// Multi-tenant isolation check. Boots the server twice (signup closed / open) and verifies that
// accounts, data, platforms, auth and the operator tools behave. Run: npm run tenant-check
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const DATA = path.join(__dirname, "..", "data");

let srv;
const start = async (port, env) => {
  srv = spawn("npx", ["tsx", "src/index.ts"], { env: { ...process.env, PORT: port, ANTHROPIC_API_KEY: "x", DATABASE_URL: process.env.TEST_DATABASE_URL || "", DASHBOARD_TOKEN: "admin-secret-code", ...env }, stdio: "ignore", detached: true });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/api/health`)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 500)); }
  throw new Error("server did not start");
};
const stop = () => { try { process.kill(-srv.pid); } catch {} };
let failed = 0;
const check = (name, ok, extra) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + JSON.stringify(extra)}`); if (!ok) failed++; };

(async () => {
  fs.rmSync(DATA, { recursive: true, force: true });
  const call = (port) => async (method, p, token, body) => {
    const r = await fetch(`http://localhost:${port}${p}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let j = {}; try { j = await r.json(); } catch {}
    return { status: r.status, body: j };
  };

  // --- closed signup (the default: existing deployments change nothing)
  await start(4101, { SIGNUP_MODE: "closed" });
  let api = call(4101);
  let r = await api("POST", "/api/auth/signup", null, { email: "a@x.co", password: "password1", businessName: "A" });
  check("signup is closed by default", r.status === 403, r);
  r = await api("GET", "/api/me", "admin-secret-code");
  check("operator code still logs into the default account", r.status === 200 && r.body.isDefault && r.body.isAdmin, r);
  stop(); await new Promise((r) => setTimeout(r, 800));

  // --- invite signup
  await start(4102, { SIGNUP_MODE: "invite" });
  api = call(4102);
  r = await api("POST", "/api/auth/signup", null, { email: "a@x.co", password: "password1", businessName: "A" });
  check("invite mode: no code is refused", r.status === 403, r);
  const inv = (await api("POST", "/api/admin/invites", "admin-secret-code", { note: "test" })).body;
  r = await api("POST", "/api/auth/signup", null, { email: "a@x.co", password: "password1", businessName: "Business A", invite: inv.code });
  check("invite mode: valid code signs up", r.status === 200 && r.body.token, r);
  const A = r.body.token;
  r = await api("POST", "/api/auth/signup", null, { email: "b@x.co", password: "password1", businessName: "B", invite: inv.code });
  check("invite code is single-use", r.status === 403, r);
  stop(); await new Promise((r) => setTimeout(r, 800));

  // --- open signup: isolation
  await start(4103, { SIGNUP_MODE: "open" });
  api = call(4103);
  r = await api("POST", "/api/auth/login", null, { email: "a@x.co", password: "password1" });
  check("login works after restart (accounts persisted)", r.status === 200 && r.body.token, r);
  const tokA = r.body.token;
  r = await api("POST", "/api/auth/login", null, { email: "a@x.co", password: "wrong-password" });
  check("wrong password rejected", r.status === 401, r);
  r = await api("POST", "/api/auth/signup", null, { email: "b@x.co", password: "password2", businessName: "Business B" });
  const tokB = r.body.token;
  check("second account created", !!tokB, r);
  r = await api("POST", "/api/auth/signup", null, { email: "short@x.co", password: "123", businessName: "S" });
  check("short password refused", r.status === 400, r);

  const items = (t) => ({ items: [{ dayOffset: 2, time: "19:00", topic: t, imageIdea: "", priority: 3, texts: { facebook: "text " + t, x: "should be dropped" } }] });
  await api("POST", "/api/plan/approve", tokA, items("only-A"));
  await api("POST", "/api/plan/approve", tokB, items("only-B"));
  const postsA = (await api("GET", "/api/posts", tokA)).body;
  const postsB = (await api("GET", "/api/posts", tokB)).body;
  const postsAdmin = (await api("GET", "/api/posts", "admin-secret-code")).body;
  check("A sees only A's posts", postsA.length === 1 && postsA[0].topic === "only-A", postsA);
  check("B sees only B's posts", postsB.length === 1 && postsB[0].topic === "only-B", postsB);
  check("the default (operator) account sees neither", postsAdmin.length === 0, postsAdmin);
  check("non-default tenants cannot use X/TikTok/website", postsA[0].platforms.every((p) => p.platform === "facebook"), postsA[0].platforms);

  await api("POST", "/api/profile", tokA, { businessName: "Business A", whatYouSell: "x", brandVoice: "voice A" });
  const pA = (await api("GET", "/api/profile", tokA)).body, pB = (await api("GET", "/api/profile", tokB)).body, pD = (await api("GET", "/api/profile", "admin-secret-code")).body;
  check("profile is per tenant", pA.configured && !pB.configured && !pD.configured, { pA, pB, pD });
  check("non-default tenants must set up their business first", pB.required === true, pB);
  r = await api("POST", "/api/posts/generate", tokB, { topic: "t", platforms: ["facebook"] });
  check("content generation blocked until the business is set up", r.status === 400, r);

  r = await api("GET", "/api/me", tokA);
  check("/api/me: tenant info, not admin, no x platform", r.status === 200 && !r.body.isAdmin && !r.body.platforms.includes("x"), r);
  r = await api("GET", "/api/connection", tokB);
  check("B has no Facebook connection (A's/operator's are not inherited)", r.status === 200 && r.body.connected === false, r);
  r = await api("GET", "/api/admin/tenants", tokA);
  check("tenants cannot use operator tools", r.status === 403, r);

  const forged = tokA.replace(/.$/, (c) => (c === "a" ? "b" : "a"));
  check("tampered token rejected", (await api("GET", "/api/posts", forged)).status === 401);
  check("no token rejected", (await api("GET", "/api/posts", null)).status === 401);
  check("random token rejected", (await api("GET", "/api/posts", "tk.abc.def")).status === 401);

  r = await api("GET", "/api/admin/tenants", "admin-secret-code");
  check("operator lists all accounts", r.status === 200 && r.body.length === 3 && r.body.some((t) => t.name === "Business B"), r);
  const idA = r.body.find((t) => t.name === "Business A").id;
  r = await api("POST", `/api/admin/tenants/${idA}`, "admin-secret-code", { plan: "basic" });
  check("operator can change a plan", r.status === 200 && r.body.plan === "basic", r);
  r = await api("GET", "/api/usage", tokA);
  check("the plan is applied to that tenant only", r.body.tier.name === "basic", r.body.tier);
  r = await api("POST", `/api/admin/tenants/${idA}`, "admin-secret-code", { status: "suspended" });
  check("suspended tenant is locked out", (await api("GET", "/api/posts", tokA)).status === 403);
  await api("POST", `/api/admin/tenants/${idA}`, "admin-secret-code", { status: "active" });

  r = await api("DELETE", "/api/account", tokB, { password: "wrong" });
  check("account deletion needs the password", r.status === 401, r);
  r = await api("DELETE", "/api/account", tokB, { password: "password2" });
  check("account deletion works", r.status === 200, r);
  check("deleted account can no longer log in", (await api("POST", "/api/auth/login", null, { email: "b@x.co", password: "password2" })).status === 401);
  check("deleted account's token is dead", (await api("GET", "/api/posts", tokB)).status === 401);
  check("A's data survived B's deletion", (await api("GET", "/api/posts", tokA)).body.length === 1);
  stop();
  fs.rmSync(DATA, { recursive: true, force: true });
  console.log(failed ? `\n${failed} FAILED` : "\nall tenant checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); stop(); process.exit(1); });

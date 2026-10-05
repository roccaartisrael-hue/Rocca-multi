// Smoke test: boots the server on a temp port and checks that every API route the dashboard relies on exists
// (answers something other than 404). Run: npm run smoke
const { spawn } = require("child_process");
const PORT = 3999;
const routes = [
  ["GET", "/api/health"], ["GET", "/api/usage"], ["GET", "/api/storage"], ["GET", "/api/profile"], ["GET", "/api/packs"],
  ["GET", "/api/posts"], ["GET", "/api/campaigns"], ["GET", "/api/connection"], ["GET", "/api/performance"],
  ["POST", "/api/profile/generate"], ["POST", "/api/profile/market"], ["POST", "/api/profile"],
  ["POST", "/api/posts/generate"], ["POST", "/api/posts/auto-schedule-all"], ["POST", "/api/plan/generate"],
  ["POST", "/api/plan/approve"], ["POST", "/api/plan/review"], ["POST", "/api/campaign/generate"], ["POST", "/api/connection/start"],
  ["GET", "/legal/privacy"], ["GET", "/legal/terms"], ["GET", "/legal/data-deletion"],
];
const srv = spawn("npx", ["tsx", "src/index.ts"], { env: { ...process.env, PORT, ANTHROPIC_API_KEY: "x", DATABASE_URL: "" }, stdio: "ignore" });
const done = (code) => { srv.kill(); process.exit(code); };
(async () => {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/api/health`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  const missing = [];
  for (const [m, p] of routes) {
    const r = await fetch(`http://localhost:${PORT}${p}`, { method: m, headers: { "content-type": "application/json" }, body: m === "POST" ? "{}" : undefined });
    const text = await r.text();
    if (r.status === 404 && /Cannot (GET|POST)/.test(text)) missing.push(`${m} ${p}`);
  }
  if (missing.length) { console.error("MISSING ROUTES:\n" + missing.join("\n")); done(1); }
  console.log(`smoke ok: ${routes.length} routes present`);
  done(0);
})();

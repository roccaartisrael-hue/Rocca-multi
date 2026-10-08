// BOOL platform end-to-end check (AI is mocked: no model calls, no money). Run: npm run platform-check
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");
const DATA = path.join(__dirname, "..", "data");
let srv, hook, hookHits = [];
const start = async (port, env) => {
  srv = spawn("npx", ["tsx", "src/index.ts"], { env: { ...process.env, PORT: port, ANTHROPIC_API_KEY: "x", AI_MOCK: "1", DATABASE_URL: process.env.TEST_DATABASE_URL || "", DASHBOARD_TOKEN: "admin-secret-code", SIGNUP_MODE: "open", PAYMENT_WEBHOOK_SECRET: "whsec", CHECKOUT_LINK_CREDITS_10: "https://pay.example/c10", LEAD_KEY: "rocca-lead-key", LEAD_WEBHOOK_URL: "http://localhost:4290/hook", ...env }, stdio: "ignore", detached: true });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/api/health`)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 500)); }
  throw new Error("server did not start");
};
const stop = () => { try { process.kill(-srv.pid); } catch {} try { hook && hook.close(); } catch {} };
let failed = 0;
const check = (name, ok, extra) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + JSON.stringify(extra)}`); if (!ok) failed++; };

(async () => {
  fs.rmSync(DATA, { recursive: true, force: true });
  hook = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { hookHits.push(JSON.parse(b)); } catch {} res.end("ok"); }); }).listen(4290);
  const PORT = 4191;
  await start(PORT, {});
  const call = async (method, p, token, body, headers = {}) => {
    const r = await fetch(`http://localhost:${PORT}${p}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch { j = { _text: text }; }
    return { status: r.status, body: j };
  };
  const ADM = "admin-secret-code";
  // fetch() ignores a custom Host header, so use plain http for the host-routing checks
  const asHost = (host, p = "/", method = "GET", headers = {}) => new Promise((resolve, reject) => {
    const q = http.request({ host: "localhost", port: PORT, path: encodeURI(p), method, headers: { host, ...headers } }, (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: b })); });
    q.on("error", reject); q.end();
  });

  // ---- prices: before VAT + the VAT-inclusive amount
  let cat = await call("GET", "/api/billing/catalog", null);
  const byId = Object.fromEntries(cat.body.items.map((i) => [i.id, i]));
  check("final prices are whole shekels incl. VAT (1,758 · 2,230 · 2,938) with net+VAT derived from them", byId.core_presence_annual.grossIls === 1758 && byId.core_presence_annual.netIls === 1489.83 && byId.core_presence_annual.vatIls === 268.17 && byId.digital_pro_annual.grossIls === 2230 && byId.total_dominance_annual.grossIls === 2938, cat.body.items.map((i) => [i.id, i.priceIls, i.grossIls]));
  check("Starter Social is in the catalog: ₪790 list → ₪932 final, monthly, no commitment", byId.starter_social_monthly && byId.starter_social_monthly.priceIls === 790 && byId.starter_social_monthly.grossIls === 932 && !byId.starter_social_monthly.commitmentMonths, byId.starter_social_monthly);
  check("every tier that is sold has a catalog entry", ["creator_lite", "creator_pro", "starter_social", "digital_core", "digital_pro", "total_dominance"].every((t) => cat.body.items.some((i) => i.tier === t)));
  check("the display defaults to Gross (the VAT-inclusive price is the prominent one)", cat.body.priceDisplay === "gross", cat.body.priceDisplay);
  check("every price carries net, VAT and gross that add up", cat.body.items.every((i) => Math.abs(i.netIls + i.vatIls - i.grossIls) < 0.005 && i.grossIls > i.netIls));
  check("the VAT note defaults to the wording the owner chose", cat.body.vatNote === "המחירים כוללים מע״מ כחוק" && cat.body.vatRate === 0.18, cat.body.vatNote);

  // ---- freemium: 3 gift credits, no card
  let r = await call("POST", "/api/auth/signup", null, { email: "free@x.co", password: "password1", businessName: "Free Biz" });
  const F = r.body.token;
  check("signup starts on the free trial with 3 gift credits", r.status === 200 && r.body.tenant.plan === "free_trial" && r.body.tenant.credits === 3, r.body.tenant);
  r = await call("GET", "/api/me", F);
  check("/api/me exposes credits and tier", r.body.credits === 3 && r.body.plan === "free_trial" && r.body.kind === "free", r.body);
  await call("POST", "/api/profile", F, { businessName: "Free Biz", whatYouSell: "x", brandVoice: "voice" });
  for (let i = 1; i <= 3; i++) {
    r = await call("POST", "/api/posts/generate", F, { topic: "t" + i, platforms: ["facebook", "instagram"] });
    check(`generation ${i}/3 works`, r.status === 200 && r.body.platforms.length === 2, r);
  }
  r = await call("GET", "/api/me", F);
  check("each successful action cost one credit", r.body.credits === 0, r.body.credits);
  r = await call("POST", "/api/posts/generate", F, { topic: "t4", platforms: ["facebook"] });
  check("out of credits → 402 with upgrade pointer", r.status === 402 && r.body.code === "no_credits", r);
  r = await call("POST", "/api/profile/market", F, {});
  check("onboarding calls are not blocked by the credit gate", r.status !== 402, r);

  // ---- paywalls
  r = await call("POST", "/api/autopilot", F, { enabled: true });
  check("autopilot is blocked on the free trial", r.status === 402 && r.body.feature === "autopilot", r);
  r = await call("POST", "/api/site/domain", F, { domain: "free-biz.co.il" });
  check("own domain is blocked below Core Presence", r.status === 402 && r.body.feature === "customDomain", r);
  r = await call("GET", "/api/ads/overview", F);
  check("ads module is blocked on the free trial", r.status === 402, r);

  // ---- checkout + webhook
  r = await call("POST", "/api/billing/quote", F, { sku: "credits_10" });
  check("the quote shows net, VAT and the exact total, plus the terms", r.body.netIls === 18.64 && r.body.vatIls === 3.36 && r.body.grossIls === 22 && r.body.terms.length >= 2, r.body);
  r = await call("POST", "/api/billing/create-checkout-session", F, { sku: "credits_10" });
  check("checkout is refused until the customer accepts the terms", r.status === 400 && r.body.code === "terms_required", r);
  r = await call("POST", "/api/billing/create-checkout-session", F, { sku: "credits_10", acceptTerms: true }, { "x-store-app": "1" });
  check("a store build never links out to a web checkout", r.status === 403 && r.body.code === "store_policy", r);
  r = await call("POST", "/api/billing/create-checkout-session", F, { sku: "credits_10", acceptTerms: true });
  check("checkout returns the hosted payment link with a signed ref", r.status === 200 && r.body.url.startsWith("https://pay.example/c10?ref=") && r.body.grossIls === 22, r);
  const ref = decodeURIComponent(r.body.url.split("ref=")[1]);
  let orders = (await call("GET", "/api/billing/orders", F)).body;
  check("a pending order is recorded with the frozen price and the accepted terms", orders.length === 1 && orders[0].status === "pending" && orders[0].grossIls === 22 && !!orders[0].termsAcceptedAt, orders);
  r = await call("POST", "/api/billing/webhook", null, { ref, paymentRef: "pay-short", amount: 19 }, { "x-webhook-secret": "whsec" });
  check("a payment for the wrong amount is rejected", r.status === 400 && /mismatch/.test(r.body.error) && (await call("GET", "/api/me", F)).body.credits === 0, r);
  r = await call("POST", "/api/billing/create-checkout-session", F, { sku: "creator_pro_monthly", acceptTerms: true });
  check("a product without a configured payment link says so (501)", r.status === 501, r);
  r = await call("POST", "/api/billing/webhook", null, { ref, paymentRef: "pay-1" }, { "x-webhook-secret": "wrong" });
  check("webhook rejects a wrong secret", r.status === 401, r);
  r = await call("POST", "/api/billing/webhook", null, { ref: ref.replace(/.$/, "0"), paymentRef: "pay-x" }, { "x-webhook-secret": "whsec" });
  check("webhook rejects a tampered ref", r.status === 400, r);
  r = await call("POST", "/api/billing/webhook", null, { ref, paymentRef: "pay-1", amount: 22 }, { "x-webhook-secret": "whsec" });
  check("a valid payment adds the credits", r.status === 200 && (await call("GET", "/api/me", F)).body.credits === 10);
  await call("POST", "/api/billing/webhook", null, { ref, paymentRef: "pay-1" }, { "x-webhook-secret": "whsec" });
  orders = (await call("GET", "/api/billing/orders", F)).body;
  check("the order is marked paid, once", orders.length === 1 && orders[0].status === "paid" && orders[0].paymentRef === "pay-1" && orders[0].method === "web", orders);
  check("the same payment replayed never double-credits", (await call("GET", "/api/me", F)).body.credits === 10);
  r = await call("POST", "/api/posts/generate", F, { topic: "t5", platforms: ["facebook"] });
  check("generation works again after buying credits", r.status === 200, r);

  // ---- creator subscription → autopilot + approval queue
  const tid = (await call("GET", "/api/admin/tenants", ADM)).body.find((t) => t.name === "Free Biz").id;
  r = await call("POST", "/api/billing/webhook", null, { tenantId: tid, sku: "creator_pro_monthly", paymentRef: "pay-2" }, { "x-webhook-secret": "whsec" });
  r = await call("GET", "/api/billing/status", F);
  check("a subscription payment activates the tier, cycle and credits", r.body.tier === "creator_pro" && r.body.cycle === "monthly" && r.body.credits === 109 && !!r.body.expiresAt, r.body);
  r = await call("POST", "/api/autopilot", F, { enabled: true });
  check("autopilot can be switched on after upgrading", r.status === 200 && r.body.autopilotEnabled === true, r);
  r = await call("POST", "/api/autopilot/run", F, {});
  check("autopilot prepares drafts and spends one credit", r.status === 200 && r.body.created === 3 && (await call("GET", "/api/me", F)).body.credits === 108, r);
  const waiting = (await call("GET", "/api/autopilot", F)).body.waiting;
  check("drafts wait for approval — nothing is scheduled or published", waiting.length === 3 && waiting.every((p) => p.status === "pending_approval"), waiting.map((p) => p.status));
  r = await call("POST", `/api/posts/${waiting[0].id}/approve`, F, {});
  check("approving a post that needs an image is refused", r.status === 400 && /תמונה/.test(r.body.error), r);
  const w = waiting[0];
  r = await call("PATCH", `/api/posts/${w.id}`, F, { platforms: w.platforms.map((p) => ({ ...p, imageUrl: "https://img.example/a.jpg", imageUrls: ["https://img.example/a.jpg", "https://img.example/b.jpg"] })) });
  r = await call("POST", `/api/posts/${w.id}/approve`, F, {});
  check("with an image the quick approval schedules the post", r.status === 200 && r.body.status === "scheduled", r);
  check("multi-image posts keep the whole carousel", r.body.platforms[0].imageUrls.length === 2, r.body.platforms[0]);
  r = await call("POST", "/api/autopilot/run", F, {});
  check("the autopilot does not pile up drafts while some wait for approval", r.body.created === 0 && r.body.skipped === "queue_full", r);

  // ---- leads
  const info = (await call("GET", "/api/leads", F)).body;
  check("each business has its own public lead key", /^[a-f0-9]{18}$/.test(info.leadKey), info);
  r = await call("POST", "/api/leads/capture", null, { key: info.leadKey, full_name: "דנה <b>כהן</b>", phone: "050-1234567", source: "landing" });
  check("lead capture works without login", r.status === 200 && r.body.ok, r);
  check("the lead is saved and visible to its business", (await call("GET", "/api/leads", F)).body.leads[0].fullName.includes("דנה"), 0);
  await new Promise((r) => setTimeout(r, 400));
  check("the owner is notified at once (call + WhatsApp links)", hookHits.length === 1 && hookHits[0].telLink === "tel:0501234567" && hookHits[0].waLink === "https://wa.me/972501234567", hookHits);
  r = await call("POST", "/api/leads/capture", null, { key: "nope", phone: "1" });
  check("an unknown key is refused", r.status === 404, r);
  r = await call("POST", "/api/leads/capture", null, { key: info.leadKey });
  check("a lead needs a phone or an email", r.status === 400, r);
  r = await call("POST", "/api/leads/capture", null, { key: info.leadKey, phone: "052", website: "bot" });
  check("honeypot submissions are dropped silently", r.status === 200 && (await call("GET", "/api/leads", F)).body.leads.length === 1, r);
  const other = await call("POST", "/api/auth/signup", null, { email: "other@x.co", password: "password1", businessName: "Other" });
  check("another business never sees these leads", (await call("GET", "/api/leads", other.body.token)).body.leads.length === 0);
  r = await call("POST", "/api/leads/capture", null, { key: "rocca-lead-key", phone: "0521111111" });
  check("the original business has its own lead key (LEAD_KEY)", r.status === 200 && (await call("GET", "/api/leads", ADM)).body.leads.length === 1);

  // ---- manual activation by the operator (deal closed in the field / through a store)
  r = await call("POST", `/api/admin/tenants/${tid}/activate`, F, { sku: "digital_core_x" });
  check("tenants cannot activate packages themselves", r.status === 403, r);
  r = await call("POST", `/api/admin/tenants/${tid}/activate`, ADM, { sku: "nope" });
  check("an unknown package is refused", r.status === 400, r);
  r = await call("POST", `/api/admin/tenants/${tid}/activate`, ADM, { sku: "starter_social_monthly", note: "נסגר בחנות" });
  r = await call("GET", "/api/billing/status", F);
  check("one click activates Starter Social with its features", r.body.tier === "starter_social" && r.body.cycle === "monthly" && r.body.credits === null && !!r.body.expiresAt, r.body);
  orders = (await call("GET", "/api/billing/orders", F)).body;
  check("the manual activation is recorded as a manual, paid order", orders[0].method === "manual" && orders[0].status === "paid" && orders[0].grossIls === 932 && orders[0].note === "נסגר בחנות", orders[0]);

  // ---- business package: unlimited credits, ads, site, domain
  await call("POST", `/api/admin/tenants/${tid}`, ADM, { plan: "digital_pro", commitmentMonths: 12, subscriptionCycle: "annual" });
  r = await call("GET", "/api/me", F);
  check("business packages are not credit-limited", r.body.credits === null && r.body.plan === "digital_pro", r.body);
  await call("POST", "/api/ads/settings", F, { adBudgetMonthly: 3000, adPlatformsEnabled: ["facebook", "instagram"] });
  const week = new Date().toISOString().slice(0, 10);
  await call("POST", "/api/ads/stats", F, { channel: "facebook", spend: 500, clicks: 100, leads: 20, impressions: 9000, periodEnd: week });
  await call("POST", "/api/ads/stats", F, { channel: "instagram", spend: 500, clicks: 100, leads: 5, impressions: 9000, periodEnd: week });
  r = await call("POST", "/api/ads/run", F, {});
  check("the allocator moves budget to the channel with the cheaper leads", r.status === 200 && r.body.shares.facebook > 0.5 && r.body.shares.instagram >= 0.1, r.body.shares);
  check("it explains itself in plain Hebrew and marks moves as recommendations", /פנייה/.test(r.body.reasoning) && r.body.actions.every((a) => a.status === "recommended") && r.body.costPerLead === 40, r.body);
  r = await call("GET", "/api/reports/summary", F);
  check("report shows leads, reach series and the budget split", r.body.series.length === 30 && r.body.totals.leads === 1 && r.body.budget.monthly === 3000, r.body.totals);

  await call("POST", "/api/profile", F, { businessName: "Free Biz", whatYouSell: "x", brandVoice: "voice" });
  r = await call("POST", "/api/site", F, { headline: "כותרת", about: "תיאור-ייחודי-123", phone: "050-1112222", whatsapp: "972501112222", status: "live" });
  r = await call("POST", "/api/site/article", F, { topic: "איך בוחרים" });
  check("an SEO article is generated and stored", r.status === 200 && r.body.slug, r);
  const site = (await call("GET", "/api/site", F)).body;
  r = await call("GET", site.publicPath, null);
  check("the public site renders with the BOOL credit pointing to rocca.co.il", r.status === 200 && /Powered by <a href="https:\/\/boolai\.co\.il"/.test(r.body._text) && /rocca\.co\.il/.test(r.body._text), r.body._text && r.body._text.slice(-400));
  r = await call("GET", `${site.publicPath}/${(await call("GET", "/api/site", F)).body.site.articles[0].slug}`, null);
  check("article pages render", r.status === 200 && /כך בוחרים אבן/.test(r.body._text), r.status);
  r = await call("GET", `${site.publicPath}/sitemap.xml`, null);
  check("sitemap lists the pages", /<urlset/.test(r.body._text) && (r.body._text.match(/<loc>/g) || []).length === 2, r.body._text);
  r = await call("GET", "/s/doesnotexist", null);
  check("unknown site key → 404", r.status === 404, r.status);
  r = await call("POST", "/api/site/domain", F, { domain: "boolai.co.il" });
  check("BOOL/ROCCA domains cannot be claimed", r.status === 400, r);
  r = await call("POST", "/api/site/domain", F, { domain: "free-biz.co.il" });
  check("Core Presence+ can request its own domain", r.status === 200 && r.body.domainStatus === "pending_dns", r);
  await call("POST", `/api/admin/tenants/${other.body.tenant.id}`, ADM, { plan: "digital_core" });
  r = await call("POST", "/api/site/domain", other.body.token, { domain: "free-biz.co.il" });
  check("a domain belongs to one business only", r.status === 409, r);
  r = await asHost("free-biz.co.il");
  check("the domain serves nothing until the operator activates it", !r.text.includes("תיאור-ייחודי-123"));
  await call("POST", `/api/admin/sites/${tid}/domain/activate`, ADM, {});
  r = await asHost("free-biz.co.il");
  check("after activation the customer's domain serves their site", r.text.includes("תיאור-ייחודי-123") && /Powered by/.test(r.text), r.text.slice(0, 200));
  r = await asHost("free-biz.co.il", "/" + (await call("GET", "/api/site", F)).body.site.articles[0].slug);
  check("and its article pages", r.status === 200 && /כך בוחרים אבן/.test(r.text), r.status);

  // ---- support
  r = await call("POST", "/api/support/tickets", F, { subject: "בעיה", message: "לא מתחבר לפייסבוק" });
  check("a ticket can be opened", r.status === 200 && r.body.status === "open", r);
  r = await call("GET", "/api/admin/tickets", ADM);
  check("the operator sees open tickets of every business", r.body.length === 1 && r.body[0].tenantName === "Free Biz", r.body);
  r = await call("POST", `/api/admin/tickets/${tid}/${r.body[0].id}/reply`, ADM, { text: "טופל", close: true });
  check("the operator replies and closes", r.body.status === "closed" && r.body.replies[0].from === "support", r.body);
  r = await call("POST", "/api/support/chat", F, { message: "איך מתחברים?" });
  check("the support assistant answers", r.status === 200 && r.body.answer.length > 0, r);
  check("tenants cannot read the operator's ticket list", (await call("GET", "/api/admin/tickets", F)).status === 403);

  // ---- subdomains
  r = await asHost("boolai.co.il");
  check("boolai.co.il serves the marketing site", r.status === 200 && r.text.includes("BOOL"), r.status);
  r = await asHost("api.boolai.co.il");
  check("api.boolai.co.il answers as an API only", JSON.parse(r.text).service === "BOOL API");
  r = await asHost("api.boolai.co.il", "/api/leads/capture", "OPTIONS", { origin: "https://some-landing.example", "access-control-request-method": "POST" });
  check("lead capture accepts cross-origin landing pages", r.headers["access-control-allow-origin"] === "https://some-landing.example", r.headers);
  r = await asHost("api.boolai.co.il", "/api/posts", "OPTIONS", { origin: "https://evil.example", "access-control-request-method": "GET" });
  check("the private API does not allow arbitrary origins", !r.headers["access-control-allow-origin"], r.headers["access-control-allow-origin"]);
  r = await asHost("api.boolai.co.il", "/api/posts", "OPTIONS", { origin: "https://app.boolai.co.il", "access-control-request-method": "GET" });
  check("app.boolai.co.il is allowed", r.headers["access-control-allow-origin"] === "https://app.boolai.co.il");

  stop();
  fs.rmSync(DATA, { recursive: true, force: true });
  console.log(failed ? `\n${failed} FAILED` : "\nall platform checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); stop(); process.exit(1); });

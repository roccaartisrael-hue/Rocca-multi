// Page-load check: opens the dashboard with a token, switches through every tab and fails on any JS error.
// Catches "works in the API but the page is broken" bugs (e.g. a variable used before its declaration).
// Run: npm run ui-check   (needs playwright: npx playwright install chromium, or PLAYWRIGHT_BROWSERS_PATH set)
const { spawn } = require("child_process");
const PORT = 3998;
let chromium;
try { ({ chromium } = require("playwright")); } catch { try { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); } catch { console.error("playwright not installed"); process.exit(2); } }
const srv = spawn("npx", ["tsx", "src/index.ts"], { env: { ...process.env, PORT, ANTHROPIC_API_KEY: "x", DATABASE_URL: "", SUPABASE_URL: "http://x", SUPABASE_SERVICE_KEY: "k" }, stdio: "ignore" });
(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://localhost:${PORT}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
  const browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSERS_PATH ? { executablePath: process.env.PLAYWRIGHT_BROWSERS_PATH + "/chromium" } : {});
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate(() => localStorage.setItem("rocca_token", "x"));
  await page.reload();
  await page.waitForTimeout(1200);
  const chips = await page.locator("#modelChips .chip").count();
  const upload = await page.locator("#imageInput + .row-actions button").count();
  for (const t of await page.$$eval("nav.tabs button", (b) => b.map((x) => x.dataset.tab))) {
    await page.click(`button[data-tab="${t}"]`);
    await page.waitForTimeout(400);
  }
  await browser.close();
  srv.kill();
  if (errors.length || chips !== 3 || upload !== 1) { console.error("UI CHECK FAILED", { errors, chips, upload }); process.exit(1); }
  console.log("ui-check ok: no JS errors, model selector + upload button present");
  process.exit(0);
})();

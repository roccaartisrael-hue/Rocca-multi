import express from "express";
import cors from "cors";
import path from "path";
import { config } from "./config";
import { api } from "./routes/api";
import { auth } from "./routes/auth";
import { publicAccount } from "./routes/account";
import { publicPlatform } from "./routes/platform";
import { publicOnboarding } from "./routes/onboarding";
import { tiktokRouter } from "./routes/tiktok";
import "./lib/platformGate";
import { siteHost, hostRouting, corsOptions } from "./lib/hosts";
import { startScheduler } from "./scheduler";
import { initPersistence, isReady, loadBlob } from "./lib/persist";

const app = express();
app.set("trust proxy", 1); // behind Render's proxy: correct client IPs for rate limits

app.use(cors(corsOptions));
// keep the raw body: payment providers sign it (HMAC) and the signature must be checked against the exact bytes
app.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
// Raw binary body for media uploads only (photos/videos): /api/media/upload
app.use("/api/media/upload", express.raw({ type: ["image/*", "video/*"], limit: "60mb" }));
app.use("/api/tiktok/upload", express.raw({ type: ["video/mp4", "video/quicktime"], limit: "64mb" }));
// Public image URLs (Facebook/Instagram fetch these); ids are unguessable.
app.get("/media/:file", async (req, res) => {
  const id = String(req.params.file).replace(/\.[a-z0-9]+$/i, "");
  const blob = /^[a-z0-9_-]+$/i.test(id) ? await loadBlob(id) : null;
  if (!blob) return res.status(404).end();
  res.set({ "Content-Type": blob.contentType, "Cache-Control": "public, max-age=31536000, immutable" }).send(blob.data);
});
app.use(express.urlencoded({ extended: false }));
app.use(hostRouting); // boolai.co.il → marketing site, api.boolai.co.il → API only
app.use(siteHost); // a customer's own domain → that customer's site
app.use(express.static(path.join(__dirname, "..", "public")));

// Until stored data is loaded, everything except the health check answers 503 — so the port opens at once
// (Render's health check passes) but nothing can read an empty cache or overwrite stored data.
app.use((req, res, next) => {
  if (isReady() || req.path === "/api/health" || !req.path.startsWith("/api") && !req.path.startsWith("/auth")) return next();
  res.status(503).json({ error: "המערכת עולה, נסו שוב בעוד רגע" });
});

app.use(publicOnboarding);
app.use(publicAccount);
app.use(publicPlatform);
app.use(auth);
app.use(tiktokRouter);
app.use(api);

async function loadStorage(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await initPersistence();
      return;
    } catch (err: any) {
      const wait = Math.min(30000, 2000 * attempt);
      console.error(`Storage init failed (attempt ${attempt}): ${err.message}. Retrying in ${wait / 1000}s…`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

// Bind first (all interfaces, Render's PORT), then load data in the background.
app.listen(config.port, "0.0.0.0", () => {
  console.log(`ROCCA social bot listening on port ${config.port}`);
  if (!config.dashboardToken) {
    console.warn("WARNING: DASHBOARD_TOKEN is not set — the API and dashboard are open to anyone who reaches this server.");
  }
  loadStorage().then(() => startScheduler());
});

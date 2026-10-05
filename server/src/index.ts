import express from "express";
import cors from "cors";
import path from "path";
import { config } from "./config";
import { api } from "./routes/api";
import { auth } from "./routes/auth";
import { startScheduler } from "./scheduler";
import { initPersistence, isReady } from "./lib/persist";

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "..", "public")));

// Until stored data is loaded, everything except the health check answers 503 — so the port opens at once
// (Render's health check passes) but nothing can read an empty cache or overwrite stored data.
app.use((req, res, next) => {
  if (isReady() || req.path === "/api/health" || !req.path.startsWith("/api") && !req.path.startsWith("/auth")) return next();
  res.status(503).json({ error: "המערכת עולה, נסו שוב בעוד רגע" });
});

app.use(auth);
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

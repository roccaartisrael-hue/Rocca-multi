import express from "express";
import cors from "cors";
import path from "path";
import { config } from "./config";
import { api } from "./routes/api";
import { auth } from "./routes/auth";
import { startScheduler } from "./scheduler";
import { initPersistence } from "./lib/persist";

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

app.use(auth);
app.use(api);

async function main() {
  await initPersistence();
  app.listen(config.port, () => {
    console.log(`ROCCA social bot listening on port ${config.port}`);
    if (!config.dashboardToken) {
      console.warn("WARNING: DASHBOARD_TOKEN is not set — the API and dashboard are open to anyone who reaches this server.");
    }
    startScheduler();
  });
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});

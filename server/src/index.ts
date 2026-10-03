import express from "express";
import cors from "cors";
import path from "path";
import { config } from "./config";
import { api } from "./routes/api";
import { startScheduler } from "./scheduler";

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

app.use(api);

app.listen(config.port, () => {
  console.log(`ROCCA social bot listening on port ${config.port}`);
  if (!config.dashboardToken) {
    console.warn("WARNING: DASHBOARD_TOKEN is not set — the API and dashboard are open to anyone who reaches this server.");
  }
  startScheduler();
});

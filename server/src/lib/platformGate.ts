import { registerExtraPlatforms } from "./tenantContext";
import { tiktokConnected } from "./tiktok";
import { hasModule } from "./plans";
import { getSite } from "./sites";

// A customer unlocks TikTok by connecting their own account, and "website" when their BOOL site (site module) is live.
registerExtraPlatforms(() => {
  const out: string[] = [];
  if (hasModule("social") && tiktokConnected()) out.push("tiktok");
  if (hasModule("site") && getSite().status === "live") out.push("website");
  return out;
});

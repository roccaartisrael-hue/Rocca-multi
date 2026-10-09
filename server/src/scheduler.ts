import cron from "node-cron";
import { config } from "./config";
import { store } from "./lib/store";
import { publishPost } from "./lib/publish";
import { getRecentMentions } from "./connectors/x";
import { fetchInsights } from "./connectors/insights";
import { handleIncoming } from "./routes/api";
import { runAsTenant, DEFAULT_TENANT } from "./lib/tenantContext";
import { activeTenantIds, expireLapsedPlans } from "./lib/tenants";
import { runAutopilot } from "./lib/autopilot";
import { runWeeklyAllocation } from "./lib/adBudget";
import { getSettings } from "./lib/settings";
import { getTier } from "./lib/plans";
import { sendBriefIfDue } from "./lib/assistantWhatsApp";

const INSIGHTS_MAX_AGE_DAYS = 14;

let lastSeenMentionId: string | undefined;

/** Runs a job once for every active tenant, each inside its own data context; one tenant's failure never stops the others. */
async function forEachTenant(job: (tenantId: string) => Promise<void>) {
  for (const id of activeTenantIds()) {
    try {
      await runAsTenant(id, () => job(id));
    } catch (err) {
      console.error(`Scheduler job failed for tenant ${id}:`, err);
    }
  }
}

async function processScheduledPosts() {
  await forEachTenant(async (tenantId) => {
    const due = store.dueScheduledPosts();
    for (const post of due) {
      try {
        await publishPost(post);
      } catch (err) {
        console.error(`Failed to publish scheduled post ${post.id} (tenant ${tenantId}):`, err);
      }
    }
  });
}

async function pollXMentions() {
  // X runs on the operator's own credentials: default tenant only.
  await runAsTenant(DEFAULT_TENANT, pollXMentionsForDefault);
}

async function pollXMentionsForDefault() {
  if (!config.x.appKey) return; // X not configured, skip silently
  try {
    const mentions = await getRecentMentions(lastSeenMentionId);
    for (const m of mentions) {
      await handleIncoming("x_mention", m.id, m.text, m.author, "אזכור ב-X");
    }
    if (mentions.length > 0) {
      lastSeenMentionId = mentions[0].id; // API returns newest first
    }
  } catch (err) {
    console.error("Failed to poll X mentions:", err);
  }
}

async function refreshInsights() {
  await forEachTenant(async () => {
    if (!config.meta.pageAccessToken) return; // this tenant has no Meta connection, skip silently
    const posts = store.postsNeedingInsightsRefresh(INSIGHTS_MAX_AGE_DAYS);
    for (const post of posts) {
      for (const pc of post.platforms) {
        if ((pc.platform !== "facebook" && pc.platform !== "instagram") || !pc.remoteId) continue;
        try {
          const metrics = await fetchInsights(pc.platform, pc.remoteId);
          if (metrics) store.updatePlatformMetrics(post.id, pc.platform, metrics);
        } catch (err) {
          console.error(`Failed to refresh insights for post ${post.id} (${pc.platform}):`, err);
        }
      }
    }
  });
}

/** Autopilot: prepares next week's drafts for every business that switched it on (approval is always the owner's). */
async function runAutopilots() {
  await forEachTenant(async () => {
    const r = await runAutopilot();
    if (r.created) console.log(`Autopilot prepared ${r.created} drafts`);
  });
}

/** Every Monday: re-split each business's paid budget by last week's results and store the plain-language explanation. */
async function runAdAllocations() {
  await forEachTenant(async () => {
    const s = getSettings();
    if (!getTier().ads || !s.adAutoDistribute || s.adBudgetMonthly <= 0) return;
    runWeeklyAllocation();
  });
}

/** Morning brief on WhatsApp for every business that connected it (each in its own time zone). */
async function runWhatsAppBriefs() {
  await forEachTenant(async () => {
    await sendBriefIfDue();
  });
}

export function startScheduler() {
  cron.schedule("*/10 * * * *", () => runWhatsAppBriefs().catch((err) => console.error("WhatsApp brief error:", err)));
  cron.schedule("11 6 * * *", () => runAutopilots().catch((err) => console.error("Autopilot error:", err)));
  cron.schedule("31 5 * * 1", () => runAdAllocations().catch((err) => console.error("Ad allocation error:", err)));
  cron.schedule("41 3 * * *", () => {
    const lapsed = expireLapsedPlans();
    if (lapsed.length) console.log(`Plans lapsed to free: ${lapsed.join(", ")}`);
  });

  // Check for due scheduled posts every minute.
  cron.schedule("* * * * *", () => {
    processScheduledPosts().catch((err) => console.error("Scheduler error:", err));
  });

  const minutes = Math.max(5, config.x.mentionsPollMinutes);
  cron.schedule(`*/${minutes} * * * *`, () => {
    pollXMentions().catch((err) => console.error("X mentions poll error:", err));
  });

  // Insights settle over the first day or two, so a daily refresh (not hourly) is plenty
  // and keeps well within the Graph API's call-rate limits.
  cron.schedule("17 3 * * *", () => {
    refreshInsights().catch((err) => console.error("Insights refresh error:", err));
  });

  console.log(
    `Scheduler started: checking scheduled posts every minute, polling X mentions every ${minutes} minutes, refreshing insights daily.`
  );
}

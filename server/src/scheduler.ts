import cron from "node-cron";
import { config } from "./config";
import { store } from "./lib/store";
import { publishPost } from "./lib/publish";
import { getRecentMentions } from "./connectors/x";
import { fetchInsights } from "./connectors/insights";
import { handleIncoming } from "./routes/api";

const INSIGHTS_MAX_AGE_DAYS = 14;

let lastSeenMentionId: string | undefined;

async function processScheduledPosts() {
  const due = store.dueScheduledPosts();
  for (const post of due) {
    try {
      await publishPost(post);
    } catch (err) {
      console.error(`Failed to publish scheduled post ${post.id}:`, err);
    }
  }
}

async function pollXMentions() {
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
  if (!config.meta.pageAccessToken) return; // Meta not configured, skip silently
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
}

export function startScheduler() {
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

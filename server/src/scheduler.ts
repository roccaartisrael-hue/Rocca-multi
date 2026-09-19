import cron from "node-cron";
import { config } from "./config";
import { store } from "./lib/store";
import { publishPost } from "./lib/publish";
import { getRecentMentions } from "./connectors/x";
import { handleIncoming } from "./routes/api";

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

export function startScheduler() {
  // Check for due scheduled posts every minute.
  cron.schedule("* * * * *", () => {
    processScheduledPosts().catch((err) => console.error("Scheduler error:", err));
  });

  const minutes = Math.max(5, config.x.mentionsPollMinutes);
  cron.schedule(`*/${minutes} * * * *`, () => {
    pollXMentions().catch((err) => console.error("X mentions poll error:", err));
  });

  console.log(
    `Scheduler started: checking scheduled posts every minute, polling X mentions every ${minutes} minutes.`
  );
}

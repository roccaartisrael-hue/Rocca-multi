import { Router, Request, Response, NextFunction } from "express";
import { config, ALL_PLATFORMS, Platform } from "../config";
import { store, PlatformContent } from "../lib/store";
import { generatePostForPlatforms, generateReplyDraft, isPriceQuestion, generateMarketingPlan, PlanItem } from "../lib/claude";
import { publishPost } from "../lib/publish";
import {
  verifyWebhookChallenge,
  parseMetaWebhook,
  replyToFacebookComment,
  replyToInstagramComment,
  sendFacebookMessage,
} from "../connectors/meta";
import { replyToTweet } from "../connectors/x";
import { fetchInsights } from "../connectors/insights";
import { currentUsage } from "../lib/usage";

export const api = Router();

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!config.dashboardToken) return next(); // no token configured = open (local/dev use only)
  const header = req.header("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : req.query.token;
  if (token !== config.dashboardToken) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

api.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

api.use("/api", requireAuth);

// Claude usage this month (calls + tokens) vs. AI_MONTHLY_LIMIT — for tracking real cost per business.
api.get("/api/usage", (_req, res) => {
  res.json(currentUsage());
});

/** Wall-clock time in Israel (Asia/Jerusalem) N days from now, as a UTC Date — the server itself runs in UTC. */
function israelTime(dayOffset: number, hour: number, minute: number): Date {
  const target = new Date(Date.now() + dayOffset * 86400000);
  const ymd = target.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  const guess = new Date(`${ymd}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
  const il = new Date(guess.toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
  const offset = il.getTime() - new Date(guess.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  return new Date(guess.getTime() - offset);
}

// ---- Marketing plan ----
api.post("/api/plan/generate", async (req, res) => {
  try {
    const b = req.body as { goal?: string; weeks?: number; postsPerWeek?: number; platforms?: Platform[]; adBudget?: number; notes?: string };
    const platforms = (b.platforms || []).filter((p) => ALL_PLATFORMS.includes(p));
    if (!platforms.length) return res.status(400).json({ error: "בחר לפחות פלטפורמה אחת" });
    const weeks = Math.min(4, Math.max(1, Math.round(Number(b.weeks) || 2)));
    const postsPerWeek = Math.min(5, Math.max(1, Math.round(Number(b.postsPerWeek) || 3)));
    const topPerformers = store.topPerformingPlatformContent("engagement", 3).map((r) => r.content.text).filter(Boolean);
    const inspirationNotes = store.listInspirations().slice(0, 3).map((i) => i.note).filter(Boolean);
    const plan = await generateMarketingPlan(
      { goal: (b.goal || "יותר פניות וחשיפה").slice(0, 300), weeks, postsPerWeek, platforms, adBudget: Number(b.adBudget) || 0, notes: (b.notes || "").slice(0, 500) },
      { topPerformers, inspirationNotes }
    );
    res.json(plan);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Turns approved plan items into posts. Items that need an image (instagram/tiktok) and have none stay drafts.
api.post("/api/plan/approve", (req, res) => {
  try {
    const items = (req.body?.items || []) as (PlanItem & { imageUrl?: string })[];
    if (!items.length) return res.status(400).json({ error: "אין פוסטים לאישור" });
    let scheduled = 0;
    let drafts = 0;
    for (const it of items) {
      const contents: PlatformContent[] = (Object.entries(it.texts || {}) as [Platform, string][])
        .filter(([p, t]) => ALL_PLATFORMS.includes(p) && t)
        .map(([p, t]) => ({ platform: p, text: t, imageUrl: it.imageUrl || undefined, status: "pending" as const }));
      if (!contents.length) continue;
      const [h, m] = String(it.time || "19:00").split(":").map(Number);
      const when = israelTime(Number(it.dayOffset) || 1, Number.isFinite(h) ? h : 19, Number.isFinite(m) ? m : 0);
      const needsImage = contents.some((c) => (c.platform === "instagram" || c.platform === "tiktok") && !c.imageUrl);
      if (needsImage) {
        // keep as draft, but remember the intended time in the topic so nothing is lost
        store.createPost(`${it.topic} (מתוכנן ל-${when.toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })} — חסרה תמונה)`, contents);
        drafts++;
      } else {
        store.createPost(it.topic, contents, when.toISOString());
        scheduled++;
      }
    }
    res.json({ scheduled, drafts });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Posts ----

api.post("/api/posts/generate", async (req, res) => {
  try {
    const { topic, platforms, imageUrl } = req.body as {
      topic: string;
      platforms: Platform[];
      imageUrl?: string;
    };
    if (!topic || !platforms?.length) {
      return res.status(400).json({ error: "topic and platforms are required" });
    }
    const invalid = platforms.filter((p) => !ALL_PLATFORMS.includes(p));
    if (invalid.length) {
      return res.status(400).json({ error: `Unknown platforms: ${invalid.join(", ")}` });
    }

    const topPerformers = store
      .topPerformingPlatformContent("engagement", 3)
      .map((row) => row.content.text)
      .filter(Boolean);
    const inspirationNotes = store
      .listInspirations()
      .slice(0, 3)
      .map((i) => i.note)
      .filter(Boolean);

    const generated = await generatePostForPlatforms(topic, platforms, { topPerformers, inspirationNotes });
    const platformContents: PlatformContent[] = platforms.map((p) => ({
      platform: p,
      text: generated[p] || "",
      imageUrl,
      status: "pending",
    }));

    const post = store.createPost(topic, platformContents);
    res.json(post);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

api.get("/api/posts", (_req, res) => {
  res.json(store.listPosts());
});

api.patch("/api/posts/:id", (req, res) => {
  const post = store.getPost(req.params.id);
  if (!post) return res.status(404).json({ error: "Not found" });
  const { platforms, scheduledFor } = req.body as {
    platforms?: PlatformContent[];
    scheduledFor?: string;
  };
  const patch: any = {};
  if (platforms) patch.platforms = platforms;
  if (scheduledFor !== undefined) {
    patch.scheduledFor = scheduledFor;
    patch.status = scheduledFor ? "scheduled" : "draft";
  }
  res.json(store.updatePost(req.params.id, patch));
});

api.post("/api/posts/:id/publish", async (req, res) => {
  const post = store.getPost(req.params.id);
  if (!post) return res.status(404).json({ error: "Not found" });
  try {
    const updated = await publishPost(post);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

api.delete("/api/posts/:id", (req, res) => {
  const ok = store.deletePost(req.params.id);
  res.json({ deleted: ok });
});

// ---- Performance / insights ----

api.get("/api/performance", (req, res) => {
  const metric = (req.query.metric as "reach" | "engagement" | "clicks") || "engagement";
  const limit = Number(req.query.limit) || 10;
  res.json(store.topPerformingPlatformContent(metric, limit));
});

api.post("/api/posts/:id/refresh-insights", async (req, res) => {
  const post = store.getPost(req.params.id);
  if (!post) return res.status(404).json({ error: "Not found" });
  const results: Record<string, string> = {};
  for (const pc of post.platforms) {
    if ((pc.platform !== "facebook" && pc.platform !== "instagram") || !pc.remoteId) continue;
    try {
      const metrics = await fetchInsights(pc.platform, pc.remoteId);
      if (metrics) store.updatePlatformMetrics(post.id, pc.platform, metrics);
      results[pc.platform] = "ok";
    } catch (err: any) {
      results[pc.platform] = err?.message || String(err);
    }
  }
  res.json({ post: store.getPost(post.id), results });
});

// ---- Inspiration (manual references — no competitor scraping, ever) ----

api.get("/api/inspirations", (_req, res) => {
  res.json(store.listInspirations());
});

api.post("/api/inspirations", (req, res) => {
  const { imageUrl, note } = req.body as { imageUrl?: string; note?: string };
  if (!imageUrl && !note) {
    return res.status(400).json({ error: "imageUrl or note is required" });
  }
  res.json(store.createInspiration(imageUrl || "", note || ""));
});

api.delete("/api/inspirations/:id", (req, res) => {
  const ok = store.deleteInspiration(req.params.id);
  res.json({ deleted: ok });
});

// ---- Replies ----

api.get("/api/replies", (req, res) => {
  const status = req.query.status as any;
  res.json(store.listReplies(status));
});

api.post("/api/replies/:id/approve", async (req, res) => {
  const reply = store.getReply(req.params.id);
  if (!reply) return res.status(404).json({ error: "Not found" });
  const text = (req.body?.text as string) || reply.draftReply;
  try {
    await sendReply(reply.source, reply.targetId, text);
    const updated = store.updateReply(reply.id, { status: "sent", draftReply: text });
    res.json(updated);
  } catch (err: any) {
    store.updateReply(reply.id, { status: "failed", error: err?.message || String(err) });
    res.status(500).json({ error: err?.message || String(err) });
  }
});

api.post("/api/replies/:id/reject", (req, res) => {
  const updated = store.updateReply(req.params.id, { status: "rejected" });
  res.json(updated);
});

async function sendReply(source: string, targetId: string, text: string) {
  switch (source) {
    case "facebook_comment":
      return replyToFacebookComment(targetId, text);
    case "instagram_comment":
      return replyToInstagramComment(targetId, text);
    case "facebook_message":
      return sendFacebookMessage(targetId, text);
    case "x_mention":
      return replyToTweet(targetId, text);
    default:
      throw new Error(`Unknown reply source: ${source}`);
  }
}

export async function handleIncoming(
  source: "facebook_comment" | "instagram_comment" | "facebook_message" | "x_mention",
  targetId: string,
  text: string,
  author: string | undefined,
  channelLabel: string
) {
  if (!targetId || !text) return;
  if (store.alreadyHandled(source, targetId)) return;

  let draftReply = "";
  try {
    draftReply = await generateReplyDraft({ incomingText: text, incomingAuthor: author, channel: channelLabel });
  } catch (err: any) {
    draftReply = "";
  }

  const priceQuestion = isPriceQuestion(text);

  const reply = store.createReply({
    source,
    incomingText: text,
    incomingAuthor: author,
    targetId,
    draftReply,
    flaggedPriceQuestion: priceQuestion,
  });

  // Price questions always wait for a human, no matter AUTO_SEND_REPLIES — never let the bot
  // improvise or confirm a number on its own.
  if (config.autoSendReplies && draftReply && !priceQuestion) {
    try {
      await sendReply(source, targetId, draftReply);
      store.updateReply(reply.id, { status: "sent" });
    } catch (err: any) {
      store.updateReply(reply.id, { status: "failed", error: err?.message || String(err) });
    }
  }
}

// ---- Meta webhooks ----

api.get("/webhooks/meta", (req, res) => {
  const challenge = verifyWebhookChallenge(
    req.query["hub.mode"] as string,
    req.query["hub.verify_token"] as string,
    req.query["hub.challenge"] as string
  );
  if (challenge) return res.status(200).send(challenge);
  res.sendStatus(403);
});

api.post("/webhooks/meta", async (req, res) => {
  res.sendStatus(200); // ack immediately; Meta requires a fast response
  try {
    const events = parseMetaWebhook(req.body);
    for (const e of events) {
      const label =
        e.kind === "facebook_comment"
          ? "תגובה בפייסבוק"
          : e.kind === "instagram_comment"
          ? "תגובה באינסטגרם"
          : "הודעה בפייסבוק מסנג'ר";
      await handleIncoming(e.kind, e.targetId, e.text, e.author, label);
    }
  } catch (err) {
    // Already responded 200 to Meta; log for the operator to see in the process logs.
    console.error("Error handling Meta webhook:", err);
  }
});

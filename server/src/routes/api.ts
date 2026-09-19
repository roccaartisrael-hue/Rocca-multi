import { Router, Request, Response, NextFunction } from "express";
import { config, ALL_PLATFORMS, Platform } from "../config";
import { store, PlatformContent } from "../lib/store";
import { generatePostForPlatforms, generateReplyDraft } from "../lib/claude";
import { publishPost } from "../lib/publish";
import {
  verifyWebhookChallenge,
  parseMetaWebhook,
  replyToFacebookComment,
  replyToInstagramComment,
  sendFacebookMessage,
} from "../connectors/meta";
import { replyToTweet } from "../connectors/x";

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

    const generated = await generatePostForPlatforms(topic, platforms);
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

  const reply = store.createReply({
    source,
    incomingText: text,
    incomingAuthor: author,
    targetId,
    draftReply,
  });

  if (config.autoSendReplies && draftReply) {
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

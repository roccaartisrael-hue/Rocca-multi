import path from "path";
import { v4 as uuid } from "uuid";
import { Platform } from "../config";
import { readDoc, writeDoc } from "./persist";

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const POSTS_FILE = path.join(DATA_DIR, "posts.json");
const REPLIES_FILE = path.join(DATA_DIR, "replies.json");
const INSPIRATIONS_FILE = path.join(DATA_DIR, "inspirations.json");

/** pending_approval: prepared by the autopilot, waits for the owner's OK — never published on its own. */
export type PostStatus = "draft" | "pending_approval" | "scheduled" | "published" | "failed";

export interface PostMetrics {
  reach?: number;
  engagement?: number;
  clicks?: number;
  saved?: number;
  fetchedAt: string;
}

export interface PlatformContent {
  platform: Platform;
  text: string;
  imageUrl?: string;
  /** Several photos → a carousel / photo album (imageUrl stays the first one). */
  imageUrls?: string[];
  status: "pending" | "sent" | "failed";
  error?: string;
  remoteId?: string;
  metrics?: PostMetrics;
}

export interface Post {
  id: string;
  topic: string;
  createdAt: string;
  scheduledFor?: string;
  status: PostStatus;
  platforms: PlatformContent[];
  /** Recommended paid promotion for this post (set by the marketing plan). */
  boost?: { budgetIls: number; days: number; audience: string; priority: number };
}

export type ReplySource = "facebook_comment" | "instagram_comment" | "facebook_message" | "x_mention";

export interface PendingReply {
  id: string;
  source: ReplySource;
  createdAt: string;
  incomingText: string;
  incomingAuthor?: string;
  targetId: string; // comment id / conversation id / tweet id
  draftReply: string;
  status: "pending" | "sent" | "rejected" | "failed";
  error?: string;
  flaggedPriceQuestion?: boolean;
}

export interface Inspiration {
  id: string;
  imageUrl: string;
  note: string;
  createdAt: string;
}

function readJson<T>(file: string): T[] {
  const raw = (readDoc(file) || "").trim();
  if (!raw) return [];
  return JSON.parse(raw) as T[];
}

function writeJson<T>(file: string, data: T[]) {
  writeDoc(file, JSON.stringify(data, null, 2));
}

export const store = {
  listPosts(): Post[] {
    return readJson<Post>(POSTS_FILE).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  getPost(id: string): Post | undefined {
    return readJson<Post>(POSTS_FILE).find((p) => p.id === id);
  },
  createPost(topic: string, platforms: PlatformContent[], scheduledFor?: string): Post {
    const posts = readJson<Post>(POSTS_FILE);
    const post: Post = {
      id: uuid(),
      topic,
      createdAt: new Date().toISOString(),
      scheduledFor,
      status: scheduledFor ? "scheduled" : "draft",
      platforms,
    };
    posts.push(post);
    writeJson(POSTS_FILE, posts);
    return post;
  },
  updatePost(id: string, patch: Partial<Post>): Post | undefined {
    const posts = readJson<Post>(POSTS_FILE);
    const idx = posts.findIndex((p) => p.id === id);
    if (idx === -1) return undefined;
    posts[idx] = { ...posts[idx], ...patch };
    writeJson(POSTS_FILE, posts);
    return posts[idx];
  },
  deletePost(id: string): boolean {
    const posts = readJson<Post>(POSTS_FILE);
    const next = posts.filter((p) => p.id !== id);
    writeJson(POSTS_FILE, next);
    return next.length !== posts.length;
  },
  dueScheduledPosts(): Post[] {
    const now = new Date().toISOString();
    return readJson<Post>(POSTS_FILE).filter(
      (p) => p.status === "scheduled" && p.scheduledFor && p.scheduledFor <= now
    );
  },
  postsNeedingInsightsRefresh(maxAgeDays: number): Post[] {
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
    return readJson<Post>(POSTS_FILE).filter(
      (p) =>
        p.status === "published" &&
        p.createdAt >= cutoff &&
        p.platforms.some((pc) => (pc.platform === "facebook" || pc.platform === "instagram") && pc.remoteId)
    );
  },
  updatePlatformMetrics(postId: string, platform: Platform, metrics: PostMetrics): Post | undefined {
    const posts = readJson<Post>(POSTS_FILE);
    const idx = posts.findIndex((p) => p.id === postId);
    if (idx === -1) return undefined;
    posts[idx] = {
      ...posts[idx],
      platforms: posts[idx].platforms.map((pc) => (pc.platform === platform ? { ...pc, metrics } : pc)),
    };
    writeJson(POSTS_FILE, posts);
    return posts[idx];
  },
  topPerformingPlatformContent(
    metric: "reach" | "engagement" | "clicks",
    limit: number
  ): { post: Post; content: PlatformContent }[] {
    const posts = readJson<Post>(POSTS_FILE);
    const flattened: { post: Post; content: PlatformContent }[] = [];
    for (const post of posts) {
      for (const pc of post.platforms) {
        if (pc.metrics && typeof pc.metrics[metric] === "number") {
          flattened.push({ post, content: pc });
        }
      }
    }
    flattened.sort((a, b) => (b.content.metrics![metric] || 0) - (a.content.metrics![metric] || 0));
    return flattened.slice(0, limit);
  },

  listReplies(statusFilter?: PendingReply["status"]): PendingReply[] {
    const all = readJson<PendingReply>(REPLIES_FILE).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
    return statusFilter ? all.filter((r) => r.status === statusFilter) : all;
  },
  getReply(id: string): PendingReply | undefined {
    return readJson<PendingReply>(REPLIES_FILE).find((r) => r.id === id);
  },
  createReply(input: Omit<PendingReply, "id" | "createdAt" | "status">): PendingReply {
    const replies = readJson<PendingReply>(REPLIES_FILE);
    const reply: PendingReply = {
      ...input,
      id: uuid(),
      createdAt: new Date().toISOString(),
      status: "pending",
    };
    replies.push(reply);
    writeJson(REPLIES_FILE, replies);
    return reply;
  },
  updateReply(id: string, patch: Partial<PendingReply>): PendingReply | undefined {
    const replies = readJson<PendingReply>(REPLIES_FILE);
    const idx = replies.findIndex((r) => r.id === id);
    if (idx === -1) return undefined;
    replies[idx] = { ...replies[idx], ...patch };
    writeJson(REPLIES_FILE, replies);
    return replies[idx];
  },
  alreadyHandled(source: ReplySource, targetId: string): boolean {
    return readJson<PendingReply>(REPLIES_FILE).some(
      (r) => r.source === source && r.targetId === targetId
    );
  },

  listInspirations(): Inspiration[] {
    return readJson<Inspiration>(INSPIRATIONS_FILE).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  createInspiration(imageUrl: string, note: string): Inspiration {
    const items = readJson<Inspiration>(INSPIRATIONS_FILE);
    const item: Inspiration = { id: uuid(), imageUrl, note, createdAt: new Date().toISOString() };
    items.push(item);
    writeJson(INSPIRATIONS_FILE, items);
    return item;
  },
  deleteInspiration(id: string): boolean {
    const items = readJson<Inspiration>(INSPIRATIONS_FILE);
    const next = items.filter((i) => i.id !== id);
    writeJson(INSPIRATIONS_FILE, next);
    return next.length !== items.length;
  },
};

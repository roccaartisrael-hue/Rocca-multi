import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { Platform } from "../config";

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const POSTS_FILE = path.join(DATA_DIR, "posts.json");
const REPLIES_FILE = path.join(DATA_DIR, "replies.json");

export type PostStatus = "draft" | "scheduled" | "published" | "failed";

export interface PlatformContent {
  platform: Platform;
  text: string;
  imageUrl?: string;
  status: "pending" | "sent" | "failed";
  error?: string;
  remoteId?: string;
}

export interface Post {
  id: string;
  topic: string;
  createdAt: string;
  scheduledFor?: string;
  status: PostStatus;
  platforms: PlatformContent[];
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
}

function ensureFile(file: string) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, "[]", "utf-8");
}

function readJson<T>(file: string): T[] {
  ensureFile(file);
  const raw = fs.readFileSync(file, "utf-8").trim();
  if (!raw) return [];
  return JSON.parse(raw) as T[];
}

function writeJson<T>(file: string, data: T[]) {
  ensureFile(file);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
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
};

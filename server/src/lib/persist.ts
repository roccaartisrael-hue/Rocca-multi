import fs from "fs";
import path from "path";
import { Pool } from "pg";
import { currentTenantId, DEFAULT_TENANT, isValidTenantId } from "./tenantContext";

/**
 * Durable storage for the JSON documents the bot keeps (posts, replies, usage, ...).
 * With DATABASE_URL set (e.g. a free Neon Postgres) every document is stored in one table and survives
 * Render restarts/redeploys. Without it, documents are plain files in data/ (fine for local dev only).
 * Reads are served from memory so the rest of the code stays synchronous; writes go to memory at once
 * and to Postgres in order, in the background.
 */
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const cache = new Map<string, string>();
let pool: Pool | null = null;
let queue: Promise<void> = Promise.resolve();
let ready = false;
let lastError = "";
let lastSavedAt = "";

/** True once stored documents are loaded (immediately when no DATABASE_URL is set). */
export function isReady(): boolean {
  return ready;
}

/** Document name inside the current tenant. The default tenant keeps the original plain names. */
function scopedName(file: string): string {
  const base = path.basename(file);
  const t = currentTenantId();
  if (t === DEFAULT_TENANT) return base;
  if (!isValidTenantId(t)) throw new Error("invalid tenant");
  return `t/${t}/${base}`;
}
const globalName = (name: string) => `sys/${path.basename(name)}`;

/** On disk (no database): where a document lives. */
const filePath = (name: string): string => path.join(DATA_DIR, name);

export async function initPersistence(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("DATABASE_URL is not set — data is stored in local files and is lost on every Render restart.");
    ready = true;
    return;
  }
  // Timeouts so an unreachable/sleeping database fails fast and is retried instead of hanging forever.
  pool = new Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 15000 });
  pool.on("error", (err) => console.error("Postgres pool error:", err.message));
  await pool.query("CREATE TABLE IF NOT EXISTS documents (name text PRIMARY KEY, body text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())");
  const { rows } = await pool.query("SELECT name, body FROM documents");
  rows.forEach((r) => cache.set(r.name, r.body));
  ready = true;
  console.log(`Persistent storage ready (${rows.length} documents loaded).`);
}

function readByName(name: string): string | undefined {
  if (pool) return cache.get(name);
  try {
    return fs.readFileSync(filePath(name), "utf-8");
  } catch {
    return undefined;
  }
}

function writeByName(name: string, body: string): void {
  if (!pool) {
    const full = filePath(name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, "utf-8");
    return;
  }
  cache.set(name, body);
  queue = queue
    .then(() =>
      pool!
        .query(
          "INSERT INTO documents (name, body) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()",
          [name, body]
        )
        .then(() => {
          lastSavedAt = new Date().toISOString();
          lastError = "";
        })
    )
    .catch((err) => {
      lastError = err.message;
      console.error(`Failed to persist ${name}:`, err.message);
    });
}

/** A document of the CURRENT tenant (the argument's file name is all that matters). */
export const readDoc = (file: string) => readByName(scopedName(file));
export const writeDoc = (file: string, body: string) => writeByName(scopedName(file), body);

/** System-wide documents (tenant list, invites, secrets) — never tenant-scoped. */
export const readGlobal = (name: string) => readByName(globalName(name));
export const writeGlobal = (name: string, body: string) => writeByName(globalName(name), body);

/** Removes every document of one tenant (account deletion). */
export function deleteTenantDocs(tenantId: string): void {
  if (!isValidTenantId(tenantId) || tenantId === DEFAULT_TENANT) throw new Error("invalid tenant");
  const prefix = `t/${tenantId}/`;
  for (const key of [...cache.keys()]) if (key.startsWith(prefix)) cache.delete(key);
  if (pool) {
    queue = queue
      .then(() => pool!.query("DELETE FROM documents WHERE name LIKE $1", [prefix + "%"]).then(() => undefined))
      .catch((err) => console.error(`Failed to delete documents of ${tenantId}:`, err.message));
  } else {
    fs.rmSync(path.join(DATA_DIR, "t", tenantId), { recursive: true, force: true });
  }
}

/** Storage health for the Settings screen: where data lives, how many documents, last save/error. */
export function storageStatus() {
  return {
    mode: pool ? "database" : "files",
    ready,
    documents: cache.size,
    lastSavedAt,
    lastError,
  };
}

/** True when images can be kept in Postgres (DATABASE_URL set). */
export const blobsAvailable = (): boolean => !!pool;

/** Stores a small binary file (a photo) in Postgres; returns its id. */
export async function saveBlob(id: string, contentType: string, data: Buffer): Promise<void> {
  if (!pool) throw new Error("no database");
  await pool.query("CREATE TABLE IF NOT EXISTS media (id text PRIMARY KEY, content_type text NOT NULL, data bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now())");
  await pool.query("INSERT INTO media (id, content_type, data) VALUES ($1, $2, $3)", [id, contentType, data]);
}

export async function loadBlob(id: string): Promise<{ contentType: string; data: Buffer } | null> {
  if (!pool) return null;
  try {
    const { rows } = await pool.query("SELECT content_type, data FROM media WHERE id = $1", [id]);
    return rows[0] ? { contentType: rows[0].content_type, data: rows[0].data } : null;
  } catch {
    return null;
  }
}

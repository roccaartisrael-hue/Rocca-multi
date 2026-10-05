import fs from "fs";
import path from "path";
import { Pool } from "pg";

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

const nameOf = (file: string) => path.basename(file);

export async function initPersistence(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("DATABASE_URL is not set — data is stored in local files and is lost on every Render restart.");
    return;
  }
  pool = new Pool({ connectionString: url, max: 3 });
  await pool.query("CREATE TABLE IF NOT EXISTS documents (name text PRIMARY KEY, body text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())");
  const { rows } = await pool.query("SELECT name, body FROM documents");
  rows.forEach((r) => cache.set(r.name, r.body));
  console.log(`Persistent storage ready (${rows.length} documents loaded).`);
}

export function readDoc(file: string): string | undefined {
  const name = nameOf(file);
  if (pool) return cache.get(name);
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return undefined;
  }
}

export function writeDoc(file: string, body: string): void {
  const name = nameOf(file);
  if (!pool) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, body, "utf-8");
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
        .then(() => undefined)
    )
    .catch((err) => console.error(`Failed to persist ${name}:`, err.message));
}

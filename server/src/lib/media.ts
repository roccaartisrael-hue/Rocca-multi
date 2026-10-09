import crypto from "crypto";
import { currentTenantId } from "./tenantContext";
import { blobsAvailable, saveBlob } from "./persist";

/**
 * Uploads a photo or video to Supabase Storage (public bucket) so Instagram/Facebook can fetch it by URL.
 * Needs SUPABASE_URL, SUPABASE_SERVICE_KEY and SUPABASE_BUCKET (default "media") — see docs/MEDIA_SETUP.md.
 */
const supabaseConfigured = (): boolean => !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
export function mediaConfigured(): boolean {
  return supabaseConfigured() || blobsAvailable();
}
const MAX_DB_IMAGE = 8 * 1024 * 1024;

const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
};

export async function uploadMedia(data: Buffer, contentType: string): Promise<string> {
  const ext = ALLOWED[contentType.split(";")[0].trim().toLowerCase()];
  if (!ext) throw new Error("סוג קובץ לא נתמך. אפשר JPG, PNG, WEBP או סרטון MP4/MOV.");
  if (!supabaseConfigured() && blobsAvailable()) {
    if (!contentType.startsWith("image/")) throw new Error("כרגע אפשר להעלות תמונות בלבד. לסרטון אפשר להדביק קישור ישיר.");
    if (data.length > MAX_DB_IMAGE) throw new Error("התמונה גדולה מדי (עד 8MB).");
    const id = `${currentTenantId()}-${crypto.randomBytes(10).toString("hex")}`;
    await saveBlob(id, contentType.split(";")[0].trim().toLowerCase(), data);
    const origin = (process.env.APP_URL || process.env.PUBLIC_URL || "").replace(/\/$/, "");
    return `${origin}/media/${id}.${ext}`;
  }
  if (!mediaConfigured()) throw new Error("העלאת קבצים עוד לא מוגדרת. אפשר להדביק קישור ישיר לתמונה או לסרטון.");
  const base = process.env.SUPABASE_URL!.replace(/\/$/, "");
  const bucket = process.env.SUPABASE_BUCKET || "media";
  const name = `${currentTenantId()}/${new Date().toISOString().slice(0, 10)}/${crypto.randomBytes(8).toString("hex")}.${ext}`;
  const res = await fetch(`${base}/storage/v1/object/${bucket}/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, apikey: process.env.SUPABASE_SERVICE_KEY!, "Content-Type": contentType, "x-upsert": "false" },
    body: data,
  });
  if (!res.ok) {
    const body: any = await res.json().catch(() => ({}));
    const msg = String(body?.message || body?.error || res.statusText);
    if (/too large|exceed|413/i.test(msg) || res.status === 413) throw new Error("הקובץ גדול מדי. אפשר לכווץ את הסרטון (1080p, עד דקה) ולנסות שוב.");
    throw new Error(`העלאה נכשלה: ${msg}`);
  }
  return `${base}/storage/v1/object/public/${bucket}/${name}`;
}

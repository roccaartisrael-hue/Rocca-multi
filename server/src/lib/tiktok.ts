import path from "path";
import { config } from "../config";
import { readDoc, writeDoc } from "./persist";
import { currentTenantId, isValidTenantId, DEFAULT_TENANT } from "./tenantContext";
import { signPayload, safeEqual, getTenant } from "./tenants";
import { brandDomain } from "./brand";

/**
 * TikTok integration (Login Kit + Content Posting API), one connection PER customer.
 * Each customer authorizes BOOL with their own TikTok account; the tokens live in that tenant's own document and never leave the server.
 * Until TikTok has audited the app, Direct Post is limited by TikTok to private (SELF_ONLY) posts; set TIKTOK_AUDITED=true afterwards.
 */
const FILE = path.join(__dirname, "..", "..", "data", "tiktok.json");
const API = "https://open.tiktokapis.com";
export const TIKTOK_SCOPES = "user.info.basic,video.publish,video.upload";
const MAX_VIDEO_BYTES = 64 * 1024 * 1024; // single-chunk upload limit

export interface TikTokConnection {
  openId: string;
  displayName: string;
  avatarUrl?: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // ms
  refreshExpiresAt: number; // ms
  scope: string;
  connectedAt: string;
}

export const tiktokConfigured = (): boolean => !!(config.tiktok.clientKey && config.tiktok.clientSecret);
export const tiktokAudited = (): boolean => process.env.TIKTOK_AUDITED === "true";

/** Must match the Redirect URI registered in the TikTok developer portal. */
export const appOrigin = (): string => (process.env.PUBLIC_APP_URL || `https://app.${brandDomain()}`).replace(/\/$/, "");
export const redirectUri = (): string => `${appOrigin()}/api/tiktok/callback`;

export function getTikTok(): TikTokConnection | null {
  try {
    const raw = readDoc(FILE);
    const c = raw ? (JSON.parse(raw) as TikTokConnection | null) : null;
    return c && c.accessToken ? c : null;
  } catch {
    return null;
  }
}
export const saveTikTok = (c: TikTokConnection): void => writeDoc(FILE, JSON.stringify(c, null, 2));
export const clearTikTok = (): void => writeDoc(FILE, "null");
export const tiktokConnected = (): boolean => !!getTikTok();

// ---- OAuth state (signed, 10 minutes, says WHOSE connection this is) ----
export function makeState(tenantId: string): string {
  const body = `${tenantId}.${Date.now()}`;
  return `${body}.${signPayload("tiktokstate:" + body).slice(0, 40)}`;
}
export function checkState(state: string): string | null {
  const [tenantId, ts, sig] = String(state || "").split(".");
  if (!tenantId || !ts || !sig || !isValidTenantId(tenantId)) return null;
  if (!safeEqual(sig, signPayload("tiktokstate:" + `${tenantId}.${ts}`).slice(0, 40))) return null;
  if (Date.now() - Number(ts) > 10 * 60 * 1000) return null;
  if (tenantId !== DEFAULT_TENANT && !getTenant(tenantId)) return null;
  return tenantId;
}

export function authUrl(): string {
  const p = new URLSearchParams({
    client_key: config.tiktok.clientKey,
    scope: TIKTOK_SCOPES,
    response_type: "code",
    redirect_uri: redirectUri(),
    state: makeState(currentTenantId()),
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${p}`;
}

async function tokenRequest(body: Record<string, string>): Promise<any> {
  const res = await fetch(`${API}/v2/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_key: config.tiktok.clientKey, client_secret: config.tiktok.clientSecret, ...body }),
    signal: AbortSignal.timeout(15000),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || j.error || !j.access_token) throw new Error(`TikTok: ${j.error_description || j.error || res.statusText}`);
  return j;
}

/** Called from the OAuth callback (inside the tenant's context): exchanges the code and stores the connection. */
export async function completeAuth(code: string): Promise<TikTokConnection> {
  const j = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });
  let displayName = "";
  let avatarUrl = "";
  try {
    const u: any = await (await fetch(`${API}/v2/user/info/?fields=open_id,display_name,avatar_url`, { headers: { Authorization: `Bearer ${j.access_token}` }, signal: AbortSignal.timeout(15000) })).json();
    displayName = u?.data?.user?.display_name || "";
    avatarUrl = u?.data?.user?.avatar_url || "";
  } catch {}
  const c: TikTokConnection = {
    openId: String(j.open_id || ""),
    displayName,
    avatarUrl,
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: Date.now() + Number(j.expires_in || 86400) * 1000,
    refreshExpiresAt: Date.now() + Number(j.refresh_expires_in || 31536000) * 1000,
    scope: String(j.scope || ""),
    connectedAt: new Date().toISOString(),
  };
  saveTikTok(c);
  return c;
}

/** A valid access token for the current tenant (refreshes it when it is about to expire). */
async function accessToken(): Promise<string> {
  const c = getTikTok();
  if (!c) throw new Error("חשבון טיקטוק לא מחובר. חברו אותו מלשונית החיבורים.");
  if (c.expiresAt - Date.now() > 60_000) return c.accessToken;
  if (Date.now() > c.refreshExpiresAt) throw new Error("החיבור לטיקטוק פג. התחברו מחדש.");
  const j = await tokenRequest({ grant_type: "refresh_token", refresh_token: c.refreshToken });
  const next: TikTokConnection = { ...c, accessToken: j.access_token, refreshToken: j.refresh_token || c.refreshToken, expiresAt: Date.now() + Number(j.expires_in || 86400) * 1000, refreshExpiresAt: Date.now() + Number(j.refresh_expires_in || 31536000) * 1000, scope: String(j.scope || c.scope) };
  saveTikTok(next);
  return next.accessToken;
}

async function call(pathname: string, body?: unknown): Promise<any> {
  const res = await fetch(`${API}${pathname}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(20000),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || (j.error && j.error.code && j.error.code !== "ok")) throw new Error(`TikTok: ${j.error?.message || j.error?.code || res.statusText}`);
  return j.data || {};
}

export interface CreatorInfo {
  nickname: string;
  username: string;
  avatarUrl: string;
  privacyOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxDurationSec: number;
  audited: boolean;
}

/** Must be queried right before showing the posting screen (TikTok UX requirement). */
export async function creatorInfo(): Promise<CreatorInfo> {
  const d = await call("/v2/post/publish/creator_info/query/");
  let options: string[] = Array.isArray(d.privacy_level_options) ? d.privacy_level_options : [];
  if (!tiktokAudited()) options = options.filter((o) => o === "SELF_ONLY"); // unaudited apps can only post privately
  return {
    nickname: d.creator_nickname || "",
    username: d.creator_username || "",
    avatarUrl: d.creator_avatar_url || "",
    privacyOptions: options,
    commentDisabled: !!d.comment_disabled,
    duetDisabled: !!d.duet_disabled,
    stitchDisabled: !!d.stitch_disabled,
    maxDurationSec: Number(d.max_video_post_duration_sec || 0),
    audited: tiktokAudited(),
  };
}

/** Only public https URLs (no localhost / private addresses) may be fetched on a customer's behalf. */
function assertPublicVideoUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("קישור הווידאו לא תקין"); }
  const h = u.hostname.toLowerCase();
  if (u.protocol !== "https:" || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || /^[\d.]+$/.test(h) || h.includes(":")) throw new Error("קישור הווידאו חייב להיות כתובת https ציבורית");
  return u;
}

async function fetchVideo(videoUrl: string): Promise<{ data: Buffer; type: string }> {
  const u = assertPublicVideoUrl(videoUrl);
  const res = await fetch(u, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error("לא ניתן להוריד את הווידאו מהקישור");
  const len = Number(res.headers.get("content-length") || 0);
  if (len > MAX_VIDEO_BYTES) throw new Error("הווידאו גדול מדי (עד 64MB)");
  const data = Buffer.from(await res.arrayBuffer());
  if (!data.length || data.length > MAX_VIDEO_BYTES) throw new Error("הווידאו גדול מדי או ריק (עד 64MB)");
  const ct = (res.headers.get("content-type") || "").split(";")[0];
  return { data, type: ct === "video/quicktime" ? "video/quicktime" : "video/mp4" };
}

async function uploadTo(uploadUrl: string, v: { data: Buffer; type: string }): Promise<void> {
  const size = v.data.length;
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": v.type, "Content-Length": String(size), "Content-Range": `bytes 0-${size - 1}/${size}` },
    body: new Uint8Array(v.data),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`העלאת הווידאו לטיקטוק נכשלה (${res.status})`);
}

export interface DirectPostInput {
  videoUrl: string;
  title: string;
  privacy: string;
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
  brandContent: boolean; // paid partnership ("branded content")
  brandOrganic: boolean; // promoting own business ("your brand")
}

/** Direct Post: publishes to the creator's profile. The caller must already hold the creator's explicit confirmation. */
export async function directPost(i: DirectPostInput): Promise<string> {
  const v = await fetchVideo(i.videoUrl);
  const d = await call("/v2/post/publish/video/init/", {
    post_info: {
      title: i.title.slice(0, 2200),
      privacy_level: i.privacy,
      disable_comment: i.disableComment,
      disable_duet: i.disableDuet,
      disable_stitch: i.disableStitch,
      brand_content_toggle: i.brandContent,
      brand_organic_toggle: i.brandOrganic,
    },
    source_info: { source: "FILE_UPLOAD", video_size: v.data.length, chunk_size: v.data.length, total_chunk_count: 1 },
  });
  if (!d.upload_url || !d.publish_id) throw new Error("TikTok לא החזירה כתובת העלאה");
  await uploadTo(d.upload_url, v);
  return String(d.publish_id);
}

/** Draft upload (video.upload): lands in the creator's TikTok inbox to edit and post there. Used for scheduled/automatic posts. */
export async function uploadDraft(videoUrl: string): Promise<string> {
  const v = await fetchVideo(videoUrl);
  const d = await call("/v2/post/publish/inbox/video/init/", {
    source_info: { source: "FILE_UPLOAD", video_size: v.data.length, chunk_size: v.data.length, total_chunk_count: 1 },
  });
  if (!d.upload_url || !d.publish_id) throw new Error("TikTok לא החזירה כתובת העלאה");
  await uploadTo(d.upload_url, v);
  return String(d.publish_id);
}

export async function publishStatus(publishId: string): Promise<{ status: string; reason?: string }> {
  const d = await call("/v2/post/publish/status/fetch/", { publish_id: publishId });
  return { status: String(d.status || "UNKNOWN"), reason: d.fail_reason ? String(d.fail_reason) : undefined };
}

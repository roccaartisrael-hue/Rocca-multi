import { config } from "../config";

const GRAPH = "https://graph.facebook.com/v19.0";

/** A media URL is treated as video when its path ends in a common video extension. */
export function isVideoUrl(url?: string): boolean {
  return !!url && /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(url);
}

interface GraphResponse {
  id?: string;
  error?: { message: string; type: string; code: number };
}

async function graphPost(pathAndQuery: string, body: Record<string, string>): Promise<GraphResponse> {
  const url = `${GRAPH}${pathAndQuery}`;
  const params = new URLSearchParams(body);
  const res = await fetch(url, { method: "POST", body: params });
  const json = (await res.json()) as GraphResponse;
  if (!res.ok || json.error) {
    throw new Error(`Meta Graph API error: ${json.error?.message || res.statusText}`);
  }
  return json;
}

/**
 * Facebook multi-photo post: each photo is uploaded unpublished (published=false) to get a media id,
 * then one feed post attaches them all (attached_media[n]).
 */
async function postPhotoAlbumToFacebook(text: string, imageUrls: string[]): Promise<string> {
  if (imageUrls.some(isVideoUrl)) throw new Error("פוסט עם כמה תמונות לא יכול לכלול סרטון");
  const ids: string[] = [];
  for (const url of imageUrls) {
    const photo = await graphPost(`/${config.meta.pageId}/photos`, { url, published: "false", access_token: config.meta.pageAccessToken });
    if (!photo.id) throw new Error("Failed to upload a photo to Facebook");
    ids.push(photo.id);
  }
  const body: Record<string, string> = { message: text, access_token: config.meta.pageAccessToken };
  ids.forEach((id, i) => (body[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id })));
  const post = await graphPost(`/${config.meta.pageId}/feed`, body);
  return post.id || "unknown";
}

export async function postToFacebook(text: string, media?: string | string[]): Promise<string> {
  if (!config.meta.pageId || !config.meta.pageAccessToken) {
    throw new Error("META_PAGE_ID / META_PAGE_ACCESS_TOKEN not configured");
  }
  const list = (Array.isArray(media) ? media : media ? [media] : []).filter(Boolean);
  if (list.length > 1) return postPhotoAlbumToFacebook(text, list);
  const imageUrl = list[0];
  const video = isVideoUrl(imageUrl);
  const endpoint = video ? `/${config.meta.pageId}/videos` : imageUrl ? `/${config.meta.pageId}/photos` : `/${config.meta.pageId}/feed`;
  const body: Record<string, string> = video
    ? { file_url: imageUrl!, description: text, access_token: config.meta.pageAccessToken }
    : imageUrl
      ? { url: imageUrl, caption: text, access_token: config.meta.pageAccessToken }
      : { message: text, access_token: config.meta.pageAccessToken };
  const result = await graphPost(endpoint, body);
  return result.id || "unknown";
}

/**
 * Instagram processes the uploaded image asynchronously. Publishing before the
 * container is FINISHED fails with "Media ID is not available", so poll its
 * status (up to ~60s) before calling media_publish.
 */
async function waitForInstagramContainer(containerId: string, tries = 20, delayMs = 3000): Promise<void> {
  const url = `${GRAPH}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(
    config.meta.pageAccessToken,
  )}`;
  for (let attempt = 0; attempt < tries; attempt++) {
    const res = await fetch(url);
    const json = (await res.json()) as { status_code?: string; status?: string; error?: { message: string } };
    if (json.error) throw new Error(`Meta Graph API error: ${json.error.message}`);
    if (json.status_code === "FINISHED") return;
    if (json.status_code === "ERROR" || json.status_code === "EXPIRED") {
      throw new Error(`Instagram could not process the media (${json.status || json.status_code})`);
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error("Instagram media processing timed out — try again in a minute");
}

/** Instagram carousel (2–10 photos): a child container per photo, then one CAROUSEL container that lists them. */
async function postCarouselToInstagram(caption: string, imageUrls: string[]): Promise<string> {
  if (imageUrls.length > 10) throw new Error("אינסטגרם מאפשר עד 10 תמונות בקרוסלה");
  if (imageUrls.some(isVideoUrl)) throw new Error("קרוסלה באינסטגרם נתמכת כאן עם תמונות בלבד");
  const children: string[] = [];
  for (const url of imageUrls) {
    const child = await graphPost(`/${config.meta.igUserId}/media`, { image_url: url, is_carousel_item: "true", access_token: config.meta.pageAccessToken });
    if (!child.id) throw new Error("Failed to create an Instagram carousel item");
    await waitForInstagramContainer(child.id);
    children.push(child.id);
  }
  const parent = await graphPost(`/${config.meta.igUserId}/media`, { media_type: "CAROUSEL", children: children.join(","), caption, access_token: config.meta.pageAccessToken });
  if (!parent.id) throw new Error("Failed to create the Instagram carousel");
  await waitForInstagramContainer(parent.id);
  const published = await graphPost(`/${config.meta.igUserId}/media_publish`, { creation_id: parent.id, access_token: config.meta.pageAccessToken });
  return published.id || "unknown";
}

export async function postToInstagram(caption: string, media: string | string[]): Promise<string> {
  if (!config.meta.igUserId || !config.meta.pageAccessToken) {
    throw new Error("META_IG_USER_ID / META_PAGE_ACCESS_TOKEN not configured");
  }
  const list = (Array.isArray(media) ? media : media ? [media] : []).filter(Boolean);
  if (list.length > 1) return postCarouselToInstagram(caption, list);
  const imageUrl = list[0] || "";
  if (!imageUrl) {
    throw new Error("Instagram requires an image (or video) URL — text-only posts are not supported");
  }
  const video = isVideoUrl(imageUrl);
  const container = await graphPost(
    `/${config.meta.igUserId}/media`,
    video
      ? { media_type: "REELS", video_url: imageUrl, caption, share_to_feed: "true", access_token: config.meta.pageAccessToken }
      : { image_url: imageUrl, caption, access_token: config.meta.pageAccessToken },
  );
  if (!container.id) throw new Error("Failed to create Instagram media container");
  // Videos take much longer to process than photos: poll up to ~5 minutes.
  if (video) await waitForInstagramContainer(container.id, 60, 5000);
  else await waitForInstagramContainer(container.id);
  const published = await graphPost(`/${config.meta.igUserId}/media_publish`, {
    creation_id: container.id,
    access_token: config.meta.pageAccessToken,
  });
  return published.id || "unknown";
}

export async function replyToFacebookComment(commentId: string, message: string): Promise<string> {
  const result = await graphPost(`/${commentId}/comments`, {
    message,
    access_token: config.meta.pageAccessToken,
  });
  return result.id || "unknown";
}

export async function replyToInstagramComment(commentId: string, message: string): Promise<string> {
  const result = await graphPost(`/${commentId}/replies`, {
    message,
    access_token: config.meta.pageAccessToken,
  });
  return result.id || "unknown";
}

export async function sendFacebookMessage(recipientPsid: string, message: string): Promise<string> {
  const result = await graphPost(`/me/messages?access_token=${config.meta.pageAccessToken}`, {
    recipient: JSON.stringify({ id: recipientPsid }),
    message: JSON.stringify({ text: message }),
    messaging_type: "RESPONSE",
  });
  return result.id || "unknown";
}

export function verifyWebhookChallenge(
  mode: string | undefined,
  token: string | undefined,
  challenge: string | undefined
): string | null {
  if (mode === "subscribe" && token === config.meta.webhookVerifyToken && challenge) {
    return challenge;
  }
  return null;
}

export interface NormalizedIncoming {
  kind: "facebook_comment" | "instagram_comment" | "facebook_message";
  accountId: string; // the Page or Instagram account id the event belongs to (routes it to a tenant)
  targetId: string; // comment id, or sender PSID for messages
  text: string;
  author?: string;
}

/**
 * Meta sends one webhook payload shape for Page (Facebook feed comments + Messenger)
 * and a separate one for Instagram. Both funnel through here.
 * See: https://developers.facebook.com/docs/graph-api/webhooks/reference
 */
export function parseMetaWebhook(body: any): NormalizedIncoming[] {
  const out: NormalizedIncoming[] = [];
  if (!body || !Array.isArray(body.entry)) return out;

  for (const entry of body.entry) {
    // Facebook Page feed comments
    for (const change of entry.changes || []) {
      if (change.field === "feed" && change.value?.item === "comment" && change.value?.verb === "add") {
        out.push({
          kind: "facebook_comment",
          accountId: String(entry.id || ""),
          targetId: change.value.comment_id,
          text: change.value.message || "",
          author: change.value.from?.name,
        });
      }
      // Instagram comments arrive as field "comments"
      if (change.field === "comments") {
        out.push({
          kind: "instagram_comment",
          accountId: String(entry.id || ""),
          targetId: change.value.id,
          text: change.value.text || "",
          author: change.value.from?.username,
        });
      }
    }

    // Messenger messages
    for (const messaging of entry.messaging || []) {
      if (messaging.message?.text && !messaging.message?.is_echo) {
        out.push({
          kind: "facebook_message",
          accountId: String(entry.id || ""),
          targetId: messaging.sender?.id,
          text: messaging.message.text,
        });
      }
    }
  }

  return out;
}

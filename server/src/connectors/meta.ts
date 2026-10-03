import { config } from "../config";

const GRAPH = "https://graph.facebook.com/v19.0";

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

export async function postToFacebook(text: string, imageUrl?: string): Promise<string> {
  if (!config.meta.pageId || !config.meta.pageAccessToken) {
    throw new Error("META_PAGE_ID / META_PAGE_ACCESS_TOKEN not configured");
  }
  const endpoint = imageUrl ? `/${config.meta.pageId}/photos` : `/${config.meta.pageId}/feed`;
  const body: Record<string, string> = imageUrl
    ? { url: imageUrl, caption: text, access_token: config.meta.pageAccessToken }
    : { message: text, access_token: config.meta.pageAccessToken };
  const result = await graphPost(endpoint, body);
  return result.id || "unknown";
}

export async function postToInstagram(caption: string, imageUrl: string): Promise<string> {
  if (!config.meta.igUserId || !config.meta.pageAccessToken) {
    throw new Error("META_IG_USER_ID / META_PAGE_ACCESS_TOKEN not configured");
  }
  if (!imageUrl) {
    throw new Error("Instagram requires an image (or video) URL — text-only posts are not supported");
  }
  const container = await graphPost(`/${config.meta.igUserId}/media`, {
    image_url: imageUrl,
    caption,
    access_token: config.meta.pageAccessToken,
  });
  if (!container.id) throw new Error("Failed to create Instagram media container");
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
          targetId: change.value.comment_id,
          text: change.value.message || "",
          author: change.value.from?.name,
        });
      }
      // Instagram comments arrive as field "comments"
      if (change.field === "comments") {
        out.push({
          kind: "instagram_comment",
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
          targetId: messaging.sender?.id,
          text: messaging.message.text,
        });
      }
    }
  }

  return out;
}

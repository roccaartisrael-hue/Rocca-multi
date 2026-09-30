import { config } from "../config";

const GRAPH = "https://graph.facebook.com/v19.0";

export interface PostMetrics {
  reach?: number;
  engagement?: number;
  clicks?: number;
  saved?: number;
  fetchedAt: string;
}

interface InsightsResponse {
  data?: { name: string; values: { value: number }[] }[];
  error?: { message: string };
}

function sumMetric(data: InsightsResponse["data"], name: string): number | undefined {
  const entry = data?.find((d) => d.name === name);
  const v = entry?.values?.[0]?.value;
  return typeof v === "number" ? v : undefined;
}

/**
 * Facebook Page post insights. Metrics chosen to match what the owner said
 * matters: reach, engagement, link clicks. See docs/PRODUCT_SPEC.md (1A-4).
 */
export async function fetchFacebookPostInsights(postId: string): Promise<PostMetrics | null> {
  if (!config.meta.pageAccessToken) return null;
  const metrics = ["post_impressions_unique", "post_engaged_users", "post_clicks"].join(",");
  const url = `${GRAPH}/${postId}/insights?metric=${metrics}&access_token=${config.meta.pageAccessToken}`;
  const res = await fetch(url);
  const json = (await res.json()) as InsightsResponse;
  if (!res.ok || json.error) {
    throw new Error(`Facebook insights error for ${postId}: ${json.error?.message || res.statusText}`);
  }
  return {
    reach: sumMetric(json.data, "post_impressions_unique"),
    engagement: sumMetric(json.data, "post_engaged_users"),
    clicks: sumMetric(json.data, "post_clicks"),
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Instagram media insights. `reach`, `saved` are stable metric names across
 * recent Graph API versions; `likes`/`comments`/`shares` are summed into
 * `engagement`. If Meta deprecates one of these for a given media type the
 * whole call fails — errors are surfaced, not silently swallowed, so it's
 * obvious in the dashboard/logs rather than showing fake zeros.
 */
export async function fetchInstagramMediaInsights(mediaId: string): Promise<PostMetrics | null> {
  if (!config.meta.pageAccessToken) return null;
  const metrics = ["reach", "likes", "comments", "shares", "saved"].join(",");
  const url = `${GRAPH}/${mediaId}/insights?metric=${metrics}&access_token=${config.meta.pageAccessToken}`;
  const res = await fetch(url);
  const json = (await res.json()) as InsightsResponse;
  if (!res.ok || json.error) {
    throw new Error(`Instagram insights error for ${mediaId}: ${json.error?.message || res.statusText}`);
  }
  const likes = sumMetric(json.data, "likes") || 0;
  const comments = sumMetric(json.data, "comments") || 0;
  const shares = sumMetric(json.data, "shares") || 0;
  return {
    reach: sumMetric(json.data, "reach"),
    engagement: likes + comments + shares,
    saved: sumMetric(json.data, "saved"),
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchInsights(
  platform: "facebook" | "instagram",
  remoteId: string
): Promise<PostMetrics | null> {
  if (platform === "facebook") return fetchFacebookPostInsights(remoteId);
  if (platform === "instagram") return fetchInstagramMediaInsights(remoteId);
  return null;
}

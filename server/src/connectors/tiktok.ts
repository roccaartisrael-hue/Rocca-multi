import { config } from "../config";

/**
 * TikTok Content Posting API (https://developers.tiktok.com/doc/content-posting-api-get-started/).
 *
 * Before this can publish anything you need:
 *   1. A TikTok developer app with the "Content Posting API" product added.
 *   2. Your app to pass TikTok's audit for `video.publish` scope — until then,
 *      posts only land in the creator's inbox as drafts (not published), which
 *      is still useful for testing but is NOT hands-free posting.
 *   3. A per-user OAuth2 access token (TIKTOK_ACCESS_TOKEN) obtained via the
 *      standard OAuth2 authorization-code flow — there is no "page token"
 *      equivalent like Meta's.
 *
 * Until those are in place this connector intentionally throws instead of
 * silently no-op'ing, so the dashboard surfaces a clear error rather than a
 * post that looks sent but never published.
 */

function assertConfigured() {
  if (!config.tiktok.clientKey || !config.tiktok.clientSecret || !config.tiktok.accessToken) {
    throw new Error(
      "TikTok not configured yet (TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET / TIKTOK_ACCESS_TOKEN). " +
        "See server/README.md for how to register an app and complete the audit."
    );
  }
}

export async function postVideoToTikTok(caption: string, videoUrl: string): Promise<string> {
  assertConfigured();
  if (!videoUrl) {
    throw new Error("TikTok requires a public video URL — text/image-only posts are not supported");
  }

  const res = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.tiktok.accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({
      post_info: {
        title: caption,
        privacy_level: "SELF_ONLY", // flip once your app has passed audit for public posting
      },
      source_info: {
        source: "PULL_FROM_URL",
        video_url: videoUrl,
      },
    }),
  });

  const json = (await res.json()) as { error?: { code?: string }; data?: { publish_id?: string } };
  if (!res.ok || json.error?.code !== "ok") {
    throw new Error(`TikTok API error: ${JSON.stringify(json.error || json)}`);
  }
  return json.data?.publish_id || "unknown";
}

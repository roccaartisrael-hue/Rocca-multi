import { uploadDraft } from "../lib/tiktok";

/**
 * Scheduled / automatic TikTok posts are sent as DRAFTS to the customer's own TikTok inbox (video.upload),
 * so the customer finishes and publishes them in TikTok. Direct publishing needs the customer's explicit
 * confirmation in the posting screen (see routes/tiktok.ts), which TikTok requires for every post.
 */
export async function postVideoToTikTok(_caption: string, videoUrl: string): Promise<string> {
  if (!videoUrl) throw new Error("TikTok requires a video URL: text/image-only posts are not supported");
  return uploadDraft(videoUrl);
}

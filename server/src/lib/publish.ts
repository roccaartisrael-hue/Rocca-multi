import { Post, PlatformContent, store } from "./store";
import { postToFacebook, postToInstagram } from "../connectors/meta";
import { postTweet } from "../connectors/x";
import { postVideoToTikTok } from "../connectors/tiktok";
import { appendWebsiteUpdate } from "../connectors/website";
import { v4 as uuid } from "uuid";
import { allowedPlatforms, isDefaultTenant } from "./tenantContext";
import { addArticle } from "./sites";

async function publishOne(pc: PlatformContent, topic: string): Promise<PlatformContent> {
  try {
    if (!allowedPlatforms([pc.platform]).length) throw new Error(`הפלטפורמה ${pc.platform} לא זמינה בחשבון הזה`);
    let remoteId: string;
    switch (pc.platform) {
      case "facebook":
        remoteId = await postToFacebook(pc.text, pc.imageUrls && pc.imageUrls.length > 1 ? pc.imageUrls : pc.imageUrl);
        break;
      case "instagram":
        remoteId = await postToInstagram(pc.text, pc.imageUrls && pc.imageUrls.length > 1 ? pc.imageUrls : pc.imageUrl || "");
        break;
      case "x":
        remoteId = await postTweet(pc.text);
        break;
      case "tiktok":
        remoteId = await postVideoToTikTok(pc.text, pc.imageUrl || "");
        break;
      case "website":
        if (isDefaultTenant()) {
          await appendWebsiteUpdate({ id: uuid(), date: new Date().toISOString(), title: topic, text: pc.text, imageUrl: pc.imageUrl });
        } else {
          // a customer's post becomes an article on their own BOOL site
          addArticle({ title: topic, description: pc.text.slice(0, 160), body: pc.text });
        }
        remoteId = "website";
        break;
      default:
        throw new Error(`Unknown platform: ${pc.platform}`);
    }
    return { ...pc, status: "sent", remoteId, error: undefined };
  } catch (err: any) {
    return { ...pc, status: "failed", error: err?.message || String(err) };
  }
}

export async function publishPost(post: Post): Promise<Post> {
  const results = await Promise.all(post.platforms.map((pc) => publishOne(pc, post.topic)));
  const anyFailed = results.some((r) => r.status === "failed");
  const allSent = results.every((r) => r.status === "sent");
  const updated = store.updatePost(post.id, {
    platforms: results,
    status: allSent ? "published" : anyFailed ? "failed" : post.status,
  });
  return updated!;
}

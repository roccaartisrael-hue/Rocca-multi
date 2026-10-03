import { Post, PlatformContent, store } from "./store";
import { postToFacebook, postToInstagram } from "../connectors/meta";
import { postTweet } from "../connectors/x";
import { postVideoToTikTok } from "../connectors/tiktok";
import { appendWebsiteUpdate } from "../connectors/website";
import { v4 as uuid } from "uuid";

async function publishOne(pc: PlatformContent, topic: string): Promise<PlatformContent> {
  try {
    let remoteId: string;
    switch (pc.platform) {
      case "facebook":
        remoteId = await postToFacebook(pc.text, pc.imageUrl);
        break;
      case "instagram":
        remoteId = await postToInstagram(pc.text, pc.imageUrl || "");
        break;
      case "x":
        remoteId = await postTweet(pc.text);
        break;
      case "tiktok":
        remoteId = await postVideoToTikTok(pc.text, pc.imageUrl || "");
        break;
      case "website":
        await appendWebsiteUpdate({
          id: uuid(),
          date: new Date().toISOString(),
          title: topic,
          text: pc.text,
          imageUrl: pc.imageUrl,
        });
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

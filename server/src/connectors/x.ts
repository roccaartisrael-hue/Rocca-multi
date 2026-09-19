import { TwitterApi } from "twitter-api-v2";
import { config } from "../config";

function client(): TwitterApi {
  if (!config.x.appKey || !config.x.appSecret || !config.x.accessToken || !config.x.accessSecret) {
    throw new Error("X_APP_KEY / X_APP_SECRET / X_ACCESS_TOKEN / X_ACCESS_SECRET not configured");
  }
  return new TwitterApi({
    appKey: config.x.appKey,
    appSecret: config.x.appSecret,
    accessToken: config.x.accessToken,
    accessSecret: config.x.accessSecret,
  });
}

export async function postTweet(text: string): Promise<string> {
  const rw = client().readWrite;
  const tweet = await rw.v2.tweet(text);
  return tweet.data.id;
}

export async function replyToTweet(tweetId: string, text: string): Promise<string> {
  const rw = client().readWrite;
  const tweet = await rw.v2.reply(text, tweetId);
  return tweet.data.id;
}

export interface XMention {
  id: string;
  text: string;
  author?: string;
}

/**
 * Polls @mentions since the given tweet id (or recent ones if omitted).
 * X has no free push-webhook tier, so the scheduler polls this periodically.
 */
export async function getRecentMentions(sinceId?: string): Promise<XMention[]> {
  const ro = client().readOnly;
  const me = await ro.v2.me();
  const result = await ro.v2.userMentionTimeline(me.data.id, {
    since_id: sinceId,
    max_results: 20,
    expansions: ["author_id"],
  });
  const users = new Map((result.data.includes?.users || []).map((u) => [u.id, u.username]));
  return (result.data.data || []).map((t) => ({
    id: t.id,
    text: t.text,
    author: t.author_id ? users.get(t.author_id) : undefined,
  }));
}

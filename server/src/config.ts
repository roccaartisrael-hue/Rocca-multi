import "dotenv/config";

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  return v.toLowerCase() === "true";
}

export const config = {
  port: Number(process.env.PORT || 3000),
  dashboardToken: process.env.DASHBOARD_TOKEN || "",

  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",

  meta: {
    pageId: process.env.META_PAGE_ID || "",
    pageAccessToken: process.env.META_PAGE_ACCESS_TOKEN || "",
    igUserId: process.env.META_IG_USER_ID || "",
    appId: process.env.META_APP_ID || "",
    appSecret: process.env.META_APP_SECRET || "",
    webhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN || "",
  },

  x: {
    appKey: process.env.X_APP_KEY || "",
    appSecret: process.env.X_APP_SECRET || "",
    accessToken: process.env.X_ACCESS_TOKEN || "",
    accessSecret: process.env.X_ACCESS_SECRET || "",
    mentionsPollMinutes: Number(process.env.X_MENTIONS_POLL_MINUTES || 15),
  },

  tiktok: {
    clientKey: process.env.TIKTOK_CLIENT_KEY || "",
    clientSecret: process.env.TIKTOK_CLIENT_SECRET || "",
    accessToken: process.env.TIKTOK_ACCESS_TOKEN || "",
  },

  website: {
    repoPath: process.env.WEBSITE_REPO_PATH || "..",
    autoGitPush: bool(process.env.AUTO_GIT_PUSH, false),
  },

  autoSendReplies: bool(process.env.AUTO_SEND_REPLIES, false),
};

export type Platform = "facebook" | "instagram" | "x" | "tiktok" | "website";

export const ALL_PLATFORMS: Platform[] = [
  "facebook",
  "instagram",
  "x",
  "tiktok",
  "website",
];

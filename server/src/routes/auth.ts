import crypto from "crypto";
import { Router, Request, Response } from "express";
import { config } from "../config";
import { saveConnection, getConnection, clearConnection } from "../lib/connection";

export const auth = Router();

const GRAPH = "https://graph.facebook.com/v19.0";
// Pages + Instagram: publish, comments, messages, insights.
const SCOPES = [
  "pages_show_list",
  "pages_manage_posts",
  "pages_read_engagement",
  "pages_manage_engagement",
  "pages_messaging",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_comments",
  "instagram_manage_insights",
].join(",");

function publicUrl(req: Request): string {
  return (process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
}

const secret = () => config.meta.appSecret || config.dashboardToken || "dev";

/** state = timestamp.signature — blocks forged callbacks and expires after 10 minutes. */
function makeState(): string {
  const ts = String(Date.now());
  return `${ts}.${crypto.createHmac("sha256", secret()).update(ts).digest("hex")}`;
}
function checkState(state: string): boolean {
  const [ts, sig] = String(state || "").split(".");
  if (!ts || !sig) return false;
  const expected = crypto.createHmac("sha256", secret()).update(ts).digest("hex");
  const ok = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  return ok && Date.now() - Number(ts) < 10 * 60 * 1000;
}

function page(res: Response, title: string, body: string) {
  res.status(200).send(`<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<body style="font-family:system-ui;background:#161412;color:#f3ead7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
<div style="max-width:420px;padding:24px;text-align:center"><h2>${title}</h2><p>${body}</p><p><a style="color:#d4b56a" href="/">חזרה לאפליקציה</a></p></div></body></html>`);
}

async function graph(path: string, params: Record<string, string>): Promise<any> {
  const url = `${GRAPH}${path}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url);
  const body: any = await res.json();
  if (!res.ok || body.error) throw new Error(body.error?.message || res.statusText);
  return body;
}

// Step 1: the app asks (authenticated, via POST) for Facebook's consent-screen URL and navigates to it.
// Returning the URL instead of taking the dashboard token in a query string keeps the token out of logs/history.
auth.post("/api/connection/start", (req, res) => {
  if (!requireAuthApi(req, res)) return;
  if (!config.meta.appId || !config.meta.appSecret) {
    return res.status(400).json({ error: "חסרה הגדרה: META_APP_ID ו-META_APP_SECRET ב-Render" });
  }
  // "Facebook Login for Business" apps take permissions from a Configuration (config_id) instead of scope.
  const configId = process.env.META_LOGIN_CONFIG_ID || "";
  const params: Record<string, string> = {
    client_id: config.meta.appId,
    redirect_uri: `${publicUrl(req)}/auth/facebook/callback`,
    state: makeState(),
    response_type: "code",
  };
  if (configId) params.config_id = configId;
  else params.scope = SCOPES;
  res.json({ url: `https://www.facebook.com/v19.0/dialog/oauth?${new URLSearchParams(params)}` });
});

// Step 2: Facebook returns here with ?code. Exchange for a long-lived user token, then read the Page + its Instagram.
auth.get("/auth/facebook/callback", async (req, res) => {
  try {
    if (req.query.error) return page(res, "החיבור בוטל", String(req.query.error_description || "לא אושרו ההרשאות."));
    if (!checkState(String(req.query.state))) return page(res, "שגיאת אבטחה", "הבקשה פגה או לא תקינה. נסו שוב מהאפליקציה.");

    const redirect = `${publicUrl(req)}/auth/facebook/callback`;
    const short = await graph("/oauth/access_token", {
      client_id: config.meta.appId,
      client_secret: config.meta.appSecret,
      redirect_uri: redirect,
      code: String(req.query.code),
    });
    const long = await graph("/oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: config.meta.appId,
      client_secret: config.meta.appSecret,
      fb_exchange_token: short.access_token,
    });
    const accounts = await graph("/me/accounts", {
      fields: "id,name,access_token,instagram_business_account{id,username}",
      access_token: long.access_token,
    });
    const pages: any[] = accounts.data || [];
    if (!pages.length) {
      return page(res, "לא נמצא עמוד", "לא נמצא עמוד פייסבוק בחשבון הזה. ודאו שבחרתם את העמוד בעת האישור, ושאתם מנהלים שלו.");
    }
    // Prefer a page that already has an Instagram account attached.
    const chosen = pages.find((p) => p.instagram_business_account) || pages[0];
    saveConnection({
      pageId: chosen.id,
      pageName: chosen.name,
      pageAccessToken: chosen.access_token,
      igUserId: chosen.instagram_business_account?.id || "",
      igUsername: chosen.instagram_business_account?.username,
      connectedAt: new Date().toISOString(),
    });
    const ig = chosen.instagram_business_account ? ` ואינסטגרם @${chosen.instagram_business_account.username}` : " (לא נמצא אינסטגרם מחובר לעמוד)";
    page(res, "✓ התחברתם בהצלחה", `חובר העמוד <b>${chosen.name}</b>${ig}.`);
  } catch (err: any) {
    page(res, "החיבור נכשל", String(err.message).replace(/[<>&]/g, ""));
  }
});

function requireAuthApi(req: Request, res: Response): boolean {
  if (!config.dashboardToken) return true;
  const header = req.header("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : req.query.token;
  if (token !== config.dashboardToken) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

// Connection status for the app (never returns the token).
auth.get("/api/connection", (req, res) => {
  if (!requireAuthApi(req, res)) return;
  const c = getConnection();
  const manual = !c && !!(process.env.META_PAGE_ACCESS_TOKEN && process.env.META_PAGE_ID);
  res.json({
    connected: !!c || manual,
    via: c ? "facebook-login" : manual ? "manual" : "none",
    pageName: c?.pageName,
    igUsername: c?.igUsername,
    igConnected: !!(c?.igUserId || process.env.META_IG_USER_ID),
    loginAvailable: !!(config.meta.appId && config.meta.appSecret),
  });
});

auth.delete("/api/connection", (req, res) => {
  if (!requireAuthApi(req, res)) return;
  clearConnection();
  res.json({ ok: true });
});

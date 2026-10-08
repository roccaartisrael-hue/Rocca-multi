import crypto from "crypto";
import { Router, Request, Response } from "express";
import { config } from "../config";
import { saveConnection, getConnection, clearConnection } from "../lib/connection";
import { authenticate } from "../lib/session";
import { runAsTenant, isDefaultTenant, isValidTenantId, DEFAULT_TENANT } from "../lib/tenantContext";
import { activeTenantIds, getTenant } from "../lib/tenants";
import { brandDomain } from "../lib/brand";

export const auth = Router();

// ---- Legal pages (privacy, terms, data deletion) — required by Meta and the app stores ----
import fs from "fs";
import path from "path";

function legalPage(file: string, extra: Record<string, string> = {}) {
  const raw = fs.readFileSync(path.join(__dirname, "..", "..", "public", "legal", file), "utf-8");
  const vars: Record<string, string> = {
    OPERATOR: process.env.OPERATOR_NAME || "מפעילת השירות",
    EMAIL: process.env.CONTACT_EMAIL || "support@example.com",
    DATE: process.env.LEGAL_DATE || new Date().toISOString().slice(0, 10),
    STATUS: "",
    ...extra,
  };
  return raw.replace(/\{\{(\w+)\}\}/g, (_m, k) => vars[k] ?? "");
}
// Canonical Meta URLs: /privacy, /terms, /data-deletion (the older /legal/* paths keep working).
auth.get(["/privacy", "/legal/privacy"], (_req, res) => res.send(legalPage("privacy.html")));
auth.get(["/terms", "/legal/terms"], (_req, res) => res.send(legalPage("terms.html")));
auth.get(["/support", "/legal/support"], (_req, res) => res.send(legalPage("support.html")));
auth.get(["/data-deletion", "/legal/data-deletion"], (req, res) => {
  const code = String(req.query.code || "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);
  res.send(legalPage("data-deletion.html", { STATUS: code ? `בקשת המחיקה התקבלה (קוד אישור: ${code}). החיבור והאסימון נמחקו.` : "" }));
});

/**
 * Meta "data deletion callback": called when a user removes the app in Facebook. We verify the signed request
 * with the app secret, drop the stored connection (token) and return the status URL + confirmation code Meta requires.
 */
auth.post("/auth/facebook/data-deletion", (req, res) => {
  try {
    const signed = String(req.body?.signed_request || "");
    const [sigB64, payloadB64] = signed.split(".");
    if (!sigB64 || !payloadB64 || !config.meta.appSecret) return res.status(400).json({ error: "invalid request" });
    const expected = crypto.createHmac("sha256", config.meta.appSecret).update(payloadB64).digest();
    const given = Buffer.from(sigB64.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return res.status(400).json({ error: "bad signature" });
    // The signed request names the Facebook user who removed the app: disconnect every tenant connected by that user.
    let fbUserId = "";
    try {
      fbUserId = String(JSON.parse(Buffer.from(payloadB64, "base64url").toString()).user_id || "");
    } catch {}
    for (const id of activeTenantIds()) {
      runAsTenant(id, () => {
        const c = getConnection();
        if (c && fbUserId && c.fbUserId === fbUserId) clearConnection();
      });
    }
    const code = crypto.randomBytes(8).toString("hex");
    res.json({ url: `${publicUrl(req)}/data-deletion?code=${code}`, confirmation_code: code });
  } catch {
    res.status(400).json({ error: "invalid request" });
  }
});

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

/** The public base URL of the app: APP_URL / PUBLIC_URL, else https://<BRAND_DOMAIN> (default boolai.co.il). Local dev uses the request host. */
function publicUrl(req: Request): string {
  const fixed = process.env.APP_URL || process.env.PUBLIC_URL;
  if (fixed) return fixed.replace(/\/$/, "");
  if (process.env.NODE_ENV !== "production" && /^(localhost|127\.0\.0\.1)/.test(req.get("host") || "")) return `${req.protocol}://${req.get("host")}`;
  return `https://${brandDomain()}`;
}

const secret = () => config.meta.appSecret || config.dashboardToken || "dev-secret";

/** state = tenantId.timestamp.signature — blocks forged callbacks, expires after 10 minutes, and says WHOSE connection this is. */
function makeState(tenantId: string): string {
  const body = `${tenantId}.${Date.now()}`;
  return `${body}.${crypto.createHmac("sha256", secret()).update(body).digest("hex")}`;
}
function checkState(state: string): string | null {
  const [tenantId, ts, sig] = String(state || "").split(".");
  if (!tenantId || !ts || !sig || !isValidTenantId(tenantId)) return null;
  const expected = crypto.createHmac("sha256", secret()).update(`${tenantId}.${ts}`).digest("hex");
  const ok = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!ok || Date.now() - Number(ts) > 10 * 60 * 1000) return null;
  if (tenantId !== DEFAULT_TENANT && !getTenant(tenantId)) return null;
  return tenantId;
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
  const a = requireAuthApi(req, res);
  if (!a) return;
  if (!config.meta.appId || !config.meta.appSecret) {
    return res.status(400).json({ error: "חסרה הגדרה: META_APP_ID ו-META_APP_SECRET ב-Render" });
  }
  // "Facebook Login for Business" apps take permissions from a Configuration (config_id) instead of scope.
  const configId = process.env.META_LOGIN_CONFIG_ID || "";
  const params: Record<string, string> = {
    client_id: config.meta.appId,
    redirect_uri: `${publicUrl(req)}/auth/facebook/callback`,
    state: makeState(a.tenantId),
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
    const tenantId = checkState(String(req.query.state));
    if (!tenantId) return page(res, "שגיאת אבטחה", "הבקשה פגה או לא תקינה. נסו שוב מהאפליקציה.");

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
    let fbUserId = "";
    try {
      fbUserId = String((await graph("/me", { fields: "id", access_token: long.access_token })).id || "");
    } catch {}
    runAsTenant(tenantId, () => saveConnection({
      fbUserId,
      pageId: chosen.id,
      pageName: chosen.name,
      pageAccessToken: chosen.access_token,
      igUserId: chosen.instagram_business_account?.id || "",
      igUsername: chosen.instagram_business_account?.username,
      connectedAt: new Date().toISOString(),
    }));
    const ig = chosen.instagram_business_account ? ` ואינסטגרם @${chosen.instagram_business_account.username}` : " (לא נמצא אינסטגרם מחובר לעמוד)";
    page(res, "✓ התחברתם בהצלחה", `חובר העמוד <b>${chosen.name}</b>${ig}.`);
  } catch (err: any) {
    page(res, "החיבור נכשל", String(err.message).replace(/[<>&]/g, ""));
  }
});

function requireAuthApi(req: Request, res: Response) {
  const a = authenticate(req);
  if (!a) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  if (a.suspended) {
    res.status(403).json({ error: "החשבון מושהה. פנו אלינו להסדרה." });
    return null;
  }
  return a;
}

// Connection status for the app (never returns the token).
auth.get("/api/connection", (req, res) => {
  const a = requireAuthApi(req, res);
  if (!a) return;
  runAsTenant(a.tenantId, () => {
  const c = getConnection();
  const manual = !c && isDefaultTenant() && !!(process.env.META_PAGE_ACCESS_TOKEN && process.env.META_PAGE_ID);
  res.json({
    connected: !!c || manual,
    via: c ? "facebook-login" : manual ? "manual" : "none",
    pageName: c?.pageName,
    igUsername: c?.igUsername,
    igConnected: !!(c?.igUserId || (isDefaultTenant() && process.env.META_IG_USER_ID)),
    loginAvailable: !!(config.meta.appId && config.meta.appSecret),
  });
  });
});

auth.delete("/api/connection", (req, res) => {
  const a = requireAuthApi(req, res);
  if (!a) return;
  runAsTenant(a.tenantId, () => clearConnection());
  res.json({ ok: true });
});

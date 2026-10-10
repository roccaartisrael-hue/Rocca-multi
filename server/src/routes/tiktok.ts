import { Router, Request, Response } from "express";
import { authenticate } from "../lib/session";
import { runAsTenant } from "../lib/tenantContext";
import { requireModule } from "../lib/checkCredits";
import {
  tiktokConfigured, tiktokAudited, getTikTok, clearTikTok, authUrl, checkState, completeAuth,
  creatorInfo, directPost, holdVideo, publishStatus, appOrigin, TIKTOK_SCOPES,
} from "../lib/tiktok";

/** TikTok connection + posting. The OAuth callback is public (TikTok redirects the customer's browser here); everything else needs the app login. */
export const tiktokRouter = Router();

const esc = (s: string) => String(s).replace(/[<>&"']/g, "");
function page(res: Response, title: string, body: string) {
  res.status(200).send(`<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<body style="font-family:system-ui;background:#161412;color:#f3ead7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
<div style="max-width:420px;padding:24px;text-align:center"><h2>${title}</h2><p>${body}</p><p><a style="color:#d4b56a" href="${appOrigin()}/">חזרה לאפליקציה</a></p></div></body></html>`);
}

tiktokRouter.get("/api/tiktok/callback", async (req: Request, res: Response) => {
  try {
    if (req.query.error) return page(res, "החיבור בוטל", esc(String(req.query.error_description || "לא אושרו ההרשאות.")));
    const tenantId = checkState(String(req.query.state || ""));
    if (!tenantId) return page(res, "שגיאת אבטחה", "הבקשה פגה או לא תקינה. נסו שוב מהאפליקציה.");
    const c = await runAsTenant(tenantId, () => completeAuth(String(req.query.code || "")));
    page(res, "✓ טיקטוק חובר", `החשבון <b>${esc(c.displayName || "שלכם")}</b> חובר ל-BOOL. אפשר לחזור לאפליקציה.`);
  } catch (e: any) {
    page(res, "החיבור נכשל", esc(e.message));
  }
});

/** Runs the handler inside the logged-in customer's tenant context. */
function authed(h: (req: Request, res: Response) => unknown | Promise<unknown>) {
  return async (req: Request, res: Response) => {
    const a = authenticate(req);
    if (!a) return res.status(401).json({ error: "Unauthorized" });
    if (a.suspended) return res.status(403).json({ error: "החשבון מושהה. פנו אלינו להסדרה." });
    await runAsTenant(a.tenantId, async () => {
      try {
        await h(req, res);
      } catch (e: any) {
        if (!res.headersSent) res.status(400).json({ error: String(e.message || e) });
      }
    });
  };
}
const moduleGate = (h: (req: Request, res: Response) => unknown | Promise<unknown>) =>
  authed(async (req, res) => {
    let ok = false;
    requireModule("social")(req, res, () => { ok = true; });
    if (ok) await h(req, res);
  });

tiktokRouter.get("/api/tiktok/status", authed((_req, res) => {
  const c = getTikTok();
  res.json({
    configured: tiktokConfigured(),
    connected: !!c,
    displayName: c?.displayName || "",
    avatarUrl: c?.avatarUrl || "",
    connectedAt: c?.connectedAt,
    canPublish: !!c && c.scope.split(",").includes("video.publish"),
    audited: tiktokAudited(),
    scopes: TIKTOK_SCOPES,
  });
}));

tiktokRouter.post("/api/tiktok/connect", moduleGate((_req, res) => {
  if (!tiktokConfigured()) return res.status(400).json({ error: "חיבור טיקטוק עדיין לא הוגדר בשרת." });
  res.json({ url: authUrl() });
}));

tiktokRouter.delete("/api/tiktok", authed((_req, res) => {
  clearTikTok();
  res.json({ ok: true });
}));

// Posting screen data: must be fetched fresh each time the screen is opened (TikTok requirement).
tiktokRouter.get("/api/tiktok/creator", moduleGate(async (_req, res) => {
  res.json(await creatorInfo());
}));

// Video chosen on the customer's device (raw body, see index.ts). Returns an id to use in /publish.
tiktokRouter.post("/api/tiktok/upload", moduleGate((req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "לא התקבל סרטון (MP4 או MOV עד 64MB)" });
  res.json({ videoId: holdVideo(req.body, String(req.header("content-type") || "")) });
}));

const PRIVACY = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"];

tiktokRouter.post("/api/tiktok/publish", moduleGate(async (req, res) => {
  const b = req.body || {};
  const videoUrl = String(b.videoUrl || "").trim();
  const videoId = String(b.videoId || "").replace(/[^a-f0-9]/g, "");
  const title = String(b.title || "").trim();
  const privacy = String(b.privacy || "");
  if (!videoUrl && !videoId) return res.status(400).json({ error: "יש לבחור סרטון" });
  if (b.consent !== true) return res.status(400).json({ error: "יש לאשר במפורש את הפרסום" });
  if (!PRIVACY.includes(privacy)) return res.status(400).json({ error: "יש לבחור מי יכול לראות את הסרטון" });
  const info = await creatorInfo();
  if (!info.privacyOptions.includes(privacy)) return res.status(400).json({ error: "רמת הפרטיות שנבחרה אינה זמינה לחשבון הזה" });
  const brandContent = !!b.brandContent;
  const brandOrganic = !!b.brandOrganic;
  if (b.commercial === true && !brandContent && !brandOrganic) return res.status(400).json({ error: "בתוכן מסחרי יש לסמן אם זה המותג שלכם או שיתוף פעולה ממומן" });
  if (brandContent && privacy === "SELF_ONLY") return res.status(400).json({ error: "תוכן ממומן אינו יכול להיות פרטי" });
  const publishId = await directPost({
    videoUrl, videoId, title, privacy,
    disableComment: info.commentDisabled || !b.allowComment,
    disableDuet: info.duetDisabled || !b.allowDuet,
    disableStitch: info.stitchDisabled || !b.allowStitch,
    brandContent, brandOrganic,
  });
  res.json({ ok: true, publishId, note: tiktokAudited() ? undefined : "עד שטיקטוק תאשר את האפליקציה, הפרסום נשמר כפרטי (רק אתם רואים)." });
}));

tiktokRouter.get("/api/tiktok/publish/:id", moduleGate(async (req, res) => {
  const id = String(req.params.id).replace(/[^\w.~-]/g, "").slice(0, 120);
  res.json(await publishStatus(id));
}));


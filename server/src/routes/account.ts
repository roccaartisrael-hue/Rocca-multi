import { Router, Request, Response, NextFunction } from "express";
import {
  createTenant, findByEmail, verifyPassword, issueToken, getTenant, listTenants, updateTenant, deleteTenant,
  createInvite, listInvites, consumeInvite, hashPassword, Tenant, withDefaults, adjustCredits, ensureLeadKey,
} from "../lib/tenants";
import { runAsTenant, isDefaultTenant, allowedPlatforms, DEFAULT_TENANT, currentTenantId } from "../lib/tenantContext";
import { ALL_PLATFORMS } from "../config";
import { getProfile } from "../lib/profile";
import { getConnection } from "../lib/connection";
import { currentUsage } from "../lib/usage";
import { getTier, TIERS, isTierName } from "../lib/plans";
import { creditsLeft } from "../lib/checkCredits";
import { store } from "../lib/store";
import { grantPack } from "../lib/credits";

/** SIGNUP_MODE: "closed" (default — nothing changes for existing deployments), "invite" (needs a code), "open". */
const signupMode = (): "closed" | "invite" | "open" => {
  const m = (process.env.SIGNUP_MODE || "closed").toLowerCase();
  return m === "open" || m === "invite" ? m : "closed";
};

// ---- tiny in-memory rate limit for the public auth endpoints (per IP) ----
const hits = new Map<string, { n: number; reset: number }>();
function limited(req: Request, max = 10, windowMs = 15 * 60 * 1000): boolean {
  const key = `${req.path}|${req.ip}`;
  const now = Date.now();
  const h = hits.get(key);
  if (!h || now > h.reset) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return false;
  }
  h.n += 1;
  return h.n > max;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Public: sign-up and login (no session yet). */
export const publicAccount = Router();

publicAccount.get("/api/auth/config", (_req, res) => {
  res.json({ signupMode: signupMode() });
});

publicAccount.post("/api/auth/signup", (req, res) => {
  if (limited(req)) return res.status(429).json({ error: "יותר מדי ניסיונות. נסו שוב בעוד כמה דקות." });
  const mode = signupMode();
  if (mode === "closed") return res.status(403).json({ error: "ההרשמה סגורה כרגע." });
  const { email, password, businessName, invite } = req.body || {};
  const mail = String(email || "").trim().toLowerCase();
  if (!EMAIL.test(mail)) return res.status(400).json({ error: "כתובת אימייל לא תקינה" });
  if (String(password || "").length < 8) return res.status(400).json({ error: "הסיסמה צריכה להיות לפחות 8 תווים" });
  if (!String(businessName || "").trim()) return res.status(400).json({ error: "חסר שם העסק" });
  if (findByEmail(mail)) return res.status(400).json({ error: "האימייל הזה כבר רשום. נסו להתחבר." });
  if (mode === "invite" && !String(invite || "").trim()) return res.status(403).json({ error: "ההרשמה בהזמנה בלבד. הזינו קוד הזמנה." });
  try {
    const tenant = createTenant({ name: String(businessName), email: mail, password: String(password) });
    if (mode === "invite" && !consumeInvite(String(invite), tenant.id)) {
      deleteTenant(tenant.id);
      return res.status(403).json({ error: "קוד ההזמנה לא תקין או שכבר נוצל." });
    }
    res.json({ token: issueToken(tenant.id), tenant: publicTenant(tenant) });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

publicAccount.post("/api/auth/login", (req, res) => {
  if (limited(req)) return res.status(429).json({ error: "יותר מדי ניסיונות. נסו שוב בעוד כמה דקות." });
  const { email, password } = req.body || {};
  const t = findByEmail(String(email || ""));
  // Same answer for "no such user" and "wrong password" so the form can't be used to discover who is registered.
  if (!t || !verifyPassword(String(password || ""), t.passwordHash)) return res.status(401).json({ error: "אימייל או סיסמה שגויים" });
  if (t.status !== "active") return res.status(403).json({ error: "החשבון מושהה. פנו אלינו להסדרה." });
  res.json({ token: issueToken(t.id), tenant: publicTenant(t) });
});

function publicTenant(t: Tenant) {
  const d = withDefaults(t);
  const left = t.trialEndsAt ? Math.ceil((new Date(t.trialEndsAt).getTime() - Date.now()) / 86400000) : null;
  return {
    id: t.id, name: t.name, email: t.email, plan: t.plan, status: t.status, trialEndsAt: t.trialEndsAt, trialDaysLeft: left,
    credits: d.creditsBalance, cycle: d.subscriptionCycle, commitmentMonths: d.commitmentMonths, planExpiresAt: d.planExpiresAt,
    country: d.country, city: d.city, currency: d.currency, language: d.language,
  };
}

/** Authenticated (mounted inside the api router, after the tenant context is set). */
export const accountRouter = Router();

const isAdmin = (req: Request) => !!(req as any).auth?.isAdmin;
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!isAdmin(req)) return res.status(403).json({ error: "Admin only" });
  next();
}

accountRouter.get("/api/me", (req, res) => {
  const id = currentTenantId();
  const t = id === DEFAULT_TENANT ? undefined : getTenant(id);
  res.json({
    tenantId: id,
    isDefault: isDefaultTenant(),
    isAdmin: isAdmin(req),
    name: t?.name || getProfile()?.businessName || "החשבון הראשי",
    email: t?.email,
    plan: getTier().name,
    planLabel: getTier().label,
    kind: getTier().kind,
    credits: creditsLeft(), // null = not credit-based (business packages / the main account)
    cycle: t ? withDefaults(t).subscriptionCycle : "none",
    trialEndsAt: t?.trialEndsAt,
    trialDaysLeft: t?.trialEndsAt ? Math.ceil((new Date(t.trialEndsAt).getTime() - Date.now()) / 86400000) : null,
    platforms: allowedPlatforms(ALL_PLATFORMS),
  });
});

accountRouter.post("/api/account/password", (req, res) => {
  const t = getTenant(currentTenantId());
  if (!t) return res.status(400).json({ error: "לחשבון הראשי אין סיסמה (קוד גישה)" });
  const { current, next } = req.body || {};
  if (!verifyPassword(String(current || ""), t.passwordHash)) return res.status(401).json({ error: "הסיסמה הנוכחית שגויה" });
  if (String(next || "").length < 8) return res.status(400).json({ error: "הסיסמה החדשה צריכה להיות לפחות 8 תווים" });
  updateTenant(t.id, { password: String(next) });
  res.json({ ok: true });
});

// Deletes the account and ALL of its data (also the answer to a data-deletion request).
accountRouter.delete("/api/account", (req, res) => {
  const t = getTenant(currentTenantId());
  if (!t) return res.status(400).json({ error: "לא ניתן למחוק את החשבון הראשי מכאן" });
  if (!verifyPassword(String(req.body?.password || ""), t.passwordHash)) return res.status(401).json({ error: "הסיסמה שגויה" });
  deleteTenant(t.id);
  res.json({ ok: true });
});

// ---- operator tools ----
accountRouter.get("/api/admin/tenants", requireAdmin, (_req, res) => {
  const rows = [{ id: DEFAULT_TENANT, name: "החשבון הראשי", email: "", plan: "", status: "active" as const, createdAt: "", trialEndsAt: undefined as string | undefined }, ...listTenants()];
  res.json(
    rows.map((t) =>
      runAsTenant(t.id, () => {
        const u = currentUsage();
        return {
          id: t.id,
          name: t.id === DEFAULT_TENANT ? getProfile()?.businessName || t.name : t.name,
          email: t.email,
          plan: getTier().name,
          credits: t.id === DEFAULT_TENANT ? null : withDefaults(t as Tenant).creditsBalance,
          status: t.status,
          createdAt: t.createdAt,
          trialEndsAt: t.trialEndsAt,
          connected: !!getConnection(),
          posts: store.listPosts().length,
          usage: { costIls: u.costIls, costCapIls: u.costCapIls, plans: u.plans, plansCap: u.plansCap },
        };
      })
    )
  );
});

accountRouter.post("/api/admin/tenants/:id", requireAdmin, (req, res) => {
  const { plan, status, trialEndsAt, password, creditsDelta, commitmentMonths, subscriptionCycle } = req.body || {};
  if (plan && !isTierName(plan)) return res.status(400).json({ error: "מסלול לא מוכר" });
  if (subscriptionCycle && !["none", "weekly", "monthly", "annual"].includes(subscriptionCycle)) return res.status(400).json({ error: "מחזור לא מוכר" });
  if (status && status !== "active" && status !== "suspended") return res.status(400).json({ error: "סטטוס לא מוכר" });
  if (password && String(password).length < 8) return res.status(400).json({ error: "סיסמה קצרה מדי" });
  const t = updateTenant(req.params.id, { plan, status, trialEndsAt, password, commitmentMonths, subscriptionCycle });
  if (!t) return res.status(404).json({ error: "לא נמצא" });
  if (Number.isFinite(Number(creditsDelta)) && Number(creditsDelta) !== 0) adjustCredits(t.id, Number(creditsDelta));
  res.json(publicTenant(getTenant(t.id)!));
});

accountRouter.post("/api/admin/tenants/:id/grant", requireAdmin, (req, res) => {
  const t = getTenant(req.params.id);
  if (!t) return res.status(404).json({ error: "לא נמצא" });
  const ok = runAsTenant(t.id, () => grantPack(String(req.body?.packId || ""), `manual-${Date.now()}`));
  if (!ok) return res.status(400).json({ error: "חבילה לא מוכרת" });
  res.json({ ok: true });
});

accountRouter.delete("/api/admin/tenants/:id", requireAdmin, (req, res) => {
  res.json({ deleted: deleteTenant(req.params.id) });
});

accountRouter.get("/api/admin/invites", requireAdmin, (_req, res) => res.json(listInvites()));
accountRouter.post("/api/admin/invites", requireAdmin, (req, res) => res.json(createInvite(String(req.body?.note || ""))));

export { hashPassword };

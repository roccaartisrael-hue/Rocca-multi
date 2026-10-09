import { Router, Request, Response, NextFunction } from "express";
import { store } from "../lib/store";
import { getTier } from "../lib/plans";
import { tierMargins } from "../lib/margins";
import { getSettings, saveSettings } from "../lib/settings";
import { runAutopilot } from "../lib/autopilot";
import { addLead, listLeads, setLeadStatus, LeadStatus } from "../lib/leads";
import { notifyLead } from "../lib/notify";
import { CATALOG, getSku, checkoutUrl, parseRef, applyPayment, vatBreakdown, vatRate, DEFAULT_VAT_NOTE, termsFor, priceDisplay } from "../lib/billing";
import { createOrder, listOrders, findOrderByRef } from "../lib/orders";
import { verifyLemonSignature, parseLemonEvent } from "../lib/mor";
import { addStats, listStats, listInsightLogs, runWeeklyAllocation, AD_CHANNELS } from "../lib/adBudget";
import { getSite, saveSite, addArticle, claimDomain, validDomain, renderSiteHtml, renderArticleHtml } from "../lib/sites";
import { listTickets, openTicket, replyTicket } from "../lib/support";
import { generateSeoArticle, answerSupport, answerAssistant, AssistantAction } from "../lib/claude";
import { listReminders, deleteReminder } from "../lib/reminders";
import { getAssistant, saveWhatsApp, validTz, createPairingCode, unbindPhone } from "../lib/assistantSettings";
import { assistantContext, executeAssistantAction } from "../lib/assistantOps";
import { waConfigured, waDisplayNumber, maskPhone, parseInbound, validWaSignature, verifyWaChallenge } from "../lib/whatsapp";
import { handleWhatsAppInbound } from "../lib/assistantWhatsApp";
import { getProfile } from "../lib/profile";
import { creditsLeft, requireFeature } from "../lib/checkCredits";
import { rateLimited } from "../lib/ratelimit";
import { currentTenantId, isDefaultTenant, runAsTenant, DEFAULT_TENANT, allowedPlatforms } from "../lib/tenantContext";
import { ALL_PLATFORMS, Platform } from "../config";
import { getTenant, findByLeadKey, ensureLeadKey, safeEqual, withDefaults, activeTenantIds, adjustCredits } from "../lib/tenants";

/** Which business does this public key belong to? LEAD_KEY (env) = the original business; others have their own key. */
function tenantForKey(key: string): string | null {
  if (!key) return null;
  const own = process.env.LEAD_KEY || "";
  if (own && safeEqual(key, own)) return DEFAULT_TENANT;
  return findByLeadKey(key)?.id || null;
}
const businessNameOf = (): string => (isDefaultTenant() ? getProfile()?.businessName || "ROCCA" : getTenant(currentTenantId())?.name || "העסק");

// ================= public (no login) =================
export const publicPlatform = Router();

publicPlatform.get("/webhooks/whatsapp", (req, res) => {
  const c = verifyWaChallenge(req.query["hub.mode"] as string, req.query["hub.verify_token"] as string, req.query["hub.challenge"] as string);
  c ? res.status(200).send(c) : res.sendStatus(403);
});
publicPlatform.post("/webhooks/whatsapp", async (req, res) => {
  if (!validWaSignature(req)) return res.sendStatus(403);
  res.sendStatus(200); // ack fast; Meta retries on slow responses
  for (const m of parseInbound(req.body)) {
    try {
      await handleWhatsAppInbound(m);
    } catch (e) {
      console.error("WhatsApp inbound error:", e);
    }
  }
});

publicPlatform.get("/api/billing/catalog", (_req, res) => {
  res.json({ vatNote: process.env.PRICES_VAT_NOTE || DEFAULT_VAT_NOTE, vatRate: vatRate(), priceDisplay: priceDisplay(), items: CATALOG.map((i) => ({ ...i, ...vatBreakdown(i.priceIls) })) });
});

// Landing pages, the generated site's form and paid-ad lead forms post here. The business is identified by its public key.
publicPlatform.post("/api/leads/capture", async (req, res) => {
  if (rateLimited(`lead|${req.ip}`, 20, 10 * 60 * 1000)) return res.status(429).json({ error: "יותר מדי פניות. נסו שוב בעוד כמה דקות." });
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // honeypot field: bots fill it, people never see it
  const tid = tenantForKey(String(b.key || ""));
  if (!tid) return res.status(404).json({ error: "לא נמצא" });
  const phone = String(b.phone || "").trim();
  const email = String(b.email || "").trim();
  if (!phone && !email) return res.status(400).json({ error: "נדרש טלפון או אימייל" });
  const out = await runAsTenant(tid, async () => {
    const lead = addLead({ fullName: b.full_name ?? b.fullName, phone, email, source: b.source, notes: b.notes });
    const s = getSettings();
    const owner = tid === DEFAULT_TENANT ? process.env.CONTACT_EMAIL : getTenant(tid)?.email;
    await notifyLead(businessNameOf(), lead, { email: s.notifyEmail || owner, whatsapp: s.notifyWhatsapp });
    return lead;
  });
  res.json({ ok: true, id: out.id });
});

// The payment provider calls this after a successful payment. Disabled unless PAYMENT_WEBHOOK_SECRET is set.
// Body: { ref | (tenantId + sku), paymentRef }. Idempotent per paymentRef.
publicPlatform.post("/api/billing/webhook", (req, res) => {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET || "";
  const given = String(req.header("x-webhook-secret") || "");
  if (!secret || !safeEqual(given, secret)) return res.status(401).json({ error: "Unauthorized" });
  const { ref, tenantId, sku, paymentRef, amount } = req.body || {};
  if (!paymentRef) return res.status(400).json({ error: "paymentRef is required" });
  const parsed = ref ? parseRef(String(ref)) : tenantId && sku ? { tenantId: String(tenantId), sku: String(sku) } : null;
  if (!parsed) return res.status(400).json({ error: "invalid ref" });
  // When the provider reports the amount it charged, it must equal the VAT-inclusive price the customer confirmed.
  if (amount !== undefined && ref) {
    const order = runAsTenant(parsed.tenantId, () => findOrderByRef(String(ref)));
    const expected = order ? order.grossIls : vatBreakdown(getSku(parsed.sku)!.priceIls).grossIls;
    if (Math.abs(Number(amount) - expected) > 0.01) return res.status(400).json({ error: `amount mismatch (expected ${expected})` });
  }
  const r = applyPayment(parsed.tenantId, parsed.sku, String(paymentRef), { ref: ref ? String(ref) : undefined, method: "web" });
  if (!r.applied) return res.status(400).json({ error: r.reason });
  res.json({ ok: true });
});

// Merchant of Record (Lemon Squeezy): the provider charges, handles tax and issues the receipt; its SIGNED webhook activates the package.
// Fails closed: unsigned / unknown / unmapped products change nothing. Needs LEMONSQUEEZY_WEBHOOK_SECRET and CHECKOUT_PRODUCT_<SKU> = the variant id.
publicPlatform.post("/api/billing/webhook/lemonsqueezy", (req, res) => {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET || "";
  if (!secret) return res.status(503).json({ error: "not configured" });
  if (!verifyLemonSignature((req as any).rawBody, req.header("x-signature"), secret)) return res.status(401).json({ error: "bad signature" });
  const pay = parseLemonEvent(req.body);
  if (!pay) return res.json({ ok: true, ignored: true }); // events we do not act on (still acknowledged so the provider stops retrying)
  const parsed = parseRef(pay.ref);
  if (!parsed) return res.status(400).json({ error: "invalid ref" });
  const wanted = process.env[`CHECKOUT_PRODUCT_${parsed.sku.toUpperCase()}`] || "";
  if (!pay.renewal) {
    // the product that was really bought must be the one this order is for (stops "pay for the cheap one, get the big one")
    if (!wanted) return res.status(400).json({ error: `product mapping missing for ${parsed.sku}` });
    if (pay.variantId !== wanted) return res.status(400).json({ error: "product mismatch" });
  } else {
    // a renewal must belong to a package that was already bought and verified here
    const hadFirst = runAsTenant(parsed.tenantId, () => listOrders().some((o) => o.sku === parsed.sku && o.status === "paid"));
    if (!hadFirst) return res.json({ ok: true, ignored: true });
  }
  const r = applyPayment(parsed.tenantId, parsed.sku, pay.paymentRef, { ref: pay.ref, method: "web", note: "Lemon Squeezy" });
  r.applied ? res.json({ ok: true }) : res.status(400).json({ error: r.reason });
});

// ---- the generated sites: /s/<key>, /s/<key>/sitemap.xml, /s/<key>/<article> ----
function withSite(req: Request, res: Response, fn: (name: string, key: string, credit: boolean) => void) {
  const key = String(req.params.key || "");
  const tid = tenantForKey(key);
  if (!tid) return res.status(404).send("Not found");
  runAsTenant(tid, () => {
    if (getSite().status !== "live") return res.status(404).send("Not found");
    fn(businessNameOf(), key, tid !== DEFAULT_TENANT && !getSite().hideCredit);
  });
}
publicPlatform.get("/s/:key", (req, res) => withSite(req, res, (name, key, credit) => res.type("html").send(renderSiteHtml(name, getSite(), key, `/s/${key}`, credit))));
publicPlatform.get("/s/:key/sitemap.xml", (req, res) =>
  withSite(req, res, (_n, key) => {
    const origin = (process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
    const urls = [`${origin}/s/${key}`, ...getSite().articles.map((a) => `${origin}/s/${key}/${a.slug}`)];
    res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`);
  })
);
publicPlatform.get("/s/:key/:slug", (req, res) =>
  withSite(req, res, (name, key, credit) => {
    const a = getSite().articles.find((x) => x.slug === req.params.slug);
    if (!a) return res.status(404).send("Not found");
    res.type("html").send(renderArticleHtml(name, a, `/s/${key}`, credit));
  })
);

// ================= authenticated (inside the tenant context) =================
export const platformRouter = Router();
const err = (res: Response, e: any, code = 500) => res.status(code).json({ error: e?.message || String(e) });

// ---- autopilot ----
platformRouter.get("/api/autopilot", (_req, res) => {
  const s = getSettings();
  const tier = getTier();
  const waiting = store.listPosts().filter((p) => p.status === "pending_approval");
  res.json({ enabled: s.autopilotEnabled, available: isDefaultTenant() || tier.autopilot, lastRun: s.autopilotLastRun, waiting });
});
platformRouter.post("/api/autopilot", (req, res) => {
  const enabled = !!req.body?.enabled;
  if (enabled && !isDefaultTenant() && !getTier().autopilot) {
    return res.status(402).json({ error: "הטייס האוטומטי זמין במנוי בתשלום. אפשר לשדרג בלשונית 'חבילות'.", code: "upgrade_required", feature: "autopilot", upgrade: "/#plans" });
  }
  res.json(saveSettings({ autopilotEnabled: enabled }));
});
platformRouter.post("/api/autopilot/run", requireFeature("autopilot"), async (_req, res) => {
  try {
    res.json(await runAutopilot({ force: true }));
  } catch (e) {
    err(res, e);
  }
});

// ---- settings (notifications) ----
platformRouter.get("/api/settings", (_req, res) => res.json(getSettings()));
platformRouter.post("/api/settings", (req, res) => {
  const b = req.body || {};
  const patch: any = {};
  if (b.notifyEmail !== undefined) patch.notifyEmail = String(b.notifyEmail).slice(0, 160);
  if (b.notifyWhatsapp !== undefined) patch.notifyWhatsapp = String(b.notifyWhatsapp).replace(/\D/g, "").slice(0, 15);
  res.json(saveSettings(patch));
});

// ---- leads ----
platformRouter.get("/api/leads", (_req, res) => {
  const tid = currentTenantId();
  const key = tid === DEFAULT_TENANT ? process.env.LEAD_KEY || "" : ensureLeadKey(tid);
  res.json({ leads: listLeads(), leadKey: key, endpoint: "/api/leads/capture" });
});
platformRouter.post("/api/leads/:id/status", (req, res) => {
  const st = String(req.body?.status) as LeadStatus;
  if (!["new", "contacted", "won", "lost"].includes(st)) return res.status(400).json({ error: "סטטוס לא מוכר" });
  const l = setLeadStatus(req.params.id, st);
  l ? res.json(l) : res.status(404).json({ error: "לא נמצא" });
});

// ---- billing ----
platformRouter.get("/api/billing/status", (_req, res) => {
  const tier = getTier();
  const t = isDefaultTenant() ? null : getTenant(currentTenantId());
  const d = t ? withDefaults(t) : null;
  res.json({
    tier: tier.name, tierLabel: tier.label, kind: tier.kind,
    credits: creditsLeft(), unlimited: creditsLeft() === null,
    cycle: d?.subscriptionCycle ?? "none", commitmentMonths: d?.commitmentMonths ?? 0, expiresAt: d?.planExpiresAt,
    features: { autopilot: isDefaultTenant() || tier.autopilot, customDomain: isDefaultTenant() || tier.customDomain, ads: isDefaultTenant() || tier.ads, leadBot: isDefaultTenant() || tier.leadBot },
  });
});
// The confirmation screen: exactly what will be charged, and the terms the customer agrees to.
platformRouter.post("/api/billing/quote", (req, res) => {
  const sku = getSku(String(req.body?.sku || ""));
  if (!sku) return res.status(400).json({ error: "מוצר לא מוכר" });
  res.json({ sku: sku.id, label: sku.label, cycle: sku.cycle, commitmentMonths: sku.commitmentMonths ?? 0, ...vatBreakdown(sku.priceIls), vatRate: vatRate(), terms: termsFor(sku), includes: sku.includes || [] });
});

// In-app checkout: the customer confirms the quote and accepts the terms → a pending order with a frozen price →
// the hosted payment page of the clearing provider (no card data ever touches this server) → webhook marks it paid.
platformRouter.post("/api/billing/create-checkout-session", (req, res) => {
  if (isDefaultTenant()) return res.status(400).json({ error: "החשבון הראשי לא נרכש בתשלום" });
  // Store builds (Google Play / App Store) must not link out to a web checkout for digital goods; they ask the user to manage the plan on the web.
  if (req.header("x-store-app")) return res.status(403).json({ error: "את המנוי מנהלים באתר, בחשבון שלך.", code: "store_policy" });
  const sku = getSku(String(req.body?.sku || ""));
  if (!sku) return res.status(400).json({ error: "מוצר לא מוכר" });
  if (req.body?.acceptTerms !== true) return res.status(400).json({ error: "יש לאשר את תנאי הרכישה לפני המעבר לתשלום", code: "terms_required" });
  const c = checkoutUrl(currentTenantId(), sku.id);
  if (!c) return res.status(501).json({ error: "הסליקה עדיין לא הוגדרה למוצר הזה. פנו אלינו ונפעיל את החבילה ידנית.", code: "checkout_not_configured" });
  const order = createOrder(sku, c.ref, new Date().toISOString());
  res.json({ url: c.url, orderId: order.id, grossIls: order.grossIls });
});

platformRouter.get("/api/billing/orders", (_req, res) => res.json(listOrders()));

// ---- ads: smart budget allocation + transparent reports ----
platformRouter.get("/api/ads/overview", requireFeature("ads"), (_req, res) => {
  res.json({ settings: getSettings(), channels: AD_CHANNELS, stats: listStats().slice(-60), logs: listInsightLogs().slice(0, 12) });
});
platformRouter.post("/api/ads/settings", requireFeature("ads"), (req, res) => {
  const b = req.body || {};
  const patch: any = {};
  if (b.adBudgetMonthly !== undefined) patch.adBudgetMonthly = Math.max(0, Math.min(1_000_000, Math.round(Number(b.adBudgetMonthly) || 0)));
  if (b.adAutoDistribute !== undefined) patch.adAutoDistribute = !!b.adAutoDistribute;
  if (Array.isArray(b.adPlatformsEnabled)) patch.adPlatformsEnabled = b.adPlatformsEnabled.filter((c: string) => (AD_CHANNELS as readonly string[]).includes(c));
  res.json(saveSettings(patch));
});
platformRouter.post("/api/ads/stats", requireFeature("ads"), (req, res) => {
  const b = req.body || {};
  if (!(AD_CHANNELS as readonly string[]).includes(String(b.channel))) return res.status(400).json({ error: "ערוץ לא מוכר" });
  const today = new Date().toISOString().slice(0, 10);
  res.json(addStats({ channel: b.channel, spend: b.spend, impressions: b.impressions, clicks: b.clicks, leads: b.leads, periodStart: String(b.periodStart || today).slice(0, 10), periodEnd: String(b.periodEnd || today).slice(0, 10) }));
});
platformRouter.post("/api/ads/run", requireFeature("ads"), (_req, res) => {
  const log = runWeeklyAllocation();
  log ? res.json(log) : res.status(400).json({ error: "קבעו קודם תקציב חודשי וערוץ אחד לפחות" });
});

// ---- the business's site & SEO ----
platformRouter.get("/api/site", (_req, res) => {
  const tid = currentTenantId();
  const key = tid === DEFAULT_TENANT ? process.env.LEAD_KEY || "" : ensureLeadKey(tid);
  res.json({ site: getSite(), publicPath: key ? `/s/${key}` : "", canUseDomain: isDefaultTenant() || getTier().customDomain });
});
platformRouter.post("/api/site", (req, res) => {
  const b = req.body || {};
  const clip = (v: unknown, n: number) => String(v ?? "").slice(0, n);
  const patch: any = {};
  if (b.headline !== undefined) patch.headline = clip(b.headline, 160);
  if (b.about !== undefined) patch.about = clip(b.about, 2000);
  if (b.phone !== undefined) patch.phone = clip(b.phone, 40);
  if (b.whatsapp !== undefined) patch.whatsapp = clip(b.whatsapp, 20).replace(/\D/g, "");
  if (b.status === "live" || b.status === "draft") patch.status = b.status;
  if (b.hideCredit !== undefined) {
    // white label is part of the higher packages
    if (b.hideCredit && !isDefaultTenant() && !getTier().ads) return res.status(402).json({ error: "הסתרת הקרדיט זמינה מחבילת Digital Pro ומעלה.", code: "upgrade_required", feature: "ads", upgrade: "/#plans" });
    patch.hideCredit = !!b.hideCredit;
  }
  res.json(saveSite(patch));
});
platformRouter.post("/api/site/domain", requireFeature("customDomain"), (req, res) => {
  const d = String(req.body?.domain || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  if (!validDomain(d)) return res.status(400).json({ error: "כתובת דומיין לא תקינה" });
  if (!claimDomain(d, currentTenantId())) return res.status(409).json({ error: "הדומיין הזה כבר משויך לעסק אחר" });
  // The operator points DNS / TLS at the service and flips this to "active" (see /api/admin/sites/:tenantId/domain/activate).
  res.json(saveSite({ domain: d, domainStatus: "pending_dns" }));
});
platformRouter.post("/api/site/article", async (req, res) => {
  try {
    const topic = String(req.body?.topic || "").trim().slice(0, 200);
    if (!topic) return res.status(400).json({ error: "חסר נושא למאמר" });
    if (!getProfile()) return res.status(400).json({ error: "קודם צריך להגדיר את העסק בלשונית 'הגדרות'." });
    const left = creditsLeft();
    if (left !== null && left <= 0) return res.status(402).json({ error: "נגמרו הקרדיטים.", code: "no_credits", upgrade: "/#plans" });
    const art = addArticle(await generateSeoArticle(topic));
    if (left !== null) adjustCredits(currentTenantId(), -1);
    res.json(art);
  } catch (e) {
    err(res, e);
  }
});

// ---- support ----
platformRouter.get("/api/support/tickets", (_req, res) => res.json(listTickets()));
platformRouter.post("/api/support/tickets", (req, res) => {
  if (!String(req.body?.message || "").trim()) return res.status(400).json({ error: "כתבו את הפנייה" });
  res.json(openTicket(req.body.subject, req.body.message, req.body.kind, getTier().label));
});
platformRouter.post("/api/support/tickets/:id/reply", (req, res) => {
  const t = replyTicket(req.params.id, "customer", req.body?.text);
  t ? res.json(t) : res.status(404).json({ error: "לא נמצא" });
});
platformRouter.post("/api/support/chat", async (req, res) => {
  if (rateLimited(`chat|${currentTenantId()}`, 30, 60 * 60 * 1000)) return res.status(429).json({ error: "הגעתם למגבלת ההודעות לשעה. אפשר לפתוח פנייה." });
  try {
    const q = String(req.body?.message || "").trim();
    if (!q) return res.status(400).json({ error: "כתבו שאלה" });
    const history = Array.isArray(req.body?.history) ? req.body.history.filter((h: any) => h && (h.role === "user" || h.role === "assistant")).map((h: any) => ({ role: h.role, text: String(h.text || "") })) : [];
    res.json({ answer: await answerSupport(q, history) });
  } catch (e) {
    err(res, e);
  }
});

// ---- personal executive assistant ----
const tzOf = (req: Request): string => {
  const ws = getAssistant().whatsapp;
  const sent = req.body?.tz;
  if (validTz(sent)) {
    if (ws.tz === "UTC" || ws.tz !== sent) saveWhatsApp({ tz: sent }); // remember the business's own time zone
    return sent;
  }
  return ws.tz;
};

platformRouter.post("/api/assistant/chat", async (req, res) => {
  if (rateLimited(`assistant|${currentTenantId()}`, 40, 60 * 60 * 1000)) return res.status(429).json({ error: "הגעתם למגבלת ההודעות לשעה, נסו שוב מאוחר יותר." });
  try {
    const q = String(req.body?.message || "").trim();
    if (!q) return res.status(400).json({ error: "כתבו הודעה" });
    const history = Array.isArray(req.body?.history) ? req.body.history.filter((h: any) => h && (h.role === "user" || h.role === "assistant")).map((h: any) => ({ role: h.role, text: String(h.text || "") })) : [];
    res.json(await answerAssistant(q, history, assistantContext(tzOf(req))));
  } catch (e) {
    err(res, e);
  }
});

// The owner approved an action the assistant proposed (button). Drafts/reminders/scheduling within the plan's limits.
platformRouter.post("/api/assistant/action", (req, res) => {
  const a = req.body || {};
  const tz = tzOf(req);
  let action: AssistantAction | undefined;
  if (a.type === "reminder" && /^\d{4}-\d{2}-\d{2}$/.test(String(a.date)) && String(a.text || "").trim()) action = { type: "reminder", date: a.date, text: String(a.text) };
  else if (a.type === "draft_post" && String(a.text || "").trim()) action = { type: "draft_post", topic: String(a.topic || "פוסט"), text: String(a.text) };
  else if (a.type === "schedule_post" && typeof a.postId === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(a.when))) action = { type: "schedule_post", postId: a.postId, when: a.when };
  if (!action) return res.status(400).json({ error: "פעולה לא נתמכת" });
  const r = executeAssistantAction(action, tz);
  r.ok ? res.json(r) : res.status(400).json({ error: r.message });
});
platformRouter.get("/api/assistant/reminders", (_req, res) => res.json(listReminders()));
platformRouter.delete("/api/assistant/reminders/:id", (req, res) => (deleteReminder(req.params.id) ? res.json({ ok: true }) : res.status(404).json({ error: "לא נמצא" })));

// ---- WhatsApp connection (customer side) ----
const LANGS = ["he", "en", "es", "fr"];
const waStatus = () => {
  const ws = getAssistant().whatsapp;
  return {
    tierAllowed: getTier().whatsappAssistant,
    configured: waConfigured() && !!waDisplayNumber(),
    enabled: ws.optIn && !!ws.phone,
    phone: ws.phone ? maskPhone(ws.phone) : "",
    briefHour: ws.briefHour,
    lang: ws.lang,
    calendars: ws.calendars,
    tz: ws.tz,
  };
};
const waPatch = (b: any) => {
  const patch: Record<string, unknown> = {};
  if (Number.isInteger(b?.briefHour) && b.briefHour >= 0 && b.briefHour <= 23) patch.briefHour = b.briefHour;
  if (LANGS.includes(b?.lang)) patch.lang = b.lang;
  if (validTz(b?.tz)) patch.tz = b.tz;
  if (Array.isArray(b?.calendars)) patch.calendars = b.calendars.filter((c: unknown) => c === "global" || c === "il");
  return patch;
};
platformRouter.get("/api/assistant/whatsapp", (_req, res) => res.json(waStatus()));
platformRouter.post("/api/assistant/whatsapp/pair", (req, res) => {
  if (!getTier().whatsappAssistant) return res.status(403).json({ error: "חיבור וואטסאפ זמין מפרימיום ומעלה" });
  if (!waConfigured() || !waDisplayNumber()) return res.status(503).json({ error: "חיבור הוואטסאפ עדיין לא פעיל" });
  if (req.body?.consent !== true) return res.status(400).json({ error: "יש לאשר קבלת הודעות" });
  saveWhatsApp({ ...waPatch(req.body), consentAt: new Date().toISOString(), optIn: false });
  const code = createPairingCode();
  res.json({ code, link: `https://wa.me/${waDisplayNumber()}?text=${encodeURIComponent("BOOL " + code)}` });
});
platformRouter.put("/api/assistant/whatsapp", (req, res) => {
  saveWhatsApp(waPatch(req.body));
  res.json(waStatus());
});
platformRouter.post("/api/assistant/whatsapp/disable", (_req, res) => {
  saveWhatsApp({ optIn: false, phone: undefined });
  unbindPhone(currentTenantId());
  res.json(waStatus());
});

// ---- reports ----
platformRouter.get("/api/reports/summary", (_req, res) => {
  const days = 30;
  const day = (iso: string) => iso.slice(0, 10);
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const reach: Record<string, number> = {};
  const engagement: Record<string, number> = {};
  for (const p of store.listPosts()) {
    if (p.status !== "published") continue;
    const d = day(p.scheduledFor || p.createdAt);
    if (d < since) continue;
    for (const pc of p.platforms) {
      reach[d] = (reach[d] || 0) + (pc.metrics?.reach || 0);
      engagement[d] = (engagement[d] || 0) + (pc.metrics?.engagement || 0);
    }
  }
  const leads: Record<string, number> = {};
  for (const l of listLeads()) {
    const d = day(l.createdAt);
    if (d >= since) leads[d] = (leads[d] || 0) + 1;
  }
  const series = Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.now() - (days - 1 - i) * 86400000).toISOString().slice(0, 10);
    return { date: d, reach: reach[d] || 0, engagement: engagement[d] || 0, leads: leads[d] || 0 };
  });
  const logs = listInsightLogs();
  const s = getSettings();
  res.json({
    series,
    totals: { reach: series.reduce((a, x) => a + x.reach, 0), engagement: series.reduce((a, x) => a + x.engagement, 0), leads: series.reduce((a, x) => a + x.leads, 0), published: store.listPosts().filter((p) => p.status === "published").length },
    budget: { monthly: s.adBudgetMonthly, shares: logs[0]?.shares || {}, latest: logs[0] || null },
  });
});

// ---- operator-only ----
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!(req as any).auth?.isAdmin) return res.status(403).json({ error: "Admin only" });
  next();
}
platformRouter.get("/api/admin/margins", requireAdmin, (_req, res) => res.json(tierMargins()));
platformRouter.get("/api/admin/tickets", requireAdmin, (_req, res) => {
  const rows: any[] = [];
  for (const id of activeTenantIds()) {
    runAsTenant(id, () => {
      const name = id === DEFAULT_TENANT ? getProfile()?.businessName || "החשבון הראשי" : getTenant(id)?.name || id;
      for (const t of listTickets()) if (t.status === "open") rows.push({ tenantId: id, tenantName: name, ...t });
    });
  }
  res.json(rows);
});
platformRouter.post("/api/admin/tickets/:tenantId/:id/reply", requireAdmin, (req, res) => {
  const t = runAsTenant(req.params.tenantId, () => replyTicket(req.params.id, "support", req.body?.text, req.body?.close ? true : undefined));
  t ? res.json(t) : res.status(404).json({ error: "לא נמצא" });
});
platformRouter.post("/api/admin/sites/:tenantId/domain/activate", requireAdmin, (req, res) => {
  if (!getTenant(req.params.tenantId)) return res.status(404).json({ error: "לא נמצא" });
  res.json(runAsTenant(req.params.tenantId, () => (getSite().domain ? saveSite({ domainStatus: "active" }) : null)) || { error: "אין דומיין מבוקש" });
});

// Manual activation: a deal closed in the field (or through a store) — the operator activates the package in one click.
// Same effect as a paid web order (tier, credits, cycle, expiry) and recorded as a manual order for the audit trail.
platformRouter.post("/api/admin/tenants/:id/activate", requireAdmin, (req, res) => {
  const sku = getSku(String(req.body?.sku || ""));
  if (!sku) return res.status(400).json({ error: "מוצר לא מוכר" });
  if (!getTenant(req.params.id)) return res.status(404).json({ error: "לא נמצא" });
  const r = applyPayment(req.params.id, sku.id, `manual-${Date.now()}`, { method: "manual", note: String(req.body?.note || "").slice(0, 300) || "הופעל ידנית" });
  r.applied ? res.json({ ok: true }) : res.status(400).json({ error: r.reason });
});

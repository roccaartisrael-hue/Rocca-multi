import crypto from "crypto";
import { readGlobal, writeGlobal } from "./persist";
import { TierName } from "./plans";
import { adjustCredits, getTenant, updateTenant } from "./tenants";
import { isValidTenantId, runAsTenant } from "./tenantContext";
import { recordPaid } from "./orders";

/**
 * What can be bought. priceIls is the price BEFORE VAT; the catalog endpoint adds the VAT-inclusive amount (grossIls) and every screen shows both.
 * The actual payment page belongs to the payment provider / existing Israeli clearing terminal: it is a hosted link
 * set per product in env (CHECKOUT_LINK_<SKU>), so no card data ever touches this server.
 */
export type SkuKind = "credits" | "subscription" | "package";
export interface Sku {
  id: string;
  kind: SkuKind;
  label: string;
  priceIls: number;
  credits?: number; // granted on every successful payment
  tier?: TierName; // plan activated on payment
  cycle?: "weekly" | "monthly" | "annual";
  commitmentMonths?: number;
  includes?: string[];
}

export const CATALOG: Sku[] = [
  { id: "credits_10", kind: "credits", label: "10 קרדיטים", priceIls: 19, credits: 10 },
  { id: "credits_35", kind: "credits", label: "35 קרדיטים", priceIls: 49, credits: 35 },
  { id: "creator_weekly", kind: "subscription", label: "יוצרים — שבועי", priceIls: 17, tier: "creator_lite", cycle: "weekly", credits: 10, includes: ["10 קרדיטים בכל שבוע"] },
  { id: "creator_lite_monthly", kind: "subscription", label: "יוצרים לייט — חודשי", priceIls: 69, tier: "creator_lite", cycle: "monthly", credits: 40, includes: ["40 קרדיטים בחודש", "פייסבוק + אינסטגרם", "טייס אוטומטי"] },
  { id: "creator_pro_monthly", kind: "subscription", label: "יוצרים פרו — חודשי", priceIls: 129, tier: "creator_pro", cycle: "monthly", credits: 100, includes: ["100 קרדיטים בחודש", "תזמון מדויק", "המלצות לקידום ממומן"] },
  { id: "starter_social_monthly", kind: "package", label: "Starter Social", priceIls: 790, tier: "starter_social", cycle: "monthly", commitmentMonths: 0, includes: ["פייסבוק + אינסטגרם אורגני", "טייס אוטומטי: פוסטים שבועיים לאישור", "תוכניות שיווק חודשיות ודוחות"] },
  { id: "core_presence_annual", kind: "package", label: "Core Presence", priceIls: 1490, tier: "digital_core", cycle: "annual", commitmentMonths: 12, includes: ["אתר תדמית + חיבור דומיין עצמאי", "מאמרי SEO לגוגל", "פייסבוק + אינסטגרם אורגני עם טייס אוטומטי"] },
  { id: "digital_pro_annual", kind: "package", label: "Digital Pro + Ads", priceIls: 1890, tier: "digital_pro", cycle: "annual", commitmentMonths: 12, includes: ["כל מה שב-Core Presence", "חלוקת תקציב ממומן חכמה בין ערוצים (המלצה שבועית)", "דוחות שקופים עם הסברי AI"] },
  { id: "total_dominance_annual", kind: "package", label: "Total Dominance", priceIls: 2490, tier: "total_dominance", cycle: "annual", commitmentMonths: 12, includes: ["כל מה שב-Digital Pro", "טיקטוק וגוגל — בקרוב", "בוט מענה ללידים 24/7 — בקרוב"] },
];

/** Israeli VAT (18% since 2025); override with VAT_RATE (e.g. 0.18) if the rate changes. */
export const vatRate = (): number => {
  const r = Number(process.env.VAT_RATE);
  return Number.isFinite(r) && r >= 0 && r < 1 ? r : 0.18;
};

const agorot = (n: number) => Math.round(n * 100) / 100;

/**
 * The customer pays ONE amount: the VAT-inclusive price, rounded to the nearest whole shekel (PRICE_ROUNDING=agora keeps agorot).
 * The pre-VAT price and the VAT are then derived from that amount, so what is shown is exactly what is charged and invoiced.
 * Catalog prices (priceIls) are the list price before VAT that the rounded amount comes from.
 */
export function vatBreakdown(listNetIls: number) {
  const rate = vatRate();
  const exact = listNetIls * (1 + rate);
  const grossIls = String(process.env.PRICE_ROUNDING || "shekel").toLowerCase() === "agora" ? agorot(exact) : Math.round(exact);
  const netIls = agorot(grossIls / (1 + rate));
  return { netIls, vatIls: agorot(grossIls - netIls), grossIls };
}

/** gross (default): the prominent price is what the customer is charged, VAT included. net: base price first. */
export const priceDisplay = (): "gross" | "net" => (String(process.env.PRICE_DISPLAY || "gross").toLowerCase() === "net" ? "net" : "gross");

export const DEFAULT_VAT_NOTE = "המחירים כוללים מע״מ כחוק";

/** What the customer must be told, and agree to, before paying. */
export function termsFor(sku: Sku): string[] {
  const t: string[] = [];
  if (sku.kind === "credits") t.push("רכישה חד־פעמית של קרדיטים. הקרדיטים אינם פגי תוקף כל עוד החשבון פעיל.");
  if (sku.cycle === "weekly") t.push("מנוי שבועי המתחדש מדי שבוע עד לביטולו.");
  if (sku.cycle === "monthly") t.push(sku.kind === "package" ? "מנוי חודשי ללא התחייבות, המתחדש מדי חודש עד לביטולו." : "מנוי חודשי המתחדש מדי חודש עד לביטולו.");
  if (sku.commitmentMonths) t.push(`התחייבות ל-${sku.commitmentMonths} חודשים, בחיוב חודשי.`);
  t.push("שום תוכן לא מתפרסם בלי אישור שלך, והשימוש כפוף לתנאי השימוש ולמדיניות הפרטיות.");
  return t;
}

export const getSku = (id: string): Sku | undefined => CATALOG.find((s) => s.id === id);

const CYCLE_DAYS = { weekly: 7, monthly: 31, annual: 31 } as const; // packages are billed monthly over the 12-month commitment
const GRACE_DAYS = 3;

function secret(): string {
  return process.env.CHECKOUT_SECRET || process.env.PAYMENT_WEBHOOK_SECRET || "dev-checkout-secret";
}

/** ref = tenantId.sku.nonce.signature — travels through the payment page and comes back in the webhook. */
export function makeRef(tenantId: string, sku: string): string {
  const body = `${tenantId}.${sku}.${crypto.randomBytes(5).toString("hex")}`;
  return `${body}.${crypto.createHmac("sha256", secret()).update(body).digest("hex").slice(0, 24)}`;
}

export function parseRef(ref: string): { tenantId: string; sku: string } | null {
  const parts = String(ref || "").split(".");
  if (parts.length !== 4) return null;
  const body = parts.slice(0, 3).join(".");
  const expected = crypto.createHmac("sha256", secret()).update(body).digest("hex").slice(0, 24);
  if (parts[3].length !== expected.length || !crypto.timingSafeEqual(Buffer.from(parts[3]), Buffer.from(expected))) return null;
  return isValidTenantId(parts[0]) && getSku(parts[1]) ? { tenantId: parts[0], sku: parts[1] } : null;
}

export function checkoutUrl(tenantId: string, skuId: string): { url: string; ref: string } | null {
  const link = process.env[`CHECKOUT_LINK_${skuId.toUpperCase()}`];
  if (!link) return null;
  const ref = makeRef(tenantId, skuId);
  const param = process.env.CHECKOUT_REF_PARAM || "ref";
  return { url: `${link}${link.includes("?") ? "&" : "?"}${param}=${encodeURIComponent(ref)}`, ref };
}

// ---- processed payments (idempotency) ----
interface Processed { paymentRef: string; tenantId: string; sku: string; at: string }
const readProcessed = (): Processed[] => {
  try {
    return JSON.parse(readGlobal("payments.json") || "[]");
  } catch {
    return [];
  }
};

/**
 * Applies a successful payment. Idempotent per paymentRef (a webhook retried by the provider never double-credits).
 * Credits are added on every payment; tier/cycle/expiry are set for subscriptions and packages.
 */
export function applyPayment(tenantId: string, skuId: string, paymentRef: string, opts: { ref?: string; method?: "web" | "manual"; note?: string } = {}): { applied: boolean; reason?: string } {
  const sku = getSku(skuId);
  const tenant = getTenant(tenantId);
  if (!sku || !tenant) return { applied: false, reason: "unknown sku or tenant" };
  const done = readProcessed();
  if (done.some((p) => p.paymentRef === paymentRef)) return { applied: true, reason: "already processed" };
  if (sku.credits) adjustCredits(tenantId, sku.credits);
  if (sku.tier && sku.cycle) {
    const expires = new Date(Date.now() + (CYCLE_DAYS[sku.cycle] + GRACE_DAYS) * 86400000).toISOString();
    updateTenant(tenantId, { plan: sku.tier, subscriptionCycle: sku.cycle, commitmentMonths: sku.commitmentMonths ?? 0, planExpiresAt: expires, trialEndsAt: undefined });
  }
  runAsTenant(tenantId, () => recordPaid(sku, paymentRef, { ref: opts.ref, method: opts.method || "web", note: opts.note }));
  done.push({ paymentRef, tenantId, sku: skuId, at: new Date().toISOString() });
  writeGlobal("payments.json", JSON.stringify(done.slice(-5000), null, 2));
  return { applied: true };
}

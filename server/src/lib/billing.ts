import crypto from "crypto";
import { readGlobal, writeGlobal } from "./persist";
import { TierName } from "./plans";
import { adjustCredits, getTenant, updateTenant } from "./tenants";
import { isValidTenantId } from "./tenantContext";

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
  { id: "creator_weekly", kind: "subscription", label: "יוצרים — שבועי", priceIls: 29, tier: "creator_lite", cycle: "weekly", credits: 10, includes: ["10 קרדיטים בכל שבוע"] },
  { id: "creator_lite_monthly", kind: "subscription", label: "יוצרים לייט — חודשי", priceIls: 69, tier: "creator_lite", cycle: "monthly", credits: 40, includes: ["40 קרדיטים בחודש", "פייסבוק + אינסטגרם", "טייס אוטומטי"] },
  { id: "creator_pro_monthly", kind: "subscription", label: "יוצרים פרו — חודשי", priceIls: 129, tier: "creator_pro", cycle: "monthly", credits: 100, includes: ["100 קרדיטים בחודש", "תזמון מדויק", "המלצות לקידום ממומן"] },
  { id: "core_presence_annual", kind: "package", label: "Core Presence", priceIls: 1490, tier: "digital_core", cycle: "annual", commitmentMonths: 12, includes: ["אתר תדמית + חיבור דומיין עצמאי", "מאמרי SEO לגוגל", "פייסבוק + אינסטגרם אורגני עם טייס אוטומטי"] },
  { id: "digital_pro_annual", kind: "package", label: "Digital Pro + Ads", priceIls: 1890, tier: "digital_pro", cycle: "annual", commitmentMonths: 12, includes: ["כל מה שב-Core Presence", "חלוקת תקציב ממומן חכמה בין ערוצים (המלצה שבועית)", "דוחות שקופים עם הסברי AI"] },
  { id: "total_dominance_annual", kind: "package", label: "Total Dominance", priceIls: 2490, tier: "total_dominance", cycle: "annual", commitmentMonths: 12, includes: ["כל מה שב-Digital Pro", "טיקטוק וגוגל — בקרוב", "בוט מענה ללידים 24/7 — בקרוב"] },
];

/** Israeli VAT (18% since 2025); override with VAT_RATE (e.g. 0.18) if the rate changes. */
export const vatRate = (): number => {
  const r = Number(process.env.VAT_RATE);
  return Number.isFinite(r) && r >= 0 && r < 1 ? r : 0.18;
};

/** Catalog prices are BEFORE VAT. The VAT-inclusive price is rounded to whole shekels — set the payment page to charge exactly this amount. */
export function vatBreakdown(netIls: number) {
  const grossIls = Math.round(netIls * (1 + vatRate()));
  return { netIls, vatIls: grossIls - netIls, grossIls };
}

export const DEFAULT_VAT_NOTE = "המחירים כוללים מע״מ כחוק / מוצגים כולל מע״מ";

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
export function applyPayment(tenantId: string, skuId: string, paymentRef: string): { applied: boolean; reason?: string } {
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
  done.push({ paymentRef, tenantId, sku: skuId, at: new Date().toISOString() });
  writeGlobal("payments.json", JSON.stringify(done.slice(-5000), null, 2));
  return { applied: true };
}

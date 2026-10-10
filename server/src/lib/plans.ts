import { Platform } from "../config";
import { currentTenantId, DEFAULT_TENANT } from "./tenantContext";
import { getTenant } from "./tenants";
import { ModuleId, MODULE_IDS, BUNDLES, BundleId } from "./modules";

/** basic/premium/vip are the original tiers (kept for existing accounts); the rest are the BOOL platform tiers. */
export type TierName =
  | "basic" | "premium" | "vip"
  | "free_trial" | "creator_lite" | "creator_pro"
  | "starter_social" | "digital_core" | "digital_pro" | "total_dominance"
  | "bundle_starter" | "bundle_pro" | "bundle_business" | "modular"; // modular pricing (see modules.ts): bundles, or à-la-carte services on "modular"

export interface Tier {
  name: TierName;
  label: string;
  priceIls: number; // monthly price incl. VAT — for display only
  costCapIls: number; // hard ceiling on estimated Claude spend per month, so margin is guaranteed
  aiCalls: number; // post drafts + reply drafts per month
  plansPerMonth: number; // marketing plans per month
  maxWeeks: number;
  maxPostsPerWeek: number;
  maxPlatforms: number;
  adAdvice: boolean;
  learnsFromPerformance: boolean; // top performers + inspiration fed to Claude
  maxScheduled: number; // posts that may be scheduled at the same time
  horizonDays: number; // how far ahead a post may be scheduled
  slots: string[]; // posting times offered (Israel time)
  exactTime: boolean; // may pick any minute, not only the offered slots
  kind: "free" | "creator" | "business"; // free: gift credits only; creator: credit packs/micro-subscriptions; business: managed packages
  unlimitedCredits: boolean; // business tiers are bounded by costCapIls, not by a credit balance
  creditsPerCycle: number; // credits granted on each paid renewal (creator tiers)
  autopilot: boolean; // may switch on the autopilot (drafts weekly for quick approval)
  customDomain: boolean; // may connect an own domain to the site module
  ads: boolean; // smart paid-budget allocation + transparent reports
  leadBot: boolean; // 24/7 lead-answering bot
  whatsappAssistant: boolean; // assistant reaches the owner on WhatsApp (daily brief + chat)
}

const SLOTS_LOW = ["12:00", "19:00", "21:00"];
const SLOTS_MID = ["09:00", "12:00", "14:00", "17:00", "19:00", "21:00"];
const SLOTS_ALL = ["08:00", "09:00", "10:00", "12:00", "14:00", "17:00", "19:00", "20:00", "21:00", "22:00"];
const NONE = { kind: "business" as const, unlimitedCredits: true, creditsPerCycle: 0, autopilot: false, customDomain: false, ads: false, leadBot: false, whatsappAssistant: false };

// Margin is enforced by costCapIls (estimated from real token usage), not just by call counts: worst case VIP costs ₪50 of ₪200.
export const TIERS: Record<TierName, Tier> = {
  // --- original tiers (existing accounts keep working unchanged) ---
  basic: { name: "basic", label: "בסיס", priceIls: 149, costCapIls: 15, aiCalls: 40, plansPerMonth: 1, maxWeeks: 1, maxPostsPerWeek: 3, maxPlatforms: 2, adAdvice: false, learnsFromPerformance: false, maxScheduled: 7, horizonDays: 7, slots: SLOTS_LOW, exactTime: false, ...NONE },
  premium: { name: "premium", label: "פרימיום", priceIls: 299, costCapIls: 30, aiCalls: 120, plansPerMonth: 3, maxWeeks: 2, maxPostsPerWeek: 14, maxPlatforms: 3, adAdvice: true, learnsFromPerformance: true, maxScheduled: 30, horizonDays: 14, slots: SLOTS_MID, exactTime: true, ...NONE, whatsappAssistant: true, autopilot: true },
  vip: { name: "vip", label: "VIP", priceIls: 499, costCapIls: 50, aiCalls: 300, plansPerMonth: 8, maxWeeks: 4, maxPostsPerWeek: 21, maxPlatforms: 5, adAdvice: true, learnsFromPerformance: true, maxScheduled: 120, horizonDays: 30, slots: SLOTS_ALL, exactTime: true, ...NONE, whatsappAssistant: true, autopilot: true },
  // --- BOOL: free / creators (credit-based) ---
  free_trial: { name: "free_trial", label: "ניסיון חינם", priceIls: 0, costCapIls: 4, aiCalls: 12, plansPerMonth: 1, maxWeeks: 1, maxPostsPerWeek: 3, maxPlatforms: 2, adAdvice: false, learnsFromPerformance: false, maxScheduled: 3, horizonDays: 7, slots: SLOTS_LOW, exactTime: false, ...NONE, kind: "free", unlimitedCredits: false },
  creator_lite: { name: "creator_lite", label: "יוצרים לייט", priceIls: 69, costCapIls: 8, aiCalls: 80, plansPerMonth: 2, maxWeeks: 1, maxPostsPerWeek: 7, maxPlatforms: 2, adAdvice: false, learnsFromPerformance: true, maxScheduled: 14, horizonDays: 14, slots: SLOTS_MID, exactTime: false, ...NONE, kind: "creator", unlimitedCredits: false, creditsPerCycle: 40, autopilot: true },
  creator_pro: { name: "creator_pro", label: "יוצרים פרו", priceIls: 129, costCapIls: 15, aiCalls: 200, plansPerMonth: 4, maxWeeks: 2, maxPostsPerWeek: 14, maxPlatforms: 3, adAdvice: true, learnsFromPerformance: true, maxScheduled: 30, horizonDays: 21, slots: SLOTS_MID, exactTime: true, ...NONE, kind: "creator", unlimitedCredits: false, creditsPerCycle: 100, autopilot: true },
  // --- BOOL: managed business packages (12-month commitment) ---
  starter_social: { name: "starter_social", label: "Starter Social", priceIls: 790, costCapIls: 40, aiCalls: 150, plansPerMonth: 4, maxWeeks: 2, maxPostsPerWeek: 14, maxPlatforms: 3, adAdvice: true, learnsFromPerformance: true, maxScheduled: 30, horizonDays: 21, slots: SLOTS_MID, exactTime: true, ...NONE, whatsappAssistant: true, autopilot: true },
  digital_core: { name: "digital_core", label: "Core Presence", priceIls: 1490, costCapIls: 60, aiCalls: 250, plansPerMonth: 6, maxWeeks: 4, maxPostsPerWeek: 14, maxPlatforms: 3, adAdvice: true, learnsFromPerformance: true, maxScheduled: 60, horizonDays: 30, slots: SLOTS_ALL, exactTime: true, ...NONE, whatsappAssistant: true, autopilot: true, customDomain: true },
  digital_pro: { name: "digital_pro", label: "Digital Pro + Ads", priceIls: 1890, costCapIls: 90, aiCalls: 400, plansPerMonth: 10, maxWeeks: 4, maxPostsPerWeek: 21, maxPlatforms: 4, adAdvice: true, learnsFromPerformance: true, maxScheduled: 120, horizonDays: 30, slots: SLOTS_ALL, exactTime: true, ...NONE, whatsappAssistant: true, autopilot: true, customDomain: true, ads: true },
  total_dominance: { name: "total_dominance", label: "Total Dominance", priceIls: 2490, costCapIls: 120, aiCalls: 600, plansPerMonth: 15, maxWeeks: 4, maxPostsPerWeek: 28, maxPlatforms: 5, adAdvice: true, learnsFromPerformance: true, maxScheduled: 200, horizonDays: 60, slots: SLOTS_ALL, exactTime: true, ...NONE, whatsappAssistant: true, autopilot: true, customDomain: true, ads: true, leadBot: true },
  // --- BOOL modular pricing: bundles and à-la-carte (entitlements come from modules.ts / entitlements.ts) ---
  bundle_starter: { name: "bundle_starter", label: "Starter", priceIls: 490, costCapIls: 25, aiCalls: 80, plansPerMonth: 2, maxWeeks: 1, maxPostsPerWeek: 3, maxPlatforms: 2, adAdvice: false, learnsFromPerformance: false, maxScheduled: 7, horizonDays: 7, slots: SLOTS_LOW, exactTime: false, ...NONE, whatsappAssistant: true, customDomain: true },
  bundle_pro: { name: "bundle_pro", label: "Pro", priceIls: 990, costCapIls: 50, aiCalls: 250, plansPerMonth: 4, maxWeeks: 2, maxPostsPerWeek: 14, maxPlatforms: 3, adAdvice: true, learnsFromPerformance: true, maxScheduled: 30, horizonDays: 21, slots: SLOTS_MID, exactTime: true, ...NONE, whatsappAssistant: true, autopilot: true, customDomain: true },
  bundle_business: { name: "bundle_business", label: "Business All-in-One", priceIls: 1390, costCapIls: 75, aiCalls: 400, plansPerMonth: 6, maxWeeks: 4, maxPostsPerWeek: 21, maxPlatforms: 4, adAdvice: true, learnsFromPerformance: true, maxScheduled: 60, horizonDays: 30, slots: SLOTS_ALL, exactTime: true, ...NONE, whatsappAssistant: true, autopilot: true, customDomain: true },
  modular: { name: "modular", label: "שירותים נבחרים", priceIls: 0, costCapIls: 40, aiCalls: 150, plansPerMonth: 3, maxWeeks: 2, maxPostsPerWeek: 14, maxPlatforms: 3, adAdvice: true, learnsFromPerformance: true, maxScheduled: 30, horizonDays: 21, slots: SLOTS_MID, exactTime: true, ...NONE },
};

export const isTierName = (x: unknown): x is TierName => typeof x === "string" && x in TIERS;

const BUNDLE_OF: Partial<Record<TierName, BundleId>> = { bundle_starter: "starter", bundle_pro: "pro", bundle_business: "business" };

/** Services included by the plan itself. Older tiers keep what they always had (social + site + SEO articles, WhatsApp by flag). */
export function planModules(t: Tier): ModuleId[] {
  const b = BUNDLE_OF[t.name];
  if (b) return [...BUNDLES[b].modules];
  if (t.name === "modular") return [];
  return t.whatsappAssistant ? ["whatsapp", "social", "site", "seo"] : ["social", "site", "seo"];
}

/** Plan services plus paid, unexpired stand-alone add-ons. The original business (default tenant) has everything. */
export function effectiveModules(): ModuleId[] {
  const id = currentTenantId();
  if (id === DEFAULT_TENANT) return [...MODULE_IDS];
  const set = new Set<ModuleId>(planModules(baseTier()));
  const until = getTenant(id)?.addonUntil || {};
  for (const m of MODULE_IDS) if (until[m] && Date.parse(until[m]!) > Date.now()) set.add(m);
  return MODULE_IDS.filter((m) => set.has(m));
}
export const hasModule = (m: ModuleId): boolean => effectiveModules().includes(m);

function baseTier(): Tier {
  const id = currentTenantId();
  const raw = (id === DEFAULT_TENANT ? process.env.PLAN_TIER || "total_dominance" : getTenant(id)?.plan || "basic").toLowerCase() as TierName;
  return TIERS[raw] || TIERS.basic;
}

/** The default tenant's tier comes from PLAN_TIER; every other tenant's from its account record. Paid add-ons switch on the matching feature flags. */
export function getTier(): Tier {
  const t = baseTier();
  if (currentTenantId() === DEFAULT_TENANT) return t;
  const until = getTenant(currentTenantId())?.addonUntil;
  if (!until || !Object.keys(until).length) return t;
  const on = (m: ModuleId) => !!until[m] && Date.parse(until[m]!) > Date.now();
  return { ...t, whatsappAssistant: t.whatsappAssistant || on("whatsapp"), customDomain: t.customDomain || on("site"), autopilot: t.autopilot || on("social") };
}

export type { Platform };

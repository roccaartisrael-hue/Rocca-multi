/**
 * Modular pricing: four stand-alone services and three bundles. Pure data + arithmetic (no storage), so it is also used by the
 * public pricing calculator. Prices are the VAT-inclusive amounts the customer sees and pays (billing.ts derives the net).
 * Layer 1 (market / competitor analysis and the knowledge base) is NOT a module: every customer gets it.
 */
export const MODULE_IDS = ["whatsapp", "social", "site", "seo"] as const;
export type ModuleId = (typeof MODULE_IDS)[number];
export const isModuleId = (x: unknown): x is ModuleId => typeof x === "string" && (MODULE_IDS as readonly string[]).includes(x);

export interface ModuleDef { id: ModuleId; label: string; includes: string; priceIls: number; commitmentMonths: number }
export const MODULES: Record<ModuleId, ModuleDef> = {
  whatsapp: { id: "whatsapp", label: "סוכן וואטסאפ ואסיסטנט AI חכם", includes: "מענה 24/7, תיאום פגישות, סנכרון לידים", priceIls: 490, commitmentMonths: 0 },
  social: { id: "social", label: "ניהול שיווק ופרסום ברשתות חברתיות", includes: "יצירת תוכן, תזמון ופרסום אוטומטי (Meta/TikTok)", priceIls: 690, commitmentMonths: 0 },
  site: { id: "site", label: "אתר עסקי, עמוד נחיתה ודומיין", includes: "אחסון, דומיין, תחזוקה והתאמה למובייל", priceIls: 290, commitmentMonths: 0 },
  seo: { id: "seo", label: "מנוע קידום אורגני בגוגל (AI SEO)", includes: "מחקר מילות מפתח, תגיות מטא, Schema, ומאמרי תוכן חודשיים", priceIls: 590, commitmentMonths: 6 },
};

export type BundleId = "starter" | "pro" | "business";
export interface BundleDef { id: BundleId; label: string; modules: ModuleId[]; priceIls: number; tier: "bundle_starter" | "bundle_pro" | "bundle_business" }
export const BUNDLES: Record<BundleId, BundleDef> = {
  starter: { id: "starter", label: "Starter", modules: ["whatsapp", "site"], priceIls: 490, tier: "bundle_starter" },
  pro: { id: "pro", label: "Pro", modules: ["whatsapp", "social", "site"], priceIls: 990, tier: "bundle_pro" },
  business: { id: "business", label: "Business All-in-One", modules: ["whatsapp", "social", "site", "seo"], priceIls: 1390, tier: "bundle_business" },
};

export const separateTotal = (mods: readonly ModuleId[]): number => [...new Set(mods)].reduce((s, m) => s + MODULES[m].priceIls, 0);
export const bundleSavings = (b: BundleDef): number => separateTotal(b.modules) - b.priceIls;
export const bundleSavingsPct = (b: BundleDef): number => Math.round((bundleSavings(b) / separateTotal(b.modules)) * 100);

/** Everything the pricing calculators need, in one JSON. */
export function pricingModel() {
  return {
    currency: "ILS",
    vatIncluded: true,
    modules: MODULE_IDS.map((id) => MODULES[id]),
    allSeparateIls: separateTotal(MODULE_IDS),
    bundles: Object.values(BUNDLES).map((b) => ({ ...b, separateIls: separateTotal(b.modules), savingsIls: bundleSavings(b), savingsPct: bundleSavingsPct(b) })),
  };
}

/** The cheapest way to get a module: a bundle that contains it, or the stand-alone add-on. */
export function upgradeAdvice(m: ModuleId, owned: readonly ModuleId[]): { addonIls: number; bundle?: BundleDef } {
  const bundle = Object.values(BUNDLES).filter((b) => b.modules.includes(m)).sort((a, b) => a.priceIls - b.priceIls)[0];
  void owned;
  return { addonIls: MODULES[m].priceIls, bundle };
}

/** Sales-style explanation shown when a service is outside the customer's package (assistant + API paywalls). */
export function upsellText(m: ModuleId, link: string): string {
  const b = upgradeAdvice(m, []).bundle;
  const where = b ? `בחבילת ${b.label}` : "בחבילה גבוהה יותר";
  const what: Record<ModuleId, string> = {
    seo: "קידום אורגני שוטף בגוגל עם מאמרים",
    social: "ניהול ופרסום ברשתות החברתיות",
    site: "אתר עסקי ודומיין",
    whatsapp: "סוכן הוואטסאפ והאסיסטנט",
  };
  return `הניתוח עבור העסק שלך מוכן, אך ${what[m]} כלול ${where} (או כתוספת נפרדת ב-₪${MODULES[m].priceIls} לחודש${MODULES[m].commitmentMonths ? `, בהתחייבות ל-${MODULES[m].commitmentMonths} חודשים` : ""}). ניתן לשדרג בלחיצת כפתור כאן: ${link}`;
}

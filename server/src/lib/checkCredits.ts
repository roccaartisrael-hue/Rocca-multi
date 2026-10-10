import { Request, Response, NextFunction } from "express";
import { currentTenantId, isDefaultTenant } from "./tenantContext";
import { adjustCredits, getTenant, withDefaults } from "./tenants";
import { getTier, hasModule } from "./plans";
import { ModuleId, upsellText } from "./modules";
import { brandDomain } from "./brand";

/**
 * Credit gate for AI actions (generating posts, plans, campaigns…).
 *  - The original business (default tenant) and business packages are bounded by the monthly cost cap, not by credits.
 *  - Free and creator tiers need credits_balance > 0; a successful action costs one credit.
 * Out of credits → 402 with a pointer to the upgrade options.
 */
export function creditsLeft(): number | null {
  if (isDefaultTenant() || getTier().unlimitedCredits) return null; // null = not credit-based
  const t = getTenant(currentTenantId());
  return t ? withDefaults(t).creditsBalance : 0;
}

export function checkCredits(req: Request, res: Response, next: NextFunction) {
  const left = creditsLeft();
  if (left === null) return next();
  if (left <= 0) {
    const tier = getTier();
    return res.status(402).json({
      error: tier.kind === "free" ? "סיימת את 3 הפעולות במתנה. כדי להמשיך אפשר לרכוש חבילת קרדיטים או לשדרג מנוי." : "נגמרו הקרדיטים. אפשר לרכוש חבילת קרדיטים או לשדרג מנוי.",
      code: "no_credits",
      upgrade: "/#plans",
    });
  }
  const tenantId = currentTenantId();
  // One credit per action that actually succeeded; failed generations are free.
  res.on("finish", () => {
    if (res.statusCode < 400) adjustCredits(tenantId, -1);
  });
  next();
}

/** Throws unless the current tier includes the feature (used for paywalls). */
export function requireFeature(feature: "autopilot" | "customDomain" | "ads" | "leadBot") {
  return (_req: Request, res: Response, next: NextFunction) => {
    const tier = getTier();
    if (isDefaultTenant() || tier[feature]) return next();
    res.status(402).json({ error: `הפיצ'ר הזה זמין ממסלול גבוה יותר (המסלול שלך: ${tier.label}).`, code: "upgrade_required", feature, upgrade: "/#plans" });
  };
}

/** Where the customer upgrades (absolute: the assistant also sends it over WhatsApp). */
export const upgradeLink = (): string => `${(process.env.PUBLIC_APP_URL || `https://app.${brandDomain()}`).replace(/\/$/, "")}/#plans`;

/**
 * Paywall for a service that is not part of the customer's package. Analysis and the knowledge base are never gated;
 * only the execution of the service is. The answer carries a ready sales message with the upgrade link.
 */
export function requireModule(m: ModuleId) {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (isDefaultTenant() || hasModule(m)) return next();
    res.status(402).json({ error: upsellText(m, upgradeLink()), code: "module_required", module: m, upgrade: "/#plans" });
  };
}

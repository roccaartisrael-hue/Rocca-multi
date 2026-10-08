import { Request, Response, NextFunction } from "express";
import { currentTenantId, isDefaultTenant } from "./tenantContext";
import { adjustCredits, getTenant, withDefaults } from "./tenants";
import { getTier } from "./plans";

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

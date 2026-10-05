import { Platform } from "../config";

export type TierName = "basic" | "premium" | "vip";

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
}

// Margin is enforced by costCapIls (estimated from real token usage), not just by call counts: worst case VIP costs ₪50 of ₪200.
export const TIERS: Record<TierName, Tier> = {
  basic: { name: "basic", label: "בסיס", priceIls: 149, costCapIls: 15, aiCalls: 40, plansPerMonth: 1, maxWeeks: 1, maxPostsPerWeek: 3, maxPlatforms: 2, adAdvice: false, learnsFromPerformance: false },
  premium: { name: "premium", label: "פרימיום", priceIls: 299, costCapIls: 30, aiCalls: 120, plansPerMonth: 3, maxWeeks: 2, maxPostsPerWeek: 14, maxPlatforms: 3, adAdvice: true, learnsFromPerformance: true },
  vip: { name: "vip", label: "VIP", priceIls: 499, costCapIls: 50, aiCalls: 300, plansPerMonth: 8, maxWeeks: 4, maxPostsPerWeek: 21, maxPlatforms: 5, adAdvice: true, learnsFromPerformance: true },
};

export function getTier(): Tier {
  const raw = (process.env.PLAN_TIER || "vip").toLowerCase() as TierName;
  return TIERS[raw] || TIERS.vip;
}

export type { Platform };

import { Platform } from "../config";

export type TierName = "basic" | "premium" | "vip";

export interface Tier {
  name: TierName;
  label: string;
  priceIls: number; // suggested monthly price — for display only
  aiCalls: number; // post drafts + reply drafts per month
  plansPerMonth: number; // marketing plans per month
  maxWeeks: number;
  maxPostsPerWeek: number;
  maxPlatforms: number;
  adAdvice: boolean;
  learnsFromPerformance: boolean; // top performers + inspiration fed to Claude
}

// Rough cost basis: a draft ≈ $0.01–0.02, a plan ≈ $0.10–0.30 in Claude usage, so VIP stays well under its price.
export const TIERS: Record<TierName, Tier> = {
  basic: { name: "basic", label: "בסיס", priceIls: 79, aiCalls: 40, plansPerMonth: 1, maxWeeks: 1, maxPostsPerWeek: 3, maxPlatforms: 2, adAdvice: false, learnsFromPerformance: false },
  premium: { name: "premium", label: "פרימיום", priceIls: 139, aiCalls: 120, plansPerMonth: 3, maxWeeks: 2, maxPostsPerWeek: 4, maxPlatforms: 3, adAdvice: true, learnsFromPerformance: true },
  vip: { name: "vip", label: "VIP", priceIls: 199, aiCalls: 300, plansPerMonth: 8, maxWeeks: 4, maxPostsPerWeek: 5, maxPlatforms: 5, adAdvice: true, learnsFromPerformance: true },
};

export function getTier(): Tier {
  const raw = (process.env.PLAN_TIER || "vip").toLowerCase() as TierName;
  return TIERS[raw] || TIERS.vip;
}

export type { Platform };

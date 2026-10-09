import path from "path";
import { config } from "../config";
import { getTier } from "./plans";
import { totalPurchased } from "./credits";
import { readDoc, writeDoc } from "./persist";
import { isDefaultTenant } from "./tenantContext";

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const USAGE_FILE = path.join(DATA_DIR, "usage.json");

export interface MonthUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  plans?: number;
  /** Accumulated estimated cost in USD across providers (preferred over token counts when present). */
  costUsd?: number;
}

type UsageByMonth = Record<string, MonthUsage>;

function monthKey(d = new Date()): string {
  return d.toISOString().slice(0, 7); // YYYY-MM (UTC)
}

function read(): UsageByMonth {
  try {
    return JSON.parse(readDoc(USAGE_FILE) || "{}") as UsageByMonth;
  } catch {
    return {};
  }
}

function write(data: UsageByMonth) {
  writeDoc(USAGE_FILE, JSON.stringify(data, null, 2));
}

// Estimated Claude price in USD per million tokens and the USD→ILS rate; override via env if pricing changes.
const PRICE_IN = Number(process.env.CLAUDE_PRICE_IN_PER_MTOK || 3);
const PRICE_OUT = Number(process.env.CLAUDE_PRICE_OUT_PER_MTOK || 15);
const USD_ILS = Number(process.env.USD_ILS || 3.1);

function tokenCostUsd(u: MonthUsage): number {
  return (u.inputTokens * PRICE_IN + u.outputTokens * PRICE_OUT) / 1e6;
}

function costIls(u: MonthUsage): number {
  return (u.costUsd ?? tokenCostUsd(u)) * USD_ILS;
}

/** AI_MONTHLY_LIMIT, when set, overrides the tier's call allowance. */
function callLimit(): number {
  return isDefaultTenant() && config.aiMonthlyLimit > 0 ? config.aiMonthlyLimit : getTier().aiCalls;
}

/**
 * Purchased top-ups roll over between months, and are only consumed by spend beyond the tier's monthly allowance.
 * Remaining top-up = purchased − overage of previous months; this month's cap = tier cap + that remainder.
 */
function allowances(all: UsageByMonth, month: string) {
  const tier = getTier();
  const bought = totalPurchased();
  let prevIls = 0;
  let prevPlans = 0;
  for (const [m, u] of Object.entries(all)) {
    if (m === month) continue;
    prevIls += Math.max(0, costIls(u) - tier.costCapIls);
    prevPlans += Math.max(0, (u.plans || 0) - tier.plansPerMonth);
  }
  return {
    costCap: tier.costCapIls + Math.max(0, bought.usageIls - prevIls),
    plansCap: tier.plansPerMonth + Math.max(0, bought.plans - prevPlans),
    hasTopUp: bought.usageIls - prevIls > 0,
  };
}

export function currentUsage() {
  const all = read();
  const month = monthKey();
  const u = all[month] || { calls: 0, inputTokens: 0, outputTokens: 0 };
  const a = allowances(all, month);
  return {
    month,
    limit: callLimit(),
    tier: getTier(),
    ...u,
    plans: u.plans || 0,
    plansCap: a.plansCap,
    costIls: Math.round(costIls(u) * 100) / 100,
    costCapIls: Math.round(a.costCap * 100) / 100,
    hasTopUp: a.hasTopUp,
  };
}

/** Throws if this month's marketing-plan allowance (tier + purchased top-ups) is used up; otherwise counts one plan. */
export function consumePlan(): void {
  const all = read();
  const month = monthKey();
  const cur = all[month] || { calls: 0, inputTokens: 0, outputTokens: 0 };
  const { plansCap } = allowances(all, month);
  if ((cur.plans || 0) >= plansCap) {
    throw new Error(`ניצלת את כל התוכניות של החודש (${plansCap}). אפשר לרכוש חבילת תוספת או לשדרג מסלול.`);
  }
  cur.plans = (cur.plans || 0) + 1;
  all[month] = cur;
  write(all);
}

/** Throws if this month's Claude spend allowance (tier + purchased top-ups) is used up. */
export function assertWithinLimit(): void {
  const { calls, limit, costIls: spent, costCapIls, hasTopUp, tier } = currentUsage();
  if (spent >= costCapIls) {
    throw new Error(`הגעת למכסת השימוש של מסלול ${tier.label}. אפשר לרכוש חבילת תוספת, לשדרג מסלול, או לחכות לתחילת החודש הבא.`);
  }
  // The call-count limit only applies while no top-up is active; with a top-up, the spend cap governs.
  if (limit > 0 && calls >= limit && !hasTopUp) {
    throw new Error(`הגעת למכסה החודשית של ${limit} פניות ל-Claude. אפשר לרכוש חבילת תוספת או לחכות לתחילת החודש הבא.`);
  }
}

/** Counts one Claude call and its token usage against the current month. */
export function recordUsage(usage?: { input_tokens?: number; output_tokens?: number; cost_usd?: number }): void {
  const all = read();
  const month = monthKey();
  const cur = all[month] || { calls: 0, inputTokens: 0, outputTokens: 0 };
  cur.calls += 1;
  cur.inputTokens += usage?.input_tokens || 0;
  cur.outputTokens += usage?.output_tokens || 0;
  // Per-call cost (provider-specific). Earlier token-only usage this month is folded in once.
  const callUsd = usage?.cost_usd ?? ((usage?.input_tokens || 0) * PRICE_IN + (usage?.output_tokens || 0) * PRICE_OUT) / 1e6;
  const before = cur.costUsd ?? tokenCostUsd({ ...cur, inputTokens: cur.inputTokens - (usage?.input_tokens || 0), outputTokens: cur.outputTokens - (usage?.output_tokens || 0) });
  cur.costUsd = before + callUsd;
  all[month] = cur;
  write(all);
}

/** Adds an external per-message cost (e.g. a WhatsApp template) to this month's spend without counting an AI call. */
export function recordCost(usd: number): void {
  const all = read();
  const month = monthKey();
  const cur = all[month] || { calls: 0, inputTokens: 0, outputTokens: 0 };
  const before = cur.costUsd ?? tokenCostUsd(cur);
  cur.costUsd = before + Math.max(0, usd);
  all[month] = cur;
  write(all);
}

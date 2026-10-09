import path from "path";
import { readDoc, writeDoc } from "./persist";

/**
 * Unit economics + hard limits for the "BOOL Autonomous Agency Director" enterprise plan.
 *
 * Goal: gross margin stays >= 80% (price is 5x the cost of API + payment processing).
 * Everything is in USD; rates are env-overridable because model pricing changes.
 *
 * Layers:
 *  1. Pure maths (maxCostBudgetUsd, estimateCostUsd, quote, marginReport) — no I/O, unit-testable.
 *  2. Ledger (usage per month and per brand) persisted like the rest of the app's documents.
 *  3. Guards (assertCanSpend, guardAgentRun, replyAllowed) — throw EnterpriseLimitError BEFORE the money is spent.
 */

// ---------- Pricing inputs ----------
const num = (k: string, d: number) => (Number.isFinite(Number(process.env[k])) && process.env[k] ? Number(process.env[k]) : d);

export type ModelKey = "strong" | "mid" | "cheap";
/** USD per million tokens (input / output). "strong" is the most expensive model class used. */
export const MODEL_RATES: Record<ModelKey, { in: number; out: number }> = {
  strong: { in: num("ENT_STRONG_IN", 15), out: num("ENT_STRONG_OUT", 75) },
  mid: { in: num("ENT_MID_IN", 3), out: num("ENT_MID_OUT", 15) },
  cheap: { in: num("ENT_CHEAP_IN", 0.3), out: num("ENT_CHEAP_OUT", 2.5) },
};

/** Media generation, USD per unit. */
export const MEDIA_RATES = {
  image: num("ENT_IMAGE_USD", 0.05),
  videoSecond: num("ENT_VIDEO_SEC_USD", 0.15),
};

/** Fixed overhead per handled reply/DM (routing, WhatsApp hand-off, storage), on top of its tokens. */
export const REPLY_OVERHEAD_USD = num("ENT_REPLY_OVERHEAD_USD", 0.004);

/** Card processing: percent of the charge + fixed fee, plus currency conversion on foreign cards. */
export const PAYMENT = { pct: num("ENT_PAY_PCT", 0.029), fixedUsd: num("ENT_PAY_FIXED", 0.3), fxPct: num("ENT_PAY_FX", 0.01) };

export const TARGET_GROSS_MARGIN = num("ENT_TARGET_MARGIN", 0.8);

export const ENTERPRISE_PLAN = {
  name: "BOOL Autonomous Agency Director",
  priceUsdMin: 1499,
  priceUsdMax: 2499,
  /** brands/pages included in the base price */
  includedBrands: 3,
};

// ---------- 1. Pure maths ----------
export function paymentFeeUsd(priceUsd: number): number {
  return priceUsd * (PAYMENT.pct + PAYMENT.fxPct) + PAYMENT.fixedUsd;
}

/** The most we may spend on API/media/infra in a month and still hit the target margin. */
export function maxCostBudgetUsd(priceUsd: number, margin = TARGET_GROSS_MARGIN): number {
  return Math.max(0, priceUsd * (1 - margin) - paymentFeeUsd(priceUsd));
}

export function tokenCostUsd(model: ModelKey, inputTokens: number, outputTokens: number): number {
  const r = MODEL_RATES[model];
  return (inputTokens * r.in + outputTokens * r.out) / 1e6;
}

export interface UsageProfile {
  /** tokens per month, per model class */
  tokens: Partial<Record<ModelKey, { input: number; output: number }>>;
  images: number;
  videoSeconds: number;
  /** replies/DMs handled automatically (tokens for them go in `tokens`, this is the per-item overhead) */
  replies: number;
  /** flat monthly infra per brand (hosting, storage, monitoring, WhatsApp) */
  infraPerBrandUsd?: number;
  brands?: number;
}

export function estimateCostUsd(p: UsageProfile): number {
  let c = 0;
  for (const [m, t] of Object.entries(p.tokens) as [ModelKey, { input: number; output: number }][]) c += tokenCostUsd(m, t.input, t.output);
  c += p.images * MEDIA_RATES.image + p.videoSeconds * MEDIA_RATES.videoSecond;
  c += p.replies * REPLY_OVERHEAD_USD;
  c += (p.infraPerBrandUsd ?? num("ENT_INFRA_PER_BRAND_USD", 4)) * (p.brands ?? 1);
  return c;
}

export interface MarginReport {
  priceUsd: number;
  paymentFeeUsd: number;
  apiCostUsd: number;
  grossProfitUsd: number;
  grossMargin: number; // 0..1
  costBudgetUsd: number; // max allowed cost at the target margin
  ok: boolean; // margin >= target
  minPriceUsd: number; // lowest price that would hit the target for this cost
}

export function marginReport(priceUsd: number, apiCostUsd: number, target = TARGET_GROSS_MARGIN): MarginReport {
  const fee = paymentFeeUsd(priceUsd);
  const gp = priceUsd - fee - apiCostUsd;
  // min price: P*(1-pct-fx) - fixed - cost >= target*P  ->  P >= (cost+fixed)/(1-pct-fx-target)
  const denom = 1 - PAYMENT.pct - PAYMENT.fxPct - target;
  return {
    priceUsd,
    paymentFeeUsd: round(fee),
    apiCostUsd: round(apiCostUsd),
    grossProfitUsd: round(gp),
    grossMargin: priceUsd > 0 ? Math.round((gp / priceUsd) * 1e4) / 1e4 : 0,
    costBudgetUsd: round(maxCostBudgetUsd(priceUsd, target)),
    ok: priceUsd > 0 && gp / priceUsd >= target,
    minPriceUsd: denom > 0 ? Math.ceil((apiCostUsd + PAYMENT.fixedUsd) / denom) : Infinity,
  };
}

/** Pre-sale check: does this expected usage profile earn >= target margin at this price? */
export function quote(priceUsd: number, profile: UsageProfile): MarginReport {
  return marginReport(priceUsd, estimateCostUsd(profile));
}

const round = (n: number) => Math.round(n * 100) / 100;

// ---------- Hard limits ----------
export interface Limits {
  /** total spend cap for the month (USD) — derived from price so margin is guaranteed */
  monthlyCostUsd: number;
  /** a single brand may not take more than this share of the monthly cap */
  perBrandShare: number;
  /** daily spend ceiling = monthly cap * this (stops a runaway day from eating the month) */
  dailyShare: number;
  maxBrands: number;
  maxTokensPerCall: number;
  maxAgentStepsPerRun: number;
  maxAgentRunsPerDayPerBrand: number;
  maxRepliesPerDayPerBrand: number;
  maxImagesPerMonth: number;
  maxVideoSecondsPerMonth: number;
  /** identical call repeated this many times within a minute = loop, trip the breaker */
  maxIdenticalCallsPerMinute: number;
}

export function limitsFor(priceUsd: number): Limits {
  return {
    monthlyCostUsd: maxCostBudgetUsd(priceUsd),
    perBrandShare: 0.5,
    dailyShare: 0.15,
    maxBrands: num("ENT_MAX_BRANDS", 10),
    maxTokensPerCall: num("ENT_MAX_TOKENS_PER_CALL", 16000),
    maxAgentStepsPerRun: num("ENT_MAX_AGENT_STEPS", 8),
    maxAgentRunsPerDayPerBrand: num("ENT_MAX_AGENT_RUNS_DAY", 24),
    maxRepliesPerDayPerBrand: num("ENT_MAX_REPLIES_DAY", 600),
    maxImagesPerMonth: num("ENT_MAX_IMAGES", 600),
    maxVideoSecondsPerMonth: num("ENT_MAX_VIDEO_SEC", 600),
    maxIdenticalCallsPerMinute: 3,
  };
}

export class EnterpriseLimitError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "EnterpriseLimitError";
  }
}

// ---------- 2. Ledger ----------
export interface Bucket {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  images: number;
  videoSeconds: number;
  replies: number;
  agentRuns: number;
}
export interface Ledger {
  month: Bucket;
  /** per brand, month */
  brands: Record<string, Bucket>;
  /** per day (YYYY-MM-DD): total cost + per brand replies/runs */
  days: Record<string, { costUsd: number; brands: Record<string, { replies: number; agentRuns: number }> }>;
  /** recent call fingerprints for loop detection: hash -> timestamps (ms) */
  recent: Record<string, number[]>;
}
const emptyBucket = (): Bucket => ({ costUsd: 0, inputTokens: 0, outputTokens: 0, images: 0, videoSeconds: 0, replies: 0, agentRuns: 0 });
export const emptyLedger = (): Ledger => ({ month: emptyBucket(), brands: {}, days: {}, recent: {} });

const FILE = path.join(__dirname, "..", "..", "data", "enterprise-usage.json");
const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);

function loadAll(): Record<string, Ledger> {
  try {
    return JSON.parse(readDoc(FILE) || "{}");
  } catch {
    return {};
  }
}
export function currentLedger(now = new Date()): Ledger {
  const l = loadAll()[monthKey(now)];
  return l ? { ...emptyLedger(), ...l } : emptyLedger();
}
function saveLedger(l: Ledger, now = new Date()) {
  const all = loadAll();
  // keep only the last 6 months so the document doesn't grow forever
  const keys = Object.keys(all).sort().slice(-5);
  const kept: Record<string, Ledger> = {};
  for (const k of keys) if (k !== monthKey(now)) kept[k] = all[k];
  kept[monthKey(now)] = l;
  writeDoc(FILE, JSON.stringify(kept));
}

export interface Spend {
  brand: string;
  model?: ModelKey;
  inputTokens?: number;
  outputTokens?: number;
  images?: number;
  videoSeconds?: number;
  replies?: number;
  agentRuns?: number;
}

export function spendCostUsd(s: Spend): number {
  return (
    (s.model ? tokenCostUsd(s.model, s.inputTokens || 0, s.outputTokens || 0) : 0) +
    (s.images || 0) * MEDIA_RATES.image +
    (s.videoSeconds || 0) * MEDIA_RATES.videoSecond +
    (s.replies || 0) * REPLY_OVERHEAD_USD
  );
}

/** Throws EnterpriseLimitError if this spend would break any hard limit. Pure over the given ledger. */
export function checkSpend(l: Ledger, lim: Limits, s: Spend, now = new Date()): void {
  const cost = spendCostUsd(s);
  const b = l.brands[s.brand] || emptyBucket();
  const day = l.days[dayKey(now)] || { costUsd: 0, brands: {} };
  const dayBrand = day.brands[s.brand] || { replies: 0, agentRuns: 0 };

  if ((s.inputTokens || 0) + (s.outputTokens || 0) > lim.maxTokensPerCall) {
    throw new EnterpriseLimitError("tokens_per_call", `A single call may not exceed ${lim.maxTokensPerCall} tokens`);
  }
  if (!l.brands[s.brand] && Object.keys(l.brands).length >= lim.maxBrands) {
    throw new EnterpriseLimitError("max_brands", `Brand limit reached (${lim.maxBrands})`);
  }
  if (l.month.costUsd + cost > lim.monthlyCostUsd) {
    throw new EnterpriseLimitError("monthly_cap", `Monthly cost cap reached ($${lim.monthlyCostUsd.toFixed(0)})`);
  }
  if (b.costUsd + cost > lim.monthlyCostUsd * lim.perBrandShare) {
    throw new EnterpriseLimitError("brand_cap", `Brand "${s.brand}" reached its share of the monthly cap`);
  }
  if (day.costUsd + cost > lim.monthlyCostUsd * lim.dailyShare) {
    throw new EnterpriseLimitError("daily_cap", "Daily cost ceiling reached — resumes tomorrow");
  }
  if (l.month.images + (s.images || 0) > lim.maxImagesPerMonth) throw new EnterpriseLimitError("images_cap", "Monthly image limit reached");
  if (l.month.videoSeconds + (s.videoSeconds || 0) > lim.maxVideoSecondsPerMonth) throw new EnterpriseLimitError("video_cap", "Monthly video limit reached");
  if (dayBrand.replies + (s.replies || 0) > lim.maxRepliesPerDayPerBrand) throw new EnterpriseLimitError("replies_cap", "Daily reply limit reached for this brand");
  if (dayBrand.agentRuns + (s.agentRuns || 0) > lim.maxAgentRunsPerDayPerBrand) throw new EnterpriseLimitError("runs_cap", "Daily autonomous-run limit reached for this brand");
}

/** Applies a spend to the ledger (mutates and returns it). Call checkSpend first. */
export function applySpend(l: Ledger, s: Spend, now = new Date()): Ledger {
  const cost = spendCostUsd(s);
  const add = (b: Bucket) => {
    b.costUsd += cost;
    b.inputTokens += s.inputTokens || 0;
    b.outputTokens += s.outputTokens || 0;
    b.images += s.images || 0;
    b.videoSeconds += s.videoSeconds || 0;
    b.replies += s.replies || 0;
    b.agentRuns += s.agentRuns || 0;
  };
  add(l.month);
  add((l.brands[s.brand] ||= emptyBucket()));
  const d = (l.days[dayKey(now)] ||= { costUsd: 0, brands: {} });
  d.costUsd += cost;
  const db = (d.brands[s.brand] ||= { replies: 0, agentRuns: 0 });
  db.replies += s.replies || 0;
  db.agentRuns += s.agentRuns || 0;
  // drop old days
  for (const k of Object.keys(l.days)) if (k < dayKey(new Date(now.getTime() - 8 * 86400000))) delete l.days[k];
  return l;
}

/** Loop breaker: the same fingerprint more than N times in a minute throws. */
export function checkLoop(l: Ledger, lim: Limits, fingerprint: string, now = Date.now()): void {
  const arr = (l.recent[fingerprint] || []).filter((t) => now - t < 60000);
  arr.push(now);
  l.recent[fingerprint] = arr;
  for (const k of Object.keys(l.recent)) if (!l.recent[k].some((t) => now - t < 60000)) delete l.recent[k];
  if (arr.length > lim.maxIdenticalCallsPerMinute) {
    throw new EnterpriseLimitError("loop", "Repeated identical call detected — stopped to prevent an infinite loop");
  }
}

// ---------- 3. Guards used by the rest of the app ----------
const priceUsd = () => num("ENT_PRICE_USD", ENTERPRISE_PLAN.priceUsdMin);

/** Call BEFORE a model/media call. Pass the worst-case estimate; throws if it would break a limit. */
export function assertCanSpend(s: Spend, fingerprint?: string): void {
  const l = currentLedger();
  const lim = limitsFor(priceUsd());
  if (fingerprint) checkLoop(l, lim, fingerprint);
  checkSpend(l, lim, s);
  if (fingerprint) saveLedger(l); // keeps loop timestamps
}

/** Call AFTER the call with the real usage. */
export function recordEnterpriseSpend(s: Spend): void {
  saveLedger(applySpend(currentLedger(), s));
}

/** Wrap one autonomous run: counts it and returns a step counter that throws past the step limit. */
export function guardAgentRun(brand: string): () => void {
  assertCanSpend({ brand, agentRuns: 1 });
  recordEnterpriseSpend({ brand, agentRuns: 1 });
  const max = limitsFor(priceUsd()).maxAgentStepsPerRun;
  let steps = 0;
  return () => {
    if (++steps > max) throw new EnterpriseLimitError("steps", `Autonomous run stopped after ${max} steps`);
  };
}

/** Live view for the dashboard / alerts: margin so far this month and how close each cap is. */
export function enterpriseStatus() {
  const l = currentLedger();
  const price = priceUsd();
  const lim = limitsFor(price);
  const rep = marginReport(price, l.month.costUsd);
  return {
    plan: ENTERPRISE_PLAN.name,
    priceUsd: price,
    usedUsd: round(l.month.costUsd),
    capUsd: round(lim.monthlyCostUsd),
    usedPct: lim.monthlyCostUsd > 0 ? Math.round((l.month.costUsd / lim.monthlyCostUsd) * 100) : 100,
    margin: rep,
    warn: l.month.costUsd >= lim.monthlyCostUsd * 0.7,
    brands: Object.fromEntries(Object.entries(l.brands).map(([k, b]) => [k, { costUsd: round(b.costUsd), replies: b.replies, agentRuns: b.agentRuns }])),
  };
}

import path from "path";
import { v4 as uuid } from "uuid";
import { readDoc, writeDoc } from "./persist";
import { getSettings } from "./settings";

const STATS_FILE = path.join(__dirname, "..", "..", "data", "adstats.json");
const LOGS_FILE = path.join(__dirname, "..", "..", "data", "adlogs.json");

export const AD_CHANNELS = ["facebook", "instagram", "google"] as const;
export const CHANNEL_LABEL: Record<string, string> = { facebook: "פייסבוק", instagram: "אינסטגרם", google: "גוגל" };

export interface ChannelStats { channel: string; spend: number; impressions: number; clicks: number; leads: number; periodStart: string; periodEnd: string; id?: string }

export interface InsightLog {
  id: string;
  periodStart: string;
  periodEnd: string;
  totalSpend: number;
  totalImpressions: number;
  totalClicks: number;
  totalLeads: number;
  costPerLead: number | null;
  /** Plain-Hebrew explanation of what changed and why. */
  reasoning: string;
  /** Per-channel budget moves. status "recommended": the owner applies them in the ads manager (no ads API connected). */
  actions: { channel: string; fromIls: number; toIls: number; status: "recommended" | "applied" }[];
  shares: Record<string, number>;
  createdAt: string;
}

const readJson = <T,>(file: string, fallback: T): T => {
  try {
    return JSON.parse(readDoc(file) || "") as T;
  } catch {
    return fallback;
  }
};

export const listStats = (): ChannelStats[] => readJson<ChannelStats[]>(STATS_FILE, []);
export const listInsightLogs = (): InsightLog[] => readJson<InsightLog[]>(LOGS_FILE, []);

export function addStats(s: Omit<ChannelStats, "id">): ChannelStats {
  const row: ChannelStats = {
    id: uuid(),
    channel: String(s.channel),
    spend: Math.max(0, Number(s.spend) || 0),
    impressions: Math.max(0, Math.floor(Number(s.impressions) || 0)),
    clicks: Math.max(0, Math.floor(Number(s.clicks) || 0)),
    leads: Math.max(0, Math.floor(Number(s.leads) || 0)),
    periodStart: s.periodStart,
    periodEnd: s.periodEnd,
  };
  const all = listStats();
  all.push(row);
  writeDoc(STATS_FILE, JSON.stringify(all.slice(-2000), null, 2));
  return row;
}

const MIN_SHARE = 0.1; // every enabled channel keeps learning
const MAX_SHARE = 0.7;
const MAX_WEEKLY_SHIFT = 0.15; // never swing more than 15 points in a week: avoids over-reacting to noise
const MIN_CLICKS = 30; // below this a channel's numbers are noise
const MIN_LEADS_FOR_CPL = 3;

const ils = (n: number) => `${Math.round(n).toLocaleString("he-IL")} ₪`;

export interface AllocationInput {
  budgetIls: number;
  channels: string[];
  stats: ChannelStats[]; // already limited to the period being judged
  previousShares?: Record<string, number>;
  periodStart: string;
  periodEnd: string;
}

/** Pure function: judges each channel by cost per lead (or per click while leads are too few) and shifts budget toward the cheaper one. */
export function computeAllocation(input: AllocationInput): InsightLog {
  const { budgetIls, channels } = input;
  const equal = 1 / Math.max(1, channels.length);
  const prev: Record<string, number> = {};
  channels.forEach((c) => (prev[c] = input.previousShares?.[c] ?? equal));

  const agg: Record<string, { spend: number; impressions: number; clicks: number; leads: number }> = {};
  channels.forEach((c) => (agg[c] = { spend: 0, impressions: 0, clicks: 0, leads: 0 }));
  for (const s of input.stats) {
    const a = agg[s.channel];
    if (!a) continue;
    a.spend += s.spend; a.impressions += s.impressions; a.clicks += s.clicks; a.leads += s.leads;
  }
  const total = Object.values(agg).reduce((t, a) => ({ spend: t.spend + a.spend, impressions: t.impressions + a.impressions, clicks: t.clicks + a.clicks, leads: t.leads + a.leads }), { spend: 0, impressions: 0, clicks: 0, leads: 0 });

  // Cost per result per channel: per lead when there are enough leads, else per click, else unknown.
  const cost: Record<string, number | null> = {};
  const basis: Record<string, "lead" | "click" | "none"> = {};
  for (const c of channels) {
    const a = agg[c];
    if (a.leads >= MIN_LEADS_FOR_CPL && a.spend > 0) { cost[c] = a.spend / a.leads; basis[c] = "lead"; }
    else if (a.clicks >= MIN_CLICKS && a.spend > 0) { cost[c] = a.spend / a.clicks; basis[c] = "click"; }
    else { cost[c] = null; basis[c] = "none"; }
  }
  // Mixing "per lead" and "per click" costs would compare apples to oranges: judge only if every channel uses the same basis.
  const bases = new Set(channels.map((c) => basis[c]));
  const comparable = bases.size === 1 && !bases.has("none") && channels.length > 1;

  let target: Record<string, number> = { ...prev };
  let reasoning: string;
  if (channels.length === 1) {
    target = { [channels[0]]: 1 };
    reasoning = `כל התקציב (${ils(budgetIls)}) מופנה לערוץ היחיד שהופעל — ${CHANNEL_LABEL[channels[0]] || channels[0]}.`;
  } else if (!comparable) {
    target = Object.fromEntries(channels.map((c) => [c, prev[c]]));
    reasoning = total.spend === 0
      ? "עדיין אין נתוני פרסום לשבוע הזה, ולכן החלוקה נשארת כמו שהייתה. ברגע שיהיו נתונים, המערכת תעביר תקציב לערוץ שמביא פניות בזול יותר."
      : "אין עדיין מספיק נתונים בכל הערוצים כדי להשוות בהגינות (צריך לפחות " + MIN_LEADS_FOR_CPL + " פניות או " + MIN_CLICKS + " קליקים בכל ערוץ). החלוקה נשארת, והמערכת ממשיכה ללמוד.";
  } else {
    const weights = Object.fromEntries(channels.map((c) => [c, 1 / (cost[c] as number)]));
    const wSum = Object.values(weights).reduce((a, b) => a + b, 0);
    let raw = Object.fromEntries(channels.map((c) => [c, Math.min(MAX_SHARE, Math.max(MIN_SHARE, weights[c] / wSum))]));
    // limit the weekly swing per channel, then renormalise
    raw = Object.fromEntries(channels.map((c) => [c, Math.min(prev[c] + MAX_WEEKLY_SHIFT, Math.max(prev[c] - MAX_WEEKLY_SHIFT, raw[c]))]));
    const sum = Object.values(raw).reduce((a, b) => a + b, 0);
    target = Object.fromEntries(channels.map((c) => [c, raw[c] / sum]));
    const unit = basis[channels[0]] === "lead" ? "פנייה" : "קליק";
    const sorted = [...channels].sort((a, b) => (cost[a] as number) - (cost[b] as number));
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    const lines = channels.map((c) => `${CHANNEL_LABEL[c] || c}: ${ils(agg[c].spend)} הניבו ${basis[c] === "lead" ? agg[c].leads + " פניות" : agg[c].clicks + " קליקים"} (${ils(cost[c] as number)} ל${unit})`);
    reasoning = `${lines.join("; ")}. ${CHANNEL_LABEL[best] || best} מביא ${unit} בזול יותר מ-${CHANNEL_LABEL[worst] || worst}, אז העברנו אליו חלק גדול יותר מהתקציב — בצעדים קטנים כדי לא להגיב ליותר מדי לרעש. כל ערוץ שומר לפחות ${Math.round(MIN_SHARE * 100)}% כדי שנמשיך ללמוד. ההערכה הזו מבוססת על שבוע אחד של נתונים ואינה הבטחה לתוצאות.`;
  }

  const actions = channels.map((c) => ({ channel: c, fromIls: Math.round(budgetIls * prev[c]), toIls: Math.round(budgetIls * target[c]), status: "recommended" as const }));
  return {
    id: uuid(),
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    totalSpend: Math.round(total.spend * 100) / 100,
    totalImpressions: total.impressions,
    totalClicks: total.clicks,
    totalLeads: total.leads,
    costPerLead: total.leads > 0 ? Math.round((total.spend / total.leads) * 100) / 100 : null,
    reasoning,
    actions,
    shares: Object.fromEntries(channels.map((c) => [c, Math.round(target[c] * 1000) / 1000])),
    createdAt: new Date().toISOString(),
  };
}

/** Runs the weekly allocation for the current tenant from the stats of the last 7 days and stores the explanation. */
export function runWeeklyAllocation(now = new Date()): InsightLog | null {
  const s = getSettings();
  if (s.adBudgetMonthly <= 0) return null;
  const channels = s.adPlatformsEnabled.filter((c) => (AD_CHANNELS as readonly string[]).includes(c));
  if (!channels.length) return null;
  const end = now.toISOString().slice(0, 10);
  const start = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const stats = listStats().filter((x) => x.periodEnd >= start && x.periodEnd <= end);
  const logs = listInsightLogs();
  const log = computeAllocation({ budgetIls: s.adBudgetMonthly, channels, stats, previousShares: logs[0]?.shares, periodStart: start, periodEnd: end });
  writeDoc(LOGS_FILE, JSON.stringify([log, ...logs].slice(0, 104), null, 2));
  return log;
}

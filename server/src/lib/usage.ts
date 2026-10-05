import fs from "fs";
import path from "path";
import { config } from "../config";

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const USAGE_FILE = path.join(DATA_DIR, "usage.json");

export interface MonthUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

type UsageByMonth = Record<string, MonthUsage>;

function monthKey(d = new Date()): string {
  return d.toISOString().slice(0, 7); // YYYY-MM (UTC)
}

function read(): UsageByMonth {
  try {
    return JSON.parse(fs.readFileSync(USAGE_FILE, "utf-8")) as UsageByMonth;
  } catch {
    return {};
  }
}

function write(data: UsageByMonth) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(USAGE_FILE, JSON.stringify(data, null, 2), "utf-8");
}

export function currentUsage(): MonthUsage & { month: string; limit: number } {
  const month = monthKey();
  const u = read()[month] || { calls: 0, inputTokens: 0, outputTokens: 0 };
  return { month, limit: config.aiMonthlyLimit, ...u };
}

/** Throws if this month's Claude call budget (AI_MONTHLY_LIMIT) is used up. */
export function assertWithinLimit(): void {
  const { calls, limit } = currentUsage();
  if (limit > 0 && calls >= limit) {
    throw new Error(`הגעת למכסה החודשית של ${limit} פניות ל-Claude. המכסה מתאפסת בתחילת החודש הבא.`);
  }
}

/** Counts one Claude call and its token usage against the current month. */
export function recordUsage(usage?: { input_tokens?: number; output_tokens?: number }): void {
  const all = read();
  const month = monthKey();
  const cur = all[month] || { calls: 0, inputTokens: 0, outputTokens: 0 };
  cur.calls += 1;
  cur.inputTokens += usage?.input_tokens || 0;
  cur.outputTokens += usage?.output_tokens || 0;
  all[month] = cur;
  write(all);
}

import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const FILE = path.join(DATA_DIR, "credits.json");

export interface Pack {
  id: string;
  label: string;
  priceIls: number;
  usageIls: number; // extra Claude spend allowance (estimated cost) the pack adds
  plans: number; // extra marketing plans
}

// Priced at roughly 3x the Claude cost they unlock, so top-ups keep the same margin as subscriptions.
export const PACKS: Pack[] = [
  { id: "small", label: "חבילת תוספת קטנה", priceIls: 50, usageIls: 15, plans: 2 },
  { id: "medium", label: "חבילת תוספת בינונית", priceIls: 100, usageIls: 35, plans: 5 },
  { id: "large", label: "חבילת תוספת גדולה", priceIls: 200, usageIls: 80, plans: 12 },
];

interface Purchase {
  id: string;
  packId: string;
  paymentRef: string;
  usageIls: number;
  plans: number;
  at: string;
}

function read(): Purchase[] {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf-8"));
  } catch {
    return [];
  }
}

export function totalPurchased(): { usageIls: number; plans: number } {
  const all = read();
  return { usageIls: all.reduce((a, p) => a + p.usageIls, 0), plans: all.reduce((a, p) => a + p.plans, 0) };
}

/** Adds a pack. Idempotent per paymentRef so a payment webhook that fires twice never double-credits. */
export function grantPack(packId: string, paymentRef: string): Purchase | null {
  const pack = PACKS.find((p) => p.id === packId);
  if (!pack) return null;
  const all = read();
  const existing = all.find((p) => p.paymentRef === paymentRef);
  if (existing) return existing;
  const purchase: Purchase = { id: uuid(), packId, paymentRef, usageIls: pack.usageIls, plans: pack.plans, at: new Date().toISOString() };
  all.push(purchase);
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2), "utf-8");
  return purchase;
}

/** Payment-page URL per pack, set in env (PACK_LINK_SMALL / _MEDIUM / _LARGE) from the payment provider. */
export function packLink(packId: string): string {
  return process.env[`PACK_LINK_${packId.toUpperCase()}`] || "";
}

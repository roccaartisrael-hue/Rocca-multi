import path from "path";
import { v4 as uuid } from "uuid";
import { readDoc, writeDoc } from "./persist";

/**
 * What the assistant knows about the business from the owner's own words (preferences, rules, decisions).
 * Fully visible and editable by the owner; exported as JSON from the same endpoint. Never stores secrets or personal identifiers.
 */
const FILE = path.join(__dirname, "..", "..", "data", "memory.json");
const MAX_FACTS = 60;

export interface Fact { id: string; text: string; createdAt: string }

const read = (): Fact[] => {
  try {
    return JSON.parse(readDoc(FILE) || "[]");
  } catch {
    return [];
  }
};
const write = (l: Fact[]) => writeDoc(FILE, JSON.stringify(l, null, 2));

export const listFacts = (): Fact[] => read();

const norm = (t: string) => t.toLowerCase().replace(/[\s.,!?"'’־-]+/g, " ").trim();

/** Rejects text that looks like a secret or an identifier (long digit runs, card/ID numbers, passwords, keys). */
export function unsafeFact(text: string): boolean {
  return /\d[\d\s-]{8,}\d/.test(text) || /(password|passcode|סיסמ|token|api[_ -]?key|cvv|secret)/i.test(text) || /[A-Za-z0-9_-]{32,}/.test(text);
}

export function addFact(text: string): { ok: boolean; fact?: Fact; reason?: string } {
  const t = String(text || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 200);
  if (t.length < 4) return { ok: false, reason: "empty" };
  if (unsafeFact(t)) return { ok: false, reason: "sensitive" };
  const all = read();
  const dup = all.find((f) => norm(f.text) === norm(t));
  if (dup) return { ok: true, fact: dup };
  const fact: Fact = { id: uuid(), text: t, createdAt: new Date().toISOString() };
  write([...all, fact].slice(-MAX_FACTS)); // oldest dropped first
  return { ok: true, fact };
}

export function deleteFact(id: string): boolean {
  const all = read();
  const rest = all.filter((f) => f.id !== id);
  if (rest.length === all.length) return false;
  write(rest);
  return true;
}

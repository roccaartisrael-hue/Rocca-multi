import path from "path";
import { v4 as uuid } from "uuid";
import { readDoc, writeDoc } from "./persist";

const FILE = path.join(__dirname, "..", "..", "data", "reminders.json");

export interface Reminder {
  id: string;
  date: string; // YYYY-MM-DD (Israel date)
  text: string;
  createdAt: string;
}

const read = (): Reminder[] => {
  try {
    return JSON.parse(readDoc(FILE) || "[]");
  } catch {
    return [];
  }
};
const write = (l: Reminder[]) => writeDoc(FILE, JSON.stringify(l.slice(0, 200), null, 2));

/** Upcoming first; reminders more than a week in the past are dropped. */
export function listReminders(): Reminder[] {
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  return read().filter((r) => r.date >= cutoff).sort((a, b) => a.date.localeCompare(b.date));
}

export function addReminder(date: string, text: string): Reminder {
  const r: Reminder = { id: uuid(), date, text: text.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 200), createdAt: new Date().toISOString() };
  write([...read(), r]);
  return r;
}

export function deleteReminder(id: string): boolean {
  const all = read();
  const rest = all.filter((r) => r.id !== id);
  if (rest.length === all.length) return false;
  write(rest);
  return true;
}

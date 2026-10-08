import path from "path";
import { v4 as uuid } from "uuid";
import { readDoc, writeDoc } from "./persist";

const FILE = path.join(__dirname, "..", "..", "data", "tickets.json");

export interface Ticket {
  id: string;
  subject: string;
  message: string;
  status: "open" | "closed";
  createdAt: string;
  replies: { from: "customer" | "support"; text: string; at: string }[];
}

const read = (): Ticket[] => {
  try {
    return JSON.parse(readDoc(FILE) || "[]");
  } catch {
    return [];
  }
};
const write = (l: Ticket[]) => writeDoc(FILE, JSON.stringify(l.slice(0, 500), null, 2));
const clip = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, n);

export const listTickets = (): Ticket[] => read();

export function openTicket(subject: unknown, message: unknown): Ticket {
  const t: Ticket = { id: uuid(), subject: clip(subject, 140) || "פנייה", message: clip(message, 3000), status: "open", createdAt: new Date().toISOString(), replies: [] };
  const all = read();
  all.unshift(t);
  write(all);
  return t;
}

export function replyTicket(id: string, from: "customer" | "support", text: unknown, close?: boolean): Ticket | undefined {
  const all = read();
  const t = all.find((x) => x.id === id);
  if (!t) return undefined;
  const body = clip(text, 3000);
  if (body) t.replies.push({ from, text: body, at: new Date().toISOString() });
  if (close !== undefined) t.status = close ? "closed" : "open";
  else if (from === "customer") t.status = "open";
  write(all);
  return t;
}

import path from "path";
import { v4 as uuid } from "uuid";
import { readDoc, writeDoc } from "./persist";

const FILE = path.join(__dirname, "..", "..", "data", "leads.json");

export type LeadStatus = "new" | "contacted" | "won" | "lost";
export interface Lead {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  source: string; // landing page, ad, site form…
  notes: string;
  status: LeadStatus;
  createdAt: string;
}

const read = (): Lead[] => {
  try {
    return JSON.parse(readDoc(FILE) || "[]");
  } catch {
    return [];
  }
};

const clip = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);

export function addLead(input: { fullName?: unknown; phone?: unknown; email?: unknown; source?: unknown; notes?: unknown }): Lead {
  const lead: Lead = {
    id: uuid(),
    fullName: clip(input.fullName, 120),
    phone: clip(input.phone, 40),
    email: clip(input.email, 160),
    source: clip(input.source, 100) || "direct",
    notes: clip(input.notes, 1000),
    status: "new",
    createdAt: new Date().toISOString(),
  };
  const all = read();
  all.unshift(lead);
  writeDoc(FILE, JSON.stringify(all.slice(0, 5000), null, 2));
  return lead;
}

export const listLeads = (): Lead[] => read();

export function setLeadStatus(id: string, status: LeadStatus): Lead | undefined {
  const all = read();
  const l = all.find((x) => x.id === id);
  if (!l) return undefined;
  l.status = status;
  writeDoc(FILE, JSON.stringify(all, null, 2));
  return l;
}

/** Israeli mobile/landline → international digits for wa.me (05X… → 9725X…). */
export function whatsappDigits(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("972")) return d;
  if (d.startsWith("0")) return "972" + d.slice(1);
  return d;
}

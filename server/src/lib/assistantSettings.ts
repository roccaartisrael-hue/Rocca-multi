import path from "path";
import crypto from "crypto";
import { readDoc, writeDoc, readGlobal, writeGlobal } from "./persist";
import { currentTenantId } from "./tenantContext";
import { Lang } from "./holidays";

const FILE = path.join(__dirname, "..", "..", "data", "assistant.json");

export interface WhatsAppSettings {
  phone?: string; // E.164 digits, set only after the customer proved ownership by messaging the BOOL number
  optIn: boolean;
  consentAt?: string;
  briefHour: number; // local hour 0-23
  tz: string; // IANA time zone of the business
  lang: Lang;
  calendars: string[]; // "global", "il"
  lastBriefDate?: string; // local YYYY-MM-DD of the last brief attempt
  lastInboundAt?: string; // opens the 24h free-text window
  lastBrief?: string;
}
export interface AssistantSettings { whatsapp: WhatsAppSettings }

const DEFAULTS: WhatsAppSettings = { optIn: false, briefHour: 8, tz: "UTC", lang: "en", calendars: ["global"] };

export function getAssistant(): AssistantSettings {
  try {
    const raw = readDoc(FILE);
    const j = raw ? JSON.parse(raw) : {};
    return { whatsapp: { ...DEFAULTS, ...(j.whatsapp || {}) } };
  } catch {
    return { whatsapp: { ...DEFAULTS } };
  }
}
export function saveWhatsApp(patch: Partial<WhatsAppSettings>): WhatsAppSettings {
  const cur = getAssistant();
  const next = { ...cur.whatsapp, ...patch };
  writeDoc(FILE, JSON.stringify({ whatsapp: next }, null, 2));
  return next;
}

export const validTz = (tz: unknown): tz is string => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: String(tz) });
    return typeof tz === "string" && tz.length > 0;
  } catch {
    return false;
  }
};

// ---- global indexes (inbound webhooks arrive without any login) ----
const readJson = <T>(name: string, fb: T): T => {
  try {
    const r = readGlobal(name);
    return r ? (JSON.parse(r) as T) : fb;
  } catch {
    return fb;
  }
};
const PHONES = "waPhones.json"; // phone -> tenantId
const PENDING = "waPending.json"; // code -> { tenantId, until }

export const tenantForPhone = (phone: string): string | undefined => readJson<Record<string, string>>(PHONES, {})[phone];

/** Short one-time code the customer sends to the BOOL WhatsApp number to prove they own the phone. */
export function createPairingCode(): string {
  const tenantId = currentTenantId();
  const all = readJson<Record<string, { tenantId: string; until: number }>>(PENDING, {});
  const now = Date.now();
  for (const k of Object.keys(all)) if (all[k].until < now || all[k].tenantId === tenantId) delete all[k];
  const code = crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
  all[code] = { tenantId, until: now + 30 * 60 * 1000 };
  writeGlobal(PENDING, JSON.stringify(all));
  return code;
}

/** Called by the webhook: binds the sender's phone to the tenant that created the code. Returns the tenant id. */
export function consumePairingCode(code: string, phone: string): string | undefined {
  const all = readJson<Record<string, { tenantId: string; until: number }>>(PENDING, {});
  const hit = all[code.toUpperCase()];
  if (!hit || hit.until < Date.now()) return undefined;
  delete all[code.toUpperCase()];
  writeGlobal(PENDING, JSON.stringify(all));
  const phones = readJson<Record<string, string>>(PHONES, {});
  for (const [p, t] of Object.entries(phones)) if (t === hit.tenantId) delete phones[p]; // one phone per business
  phones[phone] = hit.tenantId;
  writeGlobal(PHONES, JSON.stringify(phones));
  return hit.tenantId;
}

export function unbindPhone(tenantId: string): void {
  const phones = readJson<Record<string, string>>(PHONES, {});
  for (const [p, t] of Object.entries(phones)) if (t === tenantId) delete phones[p];
  writeGlobal(PHONES, JSON.stringify(phones));
}

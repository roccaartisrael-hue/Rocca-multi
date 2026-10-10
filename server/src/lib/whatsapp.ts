import crypto from "crypto";
import { Request } from "express";

/**
 * WhatsApp Business Cloud API (Meta). Everything is env-configured, nothing is stored in code:
 *  WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET (falls back to META_APP_SECRET),
 *  WHATSAPP_DISPLAY_NUMBER (the BOOL business number, digits only, used for the wa.me pairing link),
 *  WHATSAPP_BRIEF_TEMPLATE (approved utility template with ONE body variable; default "bool_daily_brief").
 */
const VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v21.0";

/** The WhatsApp phone-number ID: WHATSAPP_PHONE_ID, or WHATSAPP_PHONE_NUMBER_ID as an alias. */
export const waPhoneId = (): string => process.env.WHATSAPP_PHONE_ID || process.env.WHATSAPP_PHONE_NUMBER_ID || "";
export const waConfigured = (): boolean => !!(process.env.WHATSAPP_TOKEN && waPhoneId());
export const waDisplayNumber = (): string => String(process.env.WHATSAPP_DISPLAY_NUMBER || "").replace(/\D/g, "");

/** E.164 digits without "+". Accepts +/00 prefixes; Israeli local mobiles (05x…) are expanded; other local formats are rejected. */
export function normalizePhone(raw: string): string | null {
  let d = String(raw || "").trim().replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (/^05\d{8}$/.test(d)) d = "972" + d.slice(1);
  else if (d.startsWith("0")) return null; // local format of an unknown country: ask for the international number
  return /^[1-9]\d{7,14}$/.test(d) ? d : null;
}

export const maskPhone = (p: string): string => (p.length > 6 ? `+${p.slice(0, 3)}…${p.slice(-3)}` : "+…");

async function post(body: object): Promise<{ ok: boolean; error?: string }> {
  if (!waConfigured()) return { ok: false, error: "whatsapp_not_configured" };
  try {
    const r = await fetch(`https://graph.facebook.com/${VERSION}/${waPhoneId()}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
    });
    if (!r.ok) return { ok: false, error: `${r.status} ${(await r.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/** Free-form text: only allowed inside the 24h window after the customer's last message. */
export const sendText = (to: string, text: string) => post({ to, type: "text", text: { body: text.slice(0, 3800), preview_url: false } });

/** Business-initiated message (outside the 24h window) must be an approved template. Variables may not contain newlines. */
export const sendTemplate = (to: string, name: string, lang: string, vars: string[]) =>
  post({
    to,
    type: "template",
    template: { name, language: { code: lang }, components: [{ type: "body", parameters: vars.map((v) => ({ type: "text", text: v.replace(/[\r\n\t]+/g, " | ").replace(/ {2,}/g, " ").slice(0, 900) })) }] },
  });

export interface InboundMessage { from: string; id: string; text: string }

export function parseInbound(body: any): InboundMessage[] {
  const out: InboundMessage[] = [];
  for (const entry of body?.entry || []) {
    for (const ch of entry?.changes || []) {
      for (const m of ch?.value?.messages || []) {
        if (m?.type === "text" && m?.from && m?.text?.body) out.push({ from: String(m.from), id: String(m.id || ""), text: String(m.text.body) });
      }
    }
  }
  return out;
}

/** X-Hub-Signature-256 over the raw body. Without an app secret the webhook is rejected (inbound messages can trigger actions). */
export function validWaSignature(req: Request): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET;
  if (!secret) {
    console.warn("WHATSAPP_APP_SECRET / META_APP_SECRET not set: WhatsApp webhook rejected.");
    return false;
  }
  const given = String(req.header("x-hub-signature-256") || "");
  const raw: Buffer | undefined = (req as any).rawBody;
  if (!raw || !given.startsWith("sha256=")) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function verifyWaChallenge(mode?: string, token?: string, challenge?: string): string | null {
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && token === expected && challenge) return challenge;
  return null;
}

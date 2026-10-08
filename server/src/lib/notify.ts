import { Lead, whatsappDigits } from "./leads";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** The email a business owner gets for a new lead — big call / WhatsApp buttons. All lead text is escaped. */
export function leadEmailHtml(businessName: string, lead: Lead): string {
  const tel = lead.phone.replace(/[^\d+]/g, "");
  const wa = whatsappDigits(lead.phone);
  const btn = "display:inline-block;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold;margin:4px";
  return `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:480px;margin:auto;background:#161412;color:#f3ead7;padding:24px;border-radius:12px">
<h2 style="color:#d4b56a;margin:0 0 12px">ליד חדש · ${esc(businessName)}</h2>
<p style="font-size:18px;margin:4px 0"><b>${esc(lead.fullName) || "ללא שם"}</b></p>
${lead.phone ? `<p style="margin:4px 0">📞 ${esc(lead.phone)}</p>` : ""}${lead.email ? `<p style="margin:4px 0">✉️ ${esc(lead.email)}</p>` : ""}
<p style="margin:4px 0;color:#b9ad92">מקור: ${esc(lead.source)}</p>${lead.notes ? `<p style="margin:8px 0">${esc(lead.notes)}</p>` : ""}
<div style="margin-top:16px">${lead.phone ? `<a href="tel:${esc(tel)}" style="${btn};background:#d4b56a;color:#161412">חייגו עכשיו</a><a href="https://wa.me/${esc(wa)}" style="${btn};background:#25d366;color:#0b1f12">וואטסאפ</a>` : ""}</div></div>`;
}

export interface NotifyTarget { email?: string; whatsapp?: string }

/**
 * Announces a new lead right away. Channels are optional and configured by the operator:
 *  - RESEND_API_KEY (+ NOTIFY_FROM): a formatted email to the owner.
 *  - LEAD_WEBHOOK_URL: a JSON POST (Make/Zapier/n8n/WhatsApp Cloud API relay) with tel: and wa.me links.
 * Never throws: a failed notification must not lose the lead (it is already saved).
 */
export async function notifyLead(businessName: string, lead: Lead, target: NotifyTarget): Promise<{ email: boolean; webhook: boolean }> {
  const out = { email: false, webhook: false };
  const key = process.env.RESEND_API_KEY;
  if (key && target.email) {
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: process.env.NOTIFY_FROM || "BOOL <leads@bool.co.il>", to: [target.email], subject: `ליד חדש: ${lead.fullName || lead.phone || "פנייה חדשה"}`, html: leadEmailHtml(businessName, lead) }),
        signal: AbortSignal.timeout(10000),
      });
      out.email = r.ok;
    } catch (e) {
      console.error("Lead email failed:", (e as Error).message);
    }
  }
  const hook = process.env.LEAD_WEBHOOK_URL;
  if (hook) {
    try {
      const r = await fetch(hook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business: businessName,
          lead,
          notifyWhatsapp: target.whatsapp || "",
          telLink: lead.phone ? `tel:${lead.phone.replace(/[^\d+]/g, "")}` : "",
          waLink: lead.phone ? `https://wa.me/${whatsappDigits(lead.phone)}` : "",
        }),
        signal: AbortSignal.timeout(10000),
      });
      out.webhook = r.ok;
    } catch (e) {
      console.error("Lead webhook failed:", (e as Error).message);
    }
  }
  return out;
}

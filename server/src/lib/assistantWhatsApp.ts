import { runAsTenant, currentTenantId } from "./tenantContext";
import { getTier } from "./plans";
import { answerAssistant } from "./claude";
import { assertWithinLimit, recordCost } from "./usage";
import { rateLimited } from "./ratelimit";
import { getAssistant, saveWhatsApp, consumePairingCode, tenantForPhone } from "./assistantSettings";
import { assistantContext, executeAssistantAction, buildBrief, localHour, localYmd } from "./assistantOps";
import { InboundMessage, sendText, sendTemplate, waConfigured } from "./whatsapp";
import { Lang } from "./holidays";

const TEMPLATE_COST_USD = Number(process.env.WHATSAPP_TEMPLATE_COST_USD) || 0.05; // conservative; counted against the monthly cost cap
const seen: string[] = []; // webhook retries

const STOP = /^\s*(stop|unsubscribe|עצור|הפסק|baja|alto|arr[eê]t|قف|стоп)\s*$/i;
const PAIR = /BOOL[\s\-:]*([A-Z0-9]{6})/i;

const MSG: Record<Lang, { paired: string; stopped: string; slow: string }> = {
  he: { paired: "✓ מחובר! מעכשיו אני האסיסטנט שלך גם כאן. כתוב לי מה שצריך, ואשלח תדריך כל בוקר. לעצירה כתוב: עצור", stopped: "הופסקו ההודעות. אפשר להפעיל מחדש מהאפליקציה.", slow: "הגעת למגבלת ההודעות לשעה, נמשיך עוד מעט." },
  en: { paired: "✓ Connected! I'm now your assistant here too. Tell me what you need, and I'll send a brief every morning. To stop, reply: STOP", stopped: "Messages stopped. You can turn them back on in the app.", slow: "Hourly message limit reached, let's continue shortly." },
  es: { paired: "✓ ¡Conectado! Ahora soy tu asistente también aquí. Dime lo que necesites y te enviaré un resumen cada mañana. Para parar, escribe: BAJA", stopped: "Mensajes detenidos. Puedes reactivarlos en la app.", slow: "Límite de mensajes por hora alcanzado; seguimos en un rato." },
  fr: { paired: "✓ Connecté ! Je suis maintenant votre assistant ici aussi. Dites-moi ce dont vous avez besoin, et j'enverrai un point chaque matin. Pour arrêter, écrivez : ARRET", stopped: "Messages arrêtés. Vous pouvez les réactiver dans l'application.", slow: "Limite de messages par heure atteinte, on reprend bientôt." },
};

// Static reply for people who message the public number from the website (not customers): once per 24h per sender, no AI cost.
const STRANGER: Record<Lang, string> = {
  he: "היי! כאן BOOL AI 👋 אנחנו פלטפורמת שיווק אוטומטית לעסקים. לפרטים והרשמה: https://boolai.co.il . אם נתקלת בתקלה, אפשר לדווח מתוך האפליקציה.",
  en: "Hi! This is BOOL AI 👋 an automated marketing platform for businesses. Details and sign-up: https://boolai.co.il . If you hit a problem, report it from inside the app.",
  es: "¡Hola! Somos BOOL AI 👋 una plataforma automática de marketing para negocios. Más información y registro: https://boolai.co.il . Si tienes un problema, repórtalo desde la app.",
  fr: "Bonjour ! Ici BOOL AI 👋 une plateforme marketing automatisée pour les entreprises. Infos et inscription : https://boolai.co.il . En cas de problème, signalez-le depuis l'application.",
};
const strangerSeen = new Map<string, number>();
function strangerLang(t: string): Lang {
  if (/[\u0590-\u05FF]/.test(t)) return "he";
  if (/\b(hola|quisiera|saber|más|información)\b/i.test(t)) return "es";
  if (/\b(bonjour|je souhaite|savoir|plus sur)\b/i.test(t)) return "fr";
  return "en";
}
async function replyToStranger(from: string, text: string): Promise<void> {
  const now = Date.now();
  const last = strangerSeen.get(from) || 0;
  if (now - last < 24 * 60 * 60 * 1000) return;
  strangerSeen.set(from, now);
  if (strangerSeen.size > 5000) strangerSeen.delete(strangerSeen.keys().next().value as string);
  await sendText(from, STRANGER[strangerLang(text)]);
}

export async function handleWhatsAppInbound(msg: InboundMessage): Promise<void> {
  if (msg.id) {
    if (seen.includes(msg.id)) return;
    seen.push(msg.id);
    if (seen.length > 500) seen.shift();
  }
  const text = msg.text.trim();

  // 1) pairing: the customer proves ownership of the phone by messaging a one-time code from it
  const pair = text.match(PAIR);
  if (pair) {
    const tenantId = consumePairingCode(pair[1], msg.from);
    if (!tenantId) return; // unknown/expired code: stay silent
    await runAsTenant(tenantId, async () => {
      const ws = saveWhatsApp({ phone: msg.from, optIn: true, lastInboundAt: new Date().toISOString() });
      await sendText(msg.from, MSG[ws.lang].paired);
    });
    return;
  }

  // 2) only paired phones are served; strangers get one static reply a day
  const tenantId = tenantForPhone(msg.from);
  if (!tenantId) {
    if (text && !STOP.test(text)) await replyToStranger(msg.from, text).catch(() => {});
    return;
  }
  await runAsTenant(tenantId, async () => {
    const ws = getAssistant().whatsapp;
    if (!ws.optIn || !getTier().whatsappAssistant) return;
    saveWhatsApp({ lastInboundAt: new Date().toISOString() });
    if (STOP.test(text)) {
      saveWhatsApp({ optIn: false });
      await sendText(msg.from, MSG[ws.lang].stopped);
      return;
    }
    if (rateLimited(`wa|${currentTenantId()}`, 40, 60 * 60 * 1000)) {
      await sendText(msg.from, MSG[ws.lang].slow);
      return;
    }
    try {
      const history = ws.lastBrief ? [{ role: "assistant" as const, text: ws.lastBrief }] : [];
      const r = await answerAssistant(text, history, assistantContext(ws.tz));
      let reply = r.answer;
      if (r.action) {
        const x = executeAssistantAction(r.action, ws.tz);
        reply += `\n\n${x.ok ? "" : "⚠️ "}${x.message}`;
      }
      if (reply.trim()) await sendText(msg.from, reply);
    } catch (e: any) {
      await sendText(msg.from, String(e?.message || "Error").slice(0, 300)); // e.g. monthly cap reached — the owner should know
    }
  });
}

/** Called every few minutes for each tenant (inside its context): sends the morning brief once per local day. */
export async function sendBriefIfDue(now = new Date()): Promise<void> {
  const ws = getAssistant().whatsapp;
  if (!ws.optIn || !ws.phone || !waConfigured() || !getTier().whatsappAssistant) return;
  if (localHour(ws.tz, now) !== ws.briefHour) return;
  const today = localYmd(ws.tz, now);
  if (ws.lastBriefDate === today) return;
  try {
    assertWithinLimit(); // never spend past the plan's cost cap
  } catch {
    return;
  }
  const text = buildBrief(ws.lang, ws.tz, ws.calendars);
  const inWindow = !!ws.lastInboundAt && now.getTime() - Date.parse(ws.lastInboundAt) < 23 * 3600 * 1000;
  const res = inWindow
    ? await sendText(ws.phone, text)
    : await sendTemplate(ws.phone, process.env.WHATSAPP_BRIEF_TEMPLATE || "bool_daily_brief", ws.lang, [text]);
  if (!res.ok) {
    console.error(`WhatsApp brief failed (tenant ${currentTenantId()}): ${res.error}`);
    return;
  }
  if (!inWindow) recordCost(TEMPLATE_COST_USD);
  saveWhatsApp({ lastBriefDate: today, lastBrief: text });
}

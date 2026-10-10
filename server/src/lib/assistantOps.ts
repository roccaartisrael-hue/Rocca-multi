import { store } from "./store";
import { getProfile } from "./profile";
import { getTier, hasModule, effectiveModules } from "./plans";
import { MODULE_IDS, MODULES, upsellText } from "./modules";
import { upgradeLink } from "./checkCredits";
import { listReminders, addReminder } from "./reminders";
import { getAssistant } from "./assistantSettings";
import { upcomingDates, Lang } from "./holidays";
import { allowedPlatforms } from "./tenantContext";
import { ALL_PLATFORMS, Platform } from "../config";
import { AssistantAction } from "./claude";
import { scheduleProblem, needsImage } from "./scheduleRules";
import { listFacts, addFact } from "./businessMemory";

// ---- time zones (every business works in its own) ----
export const localYmd = (tz: string, d = new Date()): string => d.toLocaleDateString("en-CA", { timeZone: tz });
export const localHour = (tz: string, d = new Date()): number => Number(d.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).slice(0, 2)) % 24;

/** The instant at which the wall clock in `tz` shows ymd hh:mm. */
export function zonedInstant(ymd: string, hh: number, mm: number, tz: string): Date {
  const [y, mo, d] = ymd.split("-").map(Number);
  const wall = Date.UTC(y, mo - 1, d, hh, mm);
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const shown = new Date(guess).toLocaleString("sv-SE", { timeZone: tz }); // "YYYY-MM-DD HH:MM:SS"
    const shownMs = Date.parse(shown.replace(" ", "T") + "Z");
    guess += wall - shownMs;
  }
  return new Date(guess);
}

const shortId = (id: string) => id.slice(0, 8);

/** What the assistant knows about the business right now. */
export function assistantContext(tz: string): string {
  const p = getProfile();
  const posts = store.listPosts();
  const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString("sv-SE", { timeZone: tz }).slice(0, 16) : "");
  const upcoming = posts.filter((x) => x.status === "scheduled" && x.scheduledFor).sort((a, b) => String(a.scheduledFor).localeCompare(String(b.scheduledFor))).slice(0, 6);
  const drafts = posts.filter((x) => x.status === "draft" || x.status === "pending_approval").slice(0, 6);
  const today = localYmd(tz);
  const rem = listReminders().filter((r) => r.date >= today).slice(0, 8);
  const cal = upcomingDates(today, 30, getAssistant().whatsapp.calendars).slice(0, 4);
  const memory = listFacts();
  let best: string[] = [];
  try {
    best = store.topPerformingPlatformContent("engagement", 2).map((r) => String(r.content.text || "").slice(0, 120)).filter(Boolean);
  } catch {}
  return [
    `תאריך היום: ${today} · אזור זמן: ${tz}`,
    p ? `העסק: ${p.businessName} · מוכר: ${p.whatYouSell} · קהל: ${p.audience} · מיקום: ${p.location} · טון: ${p.tone}${p.neverSay ? ` · לא להגיד: ${p.neverSay}` : ""}` : "פרופיל העסק עדיין לא מולא — עודד למלא בלשונית הגדרות.",
    `פוסטים מתוזמנים: ${upcoming.length ? upcoming.map((x) => `[${shortId(x.id)}] ${fmt(x.scheduledFor)} ${x.topic}`).join("; ") : "אין"}`,
    `טיוטות וממתינים לאישור: ${drafts.length ? drafts.map((x) => `[${shortId(x.id)}] ${x.topic}`).join("; ") : "אין"}`,
    `תזכורות קרובות: ${rem.length ? rem.map((r) => `${r.date} ${r.text}`).join("; ") : "אין"}`,
    `מה שבעל העסק סיפר לך ושכדאי לזכור: ${memory.length ? memory.map((f) => f.text).join("; ") : "עדיין כלום"}`,
    `פוסטים שהצליחו אצלו: ${best.length ? best.join(" | ") : "אין עדיין נתונים"}`,
    packageLine(),
    `מועדים שיווקיים קרובים: ${cal.length ? cal.map((c) => `${c.date} ${c.name.he}`).join("; ") : "אין"}`,
  ].join("\n");
}

/** What the package includes, and the exact upgrade message for each service that is not included (the assistant uses it when asked for one). */
function packageLine(): string {
  const have = effectiveModules();
  const missing = MODULE_IDS.filter((m) => !have.includes(m));
  const link = upgradeLink();
  return [
    `החבילה של הלקוח: ${getTier().label}. שירותים כלולים: ${have.map((m) => MODULES[m].label).join("; ") || "אין"}.`,
    missing.length
      ? `שירותים שאינם כלולים (ניתוח השוק, המתחרים וידע על העסק כבר מוכנים לכולם): ${missing.map((m) => `${MODULES[m].label} — אם מבקשים זאת, ענה בדיוק בנוסח: "${upsellText(m, link)}" ואל תוציא ACTION`).join(" | ")}`
      : "כל השירותים כלולים בחבילה.",
  ].join("\n");
}

export interface ActionResult { ok: boolean; message: string }

/** Runs an action the owner approved (button) or explicitly asked for in chat (WhatsApp). Never publishes immediately. */
export function executeAssistantAction(a: AssistantAction, tz: string): ActionResult {
  if (a.type === "reminder") {
    addReminder(a.date, a.text);
    return { ok: true, message: `✓ ${a.date} · ${a.text}` };
  }
  if (a.type === "remember") {
    const r = addFact(a.text);
    return r.ok ? { ok: true, message: `🧠 ${r.fact!.text}` } : { ok: false, message: r.reason === "sensitive" ? "I don't store passwords, card numbers or personal identifiers." : "Nothing to remember" };
  }
  if ((a.type === "draft_post" || a.type === "schedule_post") && !hasModule("social")) return { ok: false, message: upsellText("social", upgradeLink()) };
  if (a.type === "draft_post") {
    const platforms = (["facebook", "instagram"] as Platform[]).filter((p) => allowedPlatforms(ALL_PLATFORMS).includes(p));
    if (!platforms.length) return { ok: false, message: "No platform available" };
    const post = store.createPost(a.topic.slice(0, 120), platforms.map((p) => ({ platform: p, text: a.text.slice(0, 2200), status: "pending" as const })));
    return { ok: true, message: `✓ draft ${shortId(post.id)}` };
  }
  // schedule_post
  const post = store.listPosts().find((x) => x.id === a.postId || shortId(x.id) === a.postId);
  if (!post) return { ok: false, message: "Post not found" };
  if (post.status === "published") return { ok: false, message: "Already published" };
  if (needsImage(post)) return { ok: false, message: "Image required (Instagram/TikTok) before scheduling" };
  const [ymd, hm] = a.when.split(" ");
  const [hh, mm] = hm.split(":").map(Number);
  if (!(hh >= 0 && hh < 24 && mm >= 0 && mm < 60)) return { ok: false, message: "Invalid time" };
  const when = zonedInstant(ymd, hh, mm, tz);
  const problem = scheduleProblem(when.toISOString(), post.id, true);
  if (problem) return { ok: false, message: problem };
  store.updatePost(post.id, { scheduledFor: when.toISOString(), status: "scheduled" });
  return { ok: true, message: `✓ ${post.topic} → ${a.when}` };
}

// ---- daily brief (deterministic text: no AI cost) ----
const T: Record<Lang, { hi: (n: string) => string; today: (n: number, t: string) => string; approve: (n: number) => string; rem: string; soon: (d: number, name: string) => string; reply: string; idle: string }> = {
  he: { hi: (n) => `בוקר טוב${n ? ` ${n}` : ""} ☀️ התדריך שלך:`, today: (n, t) => `📅 היום מתוזמנים ${n} פוסטים: ${t}`, approve: (n) => `📝 ${n} פוסטים מחכים לאישור שלך`, rem: "⏰ תזכורות", soon: (d, n) => `🎯 בעוד ${d} ימים: ${n}`, reply: `רוצה שאכין פוסט למועד? ענה "כן".`, idle: "אין משהו דחוף היום. רוצה רעיון לפוסט? ענה לי כאן." },
  en: { hi: (n) => `Good morning${n ? ` ${n}` : ""} ☀️ Your brief:`, today: (n, t) => `📅 ${n} posts scheduled today: ${t}`, approve: (n) => `📝 ${n} posts waiting for your approval`, rem: "⏰ Reminders", soon: (d, n) => `🎯 In ${d} days: ${n}`, reply: `Want me to prepare a post for it? Reply "yes".`, idle: "Nothing urgent today. Want a post idea? Reply here." },
  es: { hi: (n) => `Buenos días${n ? ` ${n}` : ""} ☀️ Tu resumen:`, today: (n, t) => `📅 ${n} publicaciones programadas hoy: ${t}`, approve: (n) => `📝 ${n} publicaciones esperan tu aprobación`, rem: "⏰ Recordatorios", soon: (d, n) => `🎯 En ${d} días: ${n}`, reply: `¿Preparo una publicación para esa fecha? Responde "sí".`, idle: "Nada urgente hoy. ¿Quieres una idea de publicación? Responde aquí." },
  fr: { hi: (n) => `Bonjour${n ? ` ${n}` : ""} ☀️ Votre point du jour :`, today: (n, t) => `📅 ${n} publications prévues aujourd'hui : ${t}`, approve: (n) => `📝 ${n} publications attendent votre validation`, rem: "⏰ Rappels", soon: (d, n) => `🎯 Dans ${d} jours : ${n}`, reply: `Je prépare une publication pour cette date ? Répondez « oui ».`, idle: "Rien d'urgent aujourd'hui. Une idée de publication ? Répondez ici." },
};

export function buildBrief(lang: Lang, tz: string, calendars: string[]): string {
  const t = T[lang] || T.en;
  const today = localYmd(tz);
  const posts = store.listPosts();
  const todays = posts.filter((p) => p.status === "scheduled" && p.scheduledFor && localYmd(tz, new Date(p.scheduledFor)) === today);
  const waiting = posts.filter((p) => p.status === "pending_approval" || p.status === "draft").length;
  const tomorrow = localYmd(tz, new Date(Date.now() + 86400000));
  const rem = listReminders().filter((r) => r.date === today || r.date === tomorrow);
  const soon = upcomingDates(today, 14, calendars).find((d) => d.daysAway >= 1);
  const biz = getProfile()?.businessName || "";
  const lines = [t.hi(biz)];
  if (todays.length) lines.push(t.today(todays.length, todays.slice(0, 3).map((p) => p.topic).join(", ")));
  if (waiting) lines.push(t.approve(waiting));
  if (rem.length) lines.push(`${t.rem}: ${rem.map((r) => r.text).join(" · ")}`);
  if (soon) lines.push(t.soon(soon.daysAway, soon.name[lang] || soon.name.en), t.reply);
  if (lines.length === 1) lines.push(t.idle);
  return lines.join("\n");
}

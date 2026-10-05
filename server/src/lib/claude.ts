import Anthropic from "@anthropic-ai/sdk";
import { config, Platform } from "../config";
import { assertWithinLimit, recordUsage } from "./usage";

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const MODEL = "claude-sonnet-5";

// Draft brand voice, pending owner approval — see docs/BRAND_VOICE.md (source of truth; update both together).
const DEFAULT_BRAND_VOICE = `
את/ה כותב/ת תוכן שיווקי בעברית עבור ROCCA — בית אבן טבעית פרימיום (אוניקס, שיש, גרניט, קוורציט) בקריית ביאליק, ישראל.

קהל יעד ראשי: מעצבים/ות (פנים, אדריכלות) — אלה שמשפיעים על בחירת החומר. איתם מדברים חומר: גוון, עורק, גימור, זמינות, איך זה מתנהג באור. קהל משני: לקוח פרטי (תוצאה וחוויה) ולקוח עסקי (תהליך ואמינות, עמידה בלו"ז). כשלא ברור מי הקהל — ברירת מחדל היא מעצבים.

הטון: יוקרתי, בטוח, מדויק — לא סופרלטיבים ריקים ("הכי", "מדהים", "חלומי") בלי עובדה שתומכת בהם. חם אבל לא מכירתי, כמו מישהו שמבין בחומר ומדבר עם עמיתים למקצוע.
מתמקד באיכות האבן, בלעדיות על עורקי אוניקס נדירים ממכרה בבעלות החברה, ובתהליך המלא (ייבוא, חיתוך, התקנה, תאורה) תחת קורת גג אחת. כשידוע שם גוון/סוג אבן מדויק (למשל "אוניקס ירוק זית") — להשתמש בו, לא ב"אוניקס" סתמי.

אף פעם לא: מחירים, הנחות או "מבצע" (גם לא בתגובות ציבוריות); הבטחות זמנים קונקרטיות שלא נמסרו; קריאות "!!!" או יותר מאימוג'י אחד; ניסוחים כמו "המבחר הכי גדול בישראל" בלי גיבוי עובדתי. אם חסר מידע — כותב/ת באופן כללי ומזמין/ה ליצירת קשר.
`.trim();

// Per-deployment override: set BRAND_VOICE to run the bot for a different business.
const BRAND_VOICE = config.brandVoice || DEFAULT_BRAND_VOICE;

const PLATFORM_RULES: Record<Platform, string> = {
  facebook: "פוסט פייסבוק: 2-4 משפטים, טון חם ואישי, אפשר אימוג'י בודד אם מתאים, קריאה לפעולה בסוף (הודעה בפרטי / קישור לאתר).",
  instagram: "כיתוב לאינסטגרם: פתיח קליט במשפט הראשון, טקסט קצר, ובסיום 5-8 האשטגים רלוונטיים בעברית ואנגלית (למשל #ROCCA #אוניקס #שיש #אבןטבעית #עיצובפנים).",
  x: "פוסט ל-X (טוויטר): עד 260 תווים, ישיר וקולע, בלי האשטגים מוגזמים (מקסימום 1-2).",
  tiktok: "כיתוב לוידאו טיקטוק: משפט פתיחה שעוצר גלילה, טון קליל יותר, 3-5 האשטגים.",
  website: "פסקת 'עדכון' לאתר החברה: 2-3 משפטים בטון מקצועי-יוקרתי, בגוף שלישי, ללא אימוג'ים.",
};

function extractJson(text: string): any {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Claude did not return JSON: " + text.slice(0, 200));
  return JSON.parse(match[0]);
}

export interface GenerationContext {
  /** Text of past posts that performed well (by reach/engagement) — style reference, not to copy verbatim. */
  topPerformers?: string[];
  /** Notes from the owner's manually-curated inspiration board — style reference, never competitor content. */
  inspirationNotes?: string[];
}

export async function generatePostForPlatforms(
  topic: string,
  platforms: Platform[],
  context?: GenerationContext
): Promise<Record<Platform, string>> {
  const rules = platforms.map((p) => `- ${p}: ${PLATFORM_RULES[p]}`).join("\n");

  const contextBlocks: string[] = [];
  if (context?.topPerformers?.length) {
    contextBlocks.push(
      `פוסטים קודמים שהצליחו הכי טוב (השראת סגנון וטון בלבד — אל תעתיק/י אותם):\n` +
        context.topPerformers.map((t) => `- "${t}"`).join("\n")
    );
  }
  if (context?.inspirationNotes?.length) {
    contextBlocks.push(
      `מה שבעל העסק ציין שהוא אוהב בפוסטים/תמונות (השראת סגנון בלבד):\n` +
        context.inspirationNotes.map((n) => `- "${n}"`).join("\n")
    );
  }

  assertWithinLimit();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: BRAND_VOICE,
    messages: [
      {
        role: "user",
        content: `כתוב תוכן שיווקי על הנושא הבא: "${topic}"

צריך גרסה נפרדת לכל אחת מהפלטפורמות הבאות, לפי הכללים שלה:
${rules}
${contextBlocks.length ? "\n" + contextBlocks.join("\n\n") + "\n" : ""}
החזר אך ורק אובייקט JSON תקין (בלי טקסט נוסף, בלי מרקדאון) במבנה:
{ ${platforms.map((p) => `"${p}": "..."`).join(", ")} }`,
      },
    ],
  });

  recordUsage(msg.usage);
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return extractJson(text);
}

export async function generateReplyDraft(params: {
  incomingText: string;
  incomingAuthor?: string;
  channel: string;
}): Promise<string> {
  assertWithinLimit();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: `${BRAND_VOICE}

את/ה עונה בשם ROCCA להודעה/תגובה של לקוח פוטנציאלי בערוץ ${params.channel}.
כתוב/כתבי תגובה קצרה, אדיבה ומועילה בעברית.
כלל קשיח: לעולם אל תציין/י מחיר, טווח מחיר, הנחה או הצעה כספית כלשהי — גם לא באופן כללי — גם אם המחיר "ידוע" או נראה מובן מאליו מההקשר. אם נשאל/ת על מחיר, הצע/י בעדינות לעבור לשיחה פרטית עם הצוות ואל תסבירי שאת נמנעת ממחיר.
אם נשאלת שאלה אחרת שאין לך עליה מידע (זמינות מדויקת, מלאי וכו'), הזמן/י ליצירת קשר ישיר עם הצוות דרך האתר או הודעה פרטית, ואל תמציא/י עובדות.
החזר אך ורק את טקסט התגובה, בלי מרכאות ובלי הסברים נוספים.`,
    messages: [
      {
        role: "user",
        content: `הודעה נכנסת מאת ${params.incomingAuthor || "לקוח"}:\n"${params.incomingText}"`,
      },
    ],
  });

  recordUsage(msg.usage);
  return msg.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
}

const PRICE_KEYWORDS = [
  "מחיר",
  "עלות",
  "כמה עולה",
  "כמה זה",
  "הנחה",
  "מבצע",
  "לשלם",
  "עלות ל",
  "price",
  "cost",
  "$",
  "₪",
];

/** Heuristic only — used to flag a pending reply for extra caution, never to decide auto-send by itself. */
export function isPriceQuestion(text: string): boolean {
  const lower = text.toLowerCase();
  return PRICE_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

export interface PlanRequest {
  goal: string; // e.g. "יותר פניות ממעצבים"
  weeks: number; // 1-4
  postsPerWeek: number; // 1-5
  platforms: Platform[];
  adBudget?: number; // monthly, ILS; 0/undefined = organic only
  notes?: string;
}

export interface PlanItem {
  dayOffset: number; // days from today
  time: string; // HH:MM
  topic: string;
  imageIdea: string;
  texts: Partial<Record<Platform, string>>;
}

export interface MarketingPlan {
  summary: string;
  audience: string;
  pillars: string[];
  items: PlanItem[];
  adAdvice: string;
}

export async function generateMarketingPlan(req: PlanRequest, context?: GenerationContext): Promise<MarketingPlan> {
  const total = req.weeks * req.postsPerWeek;
  const rules = req.platforms.map((p) => `- ${p}: ${PLATFORM_RULES[p]}`).join("\n");
  const ctx: string[] = [];
  if (context?.topPerformers?.length) {
    ctx.push(`פוסטים שהצליחו בעבר (למד/י מהם, אל תעתיק/י):\n` + context.topPerformers.map((t) => `- "${t}"`).join("\n"));
  }
  if (context?.inspirationNotes?.length) {
    ctx.push(`מה בעל העסק אוהב:\n` + context.inspirationNotes.map((n) => `- "${n}"`).join("\n"));
  }

  assertWithinLimit();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: BRAND_VOICE,
    messages: [
      {
        role: "user",
        content: `בנה/י תוכנית פרסום ל-${req.weeks} שבועות.
מטרה: ${req.goal}
מספר פוסטים: בדיוק ${total} (${req.postsPerWeek} בשבוע), מפוזרים בימים ובשעות שונות לאורך התקופה.
פלטפורמות: ${req.platforms.join(", ")}
תקציב פרסום ממומן חודשי: ${req.adBudget ? req.adBudget + " ₪" : "אין — אורגני בלבד"}
${req.notes ? "הערות בעל העסק: " + req.notes : ""}
${ctx.length ? "\n" + ctx.join("\n\n") + "\n" : ""}
כללי הכתיבה לכל פלטפורמה:
${rules}

גוון את סוגי התוכן (חומר/אבן, תהליך, פרויקט, טיפ מקצועי, מאחורי הקלעים) ואל תחזור על אותו נושא.
בשדה adAdvice: אם יש תקציב — המלצה קצרה איך לפצל אותו (אילו פוסטים כדאי לקדם, קהל יעד, משך); אם אין — כתוב המלצה אורגנית בלבד.

החזר אך ורק JSON תקין (בלי מרקדאון) במבנה:
{"summary":"...","audience":"...","pillars":["..."],"adAdvice":"...","items":[{"dayOffset":1,"time":"19:00","topic":"...","imageIdea":"איזו תמונה/וידאו לצרף","texts":{${req.platforms.map((p) => `"${p}":"..."`).join(",")}}}]}`,
      },
    ],
  });

  recordUsage(msg.usage);
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const plan = extractJson(text) as MarketingPlan;
  if (!Array.isArray(plan.items)) throw new Error("התוכנית שהתקבלה לא תקינה, נסה שוב");
  return plan;
}

import { config, Platform } from "../config";
import { assertWithinLimit, recordUsage } from "./usage";
import { getProfile } from "./profile";
import { isDefaultTenant } from "./tenantContext";
import { llm } from "./ai";


// Draft brand voice, pending owner approval — see docs/BRAND_VOICE.md (source of truth; update both together).
const DEFAULT_BRAND_VOICE = `
את/ה כותב/ת תוכן שיווקי בעברית עבור ROCCA (רוקה), "אמנות באבן": בית אבן טבעית פרימיום עם מפעל חיתוך משלו, בקריית ביאליק, ושירות לכל הארץ. ROCCA מתרחבת: בחודשים הקרובים (בתוך חודשיים-שלושה) נפתחים שלושה שואו-רומים חדשים, בראשון לציון, בירושלים ובבאר שבע, ובהם קירות אבן מוארים. מותר לכתוב "בקרוב" או "בחודשים הקרובים" ולציין את שלוש הערים, אבל לא להמציא תאריכי פתיחה, כתובות או פרטים אחרים שלא נמסרו. לא לכתוב "רשת" או "סניפי דגל" אלא "שואו-רומים חדשים".

מה ROCCA מציעה: כל סוגי האבן הטבעית הקיימים בשוק (אוניקס, שיש, גרניט, קוורציט ועוד), קירות אבן מוארים, כיורים באבן (מוארים ולא מוארים), משטחים ואבן למטבחים ולחדרי רחצה. הכול מייבוא ועד חיתוך והתקנה, תחת קורת גג אחת. בלעדיות על עורקי אוניקס נדירים ממכרה בבעלות החברה. בעתיד: רהיטים ואקססוריז, אבל לא מכריזים על כך עד שמאשרים.

המטרה: שמי שקונה דירה או משפץ ורוצה אבן לבית יגיד "רוקה" ויבוא לראות. לכן חוזרים לשם ROCCA ולסלוגן "אמנות באבן", ומדגישים ייחודיות, מומחיות ומעורבות אישית, בלי להישמע כמו עוד ספק.

קהל יעד: לקוחות פרטיים שקונים דירה או משפצים (חדר רחצה, מטבח, קיר מואר), ולצדם מעצבים/ות ואדריכלים/ות שמשפיעים על הבחירה. למעצבים מדברים חומר: גוון, עורק, גימור, איך זה מתנהג באור. ללקוח פרטי מדברים תוצאה וחוויה: איך זה ייראה בבית. כשלא ברור מי הקהל, מדברים ללקוח פרטי שקונה דירה, בנימה שמכבדת גם מעצבים.

הטון: יוקרתי, בטוח, מדויק ואנושי. אמנות ואומנות: מדברים על לוח שהוא יצירה, על עורקים כציור, על אור שמגלה את האבן. לא סופרלטיבים ריקים ("הכי", "מדהים", "חלומי") בלי עובדה שתומכת בהם. כשידוע שם גוון/סוג אבן מדויק (למשל "אוניקס ירוק זית") להשתמש בו.

מיקום: לא מזכירים את קריית ביאליק או את השואו-רום בכל פוסט. רוב הפוסטים עוסקים באבן, ביצירה, באור ובמפעל, ומסתיימים בהזמנה קצרה ("שלחו הודעה"). את המיקום מזכירים רק בפוסט הזמנה לשואו-רום, בערך אחד מכל חמישה פוסטים.

אף פעם לא: מחירים, הנחות או "מבצע" (גם לא בתגובות ציבוריות); הבטחות זמנים קונקרטיות שלא נמסרו; קריאות "!!!" או יותר מאימוג'י אחד; ניסוחים כמו "המבחר הכי גדול בישראל" בלי גיבוי עובדתי. אם חסר מידע, כותבים באופן כללי ומזמינים ליצירת קשר.
`.trim();

// Per-deployment override: set BRAND_VOICE to run the bot for a different business.
// A voice saved from the setup screen wins over BRAND_VOICE, which wins over the built-in ROCCA voice.
function brandVoice(): string {
  const p = getProfile();
  // Other tenants must never inherit the operator's (ROCCA) voice: they get their own, or a neutral fallback.
  const base = isDefaultTenant()
    ? p?.brandVoice || config.brandVoice || DEFAULT_BRAND_VOICE
    : p?.brandVoice || "את/ה כותב/ת תוכן שיווקי בעברית עבור העסק של המשתמש. כתוב/כתבי בטון מקצועי וחם. אף פעם לא מחירים, הנחות או הבטחות שלא נמסרו.";
  // The learned market brief rides along in every prompt (capped so it stays cheap).
  return p?.market ? `${base}\n\nידע על השוק של העסק (להתאמת הזוויות, העונתיות והמסרים; לא להעתיק מילה במילה):\n${p.market.slice(0, 2500)}` : base;
}
function businessName(): string {
  return getProfile()?.businessName || (isDefaultTenant() ? "ROCCA" : "העסק");
}
const IG_EXAMPLE_HASHTAGS = " (למשל #ROCCA #אוניקס #שיש #אבןטבעית #עיצובפנים)";

const PLATFORM_RULES_BASE: Record<Platform, string> = {
  facebook: "פוסט פייסבוק: 2-4 משפטים, טון חם ואישי, אפשר אימוג'י בודד אם מתאים, קריאה לפעולה בסוף (הודעה בפרטי / קישור לאתר).",
  instagram: "כיתוב לאינסטגרם: פתיח קליט במשפט הראשון, טקסט קצר, ובסיום 5-8 האשטגים רלוונטיים בעברית ואנגלית (למשל #ROCCA #אוניקס #שיש #אבןטבעית #עיצובפנים).",
  x: "פוסט ל-X (טוויטר): עד 260 תווים, ישיר וקולע, בלי האשטגים מוגזמים (מקסימום 1-2).",
  tiktok: "כיתוב לוידאו טיקטוק: משפט פתיחה שעוצר גלילה, טון קליל יותר, 3-5 האשטגים.",
  website: "פסקת 'עדכון' לאתר החברה: 2-3 משפטים בטון מקצועי-יוקרתי, בגוף שלישי, ללא אימוג'ים.",
};

/** Platform rules; the ROCCA-specific hashtag example is only used when no custom business is set up. */
function platformRules(): Record<Platform, string> {
  if (getProfile() || config.brandVoice || !isDefaultTenant()) return PLATFORM_RULES_BASE;
  return { ...PLATFORM_RULES_BASE, instagram: PLATFORM_RULES_BASE.instagram.replace(/\.$/, "") + IG_EXAMPLE_HASHTAGS + "." };
}

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
  const rules = platforms.map((p) => `- ${p}: ${platformRules()[p]}`).join("\n");

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
  const msg = await llm.messages.create({
    task: "post",
    max_tokens: 1500,
    system: brandVoice(),
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
  const msg = await llm.messages.create({
    task: "reply",
    max_tokens: 400,
    system: `${brandVoice()}

את/ה עונה בשם ${businessName()} להודעה/תגובה של לקוח פוטנציאלי בערוץ ${params.channel}.
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
  weeklyBudget?: number; // paid promotion budget per week, ILS; 0/undefined = organic only
  aggressive?: boolean;
  notes?: string;
}

export interface PlanItem {
  dayOffset: number; // days from today
  time: string; // HH:MM
  topic: string;
  imageIdea: string;
  texts: Partial<Record<Platform, string>>;
  priority: number; // 1-5, 5 = strongest candidate for paid promotion
  boost?: { budgetIls: number; days: number; audience: string; priority: number };
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
  const rules = req.platforms.map((p) => `- ${p}: ${platformRules()[p]}`).join("\n");
  const ctx: string[] = [];
  if (context?.topPerformers?.length) {
    ctx.push(`פוסטים שהצליחו בעבר (למד/י מהם, אל תעתיק/י):\n` + context.topPerformers.map((t) => `- "${t}"`).join("\n"));
  }
  if (context?.inspirationNotes?.length) {
    ctx.push(`מה בעל העסק אוהב:\n` + context.inspirationNotes.map((n) => `- "${n}"`).join("\n"));
  }

  assertWithinLimit();
  const msg = await llm.messages.create({
    task: "plan",
    max_tokens: 12000,
    system: brandVoice(),
    messages: [
      {
        role: "user",
        content: `בנה/י תוכנית פרסום ל-${req.weeks} שבועות.
מטרה: ${req.goal}
מספר פוסטים: בדיוק ${total} (${req.postsPerWeek} בשבוע), מפוזרים בימים ובשעות שונות לאורך התקופה.
פלטפורמות: ${req.platforms.join(", ")}
תקציב פרסום ממומן: ${req.weeklyBudget ? req.weeklyBudget + " ₪ בשבוע (" + req.weeklyBudget * req.weeks + " ₪ בסך הכול)" : "אין — אורגני בלבד"}
${req.aggressive ? "מצב: תקיפה אגרסיבית — נוכחות רועשת ועקבית, זוויות מכירה חדות, קריאה ברורה לפעולה, בדיקת וריאציות שונות של אותו מסר. עדיין בלי מחירים, הנחות או הבטחות שלא נמסרו." : ""}
${req.notes ? "הערות בעל העסק: " + req.notes : ""}
${ctx.length ? "\n" + ctx.join("\n\n") + "\n" : ""}
כללי הכתיבה לכל פלטפורמה:
${rules}

גוון את סוגי התוכן (חומר/אבן, תהליך, פרויקט, טיפ מקצועי, מאחורי הקלעים) ואל תחזור על אותו נושא.
בכל פריט הוסף "priority" (1-5): כמה הפוסט מתאים לקידום ממומן (5 = הכי חזק). אל תחלק את התקציב בעצמך — המערכת מחלקת לפי priority. בשדה "audience" אל תכתוב; הוא ייקבע בנפרד.
בשדה adAdvice: אם יש תקציב — המלצה קצרה איך לפצל אותו (אילו פוסטים כדאי לקדם, קהל יעד, משך); אם אין — כתוב המלצה אורגנית בלבד.

החזר אך ורק JSON תקין (בלי מרקדאון) במבנה:
{"summary":"...","audience":"...","pillars":["..."],"adAdvice":"...","items":[{"dayOffset":1,"time":"19:00","topic":"...","priority":3,"imageIdea":"איזו תמונה/וידאו לצרף","texts":{${req.platforms.map((p) => `"${p}":"..."`).join(",")}}}]}`,
      },
    ],
  });

  recordUsage(msg.usage);
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const plan = extractJson(text) as MarketingPlan;
  if (!Array.isArray(plan.items)) throw new Error("התוכנית שהתקבלה לא תקינה, נסה שוב");
  allocateBudget(plan.items, (req.weeklyBudget || 0) * req.weeks, req.weeks);
  return plan;
}

/**
 * Splits the paid budget across posts by priority (weight = priority², so strong posts get most),
 * keeping the sum exactly equal to the total. Posts below a ₪20 floor are dropped from paid promotion
 * and their share is redistributed.
 */
export function allocateBudget(items: PlanItem[], total: number, weeks: number): void {
  if (!total || total <= 0) return;
  let pool = items.map((it) => ({ it, w: Math.pow(Math.min(5, Math.max(1, Number(it.priority) || 3)), 2) }));
  for (let guard = 0; guard < items.length; guard++) {
    const sum = pool.reduce((a, x) => a + x.w, 0);
    const low = pool.filter((x) => (x.w / sum) * total < 20);
    if (!low.length || low.length === pool.length) break;
    const drop = pool.reduce((m, x) => (x.w < m.w ? x : m));
    pool = pool.filter((x) => x !== drop);
  }
  const sum = pool.reduce((a, x) => a + x.w, 0);
  let given = 0;
  pool.forEach((x, i) => {
    const amount = i === pool.length - 1 ? Math.round(total - given) : Math.round((x.w / sum) * total);
    given += amount;
    x.it.boost = { budgetIls: amount, days: x.it.priority >= 4 ? 5 : 3, audience: "", priority: Number(x.it.priority) || 3 };
  });
  void weeks;
}

export async function generateStrategyReview(
  rows: { topic: string; text: string; platform: string; reach?: number; engagement?: number; clicks?: number; boostIls?: number }[],
  weeklyBudget: number
): Promise<string> {
  assertWithinLimit();
  const msg = await llm.messages.create({
    task: "strategy",
    max_tokens: 2500,
    system: brandVoice(),
    messages: [
      {
        role: "user",
        content: `אתה אסטרטג פרסום. להלן ביצועי הפוסטים האחרונים (חשיפה, מעורבות, קליקים וסכום שקודם אם ידוע):
${JSON.stringify(rows)}

תקציב שבועי לפרסום ממומן: ${weeklyBudget || "לא הוגדר"} ₪.

כתוב ניתוח קצר ומעשי בעברית (בלי מרקדאון כבד), בסעיפים:
1. מה עובד ולמה (נתונים ספציפיים בלבד — אל תמציא מספרים).
2. מה להפסיק.
3. איך "לתקוף" בשבוע הבא: על אילו נושאים/פורמטים להכפיל, ואיך לחלק מחדש את התקציב באחוזים.
4. 3 רעיונות לבדיקות A/B.
אם אין מספיק נתונים — אמור זאת במפורש והצע תוכנית איסוף נתונים.`,
      },
    ],
  });
  recordUsage(msg.usage);
  return msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
}

export interface ProfileInput {
  businessName: string;
  whatYouSell: string;
  audience: string;
  location: string;
  tone: string;
  neverSay: string;
}

/** Turns the setup form into a brand-voice prompt in the same shape as the built-in ROCCA voice. */
export async function generateBrandVoice(input: ProfileInput): Promise<string> {
  assertWithinLimit();
  const msg = await llm.messages.create({
    task: "brandVoice",
    max_tokens: 1200,
    messages: [
      {
        role: "user",
        content: `כתוב הנחיית מערכת (system prompt) בעברית עבור AI שכותב תוכן שיווקי ותגובות ברשתות חברתיות בשם העסק הבא.

שם העסק: ${input.businessName}
מה מוכרים/מה העסק עושה: ${input.whatYouSell}
קהל יעד: ${input.audience}
מיקום: ${input.location || "לא צוין"}
טון רצוי: ${input.tone}
דברים שאסור לומר או לעשות: ${input.neverSay || "לא צוין"}

מבנה ההנחיה, בפסקאות קצרות: (1) מי העסק ובאיזו שפה כותבים, (2) קהל יעד ראשי ומשני ואיך מדברים איתם, (3) הטון והסגנון, מה להדגיש, (4) "אף פעם לא": תמיד כולל מחירים, הנחות ומבצעים, הבטחות שלא נמסרו ועובדות שלא ידועות, בנוסף למה שצוין למעלה.
אל תמציא עובדות על העסק מעבר למה שנמסר. אם חסר מידע — הנחה לכתוב באופן כללי ולהזמין ליצירת קשר.
החזר אך ורק את טקסט ההנחיה, בלי הסברים ובלי כותרות.`,
      },
    ],
  });
  recordUsage(msg.usage);
  return msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
}

export interface CampaignRequest {
  goal: string;
  offer: string; // what is being promoted
  weeks: number;
  weeklyBudget: number; // ILS paid promotion per week
  notes: string;
}

/**
 * A full campaign brief — the work an ad agency does: funnel, audiences, creatives for A/B tests,
 * KPIs, optimisation rules and a week-by-week plan. Strategy text only; nothing is launched or spent.
 */
export async function generateCampaign(req: CampaignRequest, context?: GenerationContext): Promise<any> {
  const ctx: string[] = [];
  if (context?.topPerformers?.length) ctx.push(`פוסטים שהצליחו בעבר אצל העסק:\n` + context.topPerformers.map((t) => `- "${t}"`).join("\n"));
  if (context?.inspirationNotes?.length) ctx.push(`מה בעל העסק אוהב:\n` + context.inspirationNotes.map((n) => `- "${n}"`).join("\n"));
  const total = req.weeklyBudget * req.weeks;

  assertWithinLimit();
  const msg = await llm.messages.create({
    task: "campaign",
    max_tokens: 9000,
    system: brandVoice(),
    messages: [
      {
        role: "user",
        content: `אתה מנהל/ת קריאייטיב ואסטרטגיית פרסום ממומן בכיר/ה. בנה/י תוכנית מסע פרסום מקצועית ל-${req.weeks} שבועות.

המטרה: ${req.goal}
מה מקדמים: ${req.offer}
תקציב ממומן: ${req.weeklyBudget ? `${req.weeklyBudget} ₪ בשבוע (${total} ₪ בסך הכול)` : "אין — אורגני בלבד"}
${req.notes ? "הערות: " + req.notes : ""}
${ctx.length ? "\n" + ctx.join("\n\n") + "\n" : ""}
כללים:
- פרסום בפייסבוק ובאינסטגרם בלבד. אל תמציא נתונים, אחוזי המרה או מספרים "מהשוק". יעדי KPI הם השערות התחלתיות שמתעדכנות לפי התוצאות בפועל, וציין זאת במפורש בשדה "why".
- מבנה משפך (פירמידה): מודעות, שיקול, המרה. חלק את התקציב באחוזים (budgetPercent) שמסתכמים ל-100.
- קהלים: הגדרות טירגוט בטרמינולוגיה של Meta Ads (מיקום, טווח גיל, תחומי עניין), אופן הפעלה (צר/רחב), ושייכות לשלב במשפך.
- קריאייטיבים: 6-9 מודעות (לפחות 2 לכל שלב), כל אחת עם hook לשורה הראשונה, טקסט מלא בעברית לפי הקול של העסק, CTA, והצעה איזו תמונה/וידאו לצרף. טקסטים בלי מחירים, הנחות או הבטחות שלא נמסרו.
- בדיקות A/B (2-3), כללי אופטימיזציה בצורת "אם... אז..." (למשל על בסיס עלות לקליק, שיעור הקלקה, תדירות), ותוכנית שבועית מפורטת.
- risks: סיכונים ומה לא לעשות (למשל מגבלות פרסום, תלות בתמונות).

החזר אך ורק JSON תקין (בלי מרקדאון) במבנה:
{"name":"...","objective":"...","summary":"...","audiences":[{"name":"","description":"","location":"","ageRange":"","interests":[""],"funnel":"מודעות|שיקול|המרה"}],"funnel":[{"stage":"","goal":"","budgetPercent":0,"platforms":["facebook","instagram"],"formats":[""]}],"creatives":[{"name":"","funnelStage":"","hook":"","text":"","cta":"","imageIdea":"","audience":""}],"schedule":[{"week":1,"focus":"","actions":[""]}],"kpis":[{"metric":"","target":"","why":""}],"optimizationRules":[{"if":"","then":""}],"abTests":[{"hypothesis":"","variantA":"","variantB":"","metric":"","duration":""}],"risks":[""]}`,
      },
    ],
  });
  recordUsage(msg.usage);
  const c = extractJson(msg.content.map((b) => (b.type === "text" ? b.text : "")).join(""));
  if (!Array.isArray(c.creatives) || !Array.isArray(c.funnel)) throw new Error("התוכנית שהתקבלה לא תקינה, נסו שוב");

  // Budget math is done here, not by the model: normalise percentages to 100 and convert to shekels.
  const sum = c.funnel.reduce((a: number, f: any) => a + (Number(f.budgetPercent) || 0), 0) || 1;
  c.funnel.forEach((f: any) => {
    f.budgetPercent = Math.round(((Number(f.budgetPercent) || 0) / sum) * 100);
    f.budgetIls = Math.round((total * f.budgetPercent) / 100);
  });
  // spread each stage's budget equally across that stage's creatives
  c.creatives.forEach((cr: any) => {
    const stage = c.funnel.find((f: any) => f.stage === cr.funnelStage);
    const same = c.creatives.filter((x: any) => x.funnelStage === cr.funnelStage).length || 1;
    cr.budgetIls = stage ? Math.round(stage.budgetIls / same) : 0;
  });
  return c;
}

/**
 * Learns the business's market: what drives buying decisions, customer segments, seasonality in Israel,
 * content angles and how to stand out. Built from the owner's profile plus the account's own results.
 * It is the model's general knowledge — not live market data and never scraped competitor content.
 */
export async function generateMarketBrief(input: ProfileInput, context?: GenerationContext & { stats?: string }): Promise<string> {
  const ctx: string[] = [];
  if (context?.topPerformers?.length) ctx.push(`פוסטים של העסק שהצליחו:\n` + context.topPerformers.map((t) => `- "${t}"`).join("\n"));
  if (context?.inspirationNotes?.length) ctx.push(`מה בעל העסק אוהב:\n` + context.inspirationNotes.map((n) => `- "${n}"`).join("\n"));
  if (context?.stats) ctx.push(`נתוני ביצועים של העסק:\n${context.stats}`);
  assertWithinLimit();
  const msg = await llm.messages.create({
    task: "marketBrief",
    max_tokens: 1800,
    messages: [
      {
        role: "user",
        content: `אתה אנליסט שוק ושיווק. כתוב תקציר שוק קצר ושימושי בעברית (עד 450 מילים) עבור העסק הבא, כדי שמערכת שכותבת עבורו תוכן תכיר את השוק שלו.

שם העסק: ${input.businessName}
מה מוכרים: ${input.whatYouSell}
קהל יעד: ${input.audience}
מיקום: ${input.location || "לא צוין"}
${ctx.length ? "\n" + ctx.join("\n\n") + "\n" : ""}
סעיפים (כותרת קצרה לכל אחד, ואחריה נקודות קצרות):
1. איך מקבלים החלטת רכישה בשוק הזה (מה משפיע, מי משפיע, כמה זמן זה לוקח).
2. פלחי לקוחות וצרכים עיקריים.
3. עונתיות ואירועים רלוונטיים בישראל (חגים, עונות, תקופות עבודה).
4. זוויות תוכן שמתאימות לתחום ולפלטפורמות (פייסבוק/אינסטגרם).
5. איך עסקים בתחום נוטים להציג את עצמם (סוגים כלליים, בלי שמות), ומה יכול להבדיל את העסק הזה.
6. חמש שאלות שכדאי שבעל העסק יברר מלקוחות כדי לדייק.

כללים: זו ידיעה כללית ולא נתוני שוק עדכניים. אל תמציא מספרים, אחוזים או שמות מתחרים. סמן הנחות במילה "הנחה:". בלי מחירים. החזר רק את התקציר.`,
      },
    ],
  });
  recordUsage(msg.usage);
  return msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
}

/** An SEO article for the business's own site (Hebrew, one clear topic, honest, no prices/promises). */
export async function generateSeoArticle(topic: string): Promise<{ title: string; description: string; body: string }> {
  assertWithinLimit();
  const msg = await llm.messages.create({
    task: "plan",
    max_tokens: 4000,
    system: brandVoice(),
    messages: [
      {
        role: "user",
        content: `כתוב/כתבי מאמר קידום אורגני (SEO) באתר של ${businessName()} על הנושא: "${topic}".
דרישות: 450-700 מילים, כותרת מושכת עם מילת החיפוש העיקרית, תיאור מטא עד 155 תווים, 3-5 כותרות משנה, פסקאות קצרות, תועלת אמיתית לקורא, ובסוף הזמנה ליצור קשר. בלי מחירים, הנחות, הבטחות או עובדות שלא נמסרו, ובלי "!!!". אל תמציא נתונים.
החזר אך ורק JSON תקין: {"title":"...","description":"...","body":"טקסט רגיל; כותרות משנה בשורה נפרדת שמתחילה ב-## ; פסקאות מופרדות בשורה ריקה"}`,
      },
    ],
  });
  recordUsage(msg.usage);
  const out = extractJson(msg.content.map((b) => (b.type === "text" ? b.text : "")).join(""));
  if (!out.title || !out.body) throw new Error("המאמר שהתקבל לא תקין, נסו שוב");
  return { title: String(out.title).slice(0, 160), description: String(out.description || "").slice(0, 200), body: String(out.body).slice(0, 12000) };
}

const SUPPORT_KNOWLEDGE = `אתה בוט התמיכה הטכנית של BOOL. אין נציג אנושי: אתה פותר בעצמך בעיות שימוש וקשיים טכניים, בצורה ברורה ובשלבים. BOOL היא מערכת שיווק מבוססת בינה מלאכותית ("סוכנות שיווק בקופסה") לעסקים ולמפרסמים.
מה המערכת עושה: מייצרת פוסטים ותוכניות שיווק, מפרסמת בפייסבוק ובאינסטגרם (כולל קרוסלה של כמה תמונות), מתזמנת, "טייס אוטומטי" שמכין פוסטים שבועיים לאישור מהיר (שום דבר לא מתפרסם בלי אישור), קליטת לידים עם התראה, חלוקת תקציב ממומן בין ערוצים עם הסבר, אתר קטן ומאמרי SEO, ודוחות.
איך מתחברים לפייסבוק/אינסטגרם: לשונית "הגדרות" ← "התחברות עם פייסבוק" ← לאשר את העמוד. אינסטגרם חייב להיות חשבון עסקי המחובר לעמוד.
קרדיטים: כל פעולת בינה מלאכותית (פוסט, תוכנית, קמפיין) עולה קרדיט אחד; בניסיון חינם יש 3 קרדיטים במתנה, אפשר לרכוש חבילות או מנוי בלשונית "חבילות". חבילות העסקים אינן מוגבלות בקרדיטים.
רק אם מדובר בתקלה טכנית אמיתית שלא נפתרת (באג במערכת, בעיית תשלום או בעיית חיבור) — הצע ללחוץ על "דיווח על תקלה" בלשונית "העוזר". אל תפנה לאדם בשום מקרה אחר ואל תבטיח מענה אנושי. אל תבטיח דבר שלא כתוב כאן, אל תמציא מחירים, ואל תבקש סיסמאות או מפתחות. ענה בשפה שבה פנה הלקוח (עברית, אנגלית, ספרדית או צרפתית), קצר וברור, בשלבים.
שאלות על ניהול העסק, רעיונות לתוכן ותזמון — הפנה ללשונית "אסיסטנט", שם האסיסטנט האישי של העסק.`;

export async function answerSupport(question: string, history: { role: "user" | "assistant"; text: string }[] = []): Promise<string> {
  assertWithinLimit();
  const convo = history.slice(-6).map((h) => `${h.role === "user" ? "לקוח" : "תמיכה"}: ${h.text.slice(0, 600)}`).join("\n");
  const msg = await llm.messages.create({
    task: "reply",
    max_tokens: 700,
    system: SUPPORT_KNOWLEDGE,
    messages: [{ role: "user", content: `${convo ? convo + "\n" : ""}לקוח: ${question.slice(0, 800)}\nתמיכה:` }],
  });
  recordUsage(msg.usage);
  return msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
}

// ---- Personal executive assistant (business management, not technical support) ----
export type AssistantAction =
  | { type: "draft_post"; topic: string; text: string }
  | { type: "reminder"; date: string; text: string }
  | { type: "schedule_post"; postId: string; when: string }; // when = "YYYY-MM-DD HH:MM" in the business's time zone

const ASSISTANT_SYSTEM = `אתה האסיסטנט האישי של בעל העסק — מנהל שיווק צמוד שעובד בשבילו, לא נציג שירות. אתה מכיר את העסק, מציע רעיונות לתוכן ולמבצעים, מכין פוסטים, מתכנן תזמון, ומזכיר על מועדים, חגים, מבצעים, פגישות ואירועים שיווקיים חשובים. דבר בגובה העיניים, קצר, יוזם ומעשי, ובשפה שבה פונה בעל העסק (עברית, אנגלית, ספרדית או צרפתית).
אל תמציא עובדות, מחירים או נתוני ביצועים שלא ניתנו לך. אל תבטיח תוצאות.
פעולות — בסוף התשובה, שורה נפרדת אחת לכל היותר, בפורמט מדויק:
ACTION: {"type":"draft_post","topic":"נושא קצר","text":"הטקסט המלא של הפוסט"}
ACTION: {"type":"reminder","date":"YYYY-MM-DD","text":"מה להזכיר"}
ACTION: {"type":"schedule_post","postId":"המזהה מהרשימה","when":"YYYY-MM-DD HH:MM"} — רק כשבעל העסק ביקש במפורש לאשר/לתזמן/להזיז פוסט קיים מהרשימה, והשעה לפי אזור הזמן שלו
פוסט חדש נשמר כטיוטה בלבד, ותזכורת נשמרת ברשימה. אל תכתוב שפוסט תוזמן אלא אם הוצאת schedule_post לפי בקשה מפורשת. תקלות טכניות במערכת — הפנה ללשונית "תמיכה".`;

export function parseAction(raw: string): { answer: string; action?: AssistantAction } {
  const m = raw.match(/\n?ACTION:\s*(\{[\s\S]*\})\s*$/);
  if (!m) return { answer: raw };
  const answer = raw.slice(0, m.index).trim();
  try {
    const a = JSON.parse(m[1]);
    if (a?.type === "draft_post" && typeof a.text === "string" && a.text.trim()) {
      return { answer, action: { type: "draft_post", topic: String(a.topic || "פוסט").slice(0, 120), text: a.text.slice(0, 2200) } };
    }
    if (a?.type === "schedule_post" && typeof a.postId === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(a.when))) {
      return { answer, action: { type: "schedule_post", postId: a.postId.slice(0, 40), when: a.when } };
    }
    if (a?.type === "reminder" && /^\d{4}-\d{2}-\d{2}$/.test(String(a.date)) && typeof a.text === "string" && a.text.trim()) {
      return { answer, action: { type: "reminder", date: a.date, text: a.text.slice(0, 200) } };
    }
  } catch {}
  return { answer };
}

/** `context` = what the assistant knows about the business right now (profile, upcoming posts, reminders, today's date). */
export async function answerAssistant(question: string, history: { role: "user" | "assistant"; text: string }[], context: string): Promise<{ answer: string; action?: AssistantAction }> {
  assertWithinLimit();
  const convo = history.slice(-8).map((h) => `${h.role === "user" ? "בעל העסק" : "אסיסטנט"}: ${h.text.slice(0, 700)}`).join("\n");
  const msg = await llm.messages.create({
    task: "reply",
    max_tokens: 900,
    system: `${ASSISTANT_SYSTEM}\n\nמה שידוע לך על העסק עכשיו:\n${context}`,
    messages: [{ role: "user", content: `${convo ? convo + "\n" : ""}בעל העסק: ${question.slice(0, 900)}\nאסיסטנט:` }],
  });
  recordUsage(msg.usage);
  return parseAction(msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim());
}

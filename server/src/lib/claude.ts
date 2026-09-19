import Anthropic from "@anthropic-ai/sdk";
import { config, Platform } from "../config";

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const MODEL = "claude-sonnet-5";

const BRAND_VOICE = `
את/ה כותב/ת תוכן שיווקי בעברית עבור ROCCA — בית אבן טבעית פרימיום (אוניקס, שיש, גרניט, קוורציט) בנתניה, ישראל.
הטון: יוקרתי, בטוח, חם, בלי סופרלטיבים ריקים. מתמקד באיכות האבן, בלעדיות על עורקי אוניקס נדירים ממכרה בבעלות החברה, ובתהליך המלא (ייבוא, חיתוך, התקנה, תאורה) תחת קורת גג אחת.
אף פעם לא ממציא/ה מבצעים, מחירים, תאריכים או עובדות שלא נמסרו — אם חסר מידע, כותב/ת באופן כללי ומזמין/ה ליצירת קשר.
`.trim();

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

export async function generatePostForPlatforms(
  topic: string,
  platforms: Platform[]
): Promise<Record<Platform, string>> {
  const rules = platforms.map((p) => `- ${p}: ${PLATFORM_RULES[p]}`).join("\n");

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

החזר אך ורק אובייקט JSON תקין (בלי טקסט נוסף, בלי מרקדאון) במבנה:
{ ${platforms.map((p) => `"${p}": "..."`).join(", ")} }`,
      },
    ],
  });

  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return extractJson(text);
}

export async function generateReplyDraft(params: {
  incomingText: string;
  incomingAuthor?: string;
  channel: string;
}): Promise<string> {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: `${BRAND_VOICE}

את/ה עונה בשם ROCCA להודעה/תגובה של לקוח פוטנציאלי בערוץ ${params.channel}.
כתוב/כתבי תגובה קצרה, אדיבה ומועילה בעברית. אם נשאלת שאלה על מחיר/זמינות שאין לך עליה מידע, הזמן/י ליצירת קשר ישיר עם הצוות דרך האתר או הודעה פרטית, ואל תמציא/י מספרים.
החזר אך ורק את טקסט התגובה, בלי מרכאות ובלי הסברים נוספים.`,
    messages: [
      {
        role: "user",
        content: `הודעה נכנסת מאת ${params.incomingAuthor || "לקוח"}:\n"${params.incomingText}"`,
      },
    ],
  });

  return msg.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
}

/**
 * Marketing calendar, computed (no hard-coded years): global retail dates + Jewish holidays via the Hebrew calendar.
 * Calendars are opt-in per business: "global" and "il" (Jewish/Israeli). More regions can be added the same way.
 */
export type Lang = "he" | "en" | "es" | "fr";
export interface MarketingDate { date: string; daysAway: number; name: Record<Lang, string> }

const N = (he: string, en: string, es: string, fr: string): Record<Lang, string> => ({ he, en, es, fr });

const JEWISH: { month: RegExp; day: number; name: Record<Lang, string> }[] = [
  { month: /^Tishri$/i, day: 1, name: N("ראש השנה", "Rosh Hashanah", "Rosh Hashaná", "Roch Hachana") },
  { month: /^Tishri$/i, day: 10, name: N("יום כיפור", "Yom Kippur", "Yom Kipur", "Yom Kippour") },
  { month: /^Tishri$/i, day: 15, name: N("סוכות", "Sukkot", "Sucot", "Souccot") },
  { month: /^Kislev$/i, day: 25, name: N("חנוכה", "Hanukkah", "Janucá", "Hanoucca") },
  { month: /^Shevat$/i, day: 15, name: N("ט״ו בשבט", "Tu BiShvat", "Tu BiShvat", "Tou BiChvat") },
  { month: /^Adar( II)?$/i, day: 14, name: N("פורים", "Purim", "Purim", "Pourim") },
  { month: /^Nisan$/i, day: 15, name: N("פסח", "Passover", "Pésaj", "Pessah") },
  { month: /^Iyar$/i, day: 18, name: N("ל״ג בעומר", "Lag BaOmer", "Lag BaOmer", "Lag BaOmer") },
  { month: /^Sivan$/i, day: 6, name: N("שבועות", "Shavuot", "Shavuot", "Chavouot") },
];

function nthWeekday(y: number, month0: number, weekday: number, n: number): string {
  const first = new Date(Date.UTC(y, month0, 1)).getUTCDay();
  const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  return new Date(Date.UTC(y, month0, day)).toISOString().slice(0, 10);
}

function globalDates(y: number): { date: string; name: Record<Lang, string> }[] {
  const bf = nthWeekday(y, 10, 5, 4); // 4th Friday of November
  const cm = new Date(Date.parse(bf) + 3 * 86400000).toISOString().slice(0, 10);
  return [
    { date: `${y}-01-01`, name: N("ראש השנה האזרחית", "New Year", "Año Nuevo", "Nouvel An") },
    { date: `${y}-02-14`, name: N("יום האהבה", "Valentine's Day", "San Valentín", "Saint-Valentin") },
    { date: nthWeekday(y, 4, 0, 2), name: N("יום האם (בינלאומי)", "Mother's Day (US)", "Día de la Madre (EE. UU.)", "Fête des mères (US)") },
    { date: nthWeekday(y, 5, 0, 3), name: N("יום האב (בינלאומי)", "Father's Day (US)", "Día del Padre (EE. UU.)", "Fête des pères (US)") },
    { date: `${y}-10-31`, name: N("ליל כל הקדושים", "Halloween", "Halloween", "Halloween") },
    { date: bf, name: N("בלאק פריידיי", "Black Friday", "Black Friday", "Black Friday") },
    { date: cm, name: N("סייבר מאנדיי", "Cyber Monday", "Cyber Monday", "Cyber Monday") },
    { date: `${y}-12-25`, name: N("חג המולד", "Christmas", "Navidad", "Noël") },
  ];
}

const hebFmt = new Intl.DateTimeFormat("en-u-ca-hebrew", { day: "numeric", month: "long", timeZone: "UTC" });
function jewishOn(ymd: string): Record<Lang, string> | null {
  const parts = hebFmt.formatToParts(new Date(`${ymd}T12:00:00Z`));
  const day = Number(parts.find((p) => p.type === "day")?.value);
  const month = String(parts.find((p) => p.type === "month")?.value || "");
  return JEWISH.find((h) => h.day === day && h.month.test(month))?.name || null;
}

/** Upcoming dates in [fromYmd, fromYmd+days], nearest first. */
export function upcomingDates(fromYmd: string, days: number, calendars: string[]): MarketingDate[] {
  const start = Date.parse(`${fromYmd}T12:00:00Z`);
  const out: MarketingDate[] = [];
  const years = [new Date(start).getUTCFullYear(), new Date(start + days * 86400000).getUTCFullYear()];
  const globals = calendars.includes("global") ? [...new Set(years)].flatMap(globalDates) : [];
  for (let i = 0; i <= days; i++) {
    const ymd = new Date(start + i * 86400000).toISOString().slice(0, 10);
    for (const g of globals) if (g.date === ymd) out.push({ date: ymd, daysAway: i, name: g.name });
    if (calendars.includes("il")) {
      const j = jewishOn(ymd);
      if (j) out.push({ date: ymd, daysAway: i, name: j });
    }
  }
  return out;
}

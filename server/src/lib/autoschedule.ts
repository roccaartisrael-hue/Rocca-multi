import { Post } from "./store";
import { Tier } from "./plans";

const TZ = "Asia/Jerusalem";

/** Wall-clock time in Israel on the given Israel calendar day (`dayOffset` days from today), as a UTC Date. */
export function israelTime(dayOffset: number, hour: number, minute: number): Date {
  const target = new Date(Date.now() + dayOffset * 86400000);
  const ymd = target.toLocaleDateString("en-CA", { timeZone: TZ });
  const guess = new Date(`${ymd}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
  const il = new Date(guess.toLocaleString("en-US", { timeZone: TZ }));
  const offset = il.getTime() - new Date(guess.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  return new Date(guess.getTime() - offset);
}

const israelDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const israelHHMM = (d: Date) => d.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

/**
 * Orders the tier's time slots from best to worst: by the average engagement of the account's own
 * published posts at that hour when there is data, otherwise by a sensible default (evening, noon, late).
 */
export function rankSlots(slots: string[], published: Post[]): string[] {
  const byHour: Record<string, { sum: number; n: number }> = {};
  for (const p of published) {
    const eng = p.platforms.map((pc) => pc.metrics?.engagement).filter((v): v is number => typeof v === "number");
    if (!eng.length) continue;
    const hour = israelHHMM(new Date(p.scheduledFor || p.createdAt)).slice(0, 2);
    const cur = (byHour[hour] ||= { sum: 0, n: 0 });
    cur.sum += eng.reduce((a, b) => a + b, 0) / eng.length;
    cur.n += 1;
  }
  const preferred = ["19:00", "12:00", "21:00", "20:00", "17:00", "09:00", "14:00", "10:00", "22:00", "08:00"];
  const learned = slots.some((s) => byHour[s.slice(0, 2)]);
  return [...slots].sort((a, b) => {
    if (learned) {
      const sa = byHour[a.slice(0, 2)] ? byHour[a.slice(0, 2)].sum / byHour[a.slice(0, 2)].n : -1;
      const sb = byHour[b.slice(0, 2)] ? byHour[b.slice(0, 2)].sum / byHour[b.slice(0, 2)].n : -1;
      if (sa !== sb) return sb - sa;
    }
    return preferred.indexOf(a) - preferred.indexOf(b);
  });
}

/**
 * Picks the next free slot automatically: spreads posts over the days (least busy day first),
 * uses the best-ranked time of that day, never double-books a slot, and stays inside the tier's horizon.
 */
export function pickSlot(taken: string[], tier: Tier, published: Post[]): Date | null {
  const ranked = rankSlots(tier.slots, published);
  const takenSet = new Set(taken.map((iso) => `${israelDay(new Date(iso))} ${israelHHMM(new Date(iso))}`));
  const load: Record<string, number> = {};
  taken.forEach((iso) => {
    const d = israelDay(new Date(iso));
    load[d] = (load[d] || 0) + 1;
  });
  const minTime = Date.now() + 30 * 60 * 1000;
  const maxTime = Date.now() + tier.horizonDays * 86400000;
  const candidates: { date: Date; day: string; rank: number; dayIdx: number }[] = [];
  for (let day = 0; day <= tier.horizonDays + 1; day++) {
    ranked.forEach((slot, rank) => {
      const [h, m] = slot.split(":").map(Number);
      const date = israelTime(day, h, m);
      if (date.getTime() < minTime || date.getTime() > maxTime) return;
      const key = `${israelDay(date)} ${israelHHMM(date)}`;
      if (takenSet.has(key)) return;
      candidates.push({ date, day: israelDay(date), rank, dayIdx: day });
    });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => (load[a.day] || 0) - (load[b.day] || 0) || a.dayIdx - b.dayIdx || a.rank - b.rank);
  return candidates[0].date;
}

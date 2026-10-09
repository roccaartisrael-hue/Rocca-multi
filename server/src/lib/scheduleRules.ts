import { store, PlatformContent } from "./store";
import { getTier } from "./plans";

/** Scheduling limits by tier: how many at once, how far ahead, and which times (Israel time). Returns an error message or null. */
export function scheduleProblem(whenIso: string, excludePostId: string | null, checkSlot: boolean): string | null {
  const tier = getTier();
  const when = new Date(whenIso);
  if (isNaN(when.getTime())) return "תאריך לא תקין";
  const now = Date.now();
  if (when.getTime() < now + 60 * 1000) return "בחרו זמן עתידי";
  if (when.getTime() > now + (tier.horizonDays + 1) * 86400000) return `במסלול ${tier.label} אפשר לתזמן עד ${tier.horizonDays} ימים קדימה`;
  const alreadyScheduled = store.listPosts().filter((p) => p.status === "scheduled" && p.id !== excludePostId).length;
  if (alreadyScheduled >= tier.maxScheduled) return `במסלול ${tier.label} אפשר לתזמן עד ${tier.maxScheduled} פוסטים במקביל. אפשר לשדרג מסלול.`;
  if (checkSlot && !tier.exactTime) {
    const hhmm = when.toLocaleTimeString("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" });
    if (!tier.slots.includes(hhmm)) return `במסלול ${tier.label} אפשר לבחור אחת מהשעות: ${tier.slots.join(", ")}`;
  }
  return null;
}

export const needsImage = (p: { platforms: PlatformContent[] }) =>
  p.platforms.some((c) => (c.platform === "instagram" || c.platform === "tiktok") && !c.imageUrl);


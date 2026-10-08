import { ALL_PLATFORMS, Platform } from "../config";
import { store, PlatformContent } from "./store";
import { generateMarketingPlan } from "./claude";
import { getProfile } from "./profile";
import { getSettings, saveSettings } from "./settings";
import { getTier } from "./plans";
import { assertWithinLimit, consumePlan } from "./usage";
import { allowedPlatforms, currentTenantId, isDefaultTenant } from "./tenantContext";
import { adjustCredits } from "./tenants";
import { creditsLeft } from "./checkCredits";
import { israelTime } from "./autoschedule";

export interface AutopilotResult { created: number; skipped?: string }

/**
 * The "autopilot": once a week it drafts the next few posts (from the owner's profile, with learning from past results)
 * and puts them in the approval queue. NOTHING is published until the owner approves — the autopilot only prepares.
 * It costs one credit per run on credit-based tiers.
 */
export async function runAutopilot(opts: { force?: boolean } = {}): Promise<AutopilotResult> {
  const s = getSettings();
  const tier = getTier();
  if (!s.autopilotEnabled) return { created: 0, skipped: "off" };
  if (!isDefaultTenant() && !tier.autopilot) return { created: 0, skipped: "tier" };
  if (!getProfile()) return { created: 0, skipped: "no_profile" };
  if (!opts.force && s.autopilotLastRun && Date.now() - new Date(s.autopilotLastRun).getTime() < 6 * 86400000) return { created: 0, skipped: "recent" };
  const waiting = store.listPosts().filter((p) => p.status === "pending_approval").length;
  if (waiting >= 1) return { created: 0, skipped: "queue_full" };
  const left = creditsLeft();
  if (left !== null && left <= 0) return { created: 0, skipped: "no_credits" };

  const platforms = allowedPlatforms(ALL_PLATFORMS as Platform[]).filter((p) => p === "facebook" || p === "instagram").slice(0, tier.maxPlatforms) as Platform[];
  if (!platforms.length) return { created: 0, skipped: "no_platforms" };
  assertWithinLimit();
  consumePlan();
  const plan = await generateMarketingPlan(
    { goal: "תוכן שבועי עקבי שמגדיל חשיפה ופניות", weeks: 1, postsPerWeek: Math.min(3, tier.maxPostsPerWeek), platforms, weeklyBudget: 0 },
    {
      topPerformers: tier.learnsFromPerformance ? store.topPerformingPlatformContent("engagement", 3).map((r) => r.content.text).filter(Boolean) : [],
      inspirationNotes: tier.learnsFromPerformance ? store.listInspirations().slice(0, 3).map((i) => i.note).filter(Boolean) : [],
    }
  );
  let created = 0;
  for (const it of plan.items) {
    const contents: PlatformContent[] = (Object.entries(it.texts || {}) as [Platform, string][])
      .filter(([p, t]) => platforms.includes(p) && t)
      .map(([p, t]) => ({ platform: p, text: t, status: "pending" as const }));
    if (!contents.length) continue;
    const [h, m] = String(it.time || "19:00").split(":").map(Number);
    const when = israelTime(Math.max(1, Number(it.dayOffset) || 1), Number.isFinite(h) ? h : 19, Number.isFinite(m) ? m : 0);
    const post = store.createPost(it.topic, contents);
    // the suggested time rides along; "pending_approval" keeps the scheduler from touching it
    store.updatePost(post.id, { status: "pending_approval", scheduledFor: when.toISOString() });
    created++;
  }
  saveSettings({ autopilotLastRun: new Date().toISOString() });
  if (left !== null && created > 0) adjustCredits(currentTenantId(), -1);
  return { created };
}

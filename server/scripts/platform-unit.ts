// Unit checks for the BOOL platform pieces that talk to Meta or do arithmetic. Run: npm run platform-unit
process.env.META_PAGE_ID = "PAGE1";
process.env.META_PAGE_ACCESS_TOKEN = "tok";
process.env.META_IG_USER_ID = "IG1";
process.env.ANTHROPIC_API_KEY = "x";
process.env.DATABASE_URL = "";

let failed = 0;
const check = (name: string, ok: boolean, extra?: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + JSON.stringify(extra)}`);
  if (!ok) failed++;
};

(async () => {
  const meta = await import("../src/connectors/meta");
  const { computeAllocation } = await import("../src/lib/adBudget");
  const { leadEmailHtml } = await import("../src/lib/notify");
  const { whatsappDigits } = await import("../src/lib/leads");
  const { TIERS } = await import("../src/lib/plans");

  // ---- Meta carousel: record every Graph call
  const calls: { url: string; body: Record<string, string> }[] = [];
  let n = 0;
  (globalThis as any).fetch = async (url: string, init?: { body?: URLSearchParams; method?: string }) => {
    const body = init?.body ? Object.fromEntries(init.body.entries()) : {};
    calls.push({ url: String(url), body });
    const id = `id${++n}`;
    const isStatus = String(url).includes("status_code");
    return { ok: true, statusText: "OK", json: async () => (isStatus ? { status_code: "FINISHED" } : { id }) } as any;
  };

  await meta.postToFacebook("שלום", ["https://i/1.jpg", "https://i/2.jpg", "https://i/3.jpg"]);
  const photos = calls.filter((c) => c.url.endsWith("/PAGE1/photos"));
  const feed = calls.find((c) => c.url.endsWith("/PAGE1/feed"))!;
  check("Facebook album: each photo uploaded unpublished", photos.length === 3 && photos.every((c) => c.body.published === "false"), photos);
  check("Facebook album: one feed post attaches all of them", !!feed && feed.body["attached_media[0]"] && feed.body["attached_media[1]"] && feed.body["attached_media[2]"] && feed.body.message === "שלום", feed);
  check("Facebook album: attaches the ids returned by the uploads", feed.body["attached_media[0]"] === JSON.stringify({ media_fbid: "id1" }) && feed.body["attached_media[2]"] === JSON.stringify({ media_fbid: "id3" }), feed.body);

  calls.length = 0;
  await meta.postToFacebook("יחיד", "https://i/solo.jpg");
  check("a single photo still posts the old way", calls.length === 1 && calls[0].url.endsWith("/PAGE1/photos") && calls[0].body.url === "https://i/solo.jpg" && !calls[0].body.published, calls);

  calls.length = 0;
  const ig = await meta.postToInstagram("כיתוב", ["https://i/1.jpg", "https://i/2.jpg"]);
  const children = calls.filter((c) => c.url.endsWith("/IG1/media") && c.body.is_carousel_item === "true");
  const parent = calls.find((c) => c.url.endsWith("/IG1/media") && c.body.media_type === "CAROUSEL")!;
  const pub = calls.find((c) => c.url.endsWith("/IG1/media_publish"))!;
  check("Instagram carousel: a child container per photo", children.length === 2, children);
  check("Instagram carousel: parent lists the children and carries the caption", !!parent && parent.body.children.split(",").length === 2 && parent.body.caption === "כיתוב", parent);
  check("Instagram carousel: publishes the parent container, not a child", !!pub && !parent.body.children.split(",").includes(pub.body.creation_id) && pub.body.creation_id.startsWith("id"), pub);
  check("Instagram carousel returns the published id", typeof ig === "string" && ig.startsWith("id"), ig);

  let threw = "";
  try { await meta.postToInstagram("x", Array.from({ length: 11 }, (_, i) => `https://i/${i}.jpg`)); } catch (e: any) { threw = e.message; }
  check("Instagram carousel is capped at 10 photos", /10/.test(threw), threw);
  threw = "";
  try { await meta.postToInstagram("x", ["https://i/1.jpg", "https://i/2.mp4"]); } catch (e: any) { threw = e.message; }
  check("a carousel with a video is refused with a clear message", /תמונות/.test(threw), threw);
  threw = "";
  try { await meta.postToFacebook("x", ["https://i/1.jpg", "https://i/2.mp4"]); } catch (e: any) { threw = e.message; }
  check("a Facebook album with a video is refused too", /סרטון/.test(threw), threw);

  // ---- ad allocator
  const base = { budgetIls: 3000, channels: ["facebook", "instagram"], periodStart: "2026-10-01", periodEnd: "2026-10-08" };
  const row = (channel: string, spend: number, clicks: number, leads: number) => ({ channel, spend, impressions: clicks * 20, clicks, leads, periodStart: "2026-10-01", periodEnd: "2026-10-07" });
  let a = computeAllocation({ ...base, stats: [] });
  check("no data → the split stays equal and says so", a.shares.facebook === 0.5 && /עדיין אין נתוני פרסום/.test(a.reasoning), a);
  a = computeAllocation({ ...base, stats: [row("facebook", 500, 100, 20), row("instagram", 500, 100, 5)] });
  check("cheaper leads win more budget, shares sum to 1", a.shares.facebook > a.shares.instagram && Math.abs(a.shares.facebook + a.shares.instagram - 1) < 0.002, a.shares);
  check("the weekly shift is limited to 15 points", a.shares.facebook <= 0.65 + 1e-9, a.shares);
  a = computeAllocation({ ...base, previousShares: { facebook: 0.95, instagram: 0.05 }, stats: [row("facebook", 500, 100, 1), row("instagram", 500, 100, 30)] });
  check("every channel keeps a learning floor (10%) and shifts stay small", a.shares.facebook >= 0.8 - 1e-9 && a.shares.instagram >= 0.05, a.shares);
  a = computeAllocation({ ...base, stats: [row("facebook", 500, 100, 20), row("instagram", 500, 10, 0)] });
  check("thin data in one channel → no judgement (apples vs oranges), split kept", a.shares.facebook === 0.5 && /אין עדיין מספיק נתונים/.test(a.reasoning), a);
  a = computeAllocation({ ...base, stats: [row("facebook", 400, 80, 0), row("instagram", 400, 40, 0)] });
  check("without enough leads it judges by cost per click", /קליק/.test(a.reasoning) && a.shares.facebook > a.shares.instagram, a);
  a = computeAllocation({ ...base, channels: ["google"], stats: [] });
  check("a single channel gets everything", a.shares.google === 1, a.shares);
  check("moves in ₪ add up to the budget", computeAllocation({ ...base, stats: [row("facebook", 500, 100, 20), row("instagram", 500, 100, 5)] }).actions.reduce((s, x) => s + x.toIls, 0) === 3000);

  // ---- lead email must neutralise injected markup
  const html = leadEmailHtml("עסק", { id: "1", fullName: "<script>alert(1)</script>", phone: "050-1", email: "", source: "\"><img src=x>", notes: "", status: "new", createdAt: "" });
  check("lead email escapes everything a visitor typed", !/<script>|<img/.test(html) && /&lt;script&gt;/.test(html), html.slice(0, 300));
  check("israeli numbers become wa.me digits", whatsappDigits("050-123-4567") === "972501234567" && whatsappDigits("+972 50 123 4567") === "972501234567");

  // ---- tiers
  check("every tier has a coherent shape", Object.values(TIERS).every((t) => t.costCapIls > 0 && t.aiCalls > 0 && t.slots.length > 0));
  check("free trial and creators are credit-based; business tiers are not", !TIERS.free_trial.unlimitedCredits && !TIERS.creator_lite.unlimitedCredits && TIERS.digital_core.unlimitedCredits && TIERS.total_dominance.unlimitedCredits);
  check("feature ladder: autopilot < domain < ads < lead bot", !TIERS.free_trial.autopilot && TIERS.creator_pro.autopilot && !TIERS.creator_pro.customDomain && TIERS.digital_core.customDomain && !TIERS.digital_core.ads && TIERS.digital_pro.ads && !TIERS.digital_pro.leadBot && TIERS.total_dominance.leadBot);

  // ---- expiry of unpaid plans
  const { createTenant, updateTenant, getTenant, expireLapsedPlans } = await import("../src/lib/tenants");
  const t = createTenant({ name: "Exp", email: "exp@x.co", password: "password1" });
  updateTenant(t.id, { plan: "creator_pro", subscriptionCycle: "monthly", planExpiresAt: new Date(Date.now() - 1000).toISOString() });
  const t2 = createTenant({ name: "Live", email: "live@x.co", password: "password1" });
  updateTenant(t2.id, { plan: "creator_pro", subscriptionCycle: "monthly", planExpiresAt: new Date(Date.now() + 86400000).toISOString() });
  const lapsed = expireLapsedPlans();
  check("a plan whose renewal never came falls back to free (credits stay)", lapsed.includes(t.id) && getTenant(t.id)!.plan === "free_trial" && getTenant(t.id)!.creditsBalance === 3, getTenant(t.id));
  check("a plan still inside its paid period is untouched", getTenant(t2.id)!.plan === "creator_pro");

  const fs = await import("fs");
  const path = await import("path");
  fs.rmSync(path.join(__dirname, "..", "data"), { recursive: true, force: true });
  console.log(failed ? `\n${failed} FAILED` : "\nall platform unit checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

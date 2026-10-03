// Fetches ROCCA's own Facebook Page + Instagram posts with their metrics
// from the Meta Graph API and returns them in one normalized shape for the
// dashboard's "learn from performance" screen.
//
// Required Netlify environment variables:
//   DASHBOARD_KEY      shared secret the dashboard sends as `x-dashboard-key`
//   META_ACCESS_TOKEN  long-lived Page access token (pages_read_engagement,
//                      read_insights, instagram_basic, instagram_manage_insights)
//   META_PAGE_ID       Facebook Page id          (optional if only Instagram)
//   META_IG_USER_ID    Instagram Business id     (optional if only Facebook)
// Optional:
//   META_GRAPH_VERSION       default v21.0
//   META_FB_POST_METRICS     default post_impressions_unique,post_clicks
//   META_IG_MEDIA_METRICS    default reach,saved,shares
//
// Meta renames/deprecates insight metrics from time to time; the metric lists
// are env-configurable, and a failed insights call never drops the post — it
// just comes back without reach/saves.

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v21.0'}`;

async function graph(path, params = {}) {
  const url = new URL(GRAPH + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('access_token', process.env.META_ACCESS_TOKEN);
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    throw new Error(body.error?.message || `Graph API ${res.status}`);
  }
  return body;
}

function metricValue(entry) {
  if (!entry) return null;
  if (entry.total_value && typeof entry.total_value.value === 'number') return entry.total_value.value;
  const v = entry.values && entry.values[0] && entry.values[0].value;
  return typeof v === 'number' ? v : null;
}

async function insightsFor(id, metrics) {
  try {
    const body = await graph(`/${id}/insights`, { metric: metrics });
    const out = {};
    for (const e of body.data || []) out[e.name] = metricValue(e);
    return out;
  } catch {
    return {};
  }
}

async function inChunks(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

async function facebookPosts(limit) {
  const pageId = process.env.META_PAGE_ID;
  if (!pageId) return [];
  const metrics = process.env.META_FB_POST_METRICS || 'post_impressions_unique,post_clicks';
  const body = await graph(`/${pageId}/posts`, {
    limit: String(limit),
    fields: 'id,message,created_time,permalink_url,status_type,attachments{media_type},'
      + 'shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)',
  });
  return inChunks(body.data || [], 10, async (p) => {
    const ins = await insightsFor(p.id, metrics);
    const att = p.attachments && p.attachments.data && p.attachments.data[0];
    return {
      id: 'fb_' + p.id,
      platform: 'facebook',
      text: p.message || '',
      createdAt: p.created_time,
      permalink: p.permalink_url || '',
      mediaType: (att && att.media_type) || p.status_type || '',
      likes: p.reactions?.summary?.total_count ?? 0,
      comments: p.comments?.summary?.total_count ?? 0,
      shares: p.shares?.count ?? 0,
      saves: null,
      reach: ins.post_impressions_unique ?? null,
      clicks: ins.post_clicks ?? null,
    };
  });
}

async function instagramPosts(limit) {
  const igId = process.env.META_IG_USER_ID;
  if (!igId) return [];
  const metrics = process.env.META_IG_MEDIA_METRICS || 'reach,saved,shares';
  const body = await graph(`/${igId}/media`, {
    limit: String(limit),
    fields: 'id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count',
  });
  return inChunks(body.data || [], 10, async (m) => {
    const ins = await insightsFor(m.id, metrics);
    return {
      id: 'ig_' + m.id,
      platform: 'instagram',
      text: m.caption || '',
      createdAt: m.timestamp,
      permalink: m.permalink || '',
      mediaType: m.media_product_type === 'REELS' ? 'REELS' : (m.media_type || ''),
      likes: m.like_count ?? 0,
      comments: m.comments_count ?? 0,
      shares: ins.shares ?? null,
      saves: ins.saved ?? null,
      reach: ins.reach ?? null,
      clicks: null,
    };
  });
}

const json = (status, data) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export default async (req) => {
  const key = process.env.DASHBOARD_KEY;
  if (!key || !process.env.META_ACCESS_TOKEN) {
    return json(503, { error: 'not_configured' });
  }
  if (req.headers.get('x-dashboard-key') !== key) {
    return json(401, { error: 'unauthorized' });
  }
  const limit = Math.min(Number(new URL(req.url).searchParams.get('limit')) || 50, 100);
  const errors = [];
  const settle = (p, name) => p.catch((e) => { errors.push(`${name}: ${e.message}`); return []; });
  const [fb, ig] = await Promise.all([
    settle(facebookPosts(limit), 'facebook'),
    settle(instagramPosts(limit), 'instagram'),
  ]);
  return json(200, { posts: [...fb, ...ig], errors, fetchedAt: new Date().toISOString() });
};

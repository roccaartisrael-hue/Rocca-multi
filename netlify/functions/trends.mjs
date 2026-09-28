// Placeholder for an external industry-trends provider.
//
// The dashboard's "מקור חיצוני (JSON)" trend source calls this endpoint and
// expects a JSON array of trend signals:
//
//   [{ "topic": "קירות אוניקס מוארים", "note": "עלייה בחיפושים", "weight": 0.8 }]
//
//   topic   short trend name (required)
//   note    one-line context (optional)
//   weight  0..1 importance (optional, default 0.5)
//
// When a suitable provider is found, fetch from it here (keep its API key in
// a Netlify environment variable, never in the page) and map its response to
// this shape. Until then it returns an empty list, so the dashboard simply
// has no external signals.

export default async () => new Response('[]', {
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

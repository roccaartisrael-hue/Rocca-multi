const hits = new Map<string, { n: number; reset: number }>();

/** Tiny in-memory limiter for public endpoints: true when `key` exceeded `max` hits inside the window. */
export function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  if (hits.size > 5000) for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
  const h = hits.get(key);
  if (!h || now > h.reset) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return false;
  }
  h.n += 1;
  return h.n > max;
}

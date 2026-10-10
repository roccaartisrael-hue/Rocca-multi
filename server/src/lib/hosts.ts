import path from "path";
import fs from "fs";
import { Request, Response, NextFunction } from "express";
import { CorsOptions } from "cors";
import { tenantForDomain, getSite, renderSiteHtml, renderArticleHtml } from "./sites";
import { runAsTenant, DEFAULT_TENANT } from "./tenantContext";
import { getTenant } from "./tenants";
import { hasModule } from "./plans";
import { getProfile } from "./profile";
import { brandDomain } from "./brand";

/**
 * Subdomains of BRAND_DOMAIN (default boolai.co.il): the bare domain and www → marketing site, app. → the dashboard, api. → API only.
 * Override the names with MARKETING_HOSTS / API_HOSTS (comma-separated) if the domains change.
 */
const list = (v: string | undefined, fallback: string[]) => (v ? v.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) : fallback);
const MARKETING = () => list(process.env.MARKETING_HOSTS, [brandDomain(), `www.${brandDomain()}`]);
const API_ONLY = () => list(process.env.API_HOSTS, [`api.${brandDomain()}`]);
const hostOf = (req: Request) => String(req.hostname || "").toLowerCase();

const PUBLIC_DIR = path.join(__dirname, "..", "..", "public");
const API_PATHS = /^\/(api|auth|webhooks|legal|privacy|terms|data-deletion|support|s)(\/|$)/;

export function hostRouting(req: Request, res: Response, next: NextFunction) {
  const h = hostOf(req);
  if (MARKETING().includes(h) && (req.path === "/pricing" || req.path === "/pricing/")) return res.redirect(302, "/#modular");
  if (MARKETING().includes(h) && !API_PATHS.test(req.path)) {
    const file = path.join(PUBLIC_DIR, "marketing", req.path === "/" ? "index.html" : path.normalize(req.path).replace(/^(\.\.[/\\])+/, ""));
    if (file.startsWith(path.join(PUBLIC_DIR, "marketing")) && fs.existsSync(file) && fs.statSync(file).isFile()) return res.sendFile(file);
    return res.status(404).send("Not found");
  }
  if (API_ONLY().includes(h) && !API_PATHS.test(req.path)) {
    return req.path === "/" ? res.json({ ok: true, service: "BOOL API" }) : res.status(404).json({ error: "Not found" });
  }
  next();
}

/** A customer's own domain (once the operator activated it) serves that customer's site at the root. */
export function siteHost(req: Request, res: Response, next: NextFunction) {
  if (API_PATHS.test(req.path)) return next();
  const tid = tenantForDomain(hostOf(req));
  if (!tid) return next();
  runAsTenant(tid, () => {
    const site = getSite();
    if (site.status !== "live" || site.domainStatus !== "active" || (tid !== DEFAULT_TENANT && !hasModule("site"))) return next();
    const name = tid === DEFAULT_TENANT ? getProfile()?.businessName || "ROCCA" : getTenant(tid)?.name || "";
    const key = tid === DEFAULT_TENANT ? process.env.LEAD_KEY || "" : getTenant(tid)?.leadKey || "";
    const credit = tid !== DEFAULT_TENANT && !site.hideCredit;
    if (req.path === "/" || req.path === "") return res.type("html").send(renderSiteHtml(name, site, key, "", credit, hasModule("seo")));
    const art = site.articles.find((a) => `/${a.slug}` === decodeURIComponent(req.path));
    if (art) return res.type("html").send(renderArticleHtml(name, art, "/", credit));
    next();
  });
}

const defaultOrigins = () => [brandDomain(), `www.${brandDomain()}`, `app.${brandDomain()}`, `api.${brandDomain()}`, "rocca.co.il", "www.rocca.co.il"].map((h) => `https://${h}`);
const OPEN_PATHS = /^\/(api\/leads\/capture|api\/billing\/catalog|api\/auth\/config)$/; // landing pages anywhere may call these

/** CORS: the BOOL / ROCCA domains, this server's own origin, local development; the public lead/catalog endpoints are open. */
export const corsOptions = (req: Request, cb: (err: Error | null, o?: CorsOptions) => void) => {
  const extra = list(process.env.CORS_ORIGINS, []);
  const allowAll = extra.includes("*");
  const allowed = new Set([...defaultOrigins(), ...extra, process.env.PUBLIC_URL || "", process.env.APP_URL || ""].map((o) => o.replace(/\/$/, "")));
  cb(null, {
    origin: (origin, done) => {
      if (!origin || allowAll || OPEN_PATHS.test(req.path)) return done(null, true);
      const o = origin.replace(/\/$/, "");
      const ok = allowed.has(o) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o) || /^https:\/\/[a-z0-9-]+\.onrender\.com$/.test(o) || o === "capacitor://localhost" || o === `${req.protocol}://${req.get("host")}`;
      done(null, ok);
    },
    allowedHeaders: ["Content-Type", "Authorization", "X-Model"],
  });
};

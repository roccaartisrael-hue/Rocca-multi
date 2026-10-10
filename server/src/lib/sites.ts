import path from "path";
import { v4 as uuid } from "uuid";
import { readDoc, writeDoc, readGlobal, writeGlobal } from "./persist";
import { brandDomain, brandUrl } from "./brand";

const FILE = path.join(__dirname, "..", "..", "data", "site.json");

export interface Article { id: string; slug: string; title: string; description: string; body: string; createdAt: string }
export interface Site {
  status: "draft" | "live";
  headline: string;
  about: string;
  phone: string;
  whatsapp: string; // international digits
  articles: Article[];
  /** White label: hide the "Powered by BOOL" credit (Digital Pro and up). */
  hideCredit?: boolean;
  /** Own domain (digital_core and up). pending_dns → the operator activates it after DNS points here. */
  domain?: string;
  domainStatus?: "none" | "pending_dns" | "active";
}

const EMPTY: Site = { status: "draft", headline: "", about: "", phone: "", whatsapp: "", articles: [], domainStatus: "none" };

export function getSite(): Site {
  try {
    const raw = readDoc(FILE);
    return { ...EMPTY, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...EMPTY };
  }
}
export function saveSite(patch: Partial<Site>): Site {
  const next = { ...getSite(), ...patch };
  writeDoc(FILE, JSON.stringify(next, null, 2));
  return next;
}

export function addArticle(a: { title: string; description: string; body: string }): Article {
  const site = getSite();
  const base = a.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "article";
  let slug = base;
  for (let i = 2; site.articles.some((x) => x.slug === slug); i++) slug = `${base}-${i}`;
  const art: Article = { id: uuid(), slug, title: a.title, description: a.description, body: a.body, createdAt: new Date().toISOString() };
  site.articles.unshift(art);
  saveSite({ articles: site.articles });
  return art;
}

// ---- domains → tenant (system-wide) ----
const isReserved = (d: string) => [brandDomain(), "rocca.co.il", "onrender.com", "localhost"].some((r) => d === r || d.endsWith("." + r));
export const validDomain = (d: string) => /^(?=.{4,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,24}$/i.test(d) && !isReserved(d.toLowerCase());
const readIdx = (): Record<string, string> => {
  try {
    return JSON.parse(readGlobal("siteDomains.json") || "{}");
  } catch {
    return {};
  }
};
export function claimDomain(domain: string, tenantId: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, "");
  const idx = readIdx();
  if (idx[d] && idx[d] !== tenantId) return false;
  idx[d] = tenantId;
  writeGlobal("siteDomains.json", JSON.stringify(idx));
  return true;
}
export const tenantForDomain = (host: string): string | undefined => readIdx()[host.toLowerCase().replace(/^www\./, "").replace(/:\d+$/, "")];
export function releaseDomains(tenantId: string) {
  const idx = readIdx();
  for (const k of Object.keys(idx)) if (idx[k] === tenantId) delete idx[k];
  writeGlobal("siteDomains.json", JSON.stringify(idx));
}

// ---- rendering ----
const esc = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/**
 * The small "Powered by BOOL" credit on every generated site (links to the product's own site). Digital Pro and up can hide it.
 * BOOL_CREDIT_NOFOLLOW=true adds rel="nofollow" (site-wide footer links across many sites are best kept out of link-graph signals).
 */
export function boolCredit(): string {
  const rel = process.env.BOOL_CREDIT_NOFOLLOW === "true" ? "nofollow noopener" : "noopener";
  return `<p class="credit">Powered by <a href="${brandUrl()}" rel="${rel}">BOOL</a></p>`;
}

const CSS = `*{box-sizing:border-box}body{margin:0;font-family:system-ui,Arial,sans-serif;background:#161412;color:#f3ead7;line-height:1.7}main{max-width:760px;margin:auto;padding:24px 16px}h1,h2{color:#d4b56a;line-height:1.3}a{color:#d4b56a}.card{background:#1f1c19;border:1px solid #3a342c;border-radius:12px;padding:16px;margin:12px 0}input,textarea{width:100%;padding:10px;margin:6px 0;border-radius:8px;border:1px solid #3a342c;background:#161412;color:#f3ead7;font:inherit}button,.btn{display:inline-block;background:#d4b56a;color:#161412;border:0;border-radius:8px;padding:11px 20px;font-weight:700;text-decoration:none;cursor:pointer}.wa{background:#25d366;color:#0b1f12}.credit{text-align:center;color:#8d8372;font-size:13px;margin:32px 0 8px}`;

/** seo=false (Starter/Pro): basic on-page only (title, meta description). seo=true (Business / SEO add-on): adds the Schema.org markup. */
export function renderSiteHtml(name: string, site: Site, key: string, base: string, credit = true, seo = true): string {
  const arts = site.articles.map((a) => `<div class="card"><h2 style="margin:0 0 6px"><a href="${esc(base)}/${esc(a.slug)}">${esc(a.title)}</a></h2><p style="margin:0;color:#b9ad92">${esc(a.description)}</p></div>`).join("");
  const wa = site.whatsapp ? `<a class="btn wa" href="https://wa.me/${esc(site.whatsapp)}">וואטסאפ</a> ` : "";
  const tel = site.phone ? `<a class="btn" href="tel:${esc(site.phone.replace(/[^\d+]/g, ""))}">חייגו</a>` : "";
  const ld = JSON.stringify({ "@context": "https://schema.org", "@type": "LocalBusiness", name, description: site.about.slice(0, 300), telephone: site.phone || undefined }).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(name)}${site.headline ? " | " + esc(site.headline) : ""}</title><meta name="description" content="${esc((site.about || site.headline).slice(0, 155))}">${seo ? `<script type="application/ld+json">${ld}</script>` : ""}<style>${CSS}</style></head><body><main><h1>${esc(name)}</h1><p style="font-size:20px">${esc(site.headline)}</p><p>${esc(site.about)}</p><p>${wa}${tel}</p>${arts ? `<h2>מאמרים</h2>${arts}` : ""}
<div class="card"><h2 style="margin-top:0">השאירו פרטים ונחזור אליכם</h2><form id="f"><input name="full_name" placeholder="שם" required><input name="phone" placeholder="טלפון" required><textarea name="notes" placeholder="במה נוכל לעזור?" rows="3"></textarea><input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px"><button>שליחה</button> <span id="m"></span></form></div>${credit ? boolCredit() : ""}</main>
<script>document.getElementById("f").addEventListener("submit",async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));d.key=${JSON.stringify(key)};d.source="site";const r=await fetch(${JSON.stringify("/api/leads/capture")},{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)});document.getElementById("m").textContent=r.ok?"תודה! נחזור אליכם בהקדם.":"משהו השתבש, נסו שוב.";if(r.ok)e.target.reset()})</script></body></html>`;
}

export function renderArticleHtml(name: string, a: Article, base: string, credit = true): string {
  const body = a.body.split(/\n{2,}/).map((p) => (p.startsWith("## ") ? `<h2>${esc(p.slice(3))}</h2>` : `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)).join("");
  const ld = JSON.stringify({ "@context": "https://schema.org", "@type": "Article", headline: a.title, datePublished: a.createdAt, author: { "@type": "Organization", name } }).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(a.title)} | ${esc(name)}</title><meta name="description" content="${esc(a.description)}"><script type="application/ld+json">${ld}</script><style>${CSS}</style></head><body><main><p><a href="${esc(base)}">← ${esc(name)}</a></p><h1>${esc(a.title)}</h1>${body}${credit ? boolCredit() : ""}</main></body></html>`;
}

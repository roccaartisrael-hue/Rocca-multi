import path from "path";
import { Router } from "express";
import { TERMS, TERMS_LANGS, TERMS_VERSION, isTermsLang, termsHtml } from "../lib/terms";
import { signedCopyHtml, validSignedKey, tenantForSetupToken } from "../lib/onboarding";
import { updateTenant } from "../lib/tenants";
import { rateLimited } from "../lib/ratelimit";

/** Public pages: terms JSON, printable A4 copy, a customer's signed copy, password setup, and the admin onboarding page shell (its API calls need the admin token). */
export const publicOnboarding = Router();

const PUBLIC = path.join(__dirname, "..", "..", "public");

publicOnboarding.get("/api/terms/:lang", (req, res) => {
  if (!isTermsLang(req.params.lang)) return res.status(404).json({ error: "Unknown language" });
  res.json({ version: TERMS_VERSION, ...TERMS[req.params.lang] });
});
publicOnboarding.get("/api/terms", (_req, res) => res.json({ version: TERMS_VERSION, languages: TERMS_LANGS.map((l) => ({ lang: l, flag: TERMS[l].flag, name: TERMS[l].name, dir: TERMS[l].dir })) }));

publicOnboarding.get("/terms/print", (req, res) => {
  const l = String(req.query.lang || "he");
  res.type("html").send(termsHtml(isTermsLang(l) ? l : "he"));
});

publicOnboarding.get("/terms/signed/:id", (req, res) => {
  const id = String(req.params.id || "");
  if (!/^[a-f0-9]{18}$/.test(id) || !validSignedKey(id, String(req.query.k || ""))) return res.status(404).send("Not found");
  const html = signedCopyHtml(id);
  if (!html) return res.status(404).send("Not found");
  res.set("Cache-Control", "no-store").type("html").send(html);
});

publicOnboarding.get("/admin/onboard-client", (_req, res) => res.set("Cache-Control", "no-store").sendFile(path.join(PUBLIC, "admin", "onboard-client.html")));
publicOnboarding.get("/set-password", (_req, res) => res.set("Cache-Control", "no-store").sendFile(path.join(PUBLIC, "admin", "set-password.html")));

publicOnboarding.post("/api/set-password", (req, res) => {
  if (rateLimited(`setpw|${req.ip}`, 10, 60 * 60 * 1000)) return res.status(429).json({ error: "Too many attempts" });
  const id = tenantForSetupToken(String(req.body?.token || ""));
  if (!id) return res.status(400).json({ error: "הקישור לא תקף או שכבר נוצל" });
  const pw = String(req.body?.password || "");
  if (pw.length < 8) return res.status(400).json({ error: "הסיסמה צריכה להיות לפחות 8 תווים" });
  updateTenant(id, { password: pw });
  res.json({ ok: true });
});

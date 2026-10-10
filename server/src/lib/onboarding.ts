import crypto from "crypto";
import { readGlobal, writeGlobal } from "./persist";
import { createTenant, updateTenant, getTenant, signPayload, safeEqual, findByEmail } from "./tenants";
import { isTierName, TIERS } from "./plans";
import { runAsTenant } from "./tenantContext";
import { createPairingCode, saveWhatsApp } from "./assistantSettings";
import { normalizePhone } from "./whatsapp";
import { brandDomain } from "./brand";
import { isModuleId, ModuleId, separateTotal } from "./modules";
import { TERMS, TERMS_VERSION, TermsLang, isTermsLang, termsHtml } from "./terms";

const FILE = "consents.json";
const MAX_SIGNATURE = 250_000; // chars of the data URL

export interface ConsentRecord {
  id: string;
  tenantId: string;
  consentGiven: true;
  acceptedAt: string; // ISO UTC
  ip: string;
  termsVersion: string;
  acceptedLanguage: TermsLang;
  checked: boolean[];
  signaturePng: string; // data:image/png;base64,...
  businessName: string;
  taxId: string;
  signatory: string;
  email: string;
  phone: string;
  botPhone: string;
  plan: string;
  modules?: ModuleId[]; // à-la-carte services (plan "modular")
  monthlyPriceIls?: number;
  onboardedBy: "admin";
}

const readAll = (): ConsentRecord[] => {
  try {
    const r = readGlobal(FILE);
    return r ? (JSON.parse(r) as ConsentRecord[]) : [];
  } catch {
    return [];
  }
};
export const getConsent = (id: string): ConsentRecord | undefined => readAll().find((c) => c.id === id);
export const consentsFor = (tenantId: string): ConsentRecord[] => readAll().filter((c) => c.tenantId === tenantId);

const str = (v: unknown, max: number): string => String(v ?? "").trim().slice(0, max);

export class OnboardError extends Error {}

export interface OnboardInput {
  language: unknown;
  businessName: unknown;
  taxId: unknown;
  signatory: unknown;
  email: unknown;
  phone: unknown;
  botPhone: unknown;
  plan: unknown;
  modules?: unknown;
  monthlyPriceIls: unknown;
  checked: unknown;
  signaturePng: unknown;
}

/** Signed link to the customer's own signed copy (no login needed, unguessable). */
export const signedCopyUrl = (id: string): string => `/terms/signed/${id}?k=${signPayload("signed:" + id).slice(0, 32)}`;
export const validSignedKey = (id: string, k: string): boolean => safeEqual(String(k || ""), signPayload("signed:" + id).slice(0, 32));

/** One-time password-setup link: invalidated once the password changes. */
export function setupToken(tenantId: string, days = 7): string {
  const t = getTenant(tenantId);
  const stamp = crypto.createHash("sha256").update(t?.passwordHash || "").digest("hex").slice(0, 10);
  const payload = Buffer.from(JSON.stringify({ t: tenantId, e: Date.now() + days * 86400000, s: stamp })).toString("base64url");
  return `${payload}.${signPayload("setpw:" + payload)}`;
}
export function tenantForSetupToken(token: string): string | null {
  const [payload, sig] = String(token).split(".");
  if (!payload || !sig) return null;
  const exp = signPayload("setpw:" + payload);
  if (!safeEqual(sig, exp)) return null;
  try {
    const { t, e, s } = JSON.parse(Buffer.from(payload, "base64url").toString());
    const ten = getTenant(t);
    if (!ten || Date.now() > e) return null;
    const stamp = crypto.createHash("sha256").update(ten.passwordHash).digest("hex").slice(0, 10);
    return stamp === s ? t : null;
  } catch {
    return null;
  }
}

export interface OnboardResult {
  tenantId: string;
  consentId: string;
  signedUrl: string;
  setupUrl: string;
  pairingCode: string;
  waLink: string;
  emailed: boolean;
}

export async function onboardClient(input: OnboardInput, ip: string, origin: string): Promise<OnboardResult> {
  if (!isTermsLang(input.language)) throw new OnboardError("שפה לא נתמכת");
  const lang = input.language;
  const businessName = str(input.businessName, 120);
  const signatory = str(input.signatory, 120);
  const taxId = str(input.taxId, 40);
  const email = str(input.email, 160).toLowerCase();
  const plan = str(input.plan, 40);
  if (!businessName || !signatory || !taxId) throw new OnboardError("חסרים שם עסק, מזהה עסק או שם החותם");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new OnboardError("כתובת אימייל לא תקינה");
  if (!isTierName(plan)) throw new OnboardError("מסלול לא מוכר");
  if (findByEmail(email)) throw new OnboardError("האימייל הזה כבר רשום");
  const phone = normalizePhone(str(input.phone, 30));
  const botPhone = str(input.botPhone, 30) ? normalizePhone(str(input.botPhone, 30)) : phone;
  if (!phone || !botPhone) throw new OnboardError("מספר טלפון לא תקין (פורמט בינלאומי, למשל 972501234567)");
  const checked = Array.isArray(input.checked) ? input.checked.map(Boolean) : [];
  if (checked.length !== TERMS[lang].checks.length || !checked.every(Boolean)) throw new OnboardError("יש לסמן את כל תיבות ההסכמה");
  const sig = String(input.signaturePng || "");
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sig) || sig.length > MAX_SIGNATURE || sig.length < 400) throw new OnboardError("חסרה חתימה");
  const mods: ModuleId[] = plan === "modular" ? [...new Set((Array.isArray(input.modules) ? input.modules : []).filter(isModuleId))] : [];
  if (plan === "modular" && !mods.length) throw new OnboardError("בחר לפחות שירות אחד");
  const price = input.monthlyPriceIls === "" || input.monthlyPriceIls == null ? (plan === "modular" ? separateTotal(mods) : TIERS[plan].priceIls) : Number(input.monthlyPriceIls);

  const addonUntil: Partial<Record<ModuleId, string>> = {};
  for (const m of mods) addonUntil[m] = new Date(Date.now() + 30 * 86400000).toISOString();
  const tenant = createTenant({ name: businessName, email, password: crypto.randomBytes(18).toString("base64url") });
  updateTenant(tenant.id, {
    plan,
    language: lang === "ar" || lang === "ru" ? "en" : lang, // dashboard languages today: he/en/es/fr
    subscriptionCycle: TIERS[plan].priceIls > 0 || mods.length ? "monthly" : "none",
    planExpiresAt: TIERS[plan].priceIls > 0 ? new Date(Date.now() + 30 * 86400000).toISOString() : undefined,
    addonUntil: addonUntil,
    seoCommitUntil: mods.includes("seo") ? new Date(Date.now() + 6 * 30 * 86400000).toISOString() : undefined,
  });

  const rec: ConsentRecord = {
    id: crypto.randomBytes(9).toString("hex"),
    tenantId: tenant.id,
    consentGiven: true,
    acceptedAt: new Date().toISOString(),
    ip: str(ip, 64),
    termsVersion: TERMS_VERSION,
    acceptedLanguage: lang,
    checked,
    signaturePng: sig,
    businessName, taxId, signatory, email, phone, botPhone,
    plan,
    modules: mods.length ? mods : undefined,
    monthlyPriceIls: Number.isFinite(price) && price >= 0 ? price : undefined,
    onboardedBy: "admin",
  };
  const all = readAll();
  all.push(rec);
  writeGlobal(FILE, JSON.stringify(all));

  const code = runAsTenant(tenant.id, () => {
    saveWhatsApp({ consentAt: rec.acceptedAt, lang: lang === "he" || lang === "es" ? lang : "en" });
    return createPairingCode();
  });
  const waNum = (process.env.WHATSAPP_DISPLAY_NUMBER || "12029728491").replace(/\D/g, "");
  const setupUrl = `${origin}/set-password?t=${encodeURIComponent(setupToken(tenant.id))}`;
  const signedUrl = `${origin}${signedCopyUrl(rec.id)}`;
  const emailed = await emailCustomer(email, lang, businessName, setupUrl, signedUrl);
  return { tenantId: tenant.id, consentId: rec.id, signedUrl, setupUrl, pairingCode: code, waLink: `https://wa.me/${waNum}?text=${encodeURIComponent("BOOL " + code)}`, emailed };
}

const MAIL: Record<TermsLang, { subject: string; hi: (n: string) => string; p1: string; b1: string; b2: string }> = {
  he: { subject: "ברוכים הבאים ל-BOOL AI", hi: (n) => `שלום ${n},`, p1: "ההצטרפות הושלמה וההסכם נחתם. ממשיכים בשני צעדים:", b1: "הגדרת סיסמה וכניסה לחשבון", b2: "העותק החתום של ההסכם (אפשר לשמור כ-PDF)" },
  en: { subject: "Welcome to BOOL AI", hi: (n) => `Hello ${n},`, p1: "Your sign-up is complete and the agreement is signed. Two next steps:", b1: "Set your password and log in", b2: "Your signed copy of the agreement (save as PDF)" },
  es: { subject: "Bienvenido a BOOL AI", hi: (n) => `Hola ${n},`, p1: "El registro está completo y el acuerdo firmado. Dos pasos más:", b1: "Define tu contraseña y entra", b2: "Tu copia firmada del acuerdo (guárdala como PDF)" },
  ar: { subject: "مرحباً بك في BOOL AI", hi: (n) => `مرحباً ${n}،`, p1: "اكتمل التسجيل وتم توقيع الاتفاقية. الخطوتان التاليتان:", b1: "تعيين كلمة المرور وتسجيل الدخول", b2: "نسختك الموقعة من الاتفاقية (احفظها بصيغة PDF)" },
  ru: { subject: "Добро пожаловать в BOOL AI", hi: (n) => `Здравствуйте, ${n}!`, p1: "Регистрация завершена, соглашение подписано. Два следующих шага:", b1: "Задать пароль и войти", b2: "Ваша подписанная копия соглашения (сохраните как PDF)" },
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function emailCustomer(to: string, lang: TermsLang, name: string, setupUrl: string, signedUrl: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const m = MAIL[lang];
  const d = TERMS[lang];
  const html = `<div dir="${d.dir}" style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:20px"><h2>${esc(m.subject)}</h2><p>${esc(m.hi(name))}</p><p>${esc(m.p1)}</p><p><a href="${esc(setupUrl)}">${esc(m.b1)}</a></p><p><a href="${esc(signedUrl)}">${esc(m.b2)}</a></p></div>`;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.NOTIFY_FROM || `BOOL <hello@${brandDomain()}>`, to: [to], subject: m.subject, html }),
      signal: AbortSignal.timeout(10000),
    });
    return r.ok;
  } catch (e) {
    console.error("Onboarding email failed:", (e as Error).message);
    return false;
  }
}

export function signedCopyHtml(id: string): string | null {
  const c = getConsent(id);
  if (!c) return null;
  return termsHtml(c.acceptedLanguage, { businessName: c.businessName, signatory: c.signatory, taxId: c.taxId, email: c.email, phone: c.phone, plan: c.plan, acceptedAt: c.acceptedAt, signaturePng: c.signaturePng, checked: c.checked });
}

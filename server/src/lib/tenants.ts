import crypto from "crypto";
import { readGlobal, writeGlobal, deleteTenantDocs } from "./persist";
import { DEFAULT_TENANT, isValidTenantId } from "./tenantContext";
import type { TierName } from "./plans";
import { releaseDomains } from "./sites";

/** Business accounts (tenants), their login, invite codes and the page → tenant index. All stored system-wide. */
export type TenantStatus = "active" | "suspended";

export interface Tenant {
  id: string;
  name: string;
  email: string;
  passwordHash: string; // scrypt$<salt>$<hash>
  plan: TierName; // the subscription tier (see plans.ts)
  status: TenantStatus;
  trialEndsAt?: string;
  createdAt: string;
  // BOOL platform fields (absent on accounts created before them; read through withDefaults)
  commitmentMonths?: number; // 0 = monthly/weekly, 12 = annual package
  creditsBalance?: number; // gift on sign-up; consumed by AI actions on credit-based tiers
  subscriptionCycle?: "none" | "weekly" | "monthly" | "annual";
  country?: string;
  city?: string;
  currency?: string;
  language?: string;
  planExpiresAt?: string; // paid plan lapses (back to free) if no renewal payment arrives by then
  leadKey?: string; // public key that identifies this business on the lead-capture endpoint
}

export const FREE_GIFT_CREDITS = 3;

/** Paid plans whose renewal payment never arrived fall back to the free tier (their remaining credits stay). */
export function expireLapsedPlans(now = Date.now()): string[] {
  const list = readAll();
  const lapsed: string[] = [];
  for (const t of list) {
    if (t.planExpiresAt && new Date(t.planExpiresAt).getTime() < now && t.plan !== "free_trial") {
      t.plan = "free_trial";
      t.subscriptionCycle = "none";
      t.commitmentMonths = 0;
      t.planExpiresAt = undefined;
      lapsed.push(t.id);
    }
  }
  if (lapsed.length) writeAll(list);
  return lapsed;
}

export function withDefaults(t: Tenant): Required<Omit<Tenant, "trialEndsAt" | "city" | "planExpiresAt">> & { trialEndsAt?: string; city?: string; planExpiresAt?: string } {
  return {
    ...t,
    commitmentMonths: t.commitmentMonths ?? 0,
    creditsBalance: t.creditsBalance ?? 0,
    subscriptionCycle: t.subscriptionCycle ?? "none",
    country: t.country ?? "IL",
    currency: t.currency ?? "ILS",
    language: t.language ?? "he",
    leadKey: t.leadKey ?? "",
  };
}

function readJson<T>(name: string, fallback: T): T {
  try {
    const raw = readGlobal(name);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// ---- passwords ----
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = String(stored).split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const given = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

// ---- tenants ----
const readAll = (): Tenant[] => readJson<Tenant[]>("tenants.json", []);
const writeAll = (list: Tenant[]) => writeGlobal("tenants.json", JSON.stringify(list, null, 2));

export const listTenants = (): Tenant[] => readAll();
export const getTenant = (id: string): Tenant | undefined => readAll().find((t) => t.id === id);
export const findByEmail = (email: string): Tenant | undefined =>
  readAll().find((t) => t.email === email.trim().toLowerCase());

/** The tenants whose scheduled posts and insights must be processed: the original one plus every active account. */
export const activeTenantIds = (): string[] => [DEFAULT_TENANT, ...readAll().filter((t) => t.status === "active").map((t) => t.id)];

export function createTenant(input: { name: string; email: string; password: string; plan?: Tenant["plan"]; trialDays?: number; credits?: number; city?: string }): Tenant {
  const list = readAll();
  const email = input.email.trim().toLowerCase();
  if (list.some((t) => t.email === email)) throw new Error("האימייל הזה כבר רשום");
  const tenant: Tenant = {
    id: crypto.randomBytes(6).toString("hex"),
    name: input.name.trim().slice(0, 120),
    email,
    passwordHash: hashPassword(input.password),
    plan: input.plan || "free_trial", // freemium: no card, a few gift credits, upgrade to unlock more
    status: "active",
    trialEndsAt: input.trialDays ? new Date(Date.now() + input.trialDays * 86400000).toISOString() : undefined,
    createdAt: new Date().toISOString(),
    commitmentMonths: 0,
    creditsBalance: input.credits ?? FREE_GIFT_CREDITS,
    subscriptionCycle: "none",
    country: "IL",
    city: input.city,
    currency: "ILS",
    language: "he",
    leadKey: crypto.randomBytes(9).toString("hex"),
  };
  list.push(tenant);
  writeAll(list);
  return tenant;
}

export type TenantPatch = Partial<Pick<Tenant, "plan" | "status" | "trialEndsAt" | "name" | "commitmentMonths" | "subscriptionCycle" | "country" | "city" | "currency" | "language" | "planExpiresAt">> & { password?: string };

export function updateTenant(id: string, patch: TenantPatch): Tenant | undefined {
  const list = readAll();
  const t = list.find((x) => x.id === id);
  if (!t) return undefined;
  if (patch.plan) t.plan = patch.plan;
  if (patch.status) t.status = patch.status;
  if (patch.trialEndsAt !== undefined) t.trialEndsAt = patch.trialEndsAt;
  if (patch.name) t.name = patch.name.trim().slice(0, 120);
  if (patch.password) t.passwordHash = hashPassword(patch.password);
  if ("planExpiresAt" in patch) t.planExpiresAt = patch.planExpiresAt;
  if (patch.commitmentMonths !== undefined) t.commitmentMonths = Math.max(0, Math.floor(patch.commitmentMonths));
  if (patch.subscriptionCycle) t.subscriptionCycle = patch.subscriptionCycle;
  for (const k of ["country", "city", "currency", "language"] as const) if (patch[k] !== undefined) t[k] = String(patch[k]).slice(0, 100);
  writeAll(list);
  return t;
}

/** Adds (or removes, with a negative delta) credits. Never goes below zero; returns the new balance. */
export function adjustCredits(id: string, delta: number): number | undefined {
  const list = readAll();
  const t = list.find((x) => x.id === id);
  if (!t) return undefined;
  t.creditsBalance = Math.max(0, (t.creditsBalance ?? 0) + Math.trunc(delta));
  writeAll(list);
  return t.creditsBalance;
}

export const findByLeadKey = (key: string): Tenant | undefined => (key ? readAll().find((t) => t.leadKey && t.leadKey === key) : undefined);

/** Gives accounts created before the platform fields existed a lead key (so their site form can work). */
export function ensureLeadKey(id: string): string {
  const list = readAll();
  const t = list.find((x) => x.id === id);
  if (!t) return "";
  if (!t.leadKey) {
    t.leadKey = crypto.randomBytes(9).toString("hex");
    writeAll(list);
  }
  return t.leadKey;
}

export function deleteTenant(id: string): boolean {
  if (!isValidTenantId(id) || id === DEFAULT_TENANT) return false;
  const list = readAll();
  const next = list.filter((t) => t.id !== id);
  if (next.length === list.length) return false;
  writeAll(next);
  deleteTenantDocs(id);
  releaseDomains(id);
  const idx = readJson<Record<string, string>>("pageIndex.json", {});
  for (const k of Object.keys(idx)) if (idx[k] === id) delete idx[k];
  writeGlobal("pageIndex.json", JSON.stringify(idx));
  return true;
}

// ---- signed session tokens ----
function secret(): string {
  let s = readGlobal("secret.txt");
  if (!s) {
    s = crypto.randomBytes(32).toString("hex");
    writeGlobal("secret.txt", s);
  }
  return s;
}

const sign = (payload: string) => crypto.createHmac("sha256", secret()).update(payload).digest("base64url");

export function issueToken(tenantId: string, days = 30): string {
  const payload = Buffer.from(JSON.stringify({ t: tenantId, e: Date.now() + days * 86400000 })).toString("base64url");
  return `tk.${payload}.${sign(payload)}`;
}

export function verifyToken(token: string): string | null {
  const [prefix, payload, sig] = String(token).split(".");
  if (prefix !== "tk" || !payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const { t, e } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof t === "string" && isValidTenantId(t) && t !== DEFAULT_TENANT && Date.now() < e ? t : null;
  } catch {
    return null;
  }
}

/** Constant-time string comparison (for the legacy access code). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ---- invites ----
interface Invite { code: string; note: string; createdAt: string; usedBy?: string }
const readInvites = (): Invite[] => readJson<Invite[]>("invites.json", []);
const writeInvites = (l: Invite[]) => writeGlobal("invites.json", JSON.stringify(l, null, 2));

export function createInvite(note: string): Invite {
  const inv: Invite = { code: crypto.randomBytes(5).toString("hex"), note: note.slice(0, 80), createdAt: new Date().toISOString() };
  const list = readInvites();
  list.push(inv);
  writeInvites(list);
  return inv;
}
export const listInvites = (): Invite[] => readInvites();

/** Consumes an unused invite code; returns false if it does not exist or was used. */
export function consumeInvite(code: string, tenantId: string): boolean {
  const list = readInvites();
  const inv = list.find((i) => i.code === code.trim().toLowerCase() && !i.usedBy);
  if (!inv) return false;
  inv.usedBy = tenantId;
  writeInvites(list);
  return true;
}

// ---- Meta page → tenant routing (webhooks arrive without any login) ----
export function indexAccounts(tenantId: string, ids: string[]): void {
  const idx = readJson<Record<string, string>>("pageIndex.json", {});
  for (const id of ids.filter(Boolean)) idx[id] = tenantId;
  writeGlobal("pageIndex.json", JSON.stringify(idx));
}
export function unindexTenant(tenantId: string): void {
  const idx = readJson<Record<string, string>>("pageIndex.json", {});
  for (const k of Object.keys(idx)) if (idx[k] === tenantId) delete idx[k];
  writeGlobal("pageIndex.json", JSON.stringify(idx));
}
export const tenantForAccount = (id: string): string | undefined => readJson<Record<string, string>>("pageIndex.json", {})[id];

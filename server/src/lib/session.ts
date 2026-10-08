import { Request } from "express";
import { config } from "../config";
import { DEFAULT_TENANT } from "./tenantContext";
import { getTenant, safeEqual, verifyToken } from "./tenants";

export interface AuthInfo {
  tenantId: string;
  isAdmin: boolean; // the operator (legacy access code) — may manage all tenants
  suspended?: boolean;
}

function tokenOf(req: Request): string {
  const header = req.header("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7) : String(req.query.token || "");
}

/**
 * Who is calling?
 *  - The operator's access code (DASHBOARD_TOKEN) → the default tenant (the original business) with admin rights.
 *    With no DASHBOARD_TOKEN configured the original open/dev behaviour is kept.
 *  - A signed session token → that tenant (only if its account exists and is not suspended).
 */
export function authenticate(req: Request): AuthInfo | null {
  const token = tokenOf(req);
  if (!config.dashboardToken && !token) return { tenantId: DEFAULT_TENANT, isAdmin: true };
  if (config.dashboardToken && token && safeEqual(token, config.dashboardToken)) return { tenantId: DEFAULT_TENANT, isAdmin: true };
  const tenantId = token ? verifyToken(token) : null;
  if (!tenantId) return null;
  const tenant = getTenant(tenantId);
  if (!tenant) return null;
  return { tenantId, isAdmin: false, suspended: tenant.status !== "active" };
}

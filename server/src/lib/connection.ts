import path from "path";
import { readDoc, writeDoc } from "./persist";
import { currentTenantId } from "./tenantContext";
import { indexAccounts, unindexTenant } from "./tenants";

const FILE = path.join(__dirname, "..", "..", "data", "connection.json");

/** The Facebook Page + Instagram account connected through "Connect with Facebook". */
export interface MetaConnection {
  pageId: string;
  pageName: string;
  pageAccessToken: string; // Page token derived from a long-lived user token — does not expire
  igUserId: string;
  igUsername?: string;
  connectedAt: string;
  fbUserId?: string; // the Facebook user who connected — used to honour Meta data-deletion requests
}

export function getConnection(): MetaConnection | null {
  try {
    const raw = readDoc(FILE);
    return raw ? (JSON.parse(raw) as MetaConnection) : null;
  } catch {
    return null;
  }
}

export function saveConnection(c: MetaConnection): void {
  writeDoc(FILE, JSON.stringify(c, null, 2));
  indexAccounts(currentTenantId(), [c.pageId, c.igUserId]); // so webhooks for this page reach this tenant
}

export function clearConnection(): void {
  writeDoc(FILE, "null");
  unindexTenant(currentTenantId());
}

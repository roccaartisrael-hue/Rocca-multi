import path from "path";
import { readDoc, writeDoc } from "./persist";

const FILE = path.join(__dirname, "..", "..", "data", "connection.json");

/** The Facebook Page + Instagram account connected through "Connect with Facebook". */
export interface MetaConnection {
  pageId: string;
  pageName: string;
  pageAccessToken: string; // Page token derived from a long-lived user token — does not expire
  igUserId: string;
  igUsername?: string;
  connectedAt: string;
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
}

export function clearConnection(): void {
  writeDoc(FILE, "null");
}

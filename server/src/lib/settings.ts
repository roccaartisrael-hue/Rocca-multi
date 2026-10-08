import path from "path";
import { readDoc, writeDoc } from "./persist";

const FILE = path.join(__dirname, "..", "..", "data", "settings.json");

/** Per-business switches and preferences (tenant-scoped; the default tenant keeps its own copy too). */
export interface Settings {
  autopilotEnabled: boolean; // weekly drafts are prepared automatically and wait for approval — nothing publishes by itself
  autopilotLastRun?: string;
  adBudgetMonthly: number; // paid budget the owner allows, ₪ per month
  adAutoDistribute: boolean; // let the allocator split the budget between channels
  adPlatformsEnabled: string[];
  notifyEmail?: string; // where new leads are announced
  notifyWhatsapp?: string; // digits only, international (e.g. 9725XXXXXXXX)
  domain?: string; // the business's own domain (site module)
}

const DEFAULTS: Settings = {
  autopilotEnabled: false,
  adBudgetMonthly: 0,
  adAutoDistribute: true,
  adPlatformsEnabled: ["facebook", "instagram"],
};

export function getSettings(): Settings {
  try {
    const raw = readDoc(FILE);
    return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  writeDoc(FILE, JSON.stringify(next, null, 2));
  return next;
}

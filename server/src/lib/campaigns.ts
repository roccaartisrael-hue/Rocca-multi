import path from "path";
import { v4 as uuid } from "uuid";
import { readDoc, writeDoc } from "./persist";

const FILE = path.join(__dirname, "..", "..", "data", "campaigns.json");

export interface CampaignCreative {
  name: string;
  funnelStage: string;
  hook: string;
  text: string;
  cta: string;
  imageIdea: string;
  audience: string;
  budgetIls?: number;
}

export interface Campaign {
  id: string;
  createdAt: string;
  request: { goal: string; offer: string; weeks: number; weeklyBudget: number; notes: string };
  name: string;
  objective: string;
  summary: string;
  audiences: { name: string; description: string; location: string; ageRange: string; interests: string[]; funnel: string }[];
  funnel: { stage: string; goal: string; budgetPercent: number; budgetIls: number; platforms: string[]; formats: string[] }[];
  creatives: CampaignCreative[];
  schedule: { week: number; focus: string; actions: string[] }[];
  kpis: { metric: string; target: string; why: string }[];
  optimizationRules: { if: string; then: string }[];
  abTests: { hypothesis: string; variantA: string; variantB: string; metric: string; duration: string }[];
  risks: string[];
}

function read(): Campaign[] {
  try {
    return JSON.parse(readDoc(FILE) || "[]");
  } catch {
    return [];
  }
}

export const campaigns = {
  list(): Campaign[] {
    return read().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  get(id: string): Campaign | undefined {
    return read().find((c) => c.id === id);
  },
  save(c: Omit<Campaign, "id" | "createdAt">): Campaign {
    const all = read();
    const full = { ...c, id: uuid(), createdAt: new Date().toISOString() } as Campaign;
    all.push(full);
    writeDoc(FILE, JSON.stringify(all, null, 2));
    return full;
  },
  remove(id: string): boolean {
    const all = read();
    const next = all.filter((c) => c.id !== id);
    writeDoc(FILE, JSON.stringify(next, null, 2));
    return next.length !== all.length;
  },
};

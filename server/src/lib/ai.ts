import { AsyncLocalStorage } from "async_hooks";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { getTier } from "./plans";

/**
 * One interface over the two text models the app can use: Claude (default) and Gemini.
 * The call shape mirrors Anthropic's messages.create so existing code stays unchanged.
 *
 * Provider choice:
 *   AI_PROVIDER=gemini            -> Gemini for everything
 *   GEMINI_FOR_TIERS=basic,...    -> Gemini only for those subscription tiers (cheaper margin on low tiers)
 * Gemini needs GEMINI_API_KEY; without it the app silently stays on Claude.
 */
export type Provider = "claude" | "gemini";

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
const CLAUDE_MODEL = "claude-sonnet-5";
const GEMINI_BASE = () => process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";
// Last-resort name if the model list can't be fetched. Normally the model is discovered from the API (see below).
const GEMINI_FALLBACK = "gemini-flash-latest";

interface ModelInfo { name: string; version: number[]; stable: boolean }
let discovered: { model: string; at: number; all: string[] } | null = null;

/** Picks the newest general-purpose Flash model that this API key can actually call (generateContent). */
function pickFlash(models: { name: string; supportedGenerationMethods?: string[] }[]): { best: string; all: string[] } {
  const ok: ModelInfo[] = [];
  for (const m of models) {
    const id = m.name.replace(/^models\//, "");
    if (!(m.supportedGenerationMethods || []).includes("generateContent")) continue;
    const match = id.match(/^gemini-(\d+)(?:\.(\d+))?-flash(-preview)?(?:-\d+)?$/);
    if (!match) continue; // skips lite, image, tts, live, audio, exp, thinking variants
    ok.push({ name: id, version: [Number(match[1]), Number(match[2] || 0)], stable: !match[3] && !/-\d{2,}$/.test(id) });
  }
  ok.sort((a, b) => b.version[0] - a.version[0] || b.version[1] - a.version[1] || Number(b.stable) - Number(a.stable));
  return { best: ok[0]?.name || "", all: ok.map((m) => m.name) };
}

export async function geminiModel(force = false): Promise<string> {
  if (process.env.GEMINI_MODEL) return process.env.GEMINI_MODEL; // explicit override
  if (!force && discovered && Date.now() - discovered.at < 3600_000) return discovered.model;
  try {
    const res = await fetch(`${GEMINI_BASE()}/v1beta/models?pageSize=200`, { headers: { "x-goog-api-key": process.env.GEMINI_API_KEY! } });
    const data: any = await res.json();
    const { best, all } = pickFlash(data.models || []);
    discovered = { model: best || GEMINI_FALLBACK, at: Date.now(), all };
  } catch {
    discovered = { model: GEMINI_FALLBACK, at: Date.now() - 3000_000, all: [] }; // retry listing in ~10 min
  }
  return discovered.model;
}

/** For diagnostics: which Flash models this key can use, and which one the app picked. */
export async function geminiStatus() {
  if (!geminiAvailable()) return { available: false };
  const model = await geminiModel();
  return { available: true, model, overridden: !!process.env.GEMINI_MODEL, usable: discovered?.all || [] };
}

/**
 * Task routing: Gemini takes the light, high-volume writing; Claude takes the work that needs depth.
 * "auto" (default) follows TASKS below. The user can force a model per request with the X-Model header
 * (the dashboard's model selector): "claude" = highest quality, "gemini" = fast and cheap.
 */
export type Task = "post" | "reply" | "brandVoice" | "marketBrief" | "plan" | "strategy" | "campaign";
export type ModelChoice = "auto" | "claude" | "gemini";

const TASKS: Record<Task, Provider> = {
  post: "gemini", // single posts and captions
  reply: "gemini", // short comment replies
  brandVoice: "claude", // sets the voice of everything else
  marketBrief: "claude",
  plan: "claude", // content calendar
  strategy: "claude", // learning from results
  campaign: "claude", // professional campaign brief
};

const modelContext = new AsyncLocalStorage<ModelChoice>();

/** Runs `fn` with the user's model choice visible to every llm call inside it. */
export function withModelChoice<T>(choice: string | undefined, fn: () => T): T {
  const c: ModelChoice = choice === "claude" || choice === "gemini" ? choice : "auto";
  return modelContext.run(c, fn);
}

export function geminiAvailable(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

export function activeProvider(task: Task = "post"): Provider {
  if (!geminiAvailable()) return "claude";
  if ((process.env.AI_PROVIDER || "").toLowerCase() === "gemini") return "gemini"; // operator override: Gemini for everything
  const choice = modelContext.getStore() || "auto";
  if (choice !== "auto") return choice;
  const tiers = (process.env.GEMINI_FOR_TIERS || "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (tiers.includes(getTier().name)) return "gemini"; // cheap tiers: Gemini even for the heavy tasks
  return TASKS[task];
}

// Estimated USD per million tokens — override from the provider's real price list.
const PRICES: Record<Provider, { in: number; out: number }> = {
  claude: { in: Number(process.env.CLAUDE_PRICE_IN_PER_MTOK || 3), out: Number(process.env.CLAUDE_PRICE_OUT_PER_MTOK || 15) },
  gemini: { in: Number(process.env.GEMINI_PRICE_IN_PER_MTOK || 0.3), out: Number(process.env.GEMINI_PRICE_OUT_PER_MTOK || 2.5) },
};

interface CreateParams {
  model?: string; // ignored: the provider decides
  max_tokens: number;
  system?: string;
  messages: { role: "user"; content: string }[];
  task?: Task;
}

export interface AiResult {
  content: { type: "text"; text: string }[];
  usage: { input_tokens: number; output_tokens: number; cost_usd: number; provider: Provider };
}

async function viaClaude(p: CreateParams): Promise<AiResult> {
  const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: p.max_tokens, system: p.system, messages: p.messages });
  const input = msg.usage.input_tokens;
  const output = msg.usage.output_tokens;
  return {
    content: [{ type: "text", text: msg.content.map((b) => (b.type === "text" ? b.text : "")).join("") }],
    usage: { input_tokens: input, output_tokens: output, cost_usd: (input * PRICES.claude.in + output * PRICES.claude.out) / 1e6, provider: "claude" },
  };
}

async function viaGemini(p: CreateParams): Promise<AiResult> {
  const body: any = {
    contents: [{ role: "user", parts: [{ text: p.messages[0].content }] }],
    generationConfig: { maxOutputTokens: p.max_tokens },
  };
  if (p.system) body.systemInstruction = { parts: [{ text: p.system }] };
  // Gemini 2.5 Flash can skip "thinking" (budget 0), which otherwise eats the output budget. Newer models use a
  // different control, so the budget is only sent to 2.5 models; if a model rejects it we retry once without.
  let model = await geminiModel();
  const withBudget = /2\.5.*flash/i.test(model);
  if (withBudget) body.generationConfig.thinkingConfig = { thinkingBudget: Number(process.env.GEMINI_THINKING_BUDGET || 0) };

  const headers = { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! };
  const call = () => fetch(`${GEMINI_BASE()}/v1beta/models/${model}:generateContent`, { method: "POST", headers, body: JSON.stringify(body) });
  let res = await call();
  let data: any = await res.json().catch(() => ({}));
  const msg = () => String(data?.error?.message || "");
  // A model name that is gone or closed to this key: re-discover once and retry with whatever the key can use.
  if (!res.ok && !process.env.GEMINI_MODEL && /no longer available|not found|not supported|is not available/i.test(msg())) {
    const next = await geminiModel(true);
    if (next !== model) {
      model = next;
      res = await call();
      data = await res.json().catch(() => ({}));
    }
  }
  if (!res.ok && withBudget && /thinking/i.test(msg())) {
    delete body.generationConfig.thinkingConfig;
    res = await call();
    data = await res.json().catch(() => ({}));
  }
  if (!res.ok) throw new Error(`Gemini: ${data?.error?.message || res.statusText}`);
  const text = (data.candidates?.[0]?.content?.parts || []).map((x: any) => x.text || "").join("");
  if (!text) throw new Error("Gemini לא החזיר טקסט (ייתכן שנחסם). נסו שוב או נסחו אחרת.");
  const input = data.usageMetadata?.promptTokenCount || 0;
  const output = (data.usageMetadata?.candidatesTokenCount || 0) + (data.usageMetadata?.thoughtsTokenCount || 0);
  return {
    content: [{ type: "text", text }],
    usage: { input_tokens: input, output_tokens: output, cost_usd: (input * PRICES.gemini.in + output * PRICES.gemini.out) / 1e6, provider: "gemini" },
  };
}

export const llm = {
  messages: {
    create(p: CreateParams): Promise<AiResult> {
      return activeProvider(p.task) === "gemini" ? viaGemini(p) : viaClaude(p);
    },
  },
};

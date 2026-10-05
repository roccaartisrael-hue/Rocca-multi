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
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

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
  // Flash models can skip "thinking", which otherwise eats the output budget and bills as output.
  if (/flash/i.test(GEMINI_MODEL)) body.generationConfig.thinkingConfig = { thinkingBudget: Number(process.env.GEMINI_THINKING_BUDGET || 0) };

  const res = await fetch(`${process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com"}/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
    body: JSON.stringify(body),
  });
  const data: any = await res.json().catch(() => ({}));
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

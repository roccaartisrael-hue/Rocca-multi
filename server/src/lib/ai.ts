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

export function activeProvider(): Provider {
  if (!process.env.GEMINI_API_KEY) return "claude";
  if ((process.env.AI_PROVIDER || "").toLowerCase() === "gemini") return "gemini";
  const tiers = (process.env.GEMINI_FOR_TIERS || "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  return tiers.includes(getTier().name) ? "gemini" : "claude";
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
      return activeProvider() === "gemini" ? viaGemini(p) : viaClaude(p);
    },
  },
};

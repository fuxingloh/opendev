import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { Model } from "@openxyz/runtime/openxyz";
import systemPrompt from "../prompts/system.md" with { type: "text" };

// OpenRouter's OpenAI-compatible gateway. Requires `OPENROUTER_API_KEY`.
// See https://openrouter.ai/docs for available model ids.
const or = createOpenAICompatible({
  name: "openrouter",
  apiKey: process.env.OPENROUTER_API_KEY ?? "",
  baseURL: "https://openrouter.ai/api/v1",
});

/**
 * Usage: `openrouter("z-ai/glm-4.6")`. No cache-control wrap — routed through
 * `@ai-sdk/openai-compatible`, which drops anthropic-style markers. Prompt
 * caching here would need `providerOptions.openaiCompatible.cache_control` and
 * verification that OpenRouter forwards it upstream.
 */
export default function openrouter(modelId: string): Model {
  return { model: or(modelId), systemPrompt };
}

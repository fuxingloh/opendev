import type { LanguageModelMiddleware } from "ai";

/**
 * Providers whose SDK packages actually read the marker we stamp. Only
 * providers wired through their native `@ai-sdk/<name>` package belong
 * here — openai-compatible backends (OpenRouter, Vercel AI Gateway,
 * opencode-zen) route through `@ai-sdk/openai-compatible`, which only
 * forwards `providerOptions.openaiCompatible` to the wire and drops
 * everything else. See `../../../../ai/packages/openai-compatible/src/chat/
 * convert-to-openai-compatible-chat-messages.ts:16`.
 */
export type CacheProvider = "anthropic" | "bedrock";

/**
 * Cache-control middleware. Stamps the last system message in `params.prompt`
 * with an ephemeral cache breakpoint so supported providers stop repaying
 * the static instructions prefix on every turn.
 *
 * ## Current coverage (v1)
 *
 * Only `cacheMiddleware("bedrock")` is wired (see `bedrock.ts`). Anthropic
 * is declared but unused — slot reserved for when `@ai-sdk/anthropic` lands
 * as a direct provider.
 *
 * Only the instructions block (last consecutive system at the head of the
 * prompt) is marked. That's the biggest single win — 3–6K tokens, identical
 * across every turn within a process lifetime.
 *
 * ## Not covered yet (follow-up work)
 *
 * - **Prompt-tail breakpoint on the last user message** — extends the cached
 *   prefix through env + conversation history. Compounds across turns.
 * - **Env frame caching** — channel-provided `Telegram DM: ...` frame,
 *   stable within a thread. Small absolute win.
 * - **MEMORY.md / USER.md positioning** — when they land, they belong
 *   inside the cached prefix.
 * - **openai-compatible backends** (OpenRouter, Vercel gateway, opencode-zen)
 *   — need `providerOptions.openaiCompatible.cache_control` instead, and
 *   we need to verify the upstream service honors it. Punt until proven.
 * - **Token accounting** — `usage.cacheReadInputTokens` / equivalents
 *   surfaced in logs (`mnemonic/032`).
 * - **Session affinity** — `x-session-affinity` header where supported.
 * - **Cache budget** — Anthropic caps at 4 breakpoints per request;
 *   we currently use 1.
 */
export function cacheMiddleware(provider: CacheProvider): LanguageModelMiddleware {
  return {
    specificationVersion: "v3",
    transformParams: async ({ params }) => {
      const prompt = params.prompt;
      if (!Array.isArray(prompt) || prompt.length === 0) return params;

      // System messages always sit at the head of the prompt in our pipeline
      // (instructions first, then per-request env, then user/assistant).
      // Stamp the last consecutive system at the front — that's the
      // instructions frame emitted by ToolLoopAgent.
      let lastSystem = -1;
      for (let i = 0; i < prompt.length; i++) {
        if (prompt[i]!.role === "system") lastSystem = i;
        else break;
      }
      if (lastSystem === -1) return params;

      const stamped = [...prompt];
      stamped[lastSystem] = withMarker(stamped[lastSystem]!, provider);
      return { ...params, prompt: stamped };
    },
  };
}

type WithProviderOptions = { providerOptions?: Record<string, Record<string, unknown>> };

function withMarker<M extends WithProviderOptions>(msg: M, provider: CacheProvider): M {
  const key = provider;
  const marker = provider === "bedrock" ? { cachePoint: { type: "default" } } : { cacheControl: { type: "ephemeral" } };

  return {
    ...msg,
    providerOptions: {
      ...(msg.providerOptions ?? {}),
      [key]: { ...(msg.providerOptions?.[key] ?? {}), ...marker },
    },
  };
}

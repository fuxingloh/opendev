/**
 * Picks a provider at call time based on `OPENXYZ_MODEL`, e.g.:
 *
 * ```env
 * OPENXYZ_MODEL=openrouter/z-ai/glm-4.6
 * OPENXYZ_MODEL=vercel/anthropic/claude-sonnet-4-5
 * OPENXYZ_MODEL=amazon-bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0
 * OPENXYZ_MODEL=opencode/big-pickle
 *```
 *
 * Splits on the first `/` only — the provider is the left half, the rest
 * (which may itself contain `/`) is passed through as the model id. Provider
 * modules are dynamic-imported so only the chosen one loads.
 *
 * **Provider keys match models.dev provider IDs** — same string names the
 * filename (`providers/<key>.ts`), the switch-case below, and the lookup
 * passed to `lookupLimit` inside the provider. See mnemonic/087.
 *
 * The factory returns the provider's decorated `LanguageModel` (raw ai-sdk
 * model + `.limit` attached via `Object.assign`). `loadModel` reads that at
 * the facade boundary. Return type inferred — there's no public symbol for
 * the intersection and it's implementation-detail.
 */
export default async function auto() {
  if (process.env.OPENXYZ_MODEL === undefined) {
    throw new Error("OPENXYZ_MODEL environment variable is not set");
  }

  const sep = process.env.OPENXYZ_MODEL.indexOf("/");
  const provider = sep === -1 ? process.env.OPENXYZ_MODEL : process.env.OPENXYZ_MODEL.slice(0, sep);
  const modelId = sep === -1 ? "" : process.env.OPENXYZ_MODEL.slice(sep + 1);

  switch (provider) {
    case "opencode":
      return (await import("./providers/opencode")).default(modelId);
    case "amazon-bedrock":
      return (await import("./providers/amazon-bedrock")).default(modelId);
    case "openrouter":
      return (await import("./providers/openrouter")).default(modelId);
    case "vercel":
      return (await import("./providers/vercel")).default(modelId);
    default:
      throw new Error(`Unsupported OPENXYZ_MODEL provider: ${provider}`);
  }
}

import { bedrock as aws } from "@ai-sdk/amazon-bedrock";
import { wrapLanguageModel } from "ai";
import type { Model } from "@openxyz/runtime/openxyz";
import { cacheMiddleware } from "./_cache";
import systemPrompt from "../prompts/system.md" with { type: "text" };

/**
 * Amazon Bedrock model factory. Credentials resolve from the AWS SDK's
 * default credential chain (env, shared config, instance role). Wrapped
 * with `cacheMiddleware("bedrock")` to stamp `cachePoint` markers on the
 * instructions frame for prompt caching.
 *
 * Usage: `bedrock("zai.glm-4.7")` — see AWS docs for available model ids.
 */
export default function bedrock(modelId: string): Model {
  return {
    model: wrapLanguageModel({ model: aws(modelId), middleware: cacheMiddleware("bedrock") }),
    systemPrompt,
  };
}

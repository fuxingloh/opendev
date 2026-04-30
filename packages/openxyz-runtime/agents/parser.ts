import { z } from "zod";
import { matter } from "../utils/frontmatter";
import { FilesystemConfigSchema } from "../tools/filesystem";

/**
 * Parser-only module: pulls in `yaml` for frontmatter parsing. Kept separate
 * from `factory.ts` (the runtime class) so the deployed runtime bundle never
 * imports yaml — the build's entrypoint codegen pre-parses every agent at
 * build time and inlines the result as JSON literals.
 *
 * Type-only consumers (factory.ts, build entrypoints) `import type { AgentDef }`
 * from here; that gets erased at compile time. Anything that wants to actually
 * call `parseAgent` opts in to yaml.
 */
export const AgentFrontmatterSchema = z.object({
  name: z.string(),
  description: z.string(),
  skills: z.array(z.string()).optional(),
  tools: z
    .record(z.string(), z.union([z.literal(true), z.literal(false), z.record(z.string(), z.unknown())]))
    .default({ "*": true }),
  filesystem: FilesystemConfigSchema,
  /** Name from the models. Falls back to "auto" when omitted. */
  model: z.string().default("auto"),
});

export const AgentDefSchema = AgentFrontmatterSchema.extend({
  instructions: z.string(),
});

export type AgentDef = z.infer<typeof AgentDefSchema>;

export function parseAgent(name: string, raw: string): AgentDef | undefined {
  const { data, content } = matter(raw);
  const result = AgentDefSchema.safeParse({ ...data, name, instructions: content.trim() });
  if (!result.success) {
    console.warn(
      `[openxyz] agent "${name}" invalid frontmatter: ${result.error.issues.map((i) => i.message).join(", ")}`,
    );
    return undefined;
  }
  return result.data;
}

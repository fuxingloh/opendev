import { AgentDefSchema, type AgentDef } from "@openxyz/runtime/agents/factory";
import { matter } from "./frontmatter";

/**
 * Parse a `<name>.md` agent definition: split frontmatter, validate against
 * the schema, return a typed `AgentDef`. Build-time + `openxyz start` only —
 * the deployed worker never calls this; agents are pre-parsed to JSON
 * literals in the codegened entrypoint.
 */
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

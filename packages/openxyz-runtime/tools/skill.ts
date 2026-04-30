import { tool } from "ai";
import { z } from "zod";

/**
 * Schemas + types live here so the runtime owns its own shape. Parsing
 * (`matter()`, yaml) lives in the CLI at `packages/openxyz/bin/parsers/skill.ts`
 * — a build-time concern, not a runtime one.
 */
const SkillFrontmatterSchema = z.object({
  name: z.string(),
  description: z.string(),
});

export const SkillDefSchema = SkillFrontmatterSchema.extend({
  content: z.string(),
});

export type SkillDef = z.infer<typeof SkillDefSchema>;

// TODO: SKILL.md frontmatter could support `allowed-tools` to restrict which tools the agent
//  can use while executing a skill (e.g. research skill only allows web_search + web_fetch).
//  Claude Code and opencode both support this. May or may not want this — skills currently
//  just inject instructions, they don't constrain the tool set.

export function createSkillTool(skills: SkillDef[]) {
  // Skills are enumerated in the system prompt (see `formatSkillsXml` in
  // `agents/agent.ts`). Don't repeat the list here — the agent already
  // knows what's available before invoking this tool.
  return tool({
    description: "Load a skill by name to follow its domain-specific instructions.",
    inputSchema: z.object({
      name: z.string().describe("Exact name of a skill from the system prompt's available_skills list."),
    }),
    execute: async ({ name }) => {
      const skill = skills.find((s) => s.name === name);
      if (!skill) {
        const available = skills.map((s) => s.name).join(", ");
        throw new Error(`Skill "${name}" not found. Available: ${available || "none"}`);
      }
      return skill.content.trim();
    },
  });
}

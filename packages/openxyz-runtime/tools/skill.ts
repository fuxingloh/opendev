import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tool } from "ai";
import { z } from "zod";
import { matter } from "../utils/frontmatter";

// TODO: SKILL.md frontmatter could support `allowed-tools` to restrict which tools the agent
//  can use while executing a skill (e.g. research skill only allows web_search + web_fetch).
//  Claude Code and opencode both support this. May or may not want this — skills currently
//  just inject instructions, they don't constrain the tool set.
const SkillFrontmatterSchema = z.object({
  name: z.string(),
  description: z.string(),
});

const SkillDefSchema = SkillFrontmatterSchema.extend({
  content: z.string(),
  location: z.string(),
});

export type SkillDef = z.infer<typeof SkillDefSchema>;

export function parseSkill(path: string, raw: string): SkillDef | undefined {
  const { data, content } = matter(raw);
  const result = SkillDefSchema.safeParse({ ...data, content, location: path });
  if (!result.success) {
    console.warn(
      `[openxyz] skill "${path}" invalid frontmatter: ${result.error.issues.map((i) => i.message).join(", ")}`,
    );
    return undefined;
  }
  return result.data;
}

export function createSkillTool(skills: SkillDef[]) {
  return tool({
    description: "Load a skill by name. Available skills are listed in the system prompt.",
    inputSchema: z.object({
      name: z.string().describe("The name of the skill from available skills."),
    }),
    execute: async ({ name }) => {
      const skill = skills.find((s) => s.name === name);
      if (!skill) {
        const available = skills.map((s) => s.name).join(", ");
        throw new Error(`Skill "${name}" not found. Available skills: ${available || "none"}`);
      }

      const dir = dirname(skill.location);
      const files: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        if (entry.name === "SKILL.md") continue;
        files.push(join(dir, entry.name));
        if (files.length >= 10) break;
      }

      return [
        `<skill_content name="${skill.name}">`,
        `# Skill: ${skill.name}`,
        "",
        skill.content.trim(),
        "",
        `Base directory: ${dir}`,
        "",
        "<skill_files>",
        ...files.map((f) => `<file>${f}</file>`),
        "</skill_files>",
        "</skill_content>",
      ].join("\n");
    },
  });
}

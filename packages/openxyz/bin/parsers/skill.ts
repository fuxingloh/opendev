import { SkillDefSchema, type SkillDef } from "@openxyz/runtime/tools/skill";
import { matter } from "./frontmatter";

/**
 * Parse a `SKILL.md` definition. Build-time + `openxyz start` only — the
 * deployed worker never calls this; skills are pre-parsed to JSON literals
 * in the codegened entrypoint.
 */
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

import { SkillDefSchema, type SkillDef } from "@openxyz/runtime/tools/skill";
import { matter } from "./frontmatter";

/**
 * Parse a `SKILL.md` definition. Build-time + `openxyz start` only — the
 * deployed worker never calls this; skills are pre-parsed to JSON literals
 * in the codegened entrypoint.
 *
 * `path` is used purely for error reporting; it isn't stored on the
 * resulting `SkillDef` (the runtime only needs name/description/content).
 */
export function parseSkill(path: string, raw: string): SkillDef | undefined {
  const { data, content } = matter(raw);
  const result = SkillDefSchema.safeParse({ ...data, content });
  if (!result.success) {
    console.warn(
      `[openxyz] skill "${path}" invalid frontmatter: ${result.error.issues.map((i) => i.message).join(", ")}`,
    );
    return undefined;
  }
  return result.data;
}

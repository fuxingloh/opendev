import { z } from "zod";
import { matter } from "../utils/frontmatter";

/**
 * Parser-only module: pulls in `yaml`. Kept separate from `skill.ts` so the
 * deployed runtime bundle never imports yaml — `parseSkill` is invoked at
 * build time only; runtime sees pre-parsed JSON.
 */
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

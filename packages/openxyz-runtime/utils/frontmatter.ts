import { parse as parseYaml } from "yaml";

/**
 * Tiny drop-in replacement for gray-matter's `matter(raw)`.
 *
 * Returns `{ data, content }` from a markdown string that may be prefixed
 * with `---\nYAML\n---\n…`. If no frontmatter delimiter is present, `data`
 * is empty and `content` is the full input.
 *
 * We used gray-matter before but it's CJS with a deep transitive tree
 * (js-yaml, section-matter, kind-of, etc.) — Bun's runtime transpile-cache
 * tries to write to a read-only disk on Vercel and crashes the function
 * at module-load. `yaml` is pure ESM with no transitive deps. See
 * `mnemonic/068` for the full story.
 */
export function matter(raw: string): { data: Record<string, unknown>; content: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) return { data: {}, content: raw };
  const parsed = parseYaml(match[1]!) as Record<string, unknown> | null | undefined;
  return { data: parsed ?? {}, content: match[2] ?? "" };
}

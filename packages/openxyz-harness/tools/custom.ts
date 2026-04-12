import { join } from "node:path";
import type { Tool } from "ai";

/**
 * Scan `cwd/tools/[!_]*.{js,ts}` for custom tools.
 * Each file must `export default tool(...)` (AI SDK shape).
 * Filename (minus extension) becomes the tool name.
 */
export async function scanTools(cwd: string): Promise<Record<string, Tool>> {
  const glob = new Bun.Glob("tools/[!_]*.{js,ts}");
  const tools: Record<string, Tool> = {};

  for await (const rel of glob.scan({ cwd })) {
    const file = rel.split("/").pop()!;
    const name = file.replace(/\.(js|ts)$/, "");
    const mod = await import(join(cwd, rel));
    if (!mod.default) {
      console.warn(`[openxyz] tools/${file} has no default export, skipping`);
      continue;
    }
    tools[name] = mod.default;
  }

  return tools;
}

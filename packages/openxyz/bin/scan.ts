/**
 * Filesystem enumeration of a template. No module execution, no file reads —
 * just paths keyed by name. Consumers decide what to do with them:
 *
 * - `openxyz start` loads modules + parses markdown (see `loadTemplate`)
 * - `openxyz build` code-gens static imports
 *
 * Paths under `template` are relative to `cwd`. `files` is every other
 * template-dir file we found but didn't route into a specific slot — the
 * build packs them into the runtime VFS as-is.
 */
export type OpenXyzFiles = {
  cwd: string;
  template: {
    channels: Record<string, string>;
    tools: Record<string, string>;
    agents: Record<string, string>;
    /** Named `Model` instances (LanguageModel + systemPrompt). Flat namespace — `providers/<name>.ts` is merged in. */
    models: Record<string, string>;
    /** Template-provided `Drive` instances. Filename `drives/<name>.ts` → mount `/mnt/<name>/`. */
    drives: Record<string, string>;
    skills: Record<string, string>;
    /**
     * Top-level markdown injected into prompts. Keyed by the actual filename
     * (`AGENTS.md`, `SOUL.md`, `USER.md`) — no translation, no aliases.
     * Any other top-level `*.md` (except `README.md`) triggers a warning at
     * scan time so users notice typos / unsupported files. See mnemonic/121.
     */
    mds: Record<string, string>;
  };
  files: string[];
};

/**
 * Markdown files we lift out of the template root and inject into the system
 * prompt. Exact filename match — no aliases, no lowercase variants. Load
 * order lives in `buildSystemPrompt` (`agents/agent.ts`), not here.
 */
const MD_FILES = ["SOUL.md", "USER.md", "AGENTS.md"] as const;

export async function scanDir(cwd: string): Promise<OpenXyzFiles> {
  const [channels, tools, agents, models, drives, skills, files] = await Promise.all([
    scanNamed(cwd, "channels/[!_]*.{js,ts}", /\.(js|ts)$/),
    scanNamed(cwd, "tools/[!_]*.{js,ts}", /\.(js|ts)$/),
    scanNamed(cwd, "agents/[!_]*.md", /\.md$/),
    scanNamed(cwd, "models/[!_]*.{js,ts}", /\.(js|ts)$/),
    scanNamed(cwd, "drives/[!_]*.{js,ts}", /\.(js|ts)$/),
    scanSkills(cwd),
    scanFiles(cwd),
  ]);

  // Sweep top-level `*.md`. Canonicals (`MD_FILES`) load. README.md is a
  // template author's concern — skip silently, any case. Anything else
  // gets a warning so users notice typos / unsupported files instead of
  // wondering why their `Agents.md` or `notes.md` had no effect.
  const supported = new Set<string>(MD_FILES);
  const mds: Record<string, string> = {};
  for await (const entry of new Bun.Glob("*.md").scan({ cwd, onlyFiles: true })) {
    if (supported.has(entry)) {
      mds[entry] = entry;
      continue;
    }
    if (entry.toLowerCase() === "readme.md") continue;
    console.warn(`[openxyz] "${entry}" not loaded — only ${MD_FILES.join(", ")} are injected into the system prompt`);
  }

  return { cwd, template: { channels, tools, agents, models, drives, skills, mds }, files };
}

async function scanNamed(cwd: string, pattern: string, stripExt: RegExp): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for await (const path of new Bun.Glob(pattern).scan({ cwd })) {
    const name = path.split("/").pop()!.replace(stripExt, "");
    out[name] = path;
  }
  return out;
}

/** Skills are keyed by their containing directory name: `skills/<name>/SKILL.md`. */
async function scanSkills(cwd: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for await (const path of new Bun.Glob("skills/**/SKILL.md").scan({ cwd })) {
    const parts = path.split("/");
    const name = parts[parts.length - 2]!;
    out[name] = path;
  }
  return out;
}

// Agent-facing deny (`.env*`, `.openxyz/`, `.vercel/`) also enforced at runtime
// by `@openxyz/runtime/drives/filtered-fs` — keep the two lists in sync.
// Build-only noise (`node_modules/`, `.git/`, `.DS_Store`) is appended here;
// those don't need runtime enforcement, they'd just bloat the packed bundle.
const IGNORE = [
  /(^|\/)\.env/,
  /^\.openxyz(\/|$)/,
  /^\.vercel(\/|$)/,
  /^node_modules\//,
  /^\.git\//,
  /(^|\/)\.DS_Store$/,
];

/**
 * Walks the whole template dir, minus the ignore list. Anything that survives
 * the filter goes into the VFS as-is — source files, markdown, package.json,
 * plus anything else the template author chose to drop in.
 */
async function scanFiles(cwd: string): Promise<string[]> {
  const out: string[] = [];
  for await (const rel of new Bun.Glob("**/*").scan({ cwd, onlyFiles: true })) {
    if (IGNORE.some((re) => re.test(rel))) continue;
    out.push(rel);
  }
  return out;
}

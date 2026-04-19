import { join } from "node:path";
import type { Tool } from "ai";
import { OpenXyz, type OpenXyzRuntime } from "@openxyz/runtime/openxyz";
import type { Model } from "@openxyz/runtime/model";
import type { Channel } from "@openxyz/runtime/channels";
import { loadChannel } from "../load-channel";
import { parseAgent, type AgentDef } from "@openxyz/runtime/agents/factory";
import { parseSkill, type SkillDef } from "@openxyz/runtime/tools/skill";
import { createChatState } from "@openxyz/runtime/databases";
import { WorkspaceDrive } from "@openxyz/runtime/workspace";
import type { Drive } from "@openxyz/runtime/drive";
import { Command } from "commander";
import { scanDir, type OpenXyzFiles } from "../scan";
import { loadTools } from "../load-tools";
import { loadModel } from "../load-model";

export default new Command("start").option("-p, --port <port>", "Port to listen on").action(action);

async function action(): Promise<void> {
  const files = await scanDir(process.cwd());
  if (Object.keys(files.template.channels).length === 0) {
    console.error("[openxyz] no channels found under channels/*.{js,ts} — nothing to run");
    process.exit(1);
  }

  const runtime = await loadRuntime(files);
  const openxyz = new OpenXyz(runtime);
  const state = await createChatState(runtime.cwd);
  await openxyz.init({ state });
  console.log("openxyz running. Ctrl-C to quit.");

  await new Promise<void>((resolve) => {
    process.on("SIGINT", resolve);
    process.on("SIGTERM", resolve);
  });

  await openxyz.stop();
  process.exit(0);
}

/**
 * Turn a filesystem enumeration into an `OpenXyzTemplate` by dynamically
 * importing modules, reading markdown, and parsing frontmatter.
 *
 * `openxyz build` doesn't call this — it code-gens static imports from the
 * same `OpenXyzFiles` shape instead.
 */
async function loadRuntime(scan: OpenXyzFiles): Promise<OpenXyzRuntime> {
  const abs = (p: string) => join(scan.cwd, p);
  const t = scan.template;

  const channels: Record<string, Channel> = {};
  for (const [name, path] of Object.entries(t.channels)) {
    const mod = await import(abs(path));
    channels[name] = loadChannel(mod, name);
  }

  const tools: Record<string, Tool> = {};
  const cleanup: Array<() => Promise<void>> = [];
  for (const [name, path] of Object.entries(t.tools)) {
    const mod = await import(abs(path));
    const expanded = await loadTools(name, mod);
    for (const [id, tool] of Object.entries(expanded.tools)) {
      if (tools[id]) {
        console.warn(`[openxyz] tool id "${id}" defined by multiple files, last one wins`);
      }
      tools[id] = tool;
    }
    if (expanded.cleanup) cleanup.push(expanded.cleanup);
  }

  // TODO: add a toggle so templates can opt out of shipped agents.
  const agents: Record<string, AgentDef> = { ...(await loadDefaultAgents()) };
  for (const [name, path] of Object.entries(t.agents)) {
    const raw = await Bun.file(abs(path)).text();
    const def = parseAgent(name, raw);
    if (def) agents[name] = def;
  }

  // Walk every agent → set of model names we need to load. Zod schema
  // defaults `model` to "auto", so it's always a string post-parse.
  const used = new Set<string>();
  for (const def of Object.values(agents)) {
    used.add(def.model);
  }

  const models: Record<string, Model> = {};
  for (const name of used) {
    const path = t.models[name]
      ? abs(t.models[name]!)
      : name === "auto"
        ? new URL("../../models/auto.ts", import.meta.url).pathname
        : undefined;
    if (!path) continue; // referenced but no source — surfaces clearly when an agent picks it
    const mod = await import(path);
    if (!mod.default) {
      console.warn(`[openxyz] models/${name} has no default export, skipping`);
      continue;
    }
    // Convert the whole module — loadModel reads `default` (awaiting if
    // it's a factory) plus optional `systemPrompt` / `limit` named
    // exports. Runtime only sees the canonical `Model` wrapper.
    models[name] = await loadModel(mod);
  }

  const skills: SkillDef[] = [];
  for (const path of Object.values(t.skills)) {
    const raw = await Bun.file(abs(path)).text();
    const info = parseSkill(abs(path), raw);
    if (info) skills.push(info);
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));

  const mds: { agents?: string } = {};
  if (t.mds.agents) mds.agents = await Bun.file(abs(t.mds.agents)).text();

  // Drives: WorkspaceDrive is always mounted at /workspace. Template-provided
  // `drives/<name>.ts` files mount at `/mnt/<name>/`.
  const drives: Record<string, Drive> = {
    "/workspace": new WorkspaceDrive(scan.cwd, "read-write"),
  };
  for (const [name, path] of Object.entries(t.drives)) {
    const mod = await import(abs(path));
    if (!mod.default) {
      console.warn(`[openxyz] drives/${name} has no default export, skipping`);
      continue;
    }
    drives[`/mnt/${name}`] = mod.default as Drive;
  }

  return { cwd: scan.cwd, channels, tools, agents, models, drives, skills, mds, cleanup };
}

/**
 * Load the openxyz-shipped default agents (auto, explore, research, compact)
 * from `packages/openxyz/agents/*.md`. Parsed via `parseAgent` — same code
 * path as template agents, so schema rules apply uniformly.
 */
async function loadDefaultAgents(): Promise<Record<string, AgentDef>> {
  const dir = new URL("../../agents/", import.meta.url).pathname;
  const out: Record<string, AgentDef> = {};
  for await (const file of new Bun.Glob("*.md").scan({ cwd: dir })) {
    const name = file.replace(/\.md$/, "");
    const raw = await Bun.file(join(dir, file)).text();
    const def = parseAgent(name, raw);
    if (def) out[name] = def;
  }
  return out;
}

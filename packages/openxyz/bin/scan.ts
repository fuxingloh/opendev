import { join } from "node:path";
import { existsSync } from "node:fs";
import type { Tool } from "ai";
import type { ChannelFile } from "@openxyz/harness/channels";
import type { AgentDef } from "@openxyz/harness/agents/factory";
import type { SkillInfo } from "@openxyz/harness/tools/skill";
import type { OpenXyzTemplate } from "@openxyz/harness/openxyz";
import { buildChannelFile } from "@openxyz/harness/channels";
import { parseAgent } from "@openxyz/harness/agents/factory";
import { parseSkill } from "@openxyz/harness/tools/skill";

export async function scanTemplate(cwd: string): Promise<OpenXyzTemplate> {
  const [channels, tools, agents, skills, agentsmd] = await Promise.all([
    scanChannels(cwd),
    scanTools(cwd),
    scanAgents(cwd),
    scanSkills(cwd),
    loadAgentsMd(cwd),
  ]);
  return { cwd, channels, tools, agents, skills, agentsmd };
}

export async function scanChannels(cwd: string): Promise<Record<string, ChannelFile>> {
  const glob = new Bun.Glob("channels/[!_]*.ts");
  const channels: Record<string, ChannelFile> = {};
  for await (const path of glob.scan({ cwd })) {
    const name = path.split("/").pop()!.replace(/\.ts$/, "");
    const mod = await import(join(cwd, path));
    channels[name] = buildChannelFile(mod, name);
  }
  return channels;
}

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

export async function scanAgents(cwd: string): Promise<Record<string, AgentDef>> {
  const dir = join(cwd, "agents");
  if (!existsSync(dir)) return {};
  const glob = new Bun.Glob("[!_]*.md");
  const agents: Record<string, AgentDef> = {};
  for await (const rel of glob.scan({ cwd: dir })) {
    const name = rel.replace(/\.md$/, "");
    const raw = await Bun.file(join(dir, rel)).text();
    const def = parseAgent(name, raw);
    if (def) agents[name] = def;
  }
  return agents;
}

export async function scanSkills(cwd: string): Promise<SkillInfo[]> {
  const glob = new Bun.Glob("skills/**/SKILL.md");
  const skills: SkillInfo[] = [];
  for await (const rel of glob.scan({ cwd })) {
    const abs = join(cwd, rel);
    const raw = await Bun.file(abs).text();
    const info = parseSkill(abs, raw);
    if (info) skills.push(info);
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadAgentsMd(cwd: string): Promise<string | undefined> {
  const path = join(cwd, "AGENTS.md");
  if (!existsSync(path)) return undefined;
  return Bun.file(path).text();
}

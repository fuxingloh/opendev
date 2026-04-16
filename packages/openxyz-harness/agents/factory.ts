import { ToolLoopAgent, tool, stepCountIs } from "ai";
import type { Tool } from "ai";
import { z } from "zod";
import { matter } from "../utils/frontmatter";
import { createSkillTool, type SkillDef } from "../tools/skill";
import { FilesystemTools, FilesystemConfigSchema } from "../tools/filesystem";
import { web_fetch, web_search } from "../tools/web";
import type { OpenXyzRuntime } from "../openxyz";

import basePrompt from "./prompts/openxyz.md" with { type: "text" };

const AgentFrontmatterSchema = z.object({
  name: z.string(),
  description: z.string(),
  skills: z.array(z.string()).optional(),
  tools: z
    .record(z.string(), z.union([z.literal(true), z.literal(false), z.record(z.string(), z.unknown())]))
    .optional(),
  filesystem: FilesystemConfigSchema,
  /** Name from the models. Falls back to "auto" when omitted. */
  model: z.string().default("auto"),
});

const AgentDefSchema = AgentFrontmatterSchema.extend({
  content: z.string(),
});

export type AgentDef = z.infer<typeof AgentDefSchema>;

function formatSkillsXml(skills: SkillDef[]): string {
  return [
    "<available_skills>",
    ...skills.map((s) =>
      [`  <skill>`, `    <name>${s.name}</name>`, `    <description>${s.description}</description>`, `  </skill>`].join(
        "\n",
      ),
    ),
    "</available_skills>",
  ].join("\n");
}

function formatAgentList(defs: Record<string, AgentDef>): string {
  return Object.values(defs)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((a) => `- **${a.name}**: ${a.description}`)
    .join("\n");
}

export function parseAgent(name: string, raw: string): AgentDef | undefined {
  const { data, content } = matter(raw);
  const result = AgentDefSchema.safeParse({ ...data, name, content: content.trim() });
  if (!result.success) {
    console.warn(
      `[openxyz] agent "${name}" invalid frontmatter: ${result.error.issues.map((i) => i.message).join(", ")}`,
    );
    return undefined;
  }
  return result.data;
}

export class AgentFactory {
  readonly #runtime: OpenXyzRuntime;

  constructor(runtime: OpenXyzRuntime) {
    this.#runtime = runtime;
  }

  async create(name: string, opts?: { delegate?: boolean }): Promise<ToolLoopAgent> {
    const def = this.#runtime.agents[name];
    if (!def) {
      const available = Object.keys(this.#runtime.agents).join(", ");
      throw new Error(`[openxyz] agent "${name}" not found. Available: ${available}`);
    }

    const modelName = def.model;
    const model = this.#runtime.models[modelName];
    if (!model) {
      const available = Object.keys(this.#runtime.models).join(", ") || "<none>";
      throw new Error(`[openxyz] agent "${name}" references model "${modelName}" — not found. Available: ${available}`);
    }

    const tools = this.#loadTools(def);
    if (opts?.delegate !== false) {
      tools.delegate = this.#createDelegateTool();
    }

    const skills = this.#filterSkills(def);
    const instructions = this.#buildInstructions(def, tools, skills);

    // Step budget: hardcoded 100 as runaway safety net.
    //  Final step forces text-only response so the agent summarizes rather than cutting off.
    const maxSteps = 100;

    return new ToolLoopAgent({
      model,
      instructions: { role: "system" as const, content: instructions },
      tools,
      stopWhen: stepCountIs(maxSteps),
      prepareStep: ({ stepNumber }) => {
        if (stepNumber >= maxSteps - 1) {
          return {
            toolChoice: "none",
            system: [
              {
                role: "system",
                content: `You've reached the maximum step budget (${maxSteps}). Summarize what you did and respond to the user without calling any more tools.`,
              },
            ],
          };
        }
        return undefined;
      },
    });
  }

  #createDelegateTool() {
    const factory = this;

    return tool({
      description: [
        "Delegate work to a specialized agent that runs in its own context.",
        "",
        "Use this when:",
        "- You need to research multiple things in parallel",
        "- A task benefits from a fresh, focused context",
        "- A specialized agent exists for the work",
        "",
        "Each delegated task runs independently — it cannot see your conversation history.",
        "Launch multiple delegate calls in parallel when the work is independent.",
        "",
        "## Available Agents",
        // TODO(?): allow agents to agents communication to be configurable
        formatAgentList(factory.#runtime.agents),
      ].join("\n"),
      inputSchema: z.object({
        description: z.string().describe("Short (3-5 words) task description."),
        prompt: z.string().describe("Full task prompt for the agent."),
        agent: z.string().default("auto").describe("Agent name. Defaults to 'auto'."),
      }),
      execute: async ({ description, prompt, agent: name }) => {
        const sub = await factory.create(name, { delegate: false });
        const result = await sub.generate({ prompt });
        return `<delegate_result agent="${name}" description="${description}">\n${result.text}\n</delegate_result>`;
      },
    });
  }

  #loadTools(def: AgentDef): Record<string, Tool> {
    const fs = new FilesystemTools(this.#runtime.cwd, def.filesystem);
    const all: Record<string, Tool> = {
      ...fs.tools(),
      web_fetch,
      web_search,
      skill: createSkillTool(this.#filterSkills(def)),
      ...this.#runtime.tools,
    };

    if (!def.tools) return all;

    const filtered: Record<string, Tool> = {};
    for (const [name, config] of Object.entries(def.tools)) {
      if (config && all[name]) {
        filtered[name] = all[name];
      }
    }
    return filtered;
  }

  #filterSkills(def: AgentDef): SkillDef[] {
    if (def.skills === undefined) return this.#runtime.skills;
    if (def.skills.length === 0) return [];
    const set = new Set(def.skills);
    return this.#runtime.skills.filter((s) => set.has(s.name));
  }

  #buildInstructions(def: AgentDef, tools: Record<string, Tool>, skills: SkillDef[]): string {
    // Order: stable prefix first (basePrompt + AGENTS.md), then per-agent sections (skills, env, body)
    const parts = [basePrompt];

    if (this.#runtime.mds?.agents) {
      parts.push("## Project Instructions\n\n" + this.#runtime.mds.agents.trim());
    }

    if (skills.length > 0 && tools["skill"]) {
      parts.push(
        [
          "## Skills",
          "",
          "Skills provide specialized instructions for recurring tasks. When you recognize that a task matches one of the available skills below, use the `skill` tool to load the full instructions before proceeding.",
          "",
          formatSkillsXml(skills),
        ].join("\n"),
      );
    }

    const fsConfig = def.filesystem;
    const access = typeof fsConfig === "string" ? fsConfig : (fsConfig?.["harness"] ?? "read-write");
    parts.push(["## Environment", "", `- Home: /home/openxyz`, `- Filesystem: ${access}`].join("\n"));

    if (def.content) {
      parts.push(def.content);
    }

    return parts.join("\n\n");
  }
}

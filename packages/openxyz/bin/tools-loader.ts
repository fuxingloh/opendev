import type { Tool } from "ai";
import { isMCPServer, type MCPServer } from "../tools/mcp";

export type ExpandedTools = {
  tools: Record<string, Tool>;
  /** MCP clients or similar need teardown. Undefined when the module had nothing to close. */
  cleanup?: () => Promise<void>;
};

/**
 * Resolve a single `tools/<name>.ts` module into a flat tool map + optional
 * cleanup. Called by `openxyz start` directly and by the generated `openxyz
 * build` entrypoint via `openxyz/_runtime`. Tool-id convention:
 *
 * - default `tool({})`    → `tools[name]`
 * - default `mcp({})`     → `tools[name + "_" + serverToolName]` for each server tool
 * - named `export const X = tool({})` → `tools[name + "_" + X]`
 *
 * Multiple shapes can coexist in one file (default + named, or MCP default +
 * named locals). Collisions throw so the template author sees the problem
 * before the agent does.
 */
export async function expandToolModule(name: string, mod: Record<string, unknown>): Promise<ExpandedTools> {
  const tools: Record<string, Tool> = {};
  let cleanup: (() => Promise<void>) | undefined;

  const def = mod.default;
  if (def !== undefined) {
    if (isMCPServer(def)) {
      const result = await loadMCPServer(name, def);
      Object.assign(tools, result.tools);
      cleanup = result.cleanup;
    } else if (isTool(def)) {
      tools[name] = def as Tool;
    } else {
      throw new Error(`[openxyz] tools/${name} default export is not a tool() or mcp() — got ${describe(def)}`);
    }
  }

  for (const [key, val] of Object.entries(mod)) {
    if (key === "default") continue;
    if (!isTool(val)) continue;
    const id = `${name}_${key}`;
    if (tools[id]) {
      throw new Error(`[openxyz] tools/${name} collision: "${id}" defined twice`);
    }
    tools[id] = val as Tool;
  }

  return { tools, cleanup };
}

async function loadMCPServer(name: string, server: MCPServer): Promise<ExpandedTools> {
  const { createMCPClient } = await import("@ai-sdk/mcp");

  const transport =
    server.type === "stdio"
      ? await stdioTransport(server)
      : {
          type: (server.type ?? "http") as "http" | "sse",
          url: server.url,
          headers: server.headers,
        };

  const client = await createMCPClient({
    transport,
    name: `openxyz-${name}`,
  });

  const serverTools = await client.tools();
  const tools: Record<string, Tool> = {};
  for (const [toolName, t] of Object.entries(serverTools)) {
    tools[`${name}_${toolName}`] = t as Tool;
  }

  return {
    tools,
    cleanup: async () => {
      try {
        await client.close();
      } catch (err) {
        console.warn(`[openxyz] mcp ${name} close failed`, err);
      }
    },
  };
}

// Stdio transport ships in the `@ai-sdk/mcp/mcp-stdio` subpath. Loading it
// lazily keeps the stdio dependency tree out of cold-start paths on serverless
// deployments that only use remote transports.
async function stdioTransport(server: Extract<MCPServer, { type: "stdio" }>) {
  const stdio = (await import("@ai-sdk/mcp/mcp-stdio")) as {
    Experimental_StdioMCPTransport: new (cfg: {
      command: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;
    }) => unknown;
  };
  return new stdio.Experimental_StdioMCPTransport({
    command: server.command,
    args: server.args,
    env: server.env,
    cwd: server.cwd,
  }) as never;
}

// A Tool from `ai`'s `tool()` helper is a plain object with `inputSchema` and
// (usually) `execute`. The `type` field is set to `"function"` or `"dynamic"`.
// We check loosely — false positives on hand-rolled objects are fine; the
// agent will fail loudly on call.
function isTool(v: unknown): boolean {
  return typeof v === "object" && v !== null && "inputSchema" in (v as object);
}

function describe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

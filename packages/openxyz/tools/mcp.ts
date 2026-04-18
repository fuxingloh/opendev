/**
 * `mcp()` helper — template authors place MCP server configs under
 * `tools/<name>.ts`. The filename becomes the tool-id prefix: a server exposing
 * `query` at `tools/nocodb.ts` lands in the agent's tool list as `nocodb_query`.
 *
 * At build/scan time nothing happens — the helper just returns a branded
 * config. The actual connect + `client.tools()` + close lifecycle runs at
 * runtime boot, inside the openxyz tool loader. This keeps credentials out of
 * `openxyz build` (no network, no env leaking into the generated bundle).
 *
 * Remote (streamable HTTP, SSE) is the recommended transport for deployed
 * functions. Stdio forks a child process per cold start and is local-dev-first
 * — see mnemonic/080 for the Vercel suspend/resume open question.
 */

const MCP_BRAND = Symbol.for("openxyz.mcp");

export type MCPRemoteConfig = {
  /**
   * MCP transport type. `"http"` is the current streamable HTTP transport;
   * `"sse"` is the legacy Server-Sent Events transport still supported by
   * some servers. Default: `"http"`.
   */
  type?: "http" | "sse";
  /** The URL of the MCP server. */
  url: string;
  /** Additional HTTP headers (auth tokens, custom headers). */
  headers?: Record<string, string>;
};

export type MCPStdioConfig = {
  type: "stdio";
  /** Executable to spawn (e.g. `"npx"`, `"bun"`, absolute path). */
  command: string;
  /** Arguments passed to the executable. */
  args?: string[];
  /** Environment variables. Parent env is NOT inherited — pass what the server needs. */
  env?: Record<string, string>;
  /** Working directory for the spawned process. */
  cwd?: string;
};

export type MCPConfig = MCPRemoteConfig | MCPStdioConfig;

export type MCPServer = MCPConfig & { readonly [MCP_BRAND]: true };

export function mcp(config: MCPConfig): MCPServer {
  return { ...config, [MCP_BRAND]: true } as MCPServer;
}

export function isMCPServer(value: unknown): value is MCPServer {
  return typeof value === "object" && value !== null && (value as Record<PropertyKey, unknown>)[MCP_BRAND] === true;
}

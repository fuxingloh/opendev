import { Command } from "commander";
import { createOpencode, createOpencodeTui } from "@opencode-ai/sdk";
import { createInterface } from "node:readline/promises";
import { dirname, join } from "node:path";
import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;

export default new Command("start").option("-p, --port <port>", "Port to listen on").action(action);

export async function action(options: { port?: string }): Promise<void> {
  const cwd = process.cwd();
  loadEnvConfig(cwd);

  // Resolve the opencode binary from the opencode-ai package so it doesn't need to be in $PATH
  const opencodePkg = import.meta.resolve?.("opencode-ai/package.json") ?? require.resolve("opencode-ai/package.json");
  const opencodeBinDir = join(dirname(opencodePkg.replace("file://", "")), "bin");
  process.env.PATH = `${opencodeBinDir}:${process.env.PATH}`;

  const { client, server } = await createOpencode();

  // Create a session
  const { data: session } = await client.session.create();
  if (!session) {
    console.error("Failed to create session");
    server.close();
    process.exit(1);
  }

  // Subscribe to SSE events for streaming responses
  const { stream } = await client.event.subscribe();
  (async () => {
    for await (const event of stream) {
      if (event.type === "message.part.updated" && event.properties.part.type === "text") {
        if (event.properties.delta) {
          process.stdout.write(event.properties.delta);
        }
      }
    }
  })();

  // Prompt loop
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const input = await rl.question("\n> ");
      if (!input.trim()) continue;
      if (input.trim() === "/quit") break;

      await client.session.prompt({
        path: { id: session.id },
        body: {
          parts: [{ type: "text", text: input }],
        },
      });
      console.log(); // newline after streamed response
    }
  } catch {
    // readline closed (Ctrl+D)
  } finally {
    rl.close();
    server.close();
  }
}

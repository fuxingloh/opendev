import { Command } from "commander";
import { createOpencode, createOpencodeTui } from "@opencode-ai/sdk";
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

  // Launch the TUI with stdio inherited so the user can interact
  const tui = createOpencodeTui({ project: cwd });

  // When the TUI exits, shut down the server
  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => {
      tui.close();
      server.close();
      resolve();
    });
  });
}

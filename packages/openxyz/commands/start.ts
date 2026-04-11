import { start } from "@openxyz/harness/start";
import { Command } from "commander";

export default new Command("start").option("-p, --port <port>", "Port to listen on").action(action);

async function action(): Promise<void> {
  const handle = await start({ cwd: process.cwd() });
  console.log("openxyz running. Ctrl-C to quit.");

  await new Promise<void>((resolve) => {
    process.on("SIGINT", resolve);
    process.on("SIGTERM", resolve);
  });

  await handle.stop();
  process.exit(0);
}

import { OpenXyz } from "@openxyz/harness/openxyz";
import { Command } from "commander";

export default new Command("start").option("-p, --port <port>", "Port to listen on").action(action);

async function action(): Promise<void> {
  const openxyz = new OpenXyz({ cwd: process.cwd() });
  await openxyz.start();
  console.log("openxyz running. Ctrl-C to quit.");

  await new Promise<void>((resolve) => {
    process.on("SIGINT", resolve);
    process.on("SIGTERM", resolve);
  });

  await openxyz.stop();
  process.exit(0);
}

import { Command } from "commander";
import { buildVercel } from "../build";

export default new Command("build")
  .description("Build the openxyz agent for deployment")
  .option("--output <type>", "Output target: 'vercel'", "vercel")
  .action(action);

type Opts = { output: string };

async function action(opts: Opts): Promise<void> {
  const cwd = process.cwd();
  process.env.NODE_ENV = "production";

  const target = opts.output ?? (process.env.VERCEL === "1" ? "vercel" : "vercel");
  if (target !== "vercel") {
    console.error(`[openxyz] unsupported --output '${target}'. Only 'vercel' is supported in v1.`);
    process.exit(1);
  }

  console.log(`▶ Building for Vercel...`);
  await buildVercel(cwd);
}

import { Command } from "commander";
import { build, PLATFORMS, type Platform } from "../build";

export default new Command("build")
  .description("Build the openxyz agent for deployment")
  .option("--platform <name>", `Deployment platform: ${PLATFORMS.join(" | ")}`, "vercel")
  .action(action);

type Opts = { platform: string };

async function action(opts: Opts): Promise<void> {
  const cwd = process.cwd();
  process.env.NODE_ENV = "production";

  const platform = opts.platform as Platform;
  if (!PLATFORMS.includes(platform)) {
    console.error(`[openxyz] unsupported --platform '${platform}'. Expected one of: ${PLATFORMS.join(", ")}.`);
    process.exit(1);
  }

  await build(cwd, platform);
}

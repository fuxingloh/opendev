import { Command } from "commander";
import { build, detectPlatform, PLATFORMS, type Platform } from "../build";

export default new Command("build")
  .description("Build the openxyz agent for deployment")
  .option("--platform <name>", `Deployment platform: ${PLATFORMS.join(" | ")} (auto-detected from CI env)`)
  .action(action);

type Opts = { platform?: string };

async function action(opts: Opts): Promise<void> {
  const cwd = process.cwd();
  process.env.NODE_ENV = "production";

  // Explicit `--platform` wins; otherwise sniff CI env (Vercel sets `VERCEL=1`,
  // Cloudflare Pages sets `CF_PAGES=1`, Workers Builds sets `WORKERS_CI`).
  // Local dev with no flag defaults to `vercel` for backwards compatibility
  // with templates whose `package.json` predates `--platform`.
  const platform: Platform = (opts.platform as Platform | undefined) ?? detectPlatform() ?? "vercel";

  if (!PLATFORMS.includes(platform)) {
    console.error(`[openxyz] unsupported --platform '${platform}'. Expected one of: ${PLATFORMS.join(", ")}.`);
    process.exit(1);
  }

  if (!opts.platform) {
    const auto = detectPlatform();
    if (auto) console.log(`[openxyz] auto-detected --platform ${auto} from CI env`);
  }

  await build(cwd, platform);
}

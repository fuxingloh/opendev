import { buildVercel } from "./vercel";
import { buildCloudflare } from "./cloudflare";

export type Platform = "vercel" | "cloudflare";

export const PLATFORMS: readonly Platform[] = ["vercel", "cloudflare"] as const;

/**
 * Detect the deploy platform from CI environment variables. `--platform`
 * always wins if set explicitly. CI signals checked:
 *
 *  - **Cloudflare**: `CF_PAGES` (Pages), `WORKERS_CI` (Workers Builds), or
 *    `CLOUDFLARE_ACCOUNT_ID` set alongside no Vercel signal.
 *  - **Vercel**: `VERCEL=1`.
 *
 * Returns `undefined` when nothing matches — callers decide a default.
 */
export function detectPlatform(env: NodeJS.ProcessEnv = process.env): Platform | undefined {
  const isCloudflare = env.CF_PAGES === "1" || env.WORKERS_CI === "1" || env.WORKERS_CI === "true";
  const isVercel = env.VERCEL === "1";
  if (isCloudflare && isVercel) {
    // Both set — bail to explicit. This is almost certainly a misconfigured
    // env, not a real "deploying to both" scenario.
    return undefined;
  }
  if (isCloudflare) return "cloudflare";
  if (isVercel) return "vercel";
  return undefined;
}

export async function build(cwd: string, platform: Platform): Promise<void> {
  if (platform === "vercel") {
    console.log("▶ Building for Vercel...");
    await buildVercel(cwd);
    return;
  }
  if (platform === "cloudflare") {
    console.log("▶ Building for Cloudflare Workers...");
    await buildCloudflare(cwd);
    return;
  }
  throw new Error(`[openxyz] unknown platform: ${platform}`);
}

export { buildVercel, buildCloudflare };

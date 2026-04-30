import { buildVercel } from "./vercel";
import { buildCloudflare } from "./cloudflare";

export type Platform = "vercel" | "cloudflare";

export const PLATFORMS: readonly Platform[] = ["vercel", "cloudflare"] as const;

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

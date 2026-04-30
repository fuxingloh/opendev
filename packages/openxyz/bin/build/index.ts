import { buildVercel } from "./vercel";

export type Platform = "vercel" | "cloudflare";

export const PLATFORMS: readonly Platform[] = ["vercel", "cloudflare"] as const;

export async function build(cwd: string, platform: Platform): Promise<void> {
  if (platform === "vercel") {
    console.log("▶ Building for Vercel...");
    await buildVercel(cwd);
    return;
  }
  if (platform === "cloudflare") {
    // mnemonic/133 piece 4 lands the real impl
    throw new Error(
      "[openxyz] --platform cloudflare is not implemented yet. " + "See mnemonic/133 for the migration plan.",
    );
  }
  throw new Error(`[openxyz] unknown platform: ${platform}`);
}

export { buildVercel };

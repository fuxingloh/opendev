import { join } from "node:path";

export interface ChannelScan {
  adapters: Record<string, unknown>;
  allowlists: Record<string, Set<string>>;
}

export async function scanChannels(cwd: string): Promise<ChannelScan> {
  const glob = new Bun.Glob("channels/*.ts");
  const adapters: Record<string, unknown> = {};
  const allowlists: Record<string, Set<string>> = {};

  for await (const rel of glob.scan({ cwd })) {
    const file = rel.split("/").pop()!;
    if (file.startsWith("_")) continue;
    const name = file.replace(/\.ts$/, "");
    const mod = await import(join(cwd, rel));
    if (!mod.default) {
      console.warn(`[openxyz] channels/${file} has no default export, skipping`);
      continue;
    }
    adapters[name] = mod.default;
    if (mod.allowlist) {
      allowlists[name] = new Set(mod.allowlist);
    }
  }

  return { adapters, allowlists };
}

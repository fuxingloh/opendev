import type { BunPlugin } from "bun";

/**
 * Vercel-target build plugin — strips the local-libsql fallback from
 * `createChatState` so a misconfigured deploy fails loudly at first
 * cold-start instead of silently writing to Vercel's read-only cwd
 * (mnemonic/067). Either `TURSO_DATABASE_URL` or `REDIS_URL` must be set.
 */
export function forceRemoteStatePlugin(): BunPlugin {
  const dbDir = new URL("../../../../openxyz-runtime/databases/", import.meta.url).pathname;
  const indexPath = dbDir + "index.ts";
  const libsqlPath = dbDir + "libsql.ts";
  const redisPath = dbDir + "redis.ts";

  return {
    name: "openxyz-force-remote-state",
    setup(build) {
      build.onLoad({ filter: /[\\/]databases[\\/]index\.ts$/ }, (args) => {
        if (args.path !== indexPath) return;
        return {
          loader: "ts",
          contents: [
            `import { createRedisState } from ${JSON.stringify(redisPath)};`,
            `import { createTursoState } from ${JSON.stringify(libsqlPath)};`,
            ``,
            `export async function createChatState() {`,
            `  const tursoUrl = process.env.TURSO_DATABASE_URL;`,
            `  if (tursoUrl && tursoUrl.length > 0) {`,
            `    console.log("[openxyz] state: Turso");`,
            `    return createTursoState(tursoUrl, process.env.TURSO_AUTH_TOKEN);`,
            `  }`,
            `  const redisUrl = process.env.REDIS_URL;`,
            `  if (redisUrl && redisUrl.length > 0) {`,
            `    console.log("[openxyz] state: Redis");`,
            `    return createRedisState(redisUrl);`,
            `  }`,
            `  throw new Error(`,
            `    "[openxyz] Vercel deploy requires a remote state adapter. Set TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN) or REDIS_URL."`,
            `  );`,
            `}`,
          ].join("\n"),
        };
      });
    },
  };
}

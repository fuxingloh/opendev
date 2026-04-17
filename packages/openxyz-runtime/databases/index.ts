import { createPgliteState } from "./pglite";
import { createPgState } from "./pg";
import { createRedisState } from "./redis";

/**
 * Pick the chat-sdk state adapter based on env.
 *
 * - `REDIS_URL` → Redis (preferred for serverless; reconnects cleanly).
 * - `PG_DATABASE_POSTGRES_URL` → Postgres.
 * - else → PGlite on disk (local dev / ephemeral Vercel `/tmp`).
 */
export async function createChatState(cwd: string) {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl && redisUrl.length > 0) {
    console.log("[openxyz] state: Redis");
    return createRedisState(redisUrl);
  }
  const pgUrl = process.env.PG_DATABASE_POSTGRES_URL;
  if (pgUrl && pgUrl.length > 0) {
    console.log("[openxyz] state: Postgres");
    return createPgState(pgUrl);
  }
  console.log("[openxyz] state: PGlite");
  return createPgliteState(cwd);
}

export { createPgliteState, createPgState, createRedisState };

import { createLocalLibSqlState, createTursoState } from "./libsql";
import { createRedisState } from "./redis";

/**
 * Pick the chat-sdk state adapter based on env.
 *
 * - `TURSO_DATABASE_URL` (+ optional `TURSO_AUTH_TOKEN`) → Turso (libsql remote).
 * - `REDIS_URL` → Redis.
 * - else → local libsql sqlite at `{cwd}/.openxyz/data/chat-state.db`.
 */
export async function createChatState(cwd: string) {
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  if (tursoUrl && tursoUrl.length > 0) {
    console.log("[openxyz] state: Turso");
    return createTursoState(tursoUrl, process.env.TURSO_AUTH_TOKEN);
  }
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl && redisUrl.length > 0) {
    console.log("[openxyz] state: Redis");
    return createRedisState(redisUrl);
  }
  console.log("[openxyz] state: libsql (local sqlite)");
  return createLocalLibSqlState(cwd);
}

export { createLocalLibSqlState, createRedisState, createTursoState };

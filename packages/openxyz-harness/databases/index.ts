import { createPgState } from "./pg";

/**
 * Pick the chat-sdk state adapter based on env.
 *
 * NOTE: PGlite temporarily disabled — diagnosing a Vercel `ReadOnlyFileSystem`
 * crash. If `PG_DATABASE_POSTGRES_URL` isn't set we fail fast instead of
 * falling back to PGlite. Restore the `./pglite` import once we've confirmed
 * whether PGlite's WASM was the culprit.
 */
export async function createChatState(_cwd: string) {
  const url = process.env.PG_DATABASE_POSTGRES_URL;
  if (url && url.length > 0) {
    console.log("[openxyz] state: Postgres");
    return createPgState(url);
  }
  throw new Error("[openxyz] PG_DATABASE_POSTGRES_URL not set — PGlite fallback temporarily disabled");
}

export { createPgState };

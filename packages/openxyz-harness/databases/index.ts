import { createPgliteState } from "./pglite";
import { createPgState } from "./pg";

/**
 * Pick the chat-sdk state adapter based on env.
 */
export async function createChatState(cwd: string) {
  const url = process.env.PG_DATABASE_POSTGRES_URL;
  if (url && url.length > 0) {
    console.log("[openxyz] state: Postgres");
    return createPgState(url);
  }
  console.log("[openxyz] state: PGlite");
  return createPgliteState(cwd);
}

export { createPgliteState, createPgState };

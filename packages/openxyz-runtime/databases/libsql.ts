import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createLibSqlState } from "@chat-adapter/state-libsql";

export function createTursoState(url: string, authToken?: string) {
  return createLibSqlState({ url, authToken });
}

export async function createLocalLibSqlState(cwd: string) {
  const dataDir = join(cwd, ".openxyz", "data");
  await mkdir(dataDir, { recursive: true });
  return createLibSqlState({ url: `file:${join(dataDir, "chat-state.db")}` });
}

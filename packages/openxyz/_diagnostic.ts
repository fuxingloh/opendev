// Diagnostic module for bisecting the Vercel `ReadOnlyFileSystem` crash.
// Lives in the openxyz package because this is the dir where every suspect
// (openxyz own deps + harness transitive deps hoisted in the monorepo) is
// reachable via node resolution. The generated entrypoint imports this.
// Safe to delete once the crash is understood.

export async function runBisect(): Promise<void> {
  console.log("[stage] 0 _diagnostic.ts top");

  console.log("[stage] 1 importing @openxyz/harness/openxyz …");
  await import("@openxyz/harness/openxyz");
  console.log("[stage] 1 ok");

  console.log("[stage] 2 importing @openxyz/harness/channels …");
  await import("@openxyz/harness/channels");
  console.log("[stage] 2 ok");

  console.log("[stage] 3 importing @openxyz/harness/agents/factory …");
  await import("@openxyz/harness/agents/factory");
  console.log("[stage] 3 ok");

  console.log("[stage] 4 importing @openxyz/harness/tools/skill …");
  await import("@openxyz/harness/tools/skill");
  console.log("[stage] 4 ok");

  console.log("[stage] 5 importing @openxyz/harness/databases …");
  await import("@openxyz/harness/databases");
  console.log("[stage] 5 ok");

  console.log("[stage] 6 importing @chat-adapter/telegram …");
  await import("@chat-adapter/telegram");
  console.log("[stage] 6 ok");

  console.log("[stage] 7 importing chat …");
  await import("chat");
  console.log("[stage] 7 ok");

  console.log("[stage] 8 importing ai …");
  await import("ai");
  console.log("[stage] 8 ok");

  console.log("[stage] 9 importing @ai-sdk/amazon-bedrock …");
  await import("@ai-sdk/amazon-bedrock");
  console.log("[stage] 9 ok");

  console.log("[stage] 10 importing @ai-sdk/openai-compatible …");
  await import("@ai-sdk/openai-compatible");
  console.log("[stage] 10 ok");

  // Note: pg, just-bash, @chat-adapter/state-pg are harness-only deps and
  // aren't reachable via bare specifier from this package. They're pulled in
  // transitively when stages 1–5 (harness modules) evaluate. If a crash
  // happens during those stages, one of these is the likely cause.

  console.log("[stage] all imports resolved");
}

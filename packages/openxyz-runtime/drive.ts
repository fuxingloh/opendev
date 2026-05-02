import type { IFileSystem } from "just-bash";

export type Permission = "read-write" | "read-only";

/**
 * A mount point in the agent's filesystem. Drives expose an `IFileSystem`
 * (not `extends` it — delegation overhead) and optional lifecycle hooks.
 *
 * ### Lifecycle (per agent turn)
 *
 * 1. `refresh()` — optional pre-turn hook. For remote-backed drives this is
 *    where you sync down fresh data (e.g. `git pull` for GitHubDrive,
 *    re-list Notion pages, etc.). Runs once per user message before the
 *    agent loop starts. Lazy-init fits here: on first call, clone; on
 *    subsequent calls, fast-forward.
 * 2. `fs()` — return the underlying filesystem for this turn's
 *    `FilesystemTools`. Called after `refresh` resolves, so the filesystem
 *    may be lazy-constructed. Throwing from `fs()` is fine if `refresh`
 *    hasn't set things up yet.
 * 3. Agent runs, reads/writes via the mounted filesystem.
 * 4. `commit(ctx)` — optional post-turn hook. Writable drives flush changes
 *    here (e.g. commit + push for GitHubDrive). Runs after the reply is
 *    posted to the thread. `ctx.getSummary()` returns a short LLM-authored
 *    natural-prose description of the turn's edits (no Conventional Commits
 *    prefixes like `feat:`/`fix:`) — runtime asks the same agent to
 *    summarize the just-finished turn before this fires (one extra
 *    `generate` call), so drives that need a meaningful label (commit
 *    message, sync description) get one without each drive making its own
 *    LLM call.
 *
 * Drives don't see `Thread`. Throw with a descriptive message when you
 * need to communicate a failure (including partial failures like "pushed
 * branch but could not merge"); the runtime catches and surfaces the
 * error back to the user. A broken drive never crashes the reply.
 */
export interface Drive {
  fs(): IFileSystem;
  refresh?(): Promise<void>;
  /**
   * Flush any pending changes. The drive checks its own backing store
   * (git status, blob revision, etc.) — if there's nothing to flush,
   * return without doing anything. If there is, call `ctx.getSummary()`
   * to obtain an LLM-authored description of the turn's edits and use it
   * as the commit/sync message.
   *
   * `getSummary` is lazy: the runtime makes the LLM call the first time
   * any drive invokes it, then memoizes across all drives in this turn.
   * A drive that returns without calling it incurs zero LLM cost. So the
   * dirty-gate lives drive-side: don't call `getSummary` if you have
   * nothing to commit.
   */
  commit?(ctx: { getSummary: () => Promise<string> }): Promise<void>;
}

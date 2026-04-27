import { mkdtempSync } from "node:fs";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { add, branch, clone, commit, fastForward, init, push, remove, statusMatrix } from "isomorphic-git";
import http from "isomorphic-git/http/node";
import { OverlayFs, ReadWriteFs, type IFileSystem } from "just-bash";
import type { Drive, Permission } from "@openxyz/runtime/drive";

export type GitHubDriveConfig = {
  owner: string;
  repo: string;
  /**
   * Branch to track. This is both the branch the drive clones from and the
   * branch `commit` pushes back to. Defaults to `main`. Must be a branch
   * (not a tag or SHA) because read-write drives need a valid push target.
   */
  branch?: string;
  /**
   * GitHub token. Required for private repos and for any write operation.
   * Fine-grained PAT or GitHub App install token both work — passed as
   * `password` with `x-access-token` username per GitHub docs.
   */
  token?: string;
  /** Defaults to `read-only`. `read-write` enables the `commit` flow. */
  permission?: Permission;
  /** Commit author. Defaults to a generic openxyz identity. */
  author?: { name: string; email: string };
};

/**
 * Mount a GitHub repo at `/mnt/<name>/`. Clones (shallow, single-branch) into
 * a unique `/tmp/openxyz-github-*` directory on first `refresh()` and exposes
 * that directory as the drive's filesystem root via `getMountConfig()`.
 *
 * Uses isomorphic-git (pure JS — no system `git` binary required, so this
 * works on Vercel's Bun runtime).
 *
 * ### Lifecycle
 *
 * - `refresh()` — first call clones; subsequent calls fast-forward from
 *   the tracked branch. Runs before every agent turn so the agent sees
 *   fresh state.
 * - `fs()` — returns `ReadWriteFs` (writable) or `OverlayFs({ readOnly })`
 *   (read-only) over the cloned dir. Throws if called before `refresh`.
 * - `commit()` — on `read-write`, stages dirty files, commits to a
 *   per-session branch, pushes the branch, best-effort pushes into the
 *   tracked branch. Throws a descriptive message on partial failure; the
 *   runtime surfaces it to the user.
 *
 * Serverless note: `/tmp` is per-invocation on Vercel. Cold starts re-clone.
 * Good for small/medium repos; big ones will need a smarter cache.
 */
export class GitHubDrive implements Drive {
  readonly owner: string;
  readonly repo: string;
  readonly branch: string;
  readonly token: string | undefined;
  readonly permission: Permission;
  readonly author: { name: string; email: string };
  #dir?: string;
  #fs?: IFileSystem;

  constructor(cfg: GitHubDriveConfig) {
    this.owner = cfg.owner;
    this.repo = cfg.repo;
    this.branch = cfg.branch ?? "main";
    this.token = cfg.token;
    this.permission = cfg.permission ?? "read-only";
    // Matches the `openxyz-app` GitHub App (display name "openxyz.app",
    // App ID 3412708, owner @openxyz-app, bot user id 277066060). The
    // `<user-id>+<slug>[bot]@users.noreply.github.com` email gets GitHub to
    // attribute commits to the bot (avatar + "bot" badge in the UI) when
    // pushed under a token minted from this app's install. Override
    // `cfg.author` for any other identity.
    this.author = cfg.author ?? {
      name: "openxyz-app[bot]",
      email: "277066060+openxyz-app[bot]@users.noreply.github.com",
    };
  }

  async refresh(): Promise<void> {
    if (!this.#dir) {
      const dir = mkdtempSync(join(tmpdir(), "openxyz-github-"));
      try {
        await clone({
          fs,
          http,
          dir,
          url: this.#url(),
          ref: this.branch,
          singleBranch: true,
          depth: 1,
          onAuth: this.#onAuth(),
        });
      } catch (err) {
        // Empty repo or branch doesn't exist yet — bootstrap: init locally,
        // make an initial README commit, push to create the branch. Only
        // applies on read-write drives; read-only can't push an init commit.
        const msg = err instanceof Error ? err.message : String(err);
        if (this.permission === "read-write" && /could not find|not found|empty/i.test(msg)) {
          await this.#bootstrap(dir);
        } else {
          throw err;
        }
      }
      this.#dir = dir;
      return;
    }
    // Already cloned — fast-forward to the latest remote tip. Non-ff situations
    // (local session branch ahead of remote main) are handled in `commit`.
    await fastForward({ fs, http, dir: this.#dir, ref: this.branch, onAuth: this.#onAuth() });
  }

  /**
   * Create the tracked branch from scratch. Used when the repo is empty or
   * the branch doesn't exist yet. Writes a placeholder `README.md`, commits,
   * pushes — now the remote has the branch and future `refresh()` calls
   * succeed via the normal clone path.
   */
  async #bootstrap(dir: string): Promise<void> {
    await init({ fs, dir, defaultBranch: this.branch });
    const readme = `# ${this.repo}\n\nInitialized by openxyz.\n`;
    await fs.promises.writeFile(join(dir, "README.md"), readme);
    await add({ fs, dir, filepath: "README.md" });
    await commit({
      fs,
      dir,
      author: this.author,
      message: `openxyz: initialize \`${this.branch}\``,
    });
    await push({
      fs,
      http,
      dir,
      url: this.#url(),
      ref: this.branch,
      remoteRef: this.branch,
      onAuth: this.#onAuth(),
    });
  }

  #url(): string {
    return `https://github.com/${this.owner}/${this.repo}.git`;
  }

  fs(): IFileSystem {
    if (this.#fs) return this.#fs;
    if (!this.#dir) {
      throw new Error(`[openxyz/github] GitHubDrive.fs() called before refresh() — runtime must await refresh() first`);
    }
    // Read-write needs `ReadWriteFs` so edits persist to disk — otherwise
    // `commit()`'s `git add` wouldn't see them (OverlayFs writes go to an
    // in-memory layer, not the underlying files, see mnemonic/077). Read-only
    // uses `OverlayFs({ readOnly: true })`: reads pass through, writes throw.
    this.#fs =
      this.permission === "read-write"
        ? new ReadWriteFs({ root: this.#dir })
        : new OverlayFs({ root: this.#dir, readOnly: true });
    return this.#fs;
  }

  async commit(): Promise<void> {
    if (this.permission === "read-only") return;
    if (!this.#dir) return;
    const dir = this.#dir;

    const dirty = await stageAll(dir);
    if (!dirty) return;

    // Session branch naming: `openxyz/<timestamp>-<short-uuid>`. No access to
    // `thread.id` anymore — the runtime-held ID isn't passed to drives. A
    // timestamp + short random suffix gives enough uniqueness for practical
    // use without forcing the drive to reach for chat-sdk state.
    const sessionBranch = `openxyz/${new Date().toISOString().replace(/[:.]/g, "-")}-${shortId()}`;
    await branch({ fs, dir, ref: sessionBranch, checkout: true, force: true });
    await commit({
      fs,
      dir,
      author: this.author,
      message: `openxyz: edits from ${new Date().toISOString()}`,
    });

    // Always push the session branch first — durable record even if merge fails.
    try {
      await push({ fs, http, dir, ref: sessionBranch, remoteRef: sessionBranch, onAuth: this.#onAuth() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`failed to push session branch \`${sessionBranch}\`: ${msg}`);
    }

    // Best-effort merge into the tracked branch. Protected branches, non-ff,
    // or missing permissions all end up here — we throw so the runtime
    // surfaces it to the user, but the session branch is already on remote
    // so manual PR-merge is still possible.
    try {
      await push({ fs, http, dir, ref: sessionBranch, remoteRef: this.branch, onAuth: this.#onAuth() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `pushed changes to branch \`${sessionBranch}\` but could not merge into \`${this.branch}\` (${msg}). Open a PR from that branch to merge manually.`,
      );
    }
  }

  #onAuth(): (() => { username: string; password: string }) | undefined {
    const token = this.token;
    if (!token) return undefined;
    return () => ({ username: "x-access-token", password: token });
  }
}

/**
 * Stage every added/modified/deleted path. Returns true if anything was staged.
 * Mirrors `git add -A` semantics without a shell.
 *
 * isomorphic-git's `commit` builds its tree from the git index, not the
 * working directory, so explicit staging is required — there's no `commit -a`
 * equivalent. `statusMatrix` rows are `[filepath, HEAD, WORKDIR, STAGE]`; we
 * stage whenever WORKDIR diverges from STAGE.
 */
async function stageAll(dir: string): Promise<boolean> {
  const status = await statusMatrix({ fs, dir });
  const adds: string[] = [];
  const removes: string[] = [];
  for (const [filepath, , workdirStatus, stageStatus] of status) {
    if (workdirStatus === stageStatus) continue;
    (workdirStatus === 0 ? removes : adds).push(filepath);
  }
  if (!adds.length && !removes.length) return false;
  if (adds.length) await add({ fs, dir, filepath: adds, parallel: true });
  await Promise.all(removes.map((filepath) => remove({ fs, dir, filepath })));
  return true;
}

/** Eight hex chars — enough uniqueness for session branch suffixes. */
function shortId(): string {
  return Math.random().toString(16).slice(2, 10).padEnd(8, "0");
}

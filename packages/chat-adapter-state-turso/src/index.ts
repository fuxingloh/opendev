import type { Lock, Logger, QueueEntry, StateAdapter } from "chat";
import { ConsoleLogger } from "chat";
import type { Connection } from "@tursodatabase/serverless";
import type { Database } from "@tursodatabase/database";

/**
 * A constructed turso driver client. `@tursodatabase/serverless` for remote
 * (fetch-based, edge/serverless safe); `@tursodatabase/database` for local
 * (native binding, embedded file). The two packages are kept API-compatible
 * upstream, so the adapter treats them uniformly: `await client.prepare(sql)`
 * (sync returns pass through), `stmt.run([args])` as an array.
 */
export type TursoClient = Connection | Database;

type PreparedStatement = Awaited<ReturnType<TursoClient["prepare"]>>;

export interface TursoStateAdapterOptions {
  /** A constructed client — `connect()` result from either turso driver. */
  client: TursoClient;
  /** Key prefix for all rows (default: "chat-sdk"). */
  keyPrefix?: string;
  /** Logger instance for error reporting. */
  logger?: Logger;
}

export class TursoStateAdapter implements StateAdapter {
  private readonly client: TursoClient;
  private readonly keyPrefix: string;
  private readonly logger: Logger;
  private connected = false;
  private connectPromise: Promise<void> | null = null;
  // Per-instance promise mutex around `client.transaction()`. Turso's session
  // is single-threaded — concurrent calls collide with "cannot start a
  // transaction within a transaction". Fluid Compute warm-instance reuse
  // means two webhooks can hit this adapter at the same time. Transactions
  // here are sub-millisecond; agent turns happen outside, so this only
  // serializes the cheap part.
  private txQueue: Promise<unknown> = Promise.resolve();
  // Per-instance prepared-statement cache. Each `client.prepare()` triggers a
  // describe round-trip on the serverless driver; statements are tied to the
  // connection and reusable across calls. Caching the promise (not the awaited
  // statement) collapses concurrent first-uses into a single describe.
  private readonly stmtCache = new Map<string, Promise<PreparedStatement>>();

  constructor(options: TursoStateAdapterOptions) {
    this.client = options.client;
    this.keyPrefix = options.keyPrefix || DEFAULT_KEY_PREFIX;
    this.logger = options.logger ?? new ConsoleLogger("info").child("turso");
  }

  private prepare(sql: string): Promise<PreparedStatement> {
    const cached = this.stmtCache.get(sql);
    if (cached) return cached;
    const fresh = (async () => this.client.prepare(sql))();
    this.stmtCache.set(sql, fresh);
    fresh.catch(() => {
      if (this.stmtCache.get(sql) === fresh) this.stmtCache.delete(sql);
    });
    return fresh;
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const wrapped = () => withBusyRetry(fn);
    const next = this.txQueue.then(wrapped, wrapped);
    this.txQueue = next.catch(() => undefined);
    return next;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    if (!this.connectPromise) {
      this.connectPromise = (async () => {
        try {
          await this.ensureSchema();
          this.connected = true;
        } catch (error) {
          this.connectPromise = null;
          this.logger.error("turso connect failed", { error });
          throw error;
        }
      })();
    }
    await this.connectPromise;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.connectPromise = null;
  }

  async subscribe(threadId: string): Promise<void> {
    this.ensureConnected();
    const stmt = await this.prepare(
      `INSERT INTO chat_state_subscriptions (key_prefix, thread_id)
       VALUES (?, ?) ON CONFLICT DO NOTHING`,
    );
    await stmt.run([this.keyPrefix, threadId]);
  }

  async unsubscribe(threadId: string): Promise<void> {
    this.ensureConnected();
    const stmt = await this.prepare(`DELETE FROM chat_state_subscriptions WHERE key_prefix = ? AND thread_id = ?`);
    await stmt.run([this.keyPrefix, threadId]);
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    this.ensureConnected();
    const stmt = await this.prepare(
      `SELECT 1 AS present FROM chat_state_subscriptions
       WHERE key_prefix = ? AND thread_id = ? LIMIT 1`,
    );
    const row = await stmt.get([this.keyPrefix, threadId]);
    return row !== undefined && row !== null;
  }

  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    this.ensureConnected();
    const token = generateToken();
    const now = Date.now();
    const expiresAt = now + ttlMs;

    // Single-statement upsert: insert if absent, take over if expired, no-op if
    // active. SQLite excludes a DO UPDATE row from RETURNING when its WHERE is
    // false, so the active-lock case yields no row → null. Atomic per statement,
    // so no transaction or serialize() needed.
    const stmt = await this.prepare(
      `INSERT INTO chat_state_locks (key_prefix, thread_id, token, expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (key_prefix, thread_id) DO UPDATE
         SET token = excluded.token,
             expires_at = excluded.expires_at,
             updated_at = excluded.updated_at
         WHERE chat_state_locks.expires_at <= excluded.updated_at
       RETURNING thread_id, token, expires_at`,
    );
    const row = await stmt.get([this.keyPrefix, threadId, token, expiresAt, now]);
    if (!row) return null;
    return {
      threadId: row.thread_id as string,
      token: row.token as string,
      expiresAt: Number(row.expires_at),
    };
  }

  async forceReleaseLock(threadId: string): Promise<void> {
    this.ensureConnected();
    const stmt = await this.prepare(`DELETE FROM chat_state_locks WHERE key_prefix = ? AND thread_id = ?`);
    await stmt.run([this.keyPrefix, threadId]);
  }

  async releaseLock(lock: Lock): Promise<void> {
    this.ensureConnected();
    const stmt = await this.prepare(
      `DELETE FROM chat_state_locks
       WHERE key_prefix = ? AND thread_id = ? AND token = ?`,
    );
    await stmt.run([this.keyPrefix, lock.threadId, lock.token]);
  }

  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    this.ensureConnected();
    const now = Date.now();
    const stmt = await this.prepare(
      `UPDATE chat_state_locks
       SET expires_at = ?, updated_at = ?
       WHERE key_prefix = ? AND thread_id = ? AND token = ? AND expires_at > ?
       RETURNING thread_id`,
    );
    const row = await stmt.get([now + ttlMs, now, this.keyPrefix, lock.threadId, lock.token, now]);
    return row !== undefined && row !== null;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    this.ensureConnected();
    // mnemonic/125 #5: 2 RT (on miss) → 1 RT. The follow-up DELETE for an
    // expired row was inline cleanup that belongs in `sweep()` — the SELECT's
    // `expires_at > ?` filter already excludes expired rows from the result,
    // so callers see the right answer regardless. Hit unchanged at 1 RT.
    const stmt = await this.prepare(
      `SELECT value FROM chat_state_cache
       WHERE key_prefix = ? AND cache_key = ?
         AND (expires_at IS NULL OR expires_at > ?) LIMIT 1`,
    );
    const row = await stmt.get([this.keyPrefix, key, Date.now()]);
    if (!row) return null;
    return decodeStored<T>(row.value as string);
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.ensureConnected();
    const now = Date.now();
    const serialized = JSON.stringify(value);
    const expiresAt = ttlMs ? now + ttlMs : null;
    const stmt = await this.prepare(
      `INSERT INTO chat_state_cache (key_prefix, cache_key, value, expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (key_prefix, cache_key) DO UPDATE
         SET value = excluded.value,
             expires_at = excluded.expires_at,
             updated_at = excluded.updated_at`,
    );
    await stmt.run([this.keyPrefix, key, serialized, expiresAt, now]);
  }

  async setIfNotExists(key: string, value: unknown, ttlMs?: number): Promise<boolean> {
    this.ensureConnected();
    const now = Date.now();
    const expiresAt = ttlMs ? now + ttlMs : null;

    // mnemonic/125 #2: 4 RT → 1 RT. Same upsert-with-WHERE pattern as
    // `acquireLock`. Three cases collapse into one statement:
    //   - row absent → INSERT runs → RETURNING yields cache_key → true
    //   - row present and live → DO UPDATE WHERE is false → SQLite excludes
    //     the row from RETURNING → null → false
    //   - row present and expired → WHERE true → row replaced → RETURNING
    //     yields → true
    // No transaction (single atomic statement). No `serialize()` mutex.
    const stmt = await this.prepare(
      `INSERT INTO chat_state_cache (key_prefix, cache_key, value, expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (key_prefix, cache_key) DO UPDATE
         SET value = excluded.value,
             expires_at = excluded.expires_at,
             updated_at = excluded.updated_at
         WHERE chat_state_cache.expires_at IS NOT NULL
           AND chat_state_cache.expires_at <= excluded.updated_at
       RETURNING cache_key`,
    );
    const row = await stmt.get([this.keyPrefix, key, JSON.stringify(value), expiresAt, now]);
    return row !== undefined && row !== null;
  }

  async delete(key: string): Promise<void> {
    this.ensureConnected();
    const stmt = await this.prepare(`DELETE FROM chat_state_cache WHERE key_prefix = ? AND cache_key = ?`);
    await stmt.run([this.keyPrefix, key]);
  }

  async appendToList(key: string, value: unknown, options?: { maxLength?: number; ttlMs?: number }): Promise<void> {
    this.ensureConnected();
    // mnemonic/125 #8 (revised): 5 RT → 3 RT. Drop the wrapping transaction
    // + serialize() mutex; keep all three statements (insert + refreshTtl +
    // trim) because state-memory's conformance suite asserts both:
    //   - "should refresh TTL on subsequent appends" — old entries stay
    //     alive when a new entry with TTL lands (whole-list TTL, not
    //     per-row).
    //   - "should trim to maxLength, keeping newest" — bounded list size.
    // Both contracts are real chat-sdk dependencies (message history relies
    // on cross-row TTL refresh; debounce on trim-to-maxSize-1). Optimizing
    // them away breaks behavior, not just shaves RT.
    const expiresAt = options?.ttlMs ? Date.now() + options.ttlMs : null;
    const insert = await this.prepare(
      `INSERT INTO chat_state_lists (key_prefix, list_key, value, expires_at)
       VALUES (?, ?, ?, ?)`,
    );
    await insert.run([this.keyPrefix, key, JSON.stringify(value), expiresAt]);
    if (expiresAt !== null) {
      const refreshTtl = await this.prepare(
        `UPDATE chat_state_lists SET expires_at = ?
         WHERE key_prefix = ? AND list_key = ?`,
      );
      await refreshTtl.run([expiresAt, this.keyPrefix, key]);
    }
    if (options?.maxLength && options.maxLength > 0) {
      const trim = await this.prepare(
        `DELETE FROM chat_state_lists
         WHERE key_prefix = ? AND list_key = ? AND seq NOT IN (
           SELECT seq FROM chat_state_lists
           WHERE key_prefix = ? AND list_key = ?
           ORDER BY seq DESC LIMIT ?
         )`,
      );
      await trim.run([this.keyPrefix, key, this.keyPrefix, key, options.maxLength]);
    }
  }

  async getList<T = unknown>(key: string): Promise<T[]> {
    this.ensureConnected();
    const now = Date.now();
    const del = await this.prepare(
      `DELETE FROM chat_state_lists
       WHERE key_prefix = ? AND list_key = ?
         AND expires_at IS NOT NULL AND expires_at <= ?`,
    );
    await del.run([this.keyPrefix, key, now]);

    const select = await this.prepare(
      `SELECT value FROM chat_state_lists
       WHERE key_prefix = ? AND list_key = ? ORDER BY seq ASC`,
    );
    const rows = await select.all([this.keyPrefix, key]);
    return rows.map((row) => decodeStored<T>(row.value as string));
  }

  async enqueue(threadId: string, entry: QueueEntry, maxSize: number): Promise<number> {
    this.ensureConnected();
    // mnemonic/125 #4 (revised): 6 RT → 3 RT. Drop the inline `purge` (sweep
    // owns expired-row cleanup) and the wrapping transaction + serialize()
    // mutex. `trim` stays — chat-sdk's `debounce` strategy enqueues with
    // `maxSize: 1` and relies on the adapter to keep only the latest entry
    // (state-memory contract). Insert + trim + count, three independent
    // atomic statements. Concurrent enqueues from another instance interleave
    // safely: trim is idempotent (no-op once inside the bound), count drift
    // by ±1 on the wire is acceptable since chat-sdk treats depth as advisory.
    const insert = await this.prepare(
      `INSERT INTO chat_state_queues (key_prefix, thread_id, value, expires_at)
       VALUES (?, ?, ?, ?)`,
    );
    const trim = await this.prepare(
      `DELETE FROM chat_state_queues
       WHERE key_prefix = ? AND thread_id = ? AND seq NOT IN (
         SELECT seq FROM chat_state_queues
         WHERE key_prefix = ? AND thread_id = ?
         ORDER BY seq DESC LIMIT ?
       )`,
    );
    const countStmt = await this.prepare(
      `SELECT COUNT(*) AS depth FROM chat_state_queues
       WHERE key_prefix = ? AND thread_id = ? AND expires_at > ?`,
    );

    await insert.run([this.keyPrefix, threadId, JSON.stringify(entry), entry.expiresAt]);
    if (maxSize > 0) {
      await trim.run([this.keyPrefix, threadId, this.keyPrefix, threadId, maxSize]);
    }
    const row = await countStmt.get([this.keyPrefix, threadId, Date.now()]);
    return toNumber(row?.depth);
  }

  async dequeue(threadId: string): Promise<QueueEntry | null> {
    this.ensureConnected();
    // Single statement: pick oldest non-expired, delete it, return the value.
    // The `expires_at > ?` filter on the inner SELECT means expired rows are
    // never picked — they linger in the table until `sweep()` runs them off.
    // No transaction needed (single atomic statement), no `serialize()` mutex.
    // (mnemonic/125 #3: 5 RT → 1 RT per drainQueue iteration.)
    const stmt = await this.prepare(
      `DELETE FROM chat_state_queues
       WHERE seq = (
         SELECT seq FROM chat_state_queues
         WHERE key_prefix = ? AND thread_id = ? AND expires_at > ?
         ORDER BY seq ASC LIMIT 1
       )
       RETURNING value`,
    );
    const row = await stmt.get([this.keyPrefix, threadId, Date.now()]);
    if (!row) return null;
    return JSON.parse(row.value as string) as QueueEntry;
  }

  async queueDepth(threadId: string): Promise<number> {
    this.ensureConnected();
    const stmt = await this.prepare(
      `SELECT COUNT(*) AS depth FROM chat_state_queues
       WHERE key_prefix = ? AND thread_id = ? AND expires_at > ?`,
    );
    const row = await stmt.get([this.keyPrefix, threadId, Date.now()]);
    return toNumber(row?.depth);
  }

  /**
   * Best-effort cleanup of expired rows across every chat-sdk state table.
   *
   * The hot-path methods (dequeue, enqueue, appendToList, get, …) used to
   * inline an expired-row purge before each operation. mnemonic/125 #3-#8
   * moved that cleanup off the hot path — every read/write now filters by
   * `expires_at > now` instead of pre-purging, which means stale rows linger
   * in storage until something sweeps them. This is that something.
   *
   * Wire it to a periodic Vercel cron route (suggested cadence: every 15
   * min). All deletes ship in a single multi-statement `client.exec()` —
   * one HTTP round-trip on serverless, microseconds on native. Indexes on
   * each table's `expires_at` column keep the scans cheap.
   *
   * Idempotent and safe to call concurrently with hot-path traffic; each
   * DELETE is atomic per row, and the indexes scope the cost to actual
   * expired entries, not the live working set.
   */
  async sweep(): Promise<void> {
    this.ensureConnected();
    const now = Date.now();
    // Inline the timestamp — `client.exec()` doesn't take parameters. Numeric
    // literals are safe (no injection surface) and `now` is JS Date.now().
    const sql =
      [
        `DELETE FROM chat_state_cache  WHERE expires_at IS NOT NULL AND expires_at <= ${now}`,
        `DELETE FROM chat_state_queues WHERE expires_at <= ${now}`,
        `DELETE FROM chat_state_lists  WHERE expires_at IS NOT NULL AND expires_at <= ${now}`,
        `DELETE FROM chat_state_locks  WHERE expires_at <= ${now}`,
      ].join(";\n") + ";";
    await this.client.exec(sql);
  }

  private async ensureSchema(): Promise<void> {
    // Both drivers' `exec()` accept multi-statement SQL in a single call
    // (mnemonic/125 #1). Serverless routes through Hrana's `sequence` request
    // — one HTTP round-trip for all 11 statements (vs. 11 sequential RTs if
    // we looped). Native binding runs them in-process, microseconds either
    // way. No need to feature-detect `batch()`; one call covers both.
    await this.client.exec(SCHEMA_SQL.join(";\n") + ";");
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error("TursoStateAdapter is not connected. Call connect() first.");
    }
  }
}

const DEFAULT_KEY_PREFIX = "chat-sdk";

const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS chat_state_subscriptions (
    key_prefix TEXT NOT NULL,
    thread_id  TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    PRIMARY KEY (key_prefix, thread_id)
  )`,
  `CREATE TABLE IF NOT EXISTS chat_state_locks (
    key_prefix TEXT NOT NULL,
    thread_id  TEXT NOT NULL,
    token      TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (key_prefix, thread_id)
  )`,
  `CREATE TABLE IF NOT EXISTS chat_state_cache (
    key_prefix TEXT NOT NULL,
    cache_key  TEXT NOT NULL,
    value      TEXT NOT NULL,
    expires_at INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (key_prefix, cache_key)
  )`,
  `CREATE INDEX IF NOT EXISTS chat_state_locks_expires_idx ON chat_state_locks (expires_at)`,
  `CREATE INDEX IF NOT EXISTS chat_state_cache_expires_idx ON chat_state_cache (expires_at)
   WHERE expires_at IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS chat_state_lists (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    key_prefix TEXT NOT NULL,
    list_key   TEXT NOT NULL,
    value      TEXT NOT NULL,
    expires_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS chat_state_lists_key_idx ON chat_state_lists (key_prefix, list_key, seq)`,
  `CREATE INDEX IF NOT EXISTS chat_state_lists_expires_idx ON chat_state_lists (expires_at)
   WHERE expires_at IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS chat_state_queues (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    key_prefix TEXT NOT NULL,
    thread_id  TEXT NOT NULL,
    value      TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS chat_state_queues_thread_idx ON chat_state_queues (key_prefix, thread_id, seq)`,
  `CREATE INDEX IF NOT EXISTS chat_state_queues_expires_idx ON chat_state_queues (expires_at)`,
];

function toNumber(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number.parseInt(value, 10);
  return 0;
}

function generateToken(): string {
  return `turso_${crypto.randomUUID()}`;
}

function decodeStored<T>(value: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return value as unknown as T;
  }
}

/**
 * Retry a database operation on `SQLITE_BUSY` with jittered exponential
 * backoff. Cross-instance write contention (multiple Vercel functions
 * writing to the same Turso DB) surfaces as BUSY — the in-process mutex
 * can't serialize across instances. Caps at ~1.5s total before giving up.
 */
async function withBusyRetry<T>(fn: () => Promise<T>): Promise<T> {
  const delays = [25, 50, 100, 200, 400, 800];
  for (let i = 0; i <= delays.length; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!isBusy(err) || i === delays.length) throw err;
      const base = delays[i]!;
      await new Promise((r) => setTimeout(r, base + Math.random() * base));
    }
  }
  throw new Error("unreachable");
}

function isBusy(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") return true;
  const msg = (err as { message?: unknown }).message;
  return typeof msg === "string" && /database is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(msg);
}

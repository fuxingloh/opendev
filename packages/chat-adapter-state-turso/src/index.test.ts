import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Lock, Logger } from "chat";
import { connect, type Database } from "@tursodatabase/database";
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { TursoStateAdapter } from "./index";

const mockLogger: Logger = {
  child: mock(() => mockLogger),
  debug: mock(),
  info: mock(),
  warn: mock(),
  error: mock(),
};

const TURSO_TOKEN_RE = /^turso_/;

function tmpFilePath(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "chat-turso-"));
  const file = join(dir, "state.db");
  return { path: file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function makeTmpDb(): Promise<{ db: Database; cleanup: () => Promise<void> }> {
  const { path, cleanup } = tmpFilePath();
  const db = await connect(path);
  return {
    db,
    cleanup: async () => {
      try {
        await db.close();
      } catch {
        // already closed
      }
      cleanup();
    },
  };
}

describe("TursoStateAdapter", () => {
  it("exports TursoStateAdapter", () => {
    expect(typeof TursoStateAdapter).toBe("function");
  });

  describe("ensureConnected", () => {
    let db: Database;
    let cleanup: () => Promise<void>;

    beforeEach(async () => {
      ({ db, cleanup } = await makeTmpDb());
    });

    afterEach(async () => {
      await cleanup();
    });

    it.each([
      ["subscribe", (a: TursoStateAdapter) => a.subscribe("t1")],
      ["unsubscribe", (a: TursoStateAdapter) => a.unsubscribe("t1")],
      ["isSubscribed", (a: TursoStateAdapter) => a.isSubscribed("t1")],
      ["acquireLock", (a: TursoStateAdapter) => a.acquireLock("t1", 5000)],
      ["get", (a: TursoStateAdapter) => a.get("key")],
      ["set", (a: TursoStateAdapter) => a.set("key", "value")],
      ["setIfNotExists", (a: TursoStateAdapter) => a.setIfNotExists("key", "value")],
      ["delete", (a: TursoStateAdapter) => a.delete("key")],
      ["appendToList", (a: TursoStateAdapter) => a.appendToList("list", "value")],
      ["getList", (a: TursoStateAdapter) => a.getList("list")],
      [
        "enqueue",
        (a: TursoStateAdapter) => a.enqueue("t1", { message: { id: "m1" }, enqueuedAt: 0, expiresAt: 1 } as never, 10),
      ],
      ["dequeue", (a: TursoStateAdapter) => a.dequeue("t1")],
      ["queueDepth", (a: TursoStateAdapter) => a.queueDepth("t1")],
    ])("throws when calling %s before connect", async (_, fn) => {
      const adapter = new TursoStateAdapter({ client: db, logger: mockLogger });
      expect(fn(adapter)).rejects.toThrow("not connected");
    });

    it("throws for releaseLock before connect", async () => {
      const adapter = new TursoStateAdapter({ client: db, logger: mockLogger });
      const lock: Lock = { threadId: "t1", token: "tok", expiresAt: Date.now() };
      expect(adapter.releaseLock(lock)).rejects.toThrow("not connected");
    });

    it("throws for extendLock before connect", async () => {
      const adapter = new TursoStateAdapter({ client: db, logger: mockLogger });
      const lock: Lock = { threadId: "t1", token: "tok", expiresAt: Date.now() };
      expect(adapter.extendLock(lock, 5000)).rejects.toThrow("not connected");
    });

    it("throws for forceReleaseLock before connect", async () => {
      const adapter = new TursoStateAdapter({ client: db, logger: mockLogger });
      expect(adapter.forceReleaseLock("t1")).rejects.toThrow("not connected");
    });
  });

  describe("with a real turso file database", () => {
    let db: Database;
    let cleanupDb: () => Promise<void>;
    let adapter: TursoStateAdapter;

    beforeEach(async () => {
      ({ db, cleanup: cleanupDb } = await makeTmpDb());
      adapter = new TursoStateAdapter({ client: db, logger: mockLogger });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
      await cleanupDb();
    });

    describe("connect / disconnect", () => {
      it("is idempotent on connect", async () => {
        await adapter.connect();
        await adapter.connect();
      });

      it("deduplicates concurrent connect calls", async () => {
        const { db: d, cleanup } = await makeTmpDb();
        try {
          const a = new TursoStateAdapter({ client: d, logger: mockLogger });
          await Promise.all([a.connect(), a.connect()]);
          await a.disconnect();
        } finally {
          await cleanup();
        }
      });

      it("is idempotent on disconnect", async () => {
        await adapter.disconnect();
        await adapter.disconnect();
        await adapter.connect();
      });

      it("never closes the passed-in client on disconnect", async () => {
        await adapter.disconnect();
        // DI contract: caller owns client lifecycle. The Database must still
        // be usable — the adapter never touches it.
        const stmt = db.prepare("SELECT 1 AS v");
        const row = await stmt.get();
        expect(row.v).toBe(1);
        await adapter.connect();
      });

      it("issues schema as one multi-statement exec call", async () => {
        // Both drivers' `exec()` accept ;-separated statements in a single
        // call — one HTTP RT on serverless, microseconds on native. Looping
        // would pay 11 sequential RTs on cold start (mnemonic/125 #1). This
        // pins the cold-start contract.
        const { db: d, cleanup } = await makeTmpDb();
        try {
          const execSpy = spyOn(d, "exec");
          const a = new TursoStateAdapter({ client: d, logger: mockLogger });
          await a.connect();
          expect(execSpy).toHaveBeenCalledTimes(1);
          const sql = execSpy.mock.calls[0]?.[0] as string;
          // The single string must carry every schema statement.
          expect(sql).toContain("CREATE TABLE IF NOT EXISTS chat_state_subscriptions");
          expect(sql).toContain("CREATE TABLE IF NOT EXISTS chat_state_locks");
          expect(sql).toContain("CREATE TABLE IF NOT EXISTS chat_state_cache");
          expect(sql).toContain("CREATE TABLE IF NOT EXISTS chat_state_lists");
          expect(sql).toContain("CREATE TABLE IF NOT EXISTS chat_state_queues");
          await a.disconnect();
        } finally {
          await cleanup();
        }
      });

      it("handles connect failure and allows retry", async () => {
        const { db: broken, cleanup } = await makeTmpDb();
        try {
          await broken.close();
          const a = new TursoStateAdapter({ client: broken, logger: mockLogger });
          expect(a.connect()).rejects.toThrow();
          expect(mockLogger.error).toHaveBeenCalled();
          expect(a.connect()).rejects.toThrow();
        } finally {
          await cleanup();
        }
      });
    });

    describe("subscriptions", () => {
      it("round-trips subscribe / isSubscribed / unsubscribe", async () => {
        expect(await adapter.isSubscribed("slack:C1:1.2")).toBe(false);
        await adapter.subscribe("slack:C1:1.2");
        expect(await adapter.isSubscribed("slack:C1:1.2")).toBe(true);
        await adapter.subscribe("slack:C1:1.2"); // idempotent
        expect(await adapter.isSubscribed("slack:C1:1.2")).toBe(true);
        await adapter.unsubscribe("slack:C1:1.2");
        expect(await adapter.isSubscribed("slack:C1:1.2")).toBe(false);
      });

      it("isolates subscriptions by keyPrefix", async () => {
        const other = new TursoStateAdapter({ client: db, keyPrefix: "other", logger: mockLogger });
        await other.connect();
        await adapter.subscribe("t1");
        expect(await other.isSubscribed("t1")).toBe(false);
        await other.disconnect();
      });
    });

    describe("locking", () => {
      it("acquires a lock with a token and expiry", async () => {
        const lock = await adapter.acquireLock("t1", 5000);
        expect(lock).not.toBeNull();
        expect(lock?.threadId).toBe("t1");
        expect(lock?.token).toMatch(TURSO_TOKEN_RE);
        expect(lock?.expiresAt).toBeGreaterThan(Date.now());
      });

      it("returns null when the lock is held", async () => {
        const first = await adapter.acquireLock("t1", 5000);
        expect(first).not.toBeNull();
        const second = await adapter.acquireLock("t1", 5000);
        expect(second).toBeNull();
      });

      it("allows reacquiring an expired lock", async () => {
        const first = await adapter.acquireLock("t1", 1);
        expect(first).not.toBeNull();
        await new Promise((r) => setTimeout(r, 10));
        const second = await adapter.acquireLock("t1", 5000);
        expect(second).not.toBeNull();
        expect(second?.token).not.toBe(first?.token);
      });

      it("releases a lock only with the right token", async () => {
        const lock = await adapter.acquireLock("t1", 5000);
        expect(lock).not.toBeNull();
        await adapter.releaseLock({
          threadId: "t1",
          token: "wrong",
          expiresAt: lock?.expiresAt ?? 0,
        });
        expect(await adapter.acquireLock("t1", 5000)).toBeNull();
        if (lock) await adapter.releaseLock(lock);
        expect(await adapter.acquireLock("t1", 5000)).not.toBeNull();
      });

      it("extends a lock when the token matches", async () => {
        const lock = await adapter.acquireLock("t1", 5000);
        expect(lock).not.toBeNull();
        if (!lock) return;
        expect(await adapter.extendLock(lock, 10_000)).toBe(true);
      });

      it("returns false when extending with the wrong token", async () => {
        await adapter.acquireLock("t1", 5000);
        const extended = await adapter.extendLock(
          { threadId: "t1", token: "nope", expiresAt: Date.now() + 5000 },
          5000,
        );
        expect(extended).toBe(false);
      });

      it("leaves an active lock untouched on a failed acquire", async () => {
        // Load-bearing invariant for the upsert rewrite: the DO UPDATE WHERE
        // clause must veto the write when the existing lock is active. If a
        // future SQL tweak ever lets the update fire, the original holder's
        // token/expires_at would silently rotate while the second caller
        // still sees null — two holders, no warning. Pin it explicitly.
        const first = await adapter.acquireLock("t1", 5000);
        expect(first).not.toBeNull();
        if (!first) return;
        const second = await adapter.acquireLock("t1", 5000);
        expect(second).toBeNull();
        // First token still authorizes extend → row was not rewritten.
        expect(await adapter.extendLock(first, 10_000)).toBe(true);
      });

      it("serializes concurrent acquires — exactly one winner", async () => {
        const results = await Promise.all([
          adapter.acquireLock("t1", 5000),
          adapter.acquireLock("t1", 5000),
          adapter.acquireLock("t1", 5000),
        ]);
        const winners = results.filter((r) => r !== null);
        expect(winners.length).toBe(1);
        const losers = results.filter((r) => r === null);
        expect(losers.length).toBe(2);
      });

      it("rotates the token on expired-lock takeover", async () => {
        // Pins the upsert semantics: when the existing lock is expired, the
        // new caller must receive a fresh token, not the stale one. Caller's
        // token uniquely authorizes release/extend, so a stale return here
        // would silently let two holders coexist.
        const first = await adapter.acquireLock("t1", 1);
        expect(first).not.toBeNull();
        await new Promise((r) => setTimeout(r, 10));
        const second = await adapter.acquireLock("t1", 5000);
        expect(second).not.toBeNull();
        expect(second?.token).not.toBe(first?.token);
        expect(second?.expiresAt).toBeGreaterThan(first?.expiresAt ?? 0);
        // The first token must no longer extend the lock.
        if (first) expect(await adapter.extendLock(first, 5000)).toBe(false);
        if (second) expect(await adapter.extendLock(second, 5000)).toBe(true);
      });

      it("force-releases a lock without checking token", async () => {
        const lock = await adapter.acquireLock("t1", 5000);
        expect(lock).not.toBeNull();
        await adapter.forceReleaseLock("t1");
        expect(await adapter.acquireLock("t1", 5000)).not.toBeNull();
      });
    });

    describe("cache", () => {
      it("round-trips JSON values", async () => {
        await adapter.set("key", { foo: "bar" });
        expect(await adapter.get<{ foo: string }>("key")).toEqual({ foo: "bar" });
      });

      it("returns null on miss", async () => {
        expect(await adapter.get("missing")).toBeNull();
      });

      it("respects TTL", async () => {
        await adapter.set("key", "value", 1);
        await new Promise((r) => setTimeout(r, 10));
        expect(await adapter.get("key")).toBeNull();
      });

      it("setIfNotExists inserts only when absent", async () => {
        expect(await adapter.setIfNotExists("key", "first")).toBe(true);
        expect(await adapter.setIfNotExists("key", "second")).toBe(false);
        expect(await adapter.get<string>("key")).toBe("first");
      });

      it("setIfNotExists succeeds after TTL expiry", async () => {
        expect(await adapter.setIfNotExists("key", "first", 1)).toBe(true);
        await new Promise((r) => setTimeout(r, 10));
        expect(await adapter.setIfNotExists("key", "second")).toBe(true);
        expect(await adapter.get<string>("key")).toBe("second");
      });

      it("setIfNotExists respects TTL on the new value", async () => {
        // chat-sdk conformance — ports `state-memory`'s test of the same
        // name. The TTL passed to `setIfNotExists` must take effect.
        expect(await adapter.setIfNotExists("key", "v", 5)).toBe(true);
        await new Promise((r) => setTimeout(r, 15));
        expect(await adapter.get("key")).toBeNull();
      });

      it("delete removes a value", async () => {
        await adapter.set("key", "value");
        await adapter.delete("key");
        expect(await adapter.get("key")).toBeNull();
      });

      it("setIfNotExists serializes concurrent calls — exactly one winner", async () => {
        // mnemonic/125 #2 dropped the transaction + serialize() mutex; the
        // upsert-with-WHERE pattern is atomic per statement. Pin: three
        // parallel calls on the same key produce 1 true + 2 false, and the
        // value matches the winner.
        const results = await Promise.all([
          adapter.setIfNotExists("race", "A"),
          adapter.setIfNotExists("race", "B"),
          adapter.setIfNotExists("race", "C"),
        ]);
        const winners = results.filter((r) => r).length;
        expect(winners).toBe(1);
        const stored = await adapter.get<string>("race");
        expect(["A", "B", "C"]).toContain(stored);
      });
    });

    describe("lists", () => {
      it("appends values and returns them in insertion order", async () => {
        await adapter.appendToList("mylist", { id: 1 });
        await adapter.appendToList("mylist", { id: 2 });
        await adapter.appendToList("mylist", { id: 3 });
        expect(await adapter.getList("mylist")).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
      });

      it("trims to maxLength, keeping newest", async () => {
        // mnemonic/125 #8 (revised): inline trim is retained — `getList()`
        // reads everything (no limit on the chat-sdk StateAdapter interface),
        // so without trim, active threads accumulate rows for the whole TTL
        // window and balloon transport size. refreshTtl was dropped
        // (tested separately); trim stays. 5 RT → 2 RT.
        for (let i = 1; i <= 5; i++) {
          await adapter.appendToList("mylist", { id: i }, { maxLength: 3 });
        }
        expect(await adapter.getList("mylist")).toEqual([{ id: 3 }, { id: 4 }, { id: 5 }]);
      });

      it("expires the whole list when TTL passes", async () => {
        await adapter.appendToList("mylist", { id: 1 }, { ttlMs: 1 });
        await new Promise((r) => setTimeout(r, 10));
        expect(await adapter.getList("mylist")).toEqual([]);
      });

      it("refreshes TTL on subsequent appends", async () => {
        // chat-sdk conformance — ports `state-memory`'s test of the same
        // name. The whole list shares one logical TTL: appending a fresh
        // entry with TTL extends the lifetime of older entries too.
        await adapter.appendToList("mylist", { id: 1 }, { ttlMs: 30 });
        await new Promise((r) => setTimeout(r, 20));
        await adapter.appendToList("mylist", { id: 2 }, { ttlMs: 30 });
        // First entry would have expired at t=30 (no refresh), but the
        // refresh on the second append pushes it to t≈50, so it survives.
        expect(await adapter.getList("mylist")).toEqual([{ id: 1 }, { id: 2 }]);
      });

      it("isolates lists by key", async () => {
        await adapter.appendToList("a", "alpha");
        await adapter.appendToList("b", "beta");
        expect(await adapter.getList("a")).toEqual(["alpha"]);
        expect(await adapter.getList("b")).toEqual(["beta"]);
      });

      it("starts fresh after an expired list", async () => {
        // chat-sdk conformance — appending to a list whose entries have all
        // expired must yield only the new entry, not concatenate to dead rows.
        await adapter.appendToList("L", { id: 1 }, { ttlMs: 1 });
        await new Promise((r) => setTimeout(r, 10));
        await adapter.appendToList("L", { id: 2 });
        expect(await adapter.getList("L")).toEqual([{ id: 2 }]);
      });

      it("returns empty for unknown keys", async () => {
        expect(await adapter.getList("nope")).toEqual([]);
      });
    });

    describe("statement cache", () => {
      it("prepares each SQL string at most once across repeated calls", async () => {
        const spy = spyOn(db, "prepare");
        await adapter.set("k", "v1");
        await adapter.set("k", "v2");
        await adapter.set("k", "v3");
        const insertCalls = spy.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO chat_state_cache"));
        expect(insertCalls.length).toBe(1);
        spy.mockRestore();
      });

      it("collapses concurrent first-uses of the same SQL into one prepare", async () => {
        const spy = spyOn(db, "prepare");
        await Promise.all([adapter.subscribe("t1"), adapter.subscribe("t2"), adapter.subscribe("t3")]);
        const subscribeCalls = spy.mock.calls.filter(([sql]) =>
          String(sql).includes("INSERT INTO chat_state_subscriptions"),
        );
        expect(subscribeCalls.length).toBe(1);
        spy.mockRestore();
      });

      it("uses distinct cache entries for distinct SQL strings", async () => {
        const spy = spyOn(db, "prepare");
        await adapter.set("k", "v");
        await adapter.get("k");
        await adapter.delete("k");
        const distinct = new Set(spy.mock.calls.map(([sql]) => String(sql)));
        expect(distinct.size).toBe(spy.mock.calls.length);
        spy.mockRestore();
      });

      it("evicts a failed prepare so a retry can succeed", async () => {
        // Force prepare to fail on the first call, then restore.
        const original = db.prepare.bind(db);
        let calls = 0;
        const flaky = mock((sql: string) => {
          calls++;
          if (calls === 1) throw new Error("boom");
          return original(sql);
        });
        const spy = spyOn(db, "prepare").mockImplementation(flaky as never);
        expect(adapter.set("k", "v")).rejects.toThrow("boom");
        // Cache must not retain the rejected promise — second call re-enters prepare and succeeds.
        await adapter.set("k", "v");
        expect(calls).toBeGreaterThanOrEqual(2);
        spy.mockRestore();
      });
    });

    describe("queue", () => {
      const makeEntry = (id: string, offsetMs = 90_000) => ({
        message: { id },
        enqueuedAt: Date.now(),
        expiresAt: Date.now() + offsetMs,
      });

      it("enqueues and dequeues in FIFO order", async () => {
        await adapter.enqueue("t1", makeEntry("m1") as never, 10);
        await adapter.enqueue("t1", makeEntry("m2") as never, 10);
        await adapter.enqueue("t1", makeEntry("m3") as never, 10);

        const a = await adapter.dequeue("t1");
        const b = await adapter.dequeue("t1");
        const c = await adapter.dequeue("t1");
        const d = await adapter.dequeue("t1");

        expect(a?.message.id).toBe("m1");
        expect(b?.message.id).toBe("m2");
        expect(c?.message.id).toBe("m3");
        expect(d).toBeNull();
      });

      it("returns current depth from enqueue", async () => {
        const d1 = await adapter.enqueue("t1", makeEntry("m1") as never, 10);
        const d2 = await adapter.enqueue("t1", makeEntry("m2") as never, 10);
        expect(d1).toBe(1);
        expect(d2).toBe(2);
      });

      it("trims to maxSize, keeping newest entries", async () => {
        // chat-sdk conformance — ports `state-memory`'s test of the same
        // name. Required for the `debounce` strategy (maxSize=1).
        for (let i = 1; i <= 5; i++) {
          await adapter.enqueue("t1", makeEntry(`m${i}`) as never, 3);
        }
        expect(await adapter.queueDepth("t1")).toBe(3);
        const entries: string[] = [];
        let next = await adapter.dequeue("t1");
        while (next) {
          entries.push(next.message.id as string);
          next = await adapter.dequeue("t1");
        }
        expect(entries).toEqual(["m3", "m4", "m5"]);
      });

      it("handles maxSize of 1 (debounce behavior)", async () => {
        // chat-sdk's `debounce` strategy enqueues every message with
        // `maxSize: 1`, expecting the adapter to keep only the latest entry.
        await adapter.enqueue("t1", makeEntry("m1") as never, 1);
        await adapter.enqueue("t1", makeEntry("m2") as never, 1);
        await adapter.enqueue("t1", makeEntry("m3") as never, 1);
        expect(await adapter.queueDepth("t1")).toBe(1);
        const only = await adapter.dequeue("t1");
        expect(only?.message.id).toBe("m3");
        expect(await adapter.dequeue("t1")).toBeNull();
      });

      it("returns null when dequeuing from a nonexistent thread", async () => {
        expect(await adapter.dequeue("never-existed")).toBeNull();
      });

      it("isolates queues by thread", async () => {
        await adapter.enqueue("t1", makeEntry("a") as never, 10);
        await adapter.enqueue("t2", makeEntry("b") as never, 10);
        expect((await adapter.dequeue("t1"))?.message.id).toBe("a");
        expect((await adapter.dequeue("t2"))?.message.id).toBe("b");
      });

      it("drops expired entries", async () => {
        await adapter.enqueue("t1", makeEntry("old", 1) as never, 10);
        await new Promise((r) => setTimeout(r, 10));
        await adapter.enqueue("t1", makeEntry("fresh") as never, 10);
        const entry = await adapter.dequeue("t1");
        expect(entry?.message.id).toBe("fresh");
      });

      it("queueDepth returns 0 for empty queues", async () => {
        expect(await adapter.queueDepth("nobody")).toBe(0);
      });

      it("dequeue skips expired rows without deleting them — sweep owns cleanup", async () => {
        // mnemonic/125 #3: dequeue dropped the inline expired-purge. The
        // SELECT filter excludes expired rows from being picked, but they
        // remain in storage until `sweep()` runs. This pins that contract —
        // if a future change re-introduces inline cleanup, it'll fail loudly.
        // (Note: `enqueue` still purges inline today; until mnemonic/125 #4
        // lands, we have to insert the expired row directly to test this.)
        const insertExpired = db.prepare(
          `INSERT INTO chat_state_queues (key_prefix, thread_id, value, expires_at)
           VALUES (?, ?, ?, ?)`,
        );
        await insertExpired.run([
          "chat-sdk",
          "t1",
          JSON.stringify({ message: { id: "expired" }, enqueuedAt: 0, expiresAt: 1 }),
          1,
        ]);

        // Dequeue against an only-expired queue → returns null, row untouched.
        const empty = await adapter.dequeue("t1");
        expect(empty).toBeNull();

        const stmt = db.prepare("SELECT COUNT(*) AS c FROM chat_state_queues WHERE key_prefix = ? AND thread_id = ?");
        const row = await stmt.get(["chat-sdk", "t1"]);
        expect(Number(row.c)).toBe(1);
      });
    });

    describe("sweep", () => {
      it("removes expired rows from every state table", async () => {
        const past = Date.now() - 1000;
        const future = Date.now() + 60_000;

        await adapter.set("live", "v", 60_000);
        await adapter.set("dead", "v", 1);
        await new Promise((r) => setTimeout(r, 10));

        // Fresh + expired in queues + lists.
        await adapter.enqueue(
          "t1",
          { message: { id: "fresh" }, enqueuedAt: Date.now(), expiresAt: future } as never,
          10,
        );
        await adapter.enqueue("t1", { message: { id: "stale" }, enqueuedAt: Date.now(), expiresAt: past } as never, 10);
        await adapter.appendToList("L", "live", { ttlMs: 60_000 });

        await adapter.sweep();

        // Live entries remain.
        expect(await adapter.get("live")).toBe("v");
        expect(await adapter.queueDepth("t1")).toBe(1);
        expect(await adapter.getList("L")).toEqual(["live"]);

        // Dead cache key is gone — direct table check, not via get() (which
        // also filters by expiry, masking the sweep's effect).
        const cnt = db.prepare("SELECT COUNT(*) AS c FROM chat_state_cache WHERE key_prefix = ? AND cache_key = ?");
        const cacheRow = await cnt.get(["chat-sdk", "dead"]);
        expect(Number(cacheRow.c)).toBe(0);

        // Stale queue row gone too.
        const qcnt = db.prepare("SELECT COUNT(*) AS c FROM chat_state_queues WHERE key_prefix = ? AND thread_id = ?");
        const qRow = await qcnt.get(["chat-sdk", "t1"]);
        expect(Number(qRow.c)).toBe(1);
      });

      it("is idempotent and safe to call when nothing is expired", async () => {
        await adapter.set("k", "v", 60_000);
        await adapter.sweep();
        await adapter.sweep();
        expect(await adapter.get("k")).toBe("v");
      });
    });

    describe("chat-sdk webhook integration smoke", () => {
      // Replays the exact call sequences chat-sdk's `processMessage` /
      // `handleQueueOrDebounce` / `drainQueue` make on a webhook, against
      // our real adapter + a real local Turso file. No mocks. Closes the
      // "trust upstream's premise" gap (mnemonic/125 — conformance audit):
      // unit tests pin per-method behavior; this pins the *sequences*
      // chat-sdk actually exercises.

      const LOCK_TTL = 30_000;
      const QUEUE_TTL = 90_000;
      const DEDUPE_TTL = 60_000;
      const lockKey = "telegram:42";

      const queueEntry = (id: string, text: string) => ({
        message: { id, text, author: { userName: "u" } },
        enqueuedAt: Date.now(),
        expiresAt: Date.now() + QUEUE_TTL,
      });

      it("lone-message happy path: dedupe → lock → enqueue → drain → release", async () => {
        const dedupeKey = `dedupe:telegram:msg-1`;

        // 1. Dedupe — first arrival wins.
        expect(await adapter.setIfNotExists(dedupeKey, true, DEDUPE_TTL)).toBe(true);

        // 2. Acquire lock (queue-debounce strategy always tries).
        const lock = await adapter.acquireLock(lockKey, LOCK_TTL);
        expect(lock).not.toBeNull();
        if (!lock) throw new Error("unreachable");

        // 3. Enqueue self (queue-debounce always enqueues).
        const depth = await adapter.enqueue(lockKey, queueEntry("msg-1", "hi") as never, 10);
        expect(depth).toBe(1);

        // 4. Extend lock after debounce sleep (skipped here).
        expect(await adapter.extendLock(lock, LOCK_TTL)).toBe(true);

        // 5. drainQueue: collect every pending entry. Should yield exactly msg-1.
        const drained: string[] = [];
        let next = await adapter.dequeue(lockKey);
        while (next) {
          drained.push(next.message.id as string);
          next = await adapter.dequeue(lockKey);
        }
        expect(drained).toEqual(["msg-1"]);

        // 6. Release lock — reusing the lockKey post-release must succeed.
        await adapter.releaseLock(lock);
        const second = await adapter.acquireLock(lockKey, LOCK_TTL);
        expect(second).not.toBeNull();
        if (second) await adapter.releaseLock(second);
      });

      it("burst arrival with held lock: enqueue 3, drain after release picks last + skipped=[1,2]", async () => {
        // Mirrors chat-sdk's `concurrency: queue` burst test — pre-acquire
        // the lock as if a handler is busy, fire 3 webhook arrivals (each
        // dedupe-passes + tries to acquire-lock + falls through to enqueue),
        // then release the lock and drain. drainQueue collects all pending,
        // dispatches the latest with skipped=[older], and the queue empties.
        const otherInstanceLock = await adapter.acquireLock(lockKey, LOCK_TTL);
        expect(otherInstanceLock).not.toBeNull();

        for (const id of ["m1", "m2", "m3"]) {
          // Each webhook: dedupe insert, try-acquire (fails — held), enqueue.
          expect(await adapter.setIfNotExists(`dedupe:${id}`, true, DEDUPE_TTL)).toBe(true);
          const failed = await adapter.acquireLock(lockKey, LOCK_TTL);
          expect(failed).toBeNull();
          await adapter.enqueue(lockKey, queueEntry(id, id) as never, 10);
        }
        expect(await adapter.queueDepth(lockKey)).toBe(3);

        // Force release (chat-sdk's `force` resolution path, or the holder's
        // own release at end of its turn).
        await adapter.forceReleaseLock(lockKey);

        // New webhook arrives, takes the lock, drains.
        const fresh = await adapter.acquireLock(lockKey, LOCK_TTL);
        expect(fresh).not.toBeNull();
        if (!fresh) throw new Error("unreachable");

        const collected: string[] = [];
        let next = await adapter.dequeue(lockKey);
        while (next) {
          collected.push(next.message.id as string);
          next = await adapter.dequeue(lockKey);
        }
        // FIFO order. drainQueue inside chat-sdk picks the *last* and reports
        // earlier as `skipped` — that's a chat-sdk-side decision, not the
        // adapter's. Adapter contract: deliver everything in insertion order.
        expect(collected).toEqual(["m1", "m2", "m3"]);
        await adapter.releaseLock(fresh);
      });

      it("debounce strategy: enqueue with maxSize=1 keeps only the latest", async () => {
        // chat-sdk's pure `debounce` strategy depends on the adapter
        // overwriting the slot. mnemonic/125 audit caught this.
        await adapter.enqueue(lockKey, queueEntry("d1", "first") as never, 1);
        await adapter.enqueue(lockKey, queueEntry("d2", "second") as never, 1);
        await adapter.enqueue(lockKey, queueEntry("d3", "third") as never, 1);
        expect(await adapter.queueDepth(lockKey)).toBe(1);
        const only = await adapter.dequeue(lockKey);
        expect(only?.message.id).toBe("d3");
        expect(await adapter.dequeue(lockKey)).toBeNull();
      });

      it("duplicate webhook delivery: dedupe blocks the second arrival", async () => {
        // Telegram's "second delivery" or chat-sdk's multi-path receipt
        // (Slack message + app_mention) — same message.id arrives twice,
        // dedupe must stop the second.
        const key = "dedupe:telegram:dup-1";
        expect(await adapter.setIfNotExists(key, true, DEDUPE_TTL)).toBe(true);
        expect(await adapter.setIfNotExists(key, true, DEDUPE_TTL)).toBe(false);
      });

      it("two warm instances racing on the same DB: exactly one wins the lock", async () => {
        // Fluid Compute can land two concurrent webhooks on different warm
        // instances, each with its own client connected to the same Turso
        // DB. The atomic upsert (107 #2a) must serialize them across
        // connections, not just within one. Open two separate clients on
        // the same file and race them.
        const { path, cleanup } = tmpFilePath();
        const dbA = await connect(path);
        const dbB = await connect(path);
        const a = new TursoStateAdapter({ client: dbA, logger: mockLogger });
        const b = new TursoStateAdapter({ client: dbB, logger: mockLogger });
        try {
          await a.connect();
          await b.connect();
          const results = await Promise.all([
            a.acquireLock("race-thread", LOCK_TTL),
            b.acquireLock("race-thread", LOCK_TTL),
          ]);
          const winners = results.filter((r) => r !== null);
          expect(winners.length).toBe(1);
        } finally {
          await a.disconnect();
          await b.disconnect();
          await dbA.close();
          await dbB.close();
          cleanup();
        }
      });

      it("message history: rolling window with TTL refresh and maxLength trim", async () => {
        // Telegram path: chat-sdk persists every incoming message via
        // `appendToList` with maxLength=100, ttl=7d. Replays the rolling
        // window contract: continuous activity refreshes TTL, count stays
        // bounded.
        const HIST_TTL = 7 * 24 * 60 * 60 * 1000;
        const HIST_MAX = 5;
        for (let i = 1; i <= 8; i++) {
          await adapter.appendToList(
            `msg-history:telegram:42`,
            { id: `h${i}`, text: `m${i}` },
            { maxLength: HIST_MAX, ttlMs: HIST_TTL },
          );
        }
        const history = await adapter.getList<{ id: string }>(`msg-history:telegram:42`);
        expect(history.map((h) => h.id)).toEqual(["h4", "h5", "h6", "h7", "h8"]);
      });
    });
  });
});

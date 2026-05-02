import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { env as _env, EnvNotFoundError, EnvParseError, z } from "./env";

const KEYS = ["TEST_REQUIRED", "TEST_OPTIONAL", "TEST_LIST", "TEST_PORT", "TEST_LABEL", "TEST_URL"] as const;

// Cast `env` to a record over `KEYS` so each access becomes a *named property*
// (not index-signature access). Index-signature access on a `string` key
// triggers `noUncheckedIndexedAccess` and adds `| undefined` to every read,
// but the Proxy's `get` handler always returns a real Env. Named-property
// typing reflects the runtime guarantee for keys we use in tests.
const env = _env as Record<(typeof KEYS)[number], (typeof _env)[string]>;

describe("env", () => {
  beforeEach(() => {
    for (const k of KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of KEYS) delete process.env[k];
  });

  test("env.X returns the raw value, usable as a string", () => {
    process.env.TEST_REQUIRED = "hello";
    const v = env.TEST_REQUIRED;
    expect(`${v}`).toBe("hello");
    expect(v.toString()).toBe("hello");
    expect(v.length).toBe(5);
  });

  test("env.X throws EnvNotFoundError on coerce when missing", () => {
    expect(() => `${env.TEST_REQUIRED}`).toThrow(EnvNotFoundError);
    expect(() => env.TEST_REQUIRED.toString()).toThrow(EnvNotFoundError);
  });

  test("env.X throws EnvNotFoundError on coerce when empty", () => {
    process.env.TEST_REQUIRED = "";
    expect(() => `${env.TEST_REQUIRED}`).toThrow(EnvNotFoundError);
  });

  test("EnvNotFoundError carries the key", () => {
    try {
      env.TEST_REQUIRED.toString();
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(EnvNotFoundError);
      expect((e as EnvNotFoundError).key).toBe("TEST_REQUIRED");
    }
  });

  test(".describe stashes a label that surfaces in error messages", () => {
    process.env.TEST_LABEL = "abc";
    try {
      env.TEST_LABEL.describe("port for the worker").pipe(z.coerce.number().int());
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("port for the worker");
    }
  });

  test(".describe surfaces in EnvNotFoundError when missing", () => {
    try {
      `${env.TEST_REQUIRED.describe("Telegram Bot API token")}`;
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(EnvNotFoundError);
      expect((e as EnvNotFoundError).description).toBe("Telegram Bot API token");
    }
  });

  test(".transform terminates and returns the transformed value", () => {
    process.env.TEST_LIST = "a,b, c ";
    const set = env.TEST_LIST.transform((s) => new Set(s.split(",").map((v) => v.trim())));
    expect(set).toBeInstanceOf(Set);
    expect(set.has("a")).toBe(true);
    expect(set.has("c")).toBe(true);
  });

  test(".transform throws on missing (required)", () => {
    expect(() => env.TEST_REQUIRED.transform((s) => s.toUpperCase())).toThrow(EnvNotFoundError);
  });

  test(".pipe runs the value through a Zod schema", () => {
    process.env.TEST_PORT = "8080";
    const port = env.TEST_PORT.pipe(z.coerce.number());
    expect(port).toBe(8080);
    expect(typeof port).toBe("number");
  });

  test(".pipe hard-fails (plain Error) on schema parse failure — not soft-fail", () => {
    process.env.TEST_PORT = "not-a-number";
    expect(() => env.TEST_PORT.pipe(z.coerce.number().int())).toThrow(/TEST_PORT/);
    expect(() => env.TEST_PORT.pipe(z.coerce.number().int())).not.toThrow(EnvNotFoundError);
  });

  test(".pipe throws EnvNotFoundError on missing (required)", () => {
    expect(() => env.TEST_REQUIRED.pipe(z.string())).toThrow(EnvNotFoundError);
  });

  // ─── .optional() ────────────────────────────────────────────────────

  test(".optional() is chainable — coerce throws on missing", () => {
    // Coercing an optional missing var doesn't make sense (toString can't
    // return string | undefined). Throw — caller should use .transform / .pipe.
    expect(() => `${env.TEST_OPTIONAL.optional()}`).toThrow(EnvNotFoundError);
  });

  test(".optional().transform() returns undefined when missing", () => {
    expect(env.TEST_OPTIONAL.optional().transform((s) => s.toUpperCase())).toBeUndefined();
  });

  test(".optional().transform() returns mapped value when set", () => {
    process.env.TEST_OPTIONAL = "abc";
    expect(env.TEST_OPTIONAL.optional().transform((s) => s.toUpperCase())).toBe("ABC");
  });

  test(".optional().pipe() returns undefined when missing", () => {
    expect(env.TEST_OPTIONAL.optional().pipe(z.coerce.number())).toBeUndefined();
  });

  test(".optional().pipe() returns parsed value when set", () => {
    process.env.TEST_OPTIONAL = "42";
    expect(env.TEST_OPTIONAL.optional().pipe(z.coerce.number())).toBe(42);
  });

  test(".optional().pipe() hard-fails on schema parse failure even when value is set", () => {
    process.env.TEST_OPTIONAL = "not-a-number";
    expect(() => env.TEST_OPTIONAL.optional().pipe(z.coerce.number().int())).toThrow(/TEST_OPTIONAL/);
  });

  test(".describe + .optional preserves the description for downstream errors", () => {
    process.env.TEST_OPTIONAL = "abc";
    try {
      env.TEST_OPTIONAL.describe("a label").optional().pipe(z.coerce.number().int());
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("a label");
    }
  });

  test(".optional().describe() also works (chain order doesn't matter)", () => {
    process.env.TEST_OPTIONAL = "abc";
    try {
      env.TEST_OPTIONAL.optional().describe("a label").pipe(z.coerce.number().int());
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("a label");
    }
  });

  // ─── .default() ─────────────────────────────────────────────────────

  test(".default() returns the fallback when missing — no throw", () => {
    expect(env.TEST_OPTIONAL.default("fallback").toString()).toBe("fallback");
  });

  test(".default('') is allowed even though the schema is nonempty", () => {
    // The fallback short-circuits the schema; nonempty applies only when raw is set.
    expect(env.TEST_OPTIONAL.default("").toString()).toBe("");
  });

  test(".default() returns the env value when set", () => {
    process.env.TEST_OPTIONAL = "actual";
    expect(env.TEST_OPTIONAL.default("fallback").toString()).toBe("actual");
  });

  test(".default().transform() always invokes the fn (no undefined branch)", () => {
    const set = env.TEST_LIST.default("").transform((s) => new Set(s.split(",").filter(Boolean)));
    expect(set).toBeInstanceOf(Set);
    expect(set.size).toBe(0);

    process.env.TEST_LIST = "a,b,c";
    const set2 = env.TEST_LIST.default("").transform((s) => new Set(s.split(",").filter(Boolean)));
    expect(set2.size).toBe(3);
  });

  test(".default() composes with .describe (order doesn't matter)", () => {
    expect(env.TEST_OPTIONAL.describe("a label").default("x").toString()).toBe("x");
    expect(env.TEST_OPTIONAL.default("x").describe("a label").toString()).toBe("x");
  });

  test(".default() narrows back to required after .optional()", () => {
    // An explicit fallback always returns a string, so the union collapses.
    const v: string = env.TEST_OPTIONAL.optional().default("x").toString();
    expect(v).toBe("x");
  });

  test(".default() still hard-fails on schema parse failure when set", () => {
    process.env.TEST_PORT = "not-a-number";
    expect(() => env.TEST_PORT.default("8080").pipe(z.coerce.number().int())).toThrow(EnvParseError);
  });

  // ─── soft/hard-fail discriminator ────────────────────────────────────

  test("missing-required vs malformed-set is the soft/hard discriminator", () => {
    // Missing required → soft (EnvNotFoundError, codegen catches and skips module)
    expect(() => `${env.TEST_REQUIRED}`).toThrow(EnvNotFoundError);

    // Set-but-malformed → hard (EnvParseError, propagates)
    process.env.TEST_PORT = "abc";
    expect(() => env.TEST_PORT.pipe(z.coerce.number().int())).toThrow(EnvParseError);
    expect(() => env.TEST_PORT.pipe(z.coerce.number().int())).not.toThrow(EnvNotFoundError);
  });

  // ─── EnvParseError: must NOT leak the actual value ──────────────────

  test("EnvParseError does NOT include the env value in its message (secret-safe)", () => {
    const secret = "ghp_aSecretTokenThatMustNeverLeak123456789";
    process.env.TEST_REQUIRED = secret;
    try {
      env.TEST_REQUIRED.pipe(z.string().regex(/^[0-9]+$/));
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(EnvParseError);
      expect((e as Error).message).not.toContain(secret);
      expect((e as Error).message).not.toContain("ghp_");
      expect((e as Error).message).toContain("TEST_REQUIRED");
    }
  });

  test("EnvParseError carries the key", () => {
    process.env.TEST_PORT = "abc";
    try {
      env.TEST_PORT.pipe(z.coerce.number().int());
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(EnvParseError);
      expect((e as EnvParseError).key).toBe("TEST_PORT");
    }
  });

  test("EnvParseError includes secret-safe issue codes", () => {
    process.env.TEST_PORT = "abc";
    try {
      env.TEST_PORT.pipe(z.coerce.number().int());
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(EnvParseError);
      const msg = (e as Error).message;
      // Should contain a code indicator (Zod code names are stable)
      expect(msg.length).toBeGreaterThan("[openxyz] env TEST_PORT: ".length);
    }
  });
});

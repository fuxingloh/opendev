import { z, type ZodType } from "zod";
export { z } from "zod";

/**
 * Thrown when an env var is missing or empty. Codegen wraps
 * channel/tool/drive imports in a per-module try/catch and treats this
 * specific error as a soft-skip (the module isn't loaded; siblings keep
 * working). `EnvParseError` (set-but-malformed) stays a hard-fail.
 *
 * mnemonic/138 — soft-load on missing env.
 */
export class EnvNotFoundError extends Error {
  override readonly name = "EnvNotFoundError";
  constructor(
    public readonly key: string,
    public readonly description: string,
  ) {
    super(`env ${key} is not set${description ? `: ${description}` : ""}`);
  }
}

/**
 * Thrown when an env var is set but fails the schema's validation.
 *
 * **Secret-safe:** the message intentionally omits Zod's `received` /
 * `input` / `message` fields (any of which can echo the actual value back).
 * It surfaces `code` + `expected` only — enough to debug, not enough to
 * leak a token. The parsed value is never serialized into the error.
 *
 * Hard-fail: codegen does NOT soft-skip on this — a malformed value is a
 * user bug to surface, not silently ignore.
 */
export class EnvParseError extends Error {
  override readonly name = "EnvParseError";
  constructor(
    public readonly key: string,
    public readonly description: string,
    public readonly codes: ReadonlyArray<string>,
  ) {
    const detail = codes.length > 0 ? codes.join(", ") : "validation failed";
    super(`[openxyz] env ${key}: ${detail}${description ? ` (${description})` : ""}`);
  }
}

/**
 * Pull secret-safe codes out of a ZodError. Skips `message` / `received` /
 * `input` (any of which can include the original value) — keeps `code` and
 * `expected` only.
 */
function safeIssueCodes(error: {
  issues: ReadonlyArray<{ code?: string; expected?: string; path?: PropertyKey[] }>;
}): string[] {
  return error.issues.map((i) => {
    const parts: string[] = [];
    if (i.code) parts.push(i.code);
    if (i.expected) parts.push(`expected ${i.expected}`);
    if (i.path && i.path.length > 0) parts.push(`at .${i.path.join(".")}`);
    return parts.join(" ") || "invalid";
  });
}

type Kind = "required" | "optional";

class Env<T extends string | undefined = string> extends String {
  readonly #key: string;
  readonly #kind: Kind;
  readonly #description: string | undefined;
  readonly #schema: ZodType<T>;

  constructor(key: string, kind: Kind = "required", description?: string) {
    super(process.env[key] ?? "");
    this.#key = key;
    this.#kind = kind;
    this.#description = description;
    this.#schema = (kind === "optional" ? z.string().optional() : z.string().nonempty()) as unknown as ZodType<T>;
  }

  /** Stash a label that surfaces in error messages. */
  describe(desc: string): T & Env<T> {
    return new Env<T>(this.#key, this.#kind, desc) as T & Env<T>;
  }

  /** Switch to optional semantics — missing is no longer an error. */
  optional(): (string | undefined) & Env<string | undefined> {
    return new Env<string | undefined>(this.#key, "optional", this.#description) as (string | undefined) &
      Env<string | undefined>;
  }

  /**
   * Apply a function to the parsed string.
   * - Required: throws `EnvNotFoundError` if missing, returns `U`.
   * - Optional (after `.optional()`): returns `U | undefined`.
   */
  transform<U>(fn: (s: string) => U): T extends string ? U : U | undefined {
    const value = this.#parse();
    if (value === undefined) return undefined as T extends string ? U : U | undefined;
    return fn(value) as T extends string ? U : U | undefined;
  }

  /**
   * Pipe through a Zod schema (regex/email/url/coerce/...).
   * - Required: throws on missing, returns `U`.
   * - Optional: returns `U | undefined` when missing.
   */
  pipe<U>(schema: ZodType<U>): T extends string ? U : U | undefined {
    const value = this.#parse();
    if (value === undefined) return undefined as T extends string ? U : U | undefined;
    const result = schema.safeParse(value);
    if (!result.success) throw this.#parseError(result.error);
    return result.data as T extends string ? U : U | undefined;
  }

  override toString(): string {
    const value = this.#parse();
    if (value === undefined) {
      // Optional + string-coerce is meaningless: `toString` can't return
      // `string | undefined`. Throw — caller should use `.transform` /
      // `.pipe` to consume an optional value, not coerce it to a primitive.
      throw new EnvNotFoundError(this.#key, this.#description ?? "");
    }
    return value;
  }

  override valueOf(): string {
    return this.toString();
  }

  [Symbol.toPrimitive](_hint: string): string {
    return this.toString();
  }

  /**
   * Run `#schema.safeParse(process.env[#key])`. Empty string is normalized to
   * `undefined` first so the schema's `nonempty`/`optional` semantics decide
   * the outcome. Parse-failure on a *set* value is `EnvParseError`
   * (hard-fail); missing-on-required is `EnvNotFoundError` (soft-fail).
   */
  #parse(): T {
    const env = process.env[this.#key];
    const raw = env === "" ? undefined : env;
    const result = this.#schema.safeParse(raw);
    if (!result.success) {
      if (raw === undefined) {
        throw new EnvNotFoundError(this.#key, this.#description ?? "");
      }
      throw this.#parseError(result.error);
    }
    return result.data;
  }

  /** Wrap a ZodError as a secret-safe `EnvParseError`. */
  #parseError(error: {
    issues: ReadonlyArray<{ code?: string; expected?: string; path?: PropertyKey[] }>;
  }): EnvParseError {
    return new EnvParseError(this.#key, this.#description ?? "", safeIssueCodes(error));
  }
}

/**
 * Property-access env reader.
 *
 *   env.TELEGRAM_BOT_TOKEN                                         // string (required)
 *   env.TELEGRAM_BOT_TOKEN.describe("...")                         // string with label
 *   env.GITHUB_TOKEN.optional()                                    // string | undefined
 *   env.X.optional().transform((s) => new Set(s.split(",")))       // T | undefined
 *   env.X.transform((s) => new Set(s.split(",")))                  // T (throws if missing)
 *   env.PORT.pipe(z.coerce.number())                               // number
 *   env.X.optional().pipe(z.coerce.number())                       // number | undefined
 *
 * Required reads throw `EnvNotFoundError` on coerce or terminal call when
 * missing. After `.optional()`, missing propagates as `undefined` through
 * `.transform` / `.pipe`.
 *
 * Runtime is `Env<T>` (extends `String`), type-asserted to `T & Env<T>`
 * so `const fe: string = env.FE` typechecks and string ops (template
 * literals, `.split`, `.length`) work via `String.prototype`.
 *
 * mnemonic/138 — full design + footguns.
 */
export const env = new Proxy({} as { readonly [K: string]: string & Env }, {
  get(_, key) {
    if (typeof key !== "string") return undefined;
    return new Env(key);
  },
});

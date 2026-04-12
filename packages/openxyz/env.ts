import { z, type ZodType } from "zod";

const nonEmpty = z.string().min(1);

/**
 * Read and validate an env var. Defaults to a non-empty string if `type` is omitted.
 */
export function readEnv(key: string, opts: { description: string }): string;
export function readEnv<T>(key: string, opts: { description: string; type: ZodType<T> }): T;
export function readEnv<T>(key: string, opts: { description: string; type?: ZodType<T> }): T | string {
  const raw = process.env[key];
  const result = (opts.type ?? nonEmpty).safeParse(raw);
  if (!result.success) {
    const msg = result.error.issues.map((i) => i.message).join(", ");
    throw new Error(`[openxyz] env ${key}: ${msg}`);
  }
  return result.data;
}

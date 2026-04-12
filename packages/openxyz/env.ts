import { z, type ZodType } from "zod";
export { z } from "zod";

/**
 * Read and validate an env var. Defaults to a non-empty string if `schema` is omitted.
 */
export function readEnv(key: string, opts: { description: string }): string;
export function readEnv<T>(key: string, opts: { description: string; schema: ZodType<T> }): T;
export function readEnv<T>(key: string, opts: { description: string; schema?: ZodType<T> }): T | string {
  const raw = process.env[key];
  const result = (opts.schema ?? z.string().nonempty()).safeParse(raw);
  if (!result.success) {
    const msg = result.error.issues.map((i) => i.message).join(", ");
    throw new Error(`[openxyz] env ${key}: ${msg}`);
  }
  return result.data;
}

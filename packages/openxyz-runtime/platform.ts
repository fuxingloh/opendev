/**
 * Which deploy platform is hosting this process.
 *
 * - `local` — `openxyz start`, dev loops, bare Bun server
 * - `vercel` — `openxyz build --platform vercel` bakes this into the bundle
 * - `cloudflare` — `openxyz build --platform cloudflare` bakes this in
 * - `unknown` — env var not provided. Callers should treat this as
 *   "don't assume anything" and pick a safe default.
 *
 * Channel adapters can branch on `platform()` to pick e.g. webhook vs polling
 * without the template author touching env wiring.
 */
export type Platform = "local" | "vercel" | "cloudflare" | "unknown";

export function platform(): Platform {
  const v = process.env.OPENXYZ_PLATFORM;
  if (v === "local") return "local";
  if (v === "vercel") return "vercel";
  if (v === "cloudflare") return "cloudflare";
  return "unknown";
}

import { createRedisState as createRedisStateAdapter } from "@chat-adapter/state-redis";

/**
 * chat-sdk state backed by Redis.
 *
 * Preferred adapter for serverless deploys — Redis clients reconnect cleanly
 * across invocations and don't suffer the stale-pool issues that `pg.Pool`
 * hits on Vercel (see mnemonic/067 context).
 */
export async function createRedisState(url: string) {
  return createRedisStateAdapter({ url });
}

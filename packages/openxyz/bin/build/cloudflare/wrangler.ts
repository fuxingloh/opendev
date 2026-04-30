/**
 * Generate the wrangler.jsonc that pairs with `dist/_worker.js`. Emits a
 * Workers config (not Pages) so deploys go through `wrangler deploy`.
 */
export type WranglerConfig = {
  name: string;
  /** Today's date in YYYY-MM-DD; bumped occasionally for Workers compat semver */
  compatibility_date: string;
};

export function generateWranglerJsonc(opts: WranglerConfig): string {
  // mnemonic/133: OPENXYZ_STATE binding name uses our namespacing convention,
  // not chat-state-cloudflare-do's example CHAT_STATE.
  const cfg = {
    $schema: "node_modules/wrangler/config-schema.json",
    name: opts.name,
    main: "dist/_worker.js",
    compatibility_date: opts.compatibility_date,
    // nodejs_compat covers fs/path/crypto/stream/events used across the
    // bundle (chat-sdk, AI SDK, our own utils). Workers' polyfill also
    // mirrors Workers Secrets into `process.env` so existing
    // `process.env.X` reads keep working.
    compatibility_flags: ["nodejs_compat"],
    durable_objects: {
      bindings: [{ name: "OPENXYZ_STATE", class_name: "ChatStateDO" }],
    },
    migrations: [{ tag: "v1", new_sqlite_classes: ["ChatStateDO"] }],
    observability: { enabled: true },
  };
  return JSON.stringify(cfg, null, 2) + "\n";
}

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
  // mnemonic/133: binding name reflects the chat-sdk StateAdapter role,
  // not the openxyz brand. CHAT_STATE matches chat-state-cloudflare-do's
  // convention; the OPENXYZ_* prefix is reserved for config vars
  // (OPENXYZ_BACKEND, OPENXYZ_MODEL), not runtime bindings.
  const cfg = {
    $schema: "node_modules/wrangler/config-schema.json",
    name: opts.name,
    main: "dist/_worker.js",
    compatibility_date: opts.compatibility_date,
    // nodejs_compat covers fs/path/crypto/stream/events used across the
    // bundle (chat-sdk, AI SDK, our own utils). Workers' polyfill mirrors
    // Workers Secrets into `process.env` so existing `process.env.X`
    // reads keep working.
    //
    // nodejs_compat_populate_process_env additionally exposes plaintext
    // `vars` (not just secrets) via `process.env`. Without it, channel
    // modules that read non-secret env vars at module-init (e.g.
    // TELEGRAM_ALLOWLIST in templates/openbrain/channels/telegram.ts)
    // fail Cloudflare's startup validation. Becomes default at compat
    // date 2025-04-01; we keep it explicit so older compat dates still
    // work if the user hand-edits the file.
    compatibility_flags: ["nodejs_compat", "nodejs_compat_populate_process_env"],
    durable_objects: {
      bindings: [{ name: "CHAT_STATE", class_name: "ChatStateDO" }],
    },
    migrations: [{ tag: "v1", new_sqlite_classes: ["ChatStateDO"] }],
    observability: { enabled: true },
  };
  return JSON.stringify(cfg, null, 2) + "\n";
}

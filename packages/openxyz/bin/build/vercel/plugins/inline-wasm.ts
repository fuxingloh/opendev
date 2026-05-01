import type { BunPlugin } from "bun";

/**
 * Force `import x from "*.{wasm,ttf,otf,woff,woff2}"` to inline as a
 * `Uint8Array` literal.
 *
 * Bun.build's default loader for these extensions emits a separate file
 * asset and binds the import to a relative URL string. On Vercel's Node 22
 * runtime that string lands in `fetch()` (via consumers' wasm-bindgen
 * glue or satori's font loader) which throws `Failed to parse URL from
 * ./<file>.<ext>` — the function dir isn't a valid base URL.
 *
 * The `with { type: "binary" }` import attribute *should* fix this, but
 * Bun ignores it for these binary extensions (defaults to file loader).
 * This plugin overrides that — base64 the bytes inline, decode to a
 * `Uint8Array` at module-init. No runtime fs reads, no URL resolution.
 *
 * Bundle bloat: each asset grows ~33% (base64 overhead). Acceptable for
 * the few binaries we ship (resvg wasm + Roboto TTFs) versus the
 * runtime crash.
 */
export function inlineWasmPlugin(): BunPlugin {
  return {
    name: "openxyz-inline-binary-assets",
    setup(build) {
      build.onLoad({ filter: /\.(wasm|ttf|otf|woff2?|png|jpg|jpeg)$/ }, async (args) => {
        const buf = await Bun.file(args.path).bytes();
        const b64 = Buffer.from(buf).toString("base64");
        return {
          loader: "ts",
          contents: `const b = Buffer.from(${JSON.stringify(b64)}, "base64");\nexport default new Uint8Array(b.buffer, b.byteOffset, b.byteLength);\n`,
        };
      });
    },
  };
}

import type { BunPlugin } from "bun";

/**
 * Two-fer: vfile (transitive dep via chat-sdk's markdown pipeline) ships
 * node-only `minproc.js` / `minurl.js` shims that import `node:process` /
 * `node:url` at module top level. Workers' deploy-time validator can't
 * resolve `node:process` (the import is statically analyzed and rejected
 * regardless of nodejs_compat flags), so the deploy fails before the worker
 * ever runs.
 *
 * Two interceptions:
 *  1. `node:process` → virtual module that re-exports `globalThis.process`,
 *     polyfilled by Workers' nodejs_compat at runtime.
 *  2. vfile's resolved `lib/minproc.js` / `lib/minurl.js` / `lib/minpath.js`
 *     paths → their `.browser.js` siblings. vfile already ships these
 *     polyfills for the "browser" condition; we just hand-pick them.
 *     The browser variants don't import `node:url` either, killing both
 *     birds.
 */
export function vfileBrowserShimPlugin(): BunPlugin {
  return {
    name: "openxyz-vfile-browser-shim",
    setup(build) {
      // 1. Replace any `node:process` import with a globalThis.process stub.
      build.onResolve({ filter: /^node:process$/ }, () => ({
        path: "node-process-shim",
        namespace: "openxyz-shim",
      }));
      build.onLoad({ filter: /^node-process-shim$/, namespace: "openxyz-shim" }, () => ({
        loader: "js",
        contents: `export default globalThis.process;`,
      }));

      // 2. Force vfile to use its browser variants. Bun normally picks `.js`
      // (the node condition) because of `target: "node"`. Resolved paths
      // are absolute, so the regex anchors on the package directory tail.
      build.onResolve({ filter: /vfile\/lib\/(minproc|minurl|minpath)\.js$/ }, (args) => ({
        path: args.path.replace(/\.js$/, ".browser.js"),
      }));
    },
  };
}

import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    bin: "./commands/bin.ts",
    tools: "./tools.ts",
  },
  format: "esm",
  platform: "node",
  dts: true,
});

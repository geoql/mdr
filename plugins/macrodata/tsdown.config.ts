import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    "opencode/index": "opencode/index.ts",
    "bin/macrodata-daemon": "bin/macrodata-daemon.ts",
    "bin/index-conversations": "bin/index-conversations.ts",
    "src/index": "src/index.ts",
    "src/daemon": "src/daemon.ts",
  },
  format: "esm",
  platform: "node",
  target: "node24",
  unbundle: true,
  dts: false,
  minify: false,
  treeshake: false,
  outDir: "dist",
  outExtensions: () => ({ js: ".js" }),
  copy: [{ from: "opencode/skills", to: "dist/opencode", flatten: false }],
});

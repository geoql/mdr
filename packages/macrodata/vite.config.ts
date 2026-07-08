import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
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
  },
  lint: {
    plugins: ["typescript", "import"],
    ignorePatterns: ["dist", "node_modules", "coverage", "test/fixtures"],
  },
  fmt: {
    printWidth: 100,
    semi: true,
    singleQuote: false,
    tabWidth: 2,
    trailingComma: "all",
    bracketSpacing: true,
    arrowParens: "always",
    endOfLine: "lf",
    ignorePatterns: ["dist", "node_modules", "coverage", "pnpm-lock.yaml"],
  },
});

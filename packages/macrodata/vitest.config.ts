import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "macrodata",
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    // Real embedding-model loads and daemon spawns exceed the 5s default.
    testTimeout: 90000,
    hookTimeout: 90000,
  },
});

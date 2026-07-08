import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['plugins/*'],
    coverage: {
      provider: 'v8',
      include: [
        'plugins/*/src/**/*.ts',
        'plugins/*/opencode/**/*.ts',
        'plugins/*/bin/**/*.ts',
      ],
      exclude: ['plugins/*/dist/**', '**/*.d.ts'],
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});

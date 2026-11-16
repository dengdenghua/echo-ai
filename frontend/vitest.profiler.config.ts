import { defineConfig } from "vitest/config";

import baseConfig from "./vite.config";

const base = baseConfig as Record<string, unknown> & {
  test?: Record<string, unknown>;
};

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["benchmarks/**/*.profiler.test.tsx"],
    exclude: ["node_modules/**", "dist/**", "release/**", "e2e/**"],
    projects: undefined,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});

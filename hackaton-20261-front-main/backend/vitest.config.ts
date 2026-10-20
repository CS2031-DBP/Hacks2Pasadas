import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["test/**/*.test.ts"],
    exclude: ["dist/**", "**/node_modules/**"],
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});

import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@codex-keeper/core": path.resolve("packages/core/src/index.ts"),
      "@codex-keeper/shared": path.resolve("packages/shared/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});

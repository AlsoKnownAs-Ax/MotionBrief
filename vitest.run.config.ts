import { defineConfig } from "vitest/config";

/**
 * Checks run on demand rather than in `pnpm test`: the contact sheet (`pnpm contact-sheet`) and the one-off spike
 * check (`pnpm spike-check`). They load the frame through Vite like the tests do, so they run under Vitest too.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.run.ts"],
    environment: "node",
    testTimeout: 900_000,
    teardownTimeout: 5_000,
  },
});

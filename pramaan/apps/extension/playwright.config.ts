import { defineConfig } from "@playwright/test";

// Extension E2E needs the full Chromium build (extensions do not load in the headless shell) and the local demo
// running (`pnpm demo:up`). Run with: pnpm --filter @pramaan/extension test:e2e
export default defineConfig({
  testDir: "test",
  testMatch: /.*\.e2e\.ts/,
  timeout: 240_000,
  workers: 1,
  reporter: [["list"]],
});

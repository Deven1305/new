import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "manifest", root: "packages/manifest", include: ["test/**/*.test.ts"] } },
      { test: { name: "decoder", root: "packages/decoder", include: ["test/**/*.test.ts"] } },
      { test: { name: "verifier-core", root: "packages/verifier-core", include: ["test/**/*.test.ts"], testTimeout: 60_000 } },
      { test: { name: "release", root: "packages/release", include: ["test/**/*.test.ts"], testTimeout: 300_000, hookTimeout: 120_000 } },
      { test: { name: "engine", root: "packages/engine", include: ["test/**/*.test.ts"], testTimeout: 900_000, hookTimeout: 900_000 } },
      { test: { name: "extension-unit", root: "apps/extension", include: ["test/**/*.unit.test.ts"] } },
      { test: { name: "server", root: "apps/server", include: ["test/**/*.test.ts"], testTimeout: 120_000 } },
      { test: { name: "cli", root: "apps/cli", include: ["test/**/*.test.ts"], testTimeout: 600_000 } },
      { test: { name: "demos", root: "apps/demos", include: ["test/**/*.test.ts"], testTimeout: 300_000 } },
      { test: { name: "web", root: "apps/web", include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"], environment: "jsdom" } },
    ],
  },
});

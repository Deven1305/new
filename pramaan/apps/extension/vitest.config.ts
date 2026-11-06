import { defineConfig } from "vitest/config";

// Pure extension logic (leak matching, RPC-read descriptions, fail-closed policy). Browser behaviour is in test/*.e2e.ts.
export default defineConfig({ test: { include: ["test/unit/**/*.test.ts"] } });

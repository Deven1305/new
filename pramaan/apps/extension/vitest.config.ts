import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Pure extension logic (leak matching, RPC-read descriptions, fail-closed policy, HexFence recipient row).
// Browser behaviour is in test/*.e2e.ts.
export default defineConfig({
  resolve: { alias: { "@hexfence/shared": fileURLToPath(new URL("../../../packages/shared/src/index.ts", import.meta.url)) } },
  test: { include: ["test/unit/**/*.test.ts"] },
});

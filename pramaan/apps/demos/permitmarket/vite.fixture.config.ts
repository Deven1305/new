import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      input: resolve(__dirname, "fixtures/leak.html"),
    },
  },
});


import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The dashboard talks to the Pramaan backend at VITE_API_URL (default http://localhost:8787). The backend's
// WEB_ORIGINS and SIWE_DOMAINS default to this dev port, so keep 5173 as the default; pass --port to run elsewhere.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  build: {
    target: "es2022",
    sourcemap: true,
    // No module-preload polyfill: it is an inline script, and the dashboard ships none.
    modulePreload: { polyfill: false },
  },
});

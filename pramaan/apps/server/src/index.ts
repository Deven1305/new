import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

// Local development convenience (same as the CLI): read <repo>/.env. Variables already set in the shell win.
try {
  process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch {
  // no .env file: environment variables only
}

const cfg = loadConfig();
const app = await createApp({ worker: cfg.EMBEDDED_WORKER });
await app.listen({ host: cfg.HOST, port: cfg.PORT });

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const cfg = loadConfig();
const app = await createApp({ worker: cfg.EMBEDDED_WORKER });
await app.listen({ host: cfg.HOST, port: cfg.PORT });

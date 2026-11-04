import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const cfg = loadConfig();
const app = await createApp();
await app.listen({ host: cfg.HOST, port: cfg.PORT });

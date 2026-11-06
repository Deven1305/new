import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { startWorker } from "./worker.js";

/** Stand-alone worker for production: needs DATABASE_URL so it shares the queue with the API process. */
const cfg = loadConfig();
if (!cfg.DATABASE_URL) throw new Error("a stand-alone worker needs DATABASE_URL (the embedded PGlite database cannot be shared between processes)");
const db = await openDb({ databaseUrl: cfg.DATABASE_URL });
const log = {
  info: (o: unknown, m?: string) => console.log(m ?? "", o),
  warn: (o: unknown, m?: string) => console.warn(m ?? "", o),
  error: (o: unknown, m?: string) => console.error(m ?? "", o),
};
const w = startWorker(db, cfg, log);
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => void w.stop().then(() => db.close()).then(() => process.exit(0)));

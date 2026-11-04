import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { analyzeRequest, isGuardedMethod, toJsonSafe } from "@pramaan/decoder";
import { z } from "zod";
import { loadConfig } from "./config.js";

/** Incremental public API: unsupported endpoints return 501 until implemented. */
export async function createApp() {
  const cfg = loadConfig();
  const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 });
  await app.register(cors, { origin: cfg.webOrigins, credentials: true });
  await app.register(rateLimit, { max: cfg.RATE_LIMIT_PUBLIC_MAX, timeWindow: cfg.RATE_LIMIT_WINDOW_MS });
  app.get("/healthz", async () => ({ ok: true }));
  app.get("/readyz", async (_req, reply) => reply.code(503).send({ ok: false, db: false, worker: false, reason: "backend integration incomplete" }));
  const schema = z.object({ method: z.string(), params: z.unknown(), chainId: z.number().int().nonnegative().optional(), origin: z.string().optional() });
  app.post("/v1/decode", async (req, reply) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success || !isGuardedMethod(parsed.data.method)) return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: "Expected a supported wallet method and parameters" } });
    return toJsonSafe(await analyzeRequest(parsed.data.method, parsed.data.params, { chainId: parsed.data.chainId ?? 0, origin: parsed.data.origin }));
  });
  app.setNotFoundHandler((_req, reply) => reply.code(501).send({ error: { code: "NOT_IMPLEMENTED", message: "This API endpoint is not implemented yet" } }));
  return app;
}

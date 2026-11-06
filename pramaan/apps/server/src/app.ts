import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { analyzeRequest, isGuardedMethod, toJsonSafe } from "@pramaan/decoder";
import { SANDBOX_IMAGE } from "@pramaan/engine";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";
import {
  bootstrapAdmin,
  CSRF_HEADER,
  safeEqual,
  userFromRequest,
} from "./auth.js";
import { capabilities, loadConfig, type Config } from "./config.js";
import { resolveDeps, type Ctx, type DepsInput } from "./context.js";
import { openDb, type Db } from "./db.js";
import { forbidden, HttpError, safeMessage } from "./errors.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerFindingRoutes } from "./routes/findings.js";
import { registerJobRoutes } from "./routes/jobs.js";
import { registerPublicRoutes } from "./routes/public.js";
import { registerReleaseRoutes } from "./routes/releases.js";
import { startMonitorPoller } from "./monitor.js";
import { startWorker } from "./worker.js";
import { registerIngestRoutes } from "./routes/ingest.js";
import { registerMonitorRoutes } from "./routes/monitors.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerStatsRoutes } from "./routes/stats.js";
import { registerTokenRoutes } from "./routes/tokens.js";

export interface AppOptions {
  cfg?: Config;
  db?: Db;
  deps?: DepsInput;
  skipBootstrap?: boolean;
  /** Run the analysis job worker inside this process (the dev server does; tests do not). */
  worker?: boolean;
  /** Run the on-chain monitor poller inside this process (defaults to the `worker` setting). */
  monitors?: boolean;
  logger?: boolean;
}

/**
 * Creates the Fastify API application with injectable config, db and dependencies.
 * Unsupported endpoints return 501 until implemented.
 */
export async function createApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  const cfg = opts.cfg ?? loadConfig();
  const deps = resolveDeps(opts.deps);
  const ownedDb = !opts.db;
  const db = opts.db ?? (await openDb({ databaseUrl: cfg.DATABASE_URL, dataDir: cfg.DATA_DIR }));

  const app = Fastify({
    logger: opts.logger ?? (cfg.production ? true : { level: cfg.LOG_LEVEL }),
    bodyLimit: 1024 * 1024,
  });

  const ctx: Ctx = {
    cfg,
    db,
    deps,
    log: app.log,
  };

  let worker: { stop: () => Promise<void> } | null = null;
  let poller: { stop: () => Promise<void> } | null = null;

  const secretList = [
    cfg.TELEGRAM_BOT_TOKEN,
    cfg.GITHUB_TOKEN,
    cfg.GITHUB_WEBHOOK_SECRET,
    cfg.CRE_INGEST_SECRET,
    cfg.PINATA_JWT,
    cfg.PROPOSER_PRIVATE_KEY,
  ];

  await app.register(cookie);
  await app.register(cors, {
    origin: cfg.webOrigins,
    credentials: true,
    allowedHeaders: ["authorization", "content-type", CSRF_HEADER],
  });
  await app.register(rateLimit, {
    max: cfg.RATE_LIMIT_MAX,
    timeWindow: cfg.RATE_LIMIT_WINDOW_MS,
  });

  const defaultJsonParser = app.getDefaultJsonParser("error", "error");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body: Buffer, done) => {
    req.rawBody = body;
    defaultJsonParser(req, body.toString("utf8"), done);
  });

  app.decorateRequest("user", null);
  app.decorateRequest("rawBody", null);

  app.addHook("onClose", async () => {
    await worker?.stop();
    if (ownedDb) {
      await db.close();
    }
  });

  app.addHook("preHandler", async (req) => {
    req.user = await userFromRequest(db, req, deps.now());

    const mutating = ["POST", "PATCH", "DELETE", "PUT"].includes(req.method);
    if (req.user?.via === "session" && mutating) {
      const pathname = req.url.split("?")[0];
      const isExempt = pathname === "/v1/auth/siwe" || pathname === "/v1/decode" || pathname === "/v1/ingest/cre" || pathname === "/v1/webhooks/github";
      if (!isExempt) {
        const csrfHeader = req.headers[CSRF_HEADER];
        if (
          typeof csrfHeader !== "string" ||
          !csrfHeader.trim() ||
          !req.user.csrfToken ||
          !safeEqual(csrfHeader.trim(), req.user.csrfToken)
        ) {
          throw forbidden("CSRF token missing or invalid", "CSRF_INVALID");
        }
      }
    }
  });

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: safeMessage(error, secretList),
        },
      });
    }

    const errObj =
      typeof error === "object" && error !== null
        ? (error as { statusCode?: number; validation?: unknown; name?: string; message?: string })
        : null;
    const isZod = error instanceof z.ZodError || errObj?.name === "ZodError";
    const isValidation = Boolean(errObj?.validation) || isZod || errObj?.statusCode === 400;

    if (isValidation) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_FAILED",
          message: safeMessage(error, secretList),
        },
      });
    }

    const rawStatus = errObj?.statusCode;
    const status = typeof rawStatus === "number" && rawStatus >= 400 && rawStatus < 600 ? rawStatus : 500;
    if (status === 429) {
      return reply.code(429).send({
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests",
        },
      });
    }

    req.log.error({ err: safeMessage(error, secretList) }, "server error");
    return reply.code(status).send({
      error: {
        code: status === 500 ? "INTERNAL_ERROR" : "ERROR",
        message: status === 500 ? "internal server error" : safeMessage(error, secretList),
      },
    });
  });

  if (!opts.skipBootstrap) {
    await bootstrapAdmin(db, cfg, (msg) => {
      const safe = safeMessage(msg);
      if (safe.includes("admin API token")) {
        app.log.info("bootstrap admin initialized");
      } else {
        app.log.info(safe);
      }
    });
  }

  if (opts.worker) worker = startWorker(db, cfg, app.log);
  if (opts.monitors ?? opts.worker) poller = startMonitorPoller(ctx);

  // Health and readiness endpoints
  app.get("/healthz", async () => ({ ok: true }));

  app.get("/readyz", async (_req, reply) => {
    let dbOk = false;
    try {
      await db.one("SELECT 1 AS ok");
      dbOk = true;
    } catch {
      dbOk = false;
    }
    const docker = await deps.dockerStatus();
    const workerOk = worker !== null;
    const ok = dbOk && workerOk;
    return reply.code(ok ? 200 : 503).send({
      ok,
      db: dbOk,
      worker: workerOk,
      docker: {
        available: docker.available,
        image: docker.imagePresent ? SANDBOX_IMAGE : null,
        detail: docker.detail,
      },
    });
  });

  app.get("/v1/config", async () => {
    return capabilities(cfg, deps.aiAvailable());
  });

  // Decode public endpoint
  const decodeSchema = z.object({
    method: z.string(),
    params: z.unknown(),
    chainId: z.number().int().nonnegative().optional(),
    origin: z.string().optional(),
  });
  app.post(
    "/v1/decode",
    {
      config: {
        rateLimit: {
          max: cfg.RATE_LIMIT_PUBLIC_MAX,
          timeWindow: cfg.RATE_LIMIT_WINDOW_MS,
        },
      },
    },
    async (req, reply) => {
      const parsed = decodeSchema.safeParse(req.body);
      if (!parsed.success || !isGuardedMethod(parsed.data.method)) {
        return reply.code(400).send({
          error: {
            code: "VALIDATION_FAILED",
            message: "Expected a supported wallet method and parameters",
          },
        });
      }
      return toJsonSafe(
        await analyzeRequest(parsed.data.method, parsed.data.params, {
          chainId: parsed.data.chainId ?? 0,
          origin: parsed.data.origin,
        }),
      );
    },
  );

  // Feature routes
  registerAuthRoutes(app, ctx);
  registerTokenRoutes(app, ctx);
  registerProjectRoutes(app, ctx);
  registerStatsRoutes(app, ctx);
  registerIngestRoutes(app, ctx);
  registerMonitorRoutes(app, ctx);
  registerJobRoutes(app, ctx);
  registerFindingRoutes(app, ctx);
  registerReleaseRoutes(app, ctx);
  registerPublicRoutes(app, ctx);

  // Fallback for unimplemented endpoints
  app.setNotFoundHandler((_req, reply) =>
    reply.code(501).send({
      error: {
        code: "NOT_IMPLEMENTED",
        message: "This API endpoint is not implemented yet",
      },
    }),
  );

  return app;
}

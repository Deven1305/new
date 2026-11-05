import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  SESSION_COOKIE,
  createSession,
  issueNonce,
  requireUser,
  revokeSession,
  verifySiwe,
} from "../auth.js";
import type { Ctx } from "../context.js";
import { parse } from "../errors.js";

const SiweBodySchema = z.object({
  message: z.string().min(1),
  signature: z.string().min(1),
});

export function registerAuthRoutes(app: FastifyInstance, ctx: Ctx): void {
  const authRateLimit = {
    config: {
      rateLimit: {
        max: ctx.cfg.RATE_LIMIT_AUTH_MAX,
        timeWindow: ctx.cfg.RATE_LIMIT_WINDOW_MS,
      },
    },
  };

  app.get("/v1/auth/nonce", authRateLimit, async () => {
    const nonce = await issueNonce(ctx.db, ctx.deps.now());
    return { nonce };
  });

  app.post("/v1/auth/siwe", authRateLimit, async (req, reply) => {
    const body = parse(SiweBodySchema, req.body, "SIWE body");
    const { userId, address, isAdmin } = await verifySiwe(
      ctx.db,
      ctx.cfg,
      body.message,
      body.signature,
      ctx.deps.now(),
    );
    const userAgent = req.headers["user-agent"];
    const session = await createSession(
      ctx.db,
      ctx.cfg,
      userId,
      userAgent,
      ctx.deps.now(),
    );
    reply.setCookie(SESSION_COOKIE, session.token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: ctx.cfg.COOKIE_SECURE,
      expires: session.expiresAt,
    });
    return {
      user: {
        id: userId,
        address,
        isAdmin,
      },
      csrfToken: session.csrfToken,
    };
  });

  app.post("/v1/auth/logout", authRateLimit, async (req, reply) => {
    if (req.user?.sessionId) {
      await revokeSession(ctx.db, req.user.sessionId);
    }
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/v1/me", async (req) => {
    const user = requireUser(req.user);
    return {
      user: {
        id: user.id,
        address: user.address,
        isAdmin: user.isAdmin,
      },
      csrfToken: user.csrfToken,
      via: user.via,
    };
  });
}

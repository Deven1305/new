import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  assertRole,
  audit,
  createApiToken,
  requireAccountLevel,
} from "../auth.js";
import type { Ctx } from "../context.js";
import { notFound, parse } from "../errors.js";

const CreateTokenSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80, "Name cannot exceed 80 characters"),
  projectId: z.string().uuid("Invalid project ID").optional().nullable(),
});

const TokenParamsSchema = z.object({
  id: z.string().uuid("Invalid token ID"),
});

interface TokenRow {
  id: string;
  name: string;
  project_id: string | null;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

export function registerTokenRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get("/v1/tokens", async (req) => {
    const user = requireAccountLevel(req.user);
    const rows = await ctx.db.query<TokenRow>(
      `SELECT id, name, project_id, created_at, last_used_at, revoked_at
       FROM api_tokens
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [user.id],
    );

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      projectId: r.project_id,
      createdAt: new Date(r.created_at).toISOString(),
      lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
      revokedAt: r.revoked_at ? new Date(r.revoked_at).toISOString() : null,
    }));
  });

  app.post("/v1/tokens", async (req, reply) => {
    const user = requireAccountLevel(req.user);
    const body = parse(CreateTokenSchema, req.body, "token body");

    if (body.projectId) {
      await assertRole(ctx.db, user, body.projectId, "maintainer");
    }

    const { id, token } = await createApiToken(
      ctx.db,
      user.id,
      body.name,
      body.projectId ?? null,
    );

    await audit(ctx.db, user.id, body.projectId ?? null, "token.create", body.name, { tokenId: id });

    return reply.code(201).send({ id, token });
  });

  app.delete("/v1/tokens/:id", async (req) => {
    const user = requireAccountLevel(req.user);
    const params = parse(TokenParamsSchema, req.params, "token params");

    const row = await ctx.db.one<{ id: string; name: string; project_id: string | null }>(
      `UPDATE api_tokens
       SET revoked_at = $2
       WHERE id = $1 AND user_id = $3 AND revoked_at IS NULL
       RETURNING id, name, project_id`,
      [params.id, ctx.deps.now(), user.id],
    );

    if (!row) {
      throw notFound("token");
    }

    await audit(ctx.db, user.id, row.project_id, "token.revoke", row.name, { tokenId: row.id });

    return { ok: true };
  });
}

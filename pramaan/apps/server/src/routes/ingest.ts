import { createHash, createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { insertAlert, type AlertSeverity } from "../alerts.js";
import { safeEqual } from "../auth.js";
import type { Ctx } from "../context.js";
import { badRequest, conflict, notConfigured, notFound, parse, unauthorized } from "../errors.js";

export const CRE_WORKFLOW_DECISIONS = [
  "OK",
  "PENDING_RELEASE_CHANGE",
  "PENDING_UPGRADE",
  "UNEXPECTED_IMPLEMENTATION",
  "RELEASE_REVOKED",
  "MANIFEST_MISMATCH",
  "UNKNOWN",
] as const;

export type CreDecision = (typeof CRE_WORKFLOW_DECISIONS)[number];

const CreIngestSchema = z.object({
  workflow: z.string().trim().min(1, "workflow is required").max(255),
  runId: z.string().trim().min(1, "runId is required").max(255),
  observedAt: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, "observedAt must be ISO 8601 UTC timestamp"),
  chainId: z.number().int().positive("chainId must be positive integer"),
  app: z.string().trim().min(1, "app is required").max(255),
  ensName: z.string().trim().min(1, "ensName is required").max(255),
  decision: z.enum(CRE_WORKFLOW_DECISIONS),
  severity: z.enum(["info", "low", "medium", "high", "critical"]),
  details: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().trim().min(1, "idempotencyKey is required").max(255),
});

export type CreIngestBody = z.infer<typeof CreIngestSchema>;

export function mapWorkflowSeverity(severity: "info" | "low" | "medium" | "high" | "critical"): AlertSeverity {
  switch (severity) {
    case "critical":
    case "high":
      return "critical";
    case "medium":
      return "warning";
    case "low":
    case "info":
      return "info";
  }
}

export function registerIngestRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.post(
    "/v1/ingest/cre",
    {
      bodyLimit: 64 * 1024,
      config: {
        rateLimit: {
          max: ctx.cfg.RATE_LIMIT_INGEST_MAX,
          timeWindow: ctx.cfg.RATE_LIMIT_WINDOW_MS,
        },
      },
    },
    async (req, reply) => {
      // 1. Configured secret check (501 if absent)
      const secret = ctx.cfg.CRE_INGEST_SECRET;
      if (!secret) {
        throw notConfigured("CRE_NOT_CONFIGURED", "CRE ingest is not configured on this server");
      }

      // 2. Raw body and bounded limit
      const rawBody = req.rawBody;
      if (!rawBody || rawBody.length === 0) {
        throw badRequest("request body cannot be empty", "BODY_EMPTY");
      }
      if (rawBody.length > 64 * 1024) {
        throw badRequest("request body exceeds 64KB limit", "BODY_TOO_LARGE");
      }

      // 3. Raw-byte HMAC-SHA256 signature verification with constant-time equality
      const sigHeader = req.headers["x-pramaan-signature"];
      if (typeof sigHeader !== "string") {
        throw unauthorized("missing signature header", "SIGNATURE_MISSING");
      }
      const match = /^sha256=([0-9a-fA-F]{64})$/.exec(sigHeader.trim());
      const signatureHex = match?.[1];
      if (!signatureHex) {
        throw unauthorized("malformed signature header", "SIGNATURE_INVALID");
      }
      const expectedHmac = createHmac("sha256", secret).update(rawBody).digest("hex");
      if (!safeEqual(expectedHmac.toLowerCase(), signatureHex.toLowerCase())) {
        throw unauthorized("invalid signature", "SIGNATURE_INVALID");
      }

      // 4. Strict schema validation
      const body = parse(CreIngestSchema, req.body, "CRE ingest body");

      // 5. Fresh observedAt timestamp check (not older than 10 min, not in the future)
      const now = ctx.deps.now().getTime();
      const obs = new Date(body.observedAt).getTime();
      if (Number.isNaN(obs)) {
        throw badRequest("invalid observedAt timestamp", "INVALID_TIMESTAMP");
      }
      const TEN_MIN_MS = 10 * 60 * 1000;
      if (obs < now - TEN_MIN_MS) {
        throw badRequest("observedAt timestamp is older than 10 minutes", "TIMESTAMP_OUT_OF_BOUNDS");
      }
      if (obs > now) {
        throw badRequest("observedAt timestamp is in the future", "TIMESTAMP_OUT_OF_BOUNDS");
      }

      // 6. Bind existing project by ENS name AND chainId, reject missing/ambiguous association
      const matchingProjects = await ctx.db.query<{ id: string; name: string }>(
        `SELECT id, name FROM projects WHERE lower(ens_name) = lower($1) AND chain_id = $2`,
        [body.ensName, body.chainId],
      );
      if (matchingProjects.length === 0) {
        throw notFound("project for ensName and chainId");
      }
      if (matchingProjects.length > 1) {
        throw conflict("ambiguous project association for ensName and chainId", "AMBIGUOUS_PROJECT");
      }
      const project = matchingProjects[0]!;

      // 7. Compute body digest and receipt identity using hash of canonical JSON tuple
      const bodySha256 = createHash("sha256").update(rawBody).digest("hex");
      const receiptKey = createHash("sha256")
        .update(JSON.stringify([body.workflow, body.app, body.runId]))
        .digest("hex");

      // 8. Atomic transaction: claim receipt FIRST, then insert alert / update response
      const result = await ctx.db.tx(async (tx) => {
        // Claim receipt FIRST via INSERT ON CONFLICT in Db.tx
        const initialRecord = {
          bodySha256,
          response: null,
        };

        const claimed = await tx.one(
          `INSERT INTO ingest_receipts (source, key, received_at, result)
           VALUES ('cre', $1, $2, $3)
           ON CONFLICT (source, key) DO NOTHING
           RETURNING *`,
          [receiptKey, ctx.deps.now(), JSON.stringify(initialRecord)],
        );

        if (claimed) {
          // Winner: process alert and update receipt with stable response
          const isOk = body.decision === "OK";
          let alertId: string | null = null;

          if (!isOk) {
            // Alert namespace hash of canonical JSON tuple: chain/ENS/stablekey
            const alertKey =
              "cre:" +
              createHash("sha256")
                .update(JSON.stringify([body.chainId, body.ensName.toLowerCase(), body.idempotencyKey]))
                .digest("hex");
            const dbSeverity = mapWorkflowSeverity(body.severity);

            const alertRow = await insertAlert(tx, {
              projectId: project.id,
              source: "cre",
              severity: dbSeverity,
              kind: "cre",
              title: `CRE: ${body.workflow} (${body.decision})`,
              body: JSON.stringify(body.details),
              data: {
                workflow: body.workflow,
                runId: body.runId,
                app: body.app,
                ensName: body.ensName,
                chainId: body.chainId,
                decision: body.decision,
                severity: body.severity,
                details: body.details,
                observedAt: body.observedAt,
              },
              key: alertKey,
            });

            if (alertRow) {
              alertId = alertRow.id;
              const disabledDelivery = {
                telegram: {
                  status: "disabled",
                  attempts: 0,
                  error: "Telegram delivery disabled in unattended slice",
                  at: ctx.deps.now().toISOString(),
                },
              };
              await tx.query("UPDATE alerts SET delivery = $2 WHERE id = $1", [
                alertRow.id,
                JSON.stringify(disabledDelivery),
              ]);
            }
          }

          const stableResponse = {
            ok: true,
            workflow: body.workflow,
            runId: body.runId,
            decision: body.decision,
            projectId: project.id,
            alertId,
          };

          await tx.query(
            `UPDATE ingest_receipts SET result = $2 WHERE source = 'cre' AND key = $1`,
            [receiptKey, JSON.stringify({ bodySha256, response: stableResponse })],
          );

          return { statusCode: 200, data: stableResponse };
        } else {
          // Loser: compare bodyhash and return stable winner response, or conflict rollback
          const existing = await tx.one<{ result: { bodySha256: string; response: unknown } | string }>(
            `SELECT result FROM ingest_receipts WHERE source = 'cre' AND key = $1`,
            [receiptKey],
          );
          if (!existing) {
            throw conflict("concurrent receipt conflict", "RECEIPT_CONFLICT");
          }
          const parsed = typeof existing.result === "string"
            ? (JSON.parse(existing.result) as { bodySha256: string; response: unknown })
            : existing.result;

          if (parsed.bodySha256 === bodySha256) {
            let responseData = parsed.response;
            if (!responseData) {
              let alertId: string | null = null;
              if (body.decision !== "OK") {
                const alertKey =
                  "cre:" +
                  createHash("sha256")
                    .update(JSON.stringify([body.chainId, body.ensName.toLowerCase(), body.idempotencyKey]))
                    .digest("hex");
                const alertRow = await tx.one<{ id: string }>(
                  "SELECT id FROM alerts WHERE idempotency_key = $1",
                  [alertKey],
                );
                alertId = alertRow?.id ?? null;
              }
              responseData = {
                ok: true,
                workflow: body.workflow,
                runId: body.runId,
                decision: body.decision,
                projectId: project.id,
                alertId,
              };
            }
            return { statusCode: 200, data: responseData };
          } else {
            throw conflict("same receipt identity with different signed body", "RECEIPT_CONFLICT");
          }
        }
      });

      return reply.code(result.statusCode).send(result.data);
    },
  );
}

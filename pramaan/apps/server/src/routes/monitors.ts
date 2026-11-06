import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { formatAlertText, sendTelegram, telegramConfigured, type AlertRow } from "../alerts.js";
import { assertRole, audit, requireUser } from "../auth.js";
import type { Ctx } from "../context.js";
import { conflict, HttpError, notConfigured, notFound, parse } from "../errors.js";
import { MONITOR_KINDS, pollMonitor, type MonitorRow } from "../monitor.js";
import { assertSafeHttpUrl, publicRpcOrigin } from "../net.js";

const ProjectParamsSchema = z.object({
  id: z.string().uuid("Invalid project ID"),
});

const AlertParamsSchema = z.object({
  id: z.string().uuid("Invalid alert ID"),
});

const AlertsQuerySchema = z.object({
  status: z.enum(["open", "acked", "all"]).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const EventsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const CreateMonitorSchema = z.object({
  kind: z.enum(MONITOR_KINDS),
  chainId: z.number().int().positive(),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "address must be a 0x… 20-byte address"),
  rpcUrl: z.string().trim().url().max(500).optional(),
  label: z.string().trim().min(1).max(120),
  /** Start scanning at this block instead of the recent-blocks lookback. */
  fromBlock: z.number().int().min(1).optional(),
});

interface MonitorDbRow {
  id: string;
  project_id: string;
  kind: string;
  chain_id: number;
  address: string;
  rpc_url: string | null;
  label: string;
  status: string;
  last_block: number | string | null;
  last_checked_at: Date | null;
  last_error: string | null;
  created_at: Date;
}

interface MonitorEventDbRow {
  id: string;
  project_id: string;
  monitor_id: string;
  monitor_label: string | null;
  monitor_kind: string | null;
  chain_id: number;
  block_number: number | string;
  block_time: Date | null;
  tx_hash: string;
  log_index: number;
  address: string;
  event_name: string;
  data: Record<string, unknown> | string;
  assessment: string;
  detail: string;
  created_at: Date;
}

function formatAlert(r: AlertRow) {
  return {
    id: r.id,
    projectId: r.project_id,
    monitorEventId: r.monitor_event_id,
    source: r.source,
    severity: r.severity,
    kind: r.kind,
    title: r.title,
    body: r.body,
    data: typeof r.data === "string" ? JSON.parse(r.data) : r.data ?? {},
    eta: r.eta ? new Date(r.eta).toISOString() : null,
    status: r.status,
    ackedAt: r.acked_at ? new Date(r.acked_at).toISOString() : null,
    ackedBy: r.acked_by ?? null,
    delivery: typeof r.delivery === "string" ? JSON.parse(r.delivery) : r.delivery ?? {},
    createdAt: new Date(r.created_at).toISOString(),
  };
}

function formatMonitor(m: MonitorDbRow) {
  return {
    id: m.id,
    projectId: m.project_id,
    kind: m.kind,
    chainId: m.chain_id,
    address: m.address,
    rpcUrl: publicRpcOrigin(m.rpc_url),
    label: m.label,
    status: m.status,
    lastBlock: m.last_block !== null ? Number(m.last_block) : null,
    lastCheckedAt: m.last_checked_at ? new Date(m.last_checked_at).toISOString() : null,
    lastError: m.last_error ?? null,
    createdAt: new Date(m.created_at).toISOString(),
  };
}

function formatEvent(e: MonitorEventDbRow) {
  return {
    id: e.id,
    projectId: e.project_id,
    monitorId: e.monitor_id,
    monitorLabel: e.monitor_label ?? null,
    monitorKind: e.monitor_kind ?? null,
    chainId: e.chain_id,
    blockNumber: Number(e.block_number),
    blockTime: e.block_time ? new Date(e.block_time).toISOString() : null,
    txHash: e.tx_hash,
    logIndex: e.log_index,
    address: e.address,
    eventName: e.event_name,
    data: typeof e.data === "string" ? JSON.parse(e.data) : e.data ?? {},
    assessment: e.assessment,
    detail: e.detail,
    createdAt: new Date(e.created_at).toISOString(),
  };
}

export function registerMonitorRoutes(app: FastifyInstance, ctx: Ctx): void {
  // GET /v1/projects/:id/alerts?status=open|acked
  app.get("/v1/projects/:id/alerts", async (req) => {
    const user = requireUser(req.user);
    const params = parse(ProjectParamsSchema, req.params, "project params");
    await assertRole(ctx.db, user, params.id, "viewer");

    const query = parse(AlertsQuerySchema, req.query, "alerts query");
    const limit = query.limit ?? 100;

    let sql = `SELECT * FROM alerts WHERE project_id = $1`;
    const sqlParams: unknown[] = [params.id];

    if (query.status === "open" || query.status === "acked") {
      sql += ` AND status = $2`;
      sqlParams.push(query.status);
    }

    sql += ` ORDER BY created_at DESC LIMIT $${sqlParams.length + 1}`;
    sqlParams.push(limit);

    const rows = await ctx.db.query<AlertRow>(sql, sqlParams);
    return rows.map(formatAlert);
  });

  // POST /v1/alerts/:id/ack (maintainer)
  app.post("/v1/alerts/:id/ack", async (req) => {
    const user = requireUser(req.user);
    const params = parse(AlertParamsSchema, req.params, "alert params");

    const alert = await ctx.db.one<AlertRow>("SELECT * FROM alerts WHERE id = $1", [params.id]);
    if (!alert) {
      throw notFound("alert");
    }

    // Maintainer role check on the alert's project
    await assertRole(ctx.db, user, alert.project_id, "maintainer");

    const now = ctx.deps.now();
    const updated = await ctx.db.one<AlertRow>(
      `UPDATE alerts
       SET status = 'acked', acked_at = $2, acked_by = $3
       WHERE id = $1
       RETURNING *`,
      [alert.id, now, user.id],
    );

    if (!updated) {
      throw notFound("alert");
    }

    await audit(ctx.db, user.id, alert.project_id, "alert.ack", alert.title, { alertId: alert.id });

    return formatAlert(updated);
  });

  // GET /v1/projects/:id/monitors
  app.get("/v1/projects/:id/monitors", async (req) => {
    const user = requireUser(req.user);
    const params = parse(ProjectParamsSchema, req.params, "project params");
    await assertRole(ctx.db, user, params.id, "viewer");

    const rows = await ctx.db.query<MonitorDbRow>(
      `SELECT id, project_id, kind, chain_id, address, rpc_url, label, status, last_block, last_checked_at, last_error, created_at
       FROM monitors
       WHERE project_id = $1
       ORDER BY created_at ASC`,
      [params.id],
    );

    return rows.map(formatMonitor);
  });

  // GET /v1/projects/:id/events?limit=
  app.get("/v1/projects/:id/events", async (req) => {
    const user = requireUser(req.user);
    const params = parse(ProjectParamsSchema, req.params, "project params");
    await assertRole(ctx.db, user, params.id, "viewer");

    const query = parse(EventsQuerySchema, req.query, "events query");
    const limit = query.limit ?? 50;

    const rows = await ctx.db.query<MonitorEventDbRow>(
      `SELECT
        me.id,
        me.project_id,
        me.monitor_id,
        m.label AS monitor_label,
        m.kind AS monitor_kind,
        me.chain_id,
        me.block_number,
        me.block_time,
        me.tx_hash,
        me.log_index,
        me.address,
        me.event_name,
        me.data,
        me.assessment,
        me.detail,
        me.created_at
       FROM monitor_events me
       LEFT JOIN monitors m ON m.id = me.monitor_id
       WHERE me.project_id = $1
       ORDER BY me.block_number DESC, me.created_at DESC
       LIMIT $2`,
      [params.id, limit],
    );

    return rows.map(formatEvent);
  });

  /**
   * POST /v1/projects/:id/monitors — watch one contract for the events that matter for its kind. The server polls it
   * every MONITOR_INTERVAL_MS (embedded poller); the first poll runs immediately so a bad RPC or chain shows up now.
   */
  app.post("/v1/projects/:id/monitors", async (req, reply) => {
    const user = requireUser(req.user);
    const params = parse(ProjectParamsSchema, req.params, "project params");
    await assertRole(ctx.db, user, params.id, "maintainer");
    const body = parse(CreateMonitorSchema, req.body, "monitor body");
    const project = await ctx.db.one<{ rpc_url: string | null; chain_id: number | null }>("SELECT rpc_url, chain_id FROM projects WHERE id = $1", [params.id]);
    if (!project) throw notFound("project");
    const rpcUrl = body.rpcUrl ?? project.rpc_url;
    if (!rpcUrl) throw new HttpError(400, "VALIDATION_FAILED", "rpcUrl is required (or set one on the project)");
    await assertSafeHttpUrl(rpcUrl, ctx.cfg.allowPrivateNetwork, "rpcUrl");
    const address = body.address.toLowerCase();
    const dup = await ctx.db.one("SELECT id FROM monitors WHERE project_id = $1 AND kind = $2 AND chain_id = $3 AND address = $4", [params.id, body.kind, body.chainId, address]);
    if (dup) throw conflict("this contract is already monitored for that kind", "MONITOR_EXISTS");
    const row = await ctx.db.one<MonitorRow & { created_at: Date }>(
      `INSERT INTO monitors (project_id, kind, chain_id, address, rpc_url, label, last_block)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, project_id, kind, chain_id, address, rpc_url, label, config, last_block, created_at`,
      [params.id, body.kind, body.chainId, address, rpcUrl, body.label, body.fromBlock === undefined ? null : body.fromBlock - 1],
    );
    await audit(ctx.db, user.id, params.id, "monitor.create", row!.id, { kind: body.kind, chainId: body.chainId, address });
    await pollMonitor(ctx, row!);
    const fresh = await ctx.db.one<MonitorDbRow>("SELECT * FROM monitors WHERE id = $1", [row!.id]);
    return reply.code(201).send(formatMonitor(fresh!));
  });

  app.delete("/v1/projects/:id/monitors/:monitorId", async (req) => {
    const user = requireUser(req.user);
    const params = parse(ProjectParamsSchema.extend({ monitorId: z.string().uuid() }), req.params, "monitor params");
    await assertRole(ctx.db, user, params.id, "maintainer");
    const gone = await ctx.db.one<{ id: string }>("DELETE FROM monitors WHERE id = $1 AND project_id = $2 RETURNING id", [params.monitorId, params.id]);
    if (!gone) throw notFound("monitor");
    await audit(ctx.db, user.id, params.id, "monitor.delete", params.monitorId, {});
    return { ok: true };
  });

  /** Sends one clearly-labelled test message. Nothing is stored; the result is Telegram's real answer. */
  app.post("/v1/projects/:id/alerts/test-telegram", async (req) => {
    const user = requireUser(req.user);
    const params = parse(ProjectParamsSchema, req.params, "project params");
    await assertRole(ctx.db, user, params.id, "maintainer");
    if (!telegramConfigured(ctx.cfg)) throw notConfigured("TELEGRAM_NOT_CONFIGURED", "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are not set on this server");
    const project = await ctx.db.one<{ name: string }>("SELECT name FROM projects WHERE id = $1", [params.id]);
    const result = await sendTelegram(ctx, formatAlertText(project?.name ?? "project", { severity: "info", title: "Pramaan test message", body: "Telegram delivery for this project works. No action needed.", eta: null }));
    await audit(ctx.db, user.id, params.id, "alerts.test-telegram", null, { status: result.status });
    if (result.status !== "sent") throw new HttpError(502, "TELEGRAM_FAILED", `Telegram did not accept the message: ${result.error ?? result.status}`);
    return { ok: true, delivery: { telegram: result } };
  });
}

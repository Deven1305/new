import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import multipart from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { assertRole, audit, requireUser } from "../auth.js";
import type { Ctx } from "../context.js";
import { badRequest, notFound, parse } from "../errors.js";
import { assertSafeHttpUrl } from "../net.js";
import { enqueueJob, requestCancel, type JobRow, type JobSource } from "../queue.js";
import { EXAMPLES } from "../sources.js";
import { inspectZip } from "../zip.js";

const IdParams = z.object({ id: z.string().uuid("invalid id") });

const SourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("example"), name: z.enum(["contracts", "reentrancy-bank", "initializer-takeover", "oracle-lending"]) }),
  z.object({ type: z.literal("github"), url: z.string().trim().max(300), ref: z.string().trim().max(200).optional() }),
  z.object({ type: z.literal("upload"), uploadId: z.string().uuid() }),
]);

const CreateJobSchema = z.object({
  source: SourceSchema,
  params: z.object({ fix: z.boolean().optional(), ai: z.boolean().optional() }).optional(),
  force: z.boolean().optional(),
});

const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

export function jobDto(j: JobRow) {
  return {
    id: j.id,
    projectId: j.project_id,
    kind: j.kind,
    status: j.status,
    source: j.source,
    params: j.params,
    commitSha: j.commit_sha,
    toolchainHash: j.toolchain_hash,
    attempts: j.attempts,
    error: j.error,
    result: j.result,
    createdAt: new Date(j.created_at).toISOString(),
    startedAt: j.started_at ? new Date(j.started_at).toISOString() : null,
    finishedAt: j.finished_at ? new Date(j.finished_at).toISOString() : null,
  };
}

interface EventRow {
  seq: number;
  step: string;
  status: string;
  message: string;
  created_at: Date;
}
const eventDto = (e: EventRow) => ({ seq: e.seq, step: e.step, status: e.status, message: e.message, createdAt: new Date(e.created_at).toISOString() });

/** GitHub clone URLs are limited to https://github.com/<owner>/<repo>; no credentials, ports or other hosts. */
export function parseGithubUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw badRequest("source.url is not a valid URL", "VALIDATION_FAILED");
  }
  if (u.protocol !== "https:" || u.hostname !== "github.com" || u.username || u.password || u.port) throw badRequest("only https://github.com/<owner>/<repo> sources are supported", "VALIDATION_FAILED");
  const m = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(u.pathname);
  if (!m) throw badRequest("source.url must look like https://github.com/<owner>/<repo>", "VALIDATION_FAILED");
  return `https://github.com/${m[1]}/${m[2]}`;
}

export function registerJobRoutes(app: FastifyInstance, ctx: Ctx): void {
  void app.register(async (scope) => {
    await scope.register(multipart, { limits: { fileSize: ctx.cfg.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 0 } });
    scope.post(
      "/v1/projects/:id/uploads",
      { config: { rateLimit: { max: ctx.cfg.RATE_LIMIT_UPLOAD_MAX, timeWindow: ctx.cfg.RATE_LIMIT_WINDOW_MS } } },
      async (req, reply) => {
        const user = requireUser(req.user);
        const { id } = parse(IdParams, req.params, "project params");
        await assertRole(ctx.db, user, id, "maintainer");
        const file = await req.file();
        if (!file) throw badRequest("multipart field `file` (a .zip) is required");
        if (!/\.zip$/i.test(file.filename)) throw badRequest("only .zip archives are accepted", "BAD_ARCHIVE");
        const buf = await file.toBuffer();
        if (file.file.truncated) throw badRequest(`archive exceeds ${ctx.cfg.MAX_UPLOAD_MB} MB`, "UPLOAD_TOO_LARGE");
        const insp = inspectZip(buf, { maxEntries: ctx.cfg.MAX_ARCHIVE_ENTRIES, maxExpandedBytes: ctx.cfg.MAX_ARCHIVE_EXPANDED_MB * 1024 * 1024 });
        if (!insp.hasFoundryToml) throw badRequest("the archive contains no foundry.toml (only Foundry projects are supported)", "BAD_ARCHIVE");
        const sha256 = createHash("sha256").update(buf).digest("hex");
        const dir = join(ctx.cfg.DATA_DIR, "uploads");
        mkdirSync(dir, { recursive: true });
        const path = join(dir, `${randomUUID()}.zip`);
        writeFileSync(path, buf, { mode: 0o600 });
        const row = await ctx.db.one<{ id: string }>(
          `INSERT INTO uploads (project_id, user_id, sha256, size_bytes, entries, expanded_bytes, file_name, path)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [id, user.id, sha256, buf.length, insp.entries, insp.expandedBytes, file.filename.slice(0, 200), path],
        );
        await audit(ctx.db, user.id, id, "upload.create", row!.id, { sha256, size: buf.length });
        return reply.code(201).send({ uploadId: row!.id, sha256, size: buf.length });
      },
    );
  });

  app.post("/v1/projects/:id/jobs", async (req, reply) => {
    const user = requireUser(req.user);
    const { id } = parse(IdParams, req.params, "project params");
    await assertRole(ctx.db, user, id, "maintainer");
    const body = parse(CreateJobSchema, req.body, "job body");

    let source: JobSource;
    let commit: string | null = null;
    if (body.source.type === "github") {
      const url = parseGithubUrl(body.source.url);
      await assertSafeHttpUrl(url, ctx.cfg.allowPrivateNetwork, "source.url");
      const ref = body.source.ref;
      if (ref !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(ref)) throw badRequest("source.ref is not a valid git ref", "VALIDATION_FAILED");
      source = { type: "github", url, ...(ref ? { ref } : {}) };
      // A full commit SHA pins the request, so an identical finished analysis can be reused; a branch name cannot.
      if (ref && /^[0-9a-f]{40}$/.test(ref)) commit = ref;
    } else if (body.source.type === "example") {
      if (!EXAMPLES[body.source.name]) throw notFound("example");
      source = body.source;
    } else {
      const up = await ctx.db.one<{ sha256: string }>("SELECT sha256 FROM uploads WHERE id = $1 AND project_id = $2", [body.source.uploadId, id]);
      if (!up) throw notFound("upload");
      source = body.source;
      commit = up.sha256;
    }
    const params = { ...(body.params?.fix ? { fix: true } : {}), ...(body.params?.ai ? { ai: true } : {}) };
    const { job, deduplicated } = await enqueueJob(ctx.db, { projectId: id, kind: "analyze", source, params, commit, createdBy: user.id, force: body.force });
    if (!deduplicated) await audit(ctx.db, user.id, id, "job.create", job.id, { source: source.type });
    return reply.code(deduplicated ? 200 : 201).send({ job: jobDto(job), deduplicated });
  });

  app.get("/v1/projects/:id/jobs", async (req) => {
    const user = requireUser(req.user);
    const { id } = parse(IdParams, req.params, "project params");
    await assertRole(ctx.db, user, id, "viewer");
    const rows = await ctx.db.query<JobRow>("SELECT * FROM analysis_jobs WHERE project_id = $1 ORDER BY created_at DESC LIMIT 100", [id]);
    return rows.map(jobDto);
  });

  async function loadJob(req: { user: ReturnType<typeof requireUser> | null; params: unknown }, min: "viewer" | "maintainer") {
    const user = requireUser(req.user);
    const { id } = parse(IdParams, req.params, "job params");
    const job = await ctx.db.one<JobRow>("SELECT * FROM analysis_jobs WHERE id = $1", [id]);
    if (!job) throw notFound("job");
    await assertRole(ctx.db, user, job.project_id, min);
    return { job, user };
  }

  app.get("/v1/jobs/:id", async (req) => jobDto((await loadJob(req, "viewer")).job));

  app.get("/v1/jobs/:id/events", async (req) => {
    const { job } = await loadJob(req, "viewer");
    const { after } = parse(z.object({ after: z.coerce.number().int().min(0).default(0) }), req.query, "query");
    const rows = await ctx.db.query<EventRow>("SELECT seq, step, status, message, created_at FROM job_events WHERE job_id = $1 AND seq > $2 ORDER BY seq LIMIT 1000", [job.id, after]);
    return rows.map(eventDto);
  });

  app.post("/v1/jobs/:id/cancel", async (req) => {
    const { job, user } = await loadJob(req, "maintainer");
    if (TERMINAL.has(job.status)) return jobDto(job);
    const updated = await requestCancel(ctx.db, job.id);
    await audit(ctx.db, user.id, job.project_id, "job.cancel", job.id);
    return jobDto(updated ?? (await ctx.db.one<JobRow>("SELECT * FROM analysis_jobs WHERE id = $1", [job.id]))!);
  });

  /** Server-sent events: `progress` per job event, `status` on change; resumes from Last-Event-ID; ends at a terminal status. */
  app.get("/v1/jobs/:id/stream", async (req, reply) => {
    const { job } = await loadJob(req, "viewer");
    const last = Number(req.headers["last-event-id"] ?? 0);
    let seq = Number.isInteger(last) && last > 0 ? last : 0;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    let closed = false;
    req.raw.on("close", () => (closed = true));
    let lastStatus = "";
    let lastBeat = Date.now();
    while (!closed) {
      const events = await ctx.db.query<EventRow>("SELECT seq, step, status, message, created_at FROM job_events WHERE job_id = $1 AND seq > $2 ORDER BY seq LIMIT 500", [job.id, seq]);
      for (const e of events) {
        seq = e.seq;
        res.write(`id: ${e.seq}\nevent: progress\ndata: ${JSON.stringify(eventDto(e))}\n\n`);
      }
      const cur = await ctx.db.one<{ status: string }>("SELECT status FROM analysis_jobs WHERE id = $1", [job.id]);
      const status = cur?.status ?? "FAILED";
      if (status !== lastStatus) {
        lastStatus = status;
        res.write(`event: status\ndata: ${JSON.stringify({ status })}\n\n`);
      }
      if (TERMINAL.has(status) && events.length === 0) break;
      if (Date.now() - lastBeat > ctx.cfg.SSE_HEARTBEAT_MS) {
        res.write(": keep-alive\n\n");
        lastBeat = Date.now();
      }
      await ctx.deps.sleep(ctx.cfg.SSE_POLL_MS);
    }
    res.end();
  });
}

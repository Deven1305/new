import { createHash, randomBytes } from "node:crypto";
import { canonicalize } from "@pramaan/manifest";
import { SANDBOX_IMAGE } from "@pramaan/engine";
import type { Db } from "./db.js";

export type JobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type JobKind = "analyze" | "fix";

export interface JobRow {
  id: string;
  project_id: string;
  kind: JobKind;
  status: JobStatus;
  source: JobSource;
  params: Record<string, unknown>;
  commit_sha: string | null;
  toolchain_hash: string;
  request_hash: string;
  idempotency_key: string;
  result: Record<string, unknown> | null;
  error: string | null;
  attempts: number;
  cancel_requested: boolean;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

export type JobSource =
  | { type: "example"; name: "contracts" | "reentrancy-bank" | "initializer-takeover" | "oracle-lending" }
  | { type: "github"; url: string; ref?: string }
  | { type: "upload"; uploadId: string }
  | { type: "finding"; findingId: string };

/** Results are cached per (source, commit, toolchain): the same analysis on the same code and tools is not re-run. */
export const TOOLCHAIN_HASH = createHash("sha256").update(`${SANDBOX_IMAGE}|templates@1|slither-plugin@0.1.0`).digest("hex");

export function requestHash(kind: JobKind, source: JobSource, params: Record<string, unknown>, commit: string | null): string {
  return createHash("sha256").update(canonicalize({ kind, source, params, commit, toolchain: TOOLCHAIN_HASH })).digest("hex");
}

/**
 * Creates a job unless an identical request is already in flight. Identical = same project, kind, source, params,
 * commit and toolchain. When the commit is known up front (examples, uploads, a pinned commit) a COMPLETED result is
 * reused too; a moving ref (a branch name) is only de-duplicated against jobs that have not finished, so a re-run
 * after a push is never answered with a stale result. `force` always creates a new job.
 */
export async function enqueueJob(
  db: Db,
  args: { projectId: string; kind: JobKind; source: JobSource; params?: Record<string, unknown>; commit?: string | null; createdBy: string | null; force?: boolean },
): Promise<{ job: JobRow; deduplicated: boolean }> {
  const params = args.params ?? {};
  const commit = args.commit ?? null;
  const hash = requestHash(args.kind, args.source, params, commit);
  return db.tx(async (t) => {
    await t.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${args.projectId}:${hash}`]);
    if (!args.force) {
      const existing = await t.one<JobRow>(
        `SELECT * FROM analysis_jobs WHERE project_id = $1 AND request_hash = $2 AND (status IN ('QUEUED', 'RUNNING') OR ($3::boolean AND status = 'COMPLETED'))
         ORDER BY created_at DESC LIMIT 1`,
        [args.projectId, hash, commit !== null],
      );
      if (existing) return { job: existing, deduplicated: true };
    }
    const row = await t.one<JobRow>(
      `INSERT INTO analysis_jobs (project_id, kind, source, params, commit_sha, toolchain_hash, request_hash, idempotency_key, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [args.projectId, args.kind, JSON.stringify(args.source), JSON.stringify(params), commit, TOOLCHAIN_HASH, hash, `${hash}:${randomBytes(6).toString("hex")}`, args.createdBy],
    );
    return { job: row!, deduplicated: false };
  });
}

/** Claims the oldest queued job. `FOR UPDATE SKIP LOCKED` lets several workers share one Postgres queue safely. */
export async function claimJob(db: Db, workerId: string): Promise<JobRow | null> {
  return db.one<JobRow>(
    `UPDATE analysis_jobs SET status = 'RUNNING', started_at = now(), heartbeat_at = now(), attempts = attempts + 1, worker_id = $1
     WHERE id = (SELECT id FROM analysis_jobs WHERE status = 'QUEUED' AND cancel_requested = false ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING *`,
    [workerId],
  );
}

/** Appends a progress event with the next sequence number of the job (retrying if two writers race). */
export async function addEvent(db: Db, jobId: string, step: string, status: string, message: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await db.query(
        `INSERT INTO job_events (job_id, seq, step, status, message)
         SELECT $1::uuid, COALESCE(MAX(seq), 0) + 1, $2, $3, $4 FROM job_events WHERE job_id = $1::uuid`,
        [jobId, step.slice(0, 40), status.slice(0, 20), message.slice(0, 2000)],
      );
      return;
    } catch (err) {
      if ((err as { code?: string }).code !== "23505" || attempt >= 5) throw err;
    }
  }
}

export async function heartbeat(db: Db, jobId: string): Promise<boolean> {
  const row = await db.one<{ cancel_requested: boolean }>("UPDATE analysis_jobs SET heartbeat_at = now() WHERE id = $1 RETURNING cancel_requested", [jobId]);
  return Boolean(row?.cancel_requested);
}

export async function finishJob(db: Db, jobId: string, status: "COMPLETED" | "FAILED" | "CANCELLED", result: unknown, error: string | null): Promise<void> {
  await db.query("UPDATE analysis_jobs SET status = $2, result = $3, error = $4, finished_at = now() WHERE id = $1", [jobId, status, result === null ? null : JSON.stringify(result), error]);
}

/** QUEUED jobs are cancelled at once; RUNNING jobs are flagged and the worker aborts the sandbox at its next heartbeat. */
export async function requestCancel(db: Db, jobId: string): Promise<JobRow | null> {
  const queued = await db.one<JobRow>("UPDATE analysis_jobs SET status = 'CANCELLED', cancel_requested = true, finished_at = now() WHERE id = $1 AND status = 'QUEUED' RETURNING *", [jobId]);
  if (queued) return queued;
  return db.one<JobRow>("UPDATE analysis_jobs SET cancel_requested = true WHERE id = $1 AND status = 'RUNNING' RETURNING *", [jobId]);
}

/** Jobs whose worker died (no heartbeat for 15 minutes) go back to the queue once, then fail. */
export async function recoverStale(db: Db): Promise<number> {
  const rows = await db.query<{ id: string }>(
    `UPDATE analysis_jobs SET status = CASE WHEN attempts >= 2 THEN 'FAILED' ELSE 'QUEUED' END,
       error = CASE WHEN attempts >= 2 THEN 'worker stopped responding' ELSE error END
     WHERE status = 'RUNNING' AND heartbeat_at < now() - interval '15 minutes' RETURNING id`,
  );
  return rows.length;
}

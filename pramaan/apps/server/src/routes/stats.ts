import type { FastifyInstance } from "fastify";
import { requireAccountLevel } from "../auth.js";
import type { Ctx } from "../context.js";

interface CountRow {
  count: number | string;
}

interface JobStatusCountRow {
  status: string;
  count: number | string;
}

interface FindingStatsRow {
  reproduced: number | string;
  fixed_verified: number | string;
  not_reproduced: number | string;
  candidate: number | string;
  false_positive: number | string;
}

interface ReleaseStatsRow {
  active: number | string;
  queued: number | string;
}

interface AlertStatsRow {
  open: number | string;
  critical: number | string;
}

export function registerStatsRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get("/v1/stats", async (req) => {
    const user = requireAccountLevel(req.user);
    const params = [user.id, user.isAdmin];

    const projectRow = await ctx.db.one<CountRow>(
      `SELECT COUNT(*)::int AS count
       FROM projects p
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1
       WHERE ($2::boolean = true OR pm.role IS NOT NULL OR p.is_demo = true)`,
      params,
    );
    const projects = Number(projectRow?.count ?? 0);

    const jobRows = await ctx.db.query<JobStatusCountRow>(
      `SELECT aj.status, COUNT(*)::int AS count
       FROM analysis_jobs aj
       WHERE aj.project_id IN (
         SELECT p.id
         FROM projects p
         LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1
         WHERE ($2::boolean = true OR pm.role IS NOT NULL OR p.is_demo = true)
       )
       GROUP BY aj.status`,
      params,
    );
    const jobs: Record<string, number> = {
      QUEUED: 0,
      RUNNING: 0,
      COMPLETED: 0,
      FAILED: 0,
      CANCELLED: 0,
    };
    for (const r of jobRows) {
      if (r.status in jobs) {
        jobs[r.status] = Number(r.count);
      }
    }

    const findingRow = await ctx.db.one<FindingStatsRow>(
      `SELECT
        COALESCE(SUM(CASE WHEN f.review_decision = 'false-positive' THEN 1 ELSE 0 END), 0)::int AS false_positive,
        COALESCE(SUM(CASE WHEN f.status = 'reproduced' AND (f.review_decision IS NULL OR f.review_decision != 'false-positive') THEN 1 ELSE 0 END), 0)::int AS reproduced,
        COALESCE(SUM(CASE WHEN f.status = 'fixed-verified' AND (f.review_decision IS NULL OR f.review_decision != 'false-positive') THEN 1 ELSE 0 END), 0)::int AS fixed_verified,
        COALESCE(SUM(CASE WHEN f.status = 'not-reproduced' AND (f.review_decision IS NULL OR f.review_decision != 'false-positive') THEN 1 ELSE 0 END), 0)::int AS not_reproduced,
        COALESCE(SUM(CASE WHEN f.status = 'candidate' AND (f.review_decision IS NULL OR f.review_decision != 'false-positive') THEN 1 ELSE 0 END), 0)::int AS candidate
       FROM findings f
       WHERE f.project_id IN (
         SELECT p.id
         FROM projects p
         LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1
         WHERE ($2::boolean = true OR pm.role IS NOT NULL OR p.is_demo = true)
       )`,
      params,
    );

    const releaseRow = await ctx.db.one<ReleaseStatsRow>(
      `SELECT
        COALESCE(SUM(CASE WHEN r.status = 'active' THEN 1 ELSE 0 END), 0)::int AS active,
        COALESCE(SUM(CASE WHEN r.status = 'queued' THEN 1 ELSE 0 END), 0)::int AS queued
       FROM releases r
       WHERE r.project_id IN (
         SELECT p.id
         FROM projects p
         LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1
         WHERE ($2::boolean = true OR pm.role IS NOT NULL OR p.is_demo = true)
       )`,
      params,
    );

    const alertRow = await ctx.db.one<AlertStatsRow>(
      `SELECT
        COALESCE(SUM(CASE WHEN a.status = 'open' THEN 1 ELSE 0 END), 0)::int AS open,
        COALESCE(SUM(CASE WHEN a.status = 'open' AND a.severity = 'critical' THEN 1 ELSE 0 END), 0)::int AS critical
       FROM alerts a
       WHERE a.project_id IN (
         SELECT p.id
         FROM projects p
         LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1
         WHERE ($2::boolean = true OR pm.role IS NOT NULL OR p.is_demo = true)
       )`,
      params,
    );

    return {
      projects,
      jobs,
      findings: {
        reproduced: Number(findingRow?.reproduced ?? 0),
        fixedVerified: Number(findingRow?.fixed_verified ?? 0),
        notReproduced: Number(findingRow?.not_reproduced ?? 0),
        candidate: Number(findingRow?.candidate ?? 0),
        falsePositive: Number(findingRow?.false_positive ?? 0),
      },
      releases: {
        active: Number(releaseRow?.active ?? 0),
        queued: Number(releaseRow?.queued ?? 0),
      },
      alerts: {
        open: Number(alertRow?.open ?? 0),
        critical: Number(alertRow?.critical ?? 0),
      },
    };
  });
}

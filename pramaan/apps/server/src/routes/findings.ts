import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { assertRole, audit, requireUser, type AuthUser } from "../auth.js";
import type { Ctx } from "../context.js";
import { badRequest, conflict, HttpError, notConfigured, notFound, parse } from "../errors.js";
import { enqueueJob, type JobSource } from "../queue.js";
import { jobDto } from "./jobs.js";
import type { JobRow } from "../queue.js";

const IdParams = z.object({ id: z.string().uuid("invalid id") });
const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

interface FindingRow {
  id: string;
  project_id: string;
  job_id: string;
  label: string;
  vuln_class: string;
  title: string;
  severity: string;
  confidence: string;
  status: string;
  contract: string;
  function_sig: string | null;
  file: string | null;
  lines: number[] | null;
  sources: unknown;
  template_id: string | null;
  plan: unknown;
  gates: unknown;
  vulnerable_run: unknown;
  review_decision: string | null;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  created_at: Date;
}

interface FixRow {
  id: string;
  finding_id: string;
  generator: string;
  file: string;
  diff: string;
  after_source: string | null;
  change: string | null;
  explanation: string;
  status: string;
  verification: unknown;
  job_id: string | null;
  pr_url: string | null;
  created_at: Date;
}

/** A reviewer's "false-positive" decision overrides the engine status in what the dashboard shows. */
function summary(f: FindingRow) {
  return {
    id: f.id,
    projectId: f.project_id,
    jobId: f.job_id,
    label: f.label,
    vulnClass: f.vuln_class,
    title: f.title,
    severity: f.severity,
    confidence: f.confidence,
    status: f.review_decision === "false-positive" ? "false-positive" : f.status,
    contract: f.contract,
    functionSig: f.function_sig,
    file: f.file,
    lines: f.lines,
    sources: f.sources,
    review: f.review_decision ? { decision: f.review_decision, note: f.review_note, reviewedBy: f.reviewed_by, reviewedAt: iso(f.reviewed_at) } : null,
    createdAt: iso(f.created_at),
  };
}

const fixDto = (x: FixRow) => ({
  id: x.id,
  generator: x.generator,
  file: x.file,
  diff: x.diff,
  explanation: x.explanation,
  status: x.status,
  verification: x.verification,
  prUrl: x.pr_url,
  jobId: x.job_id,
  createdAt: iso(x.created_at),
});

export function registerFindingRoutes(app: FastifyInstance, ctx: Ctx): void {
  async function loadFinding(user: AuthUser | null, id: string, min: "viewer" | "maintainer") {
    const f = await ctx.db.one<FindingRow>("SELECT * FROM findings WHERE id = $1", [id]);
    if (!f) throw notFound("finding");
    await assertRole(ctx.db, user, f.project_id, min);
    return f;
  }

  app.get("/v1/projects/:id/findings", async (req) => {
    const user = requireUser(req.user);
    const { id } = parse(IdParams, req.params, "project params");
    await assertRole(ctx.db, user, id, "viewer");
    const { status } = parse(z.object({ status: z.string().max(40).optional() }), req.query, "query");
    const rows = await ctx.db.query<FindingRow>("SELECT * FROM findings WHERE project_id = $1 ORDER BY created_at DESC, label LIMIT 500", [id]);
    const out = rows.map(summary);
    return status ? out.filter((f) => f.status === status) : out;
  });

  app.get("/v1/findings/:id", async (req) => {
    const user = requireUser(req.user);
    const { id } = parse(IdParams, req.params, "finding params");
    const f = await loadFinding(user, id, "viewer");
    const test = await ctx.db.one<{ file_name: string; source: string; sha256: string }>("SELECT file_name, source, sha256 FROM exploit_tests WHERE finding_id = $1 ORDER BY created_at LIMIT 1", [id]);
    const evidence = await ctx.db.query<{ sha256: string; created_at: Date }>("SELECT sha256, created_at FROM evidence WHERE finding_id = $1 ORDER BY created_at", [id]);
    const fixes = await ctx.db.query<FixRow>("SELECT * FROM fix_proposals WHERE finding_id = $1 ORDER BY created_at DESC", [id]);
    return {
      ...summary(f),
      templateId: f.template_id,
      plan: f.plan,
      gates: f.gates,
      vulnerableRun: f.vulnerable_run,
      exploitTest: test ? { fileName: test.file_name, source: test.source, sha256: test.sha256 } : null,
      evidence: evidence.map((e) => ({ sha256: e.sha256, createdAt: iso(e.created_at) })),
      fixes: fixes.map(fixDto),
    };
  });

  app.post("/v1/findings/:id/review", async (req) => {
    const user = requireUser(req.user);
    const { id } = parse(IdParams, req.params, "finding params");
    const f = await loadFinding(user, id, "maintainer");
    const body = parse(z.object({ decision: z.enum(["confirmed", "false-positive"]), note: z.string().trim().max(2000).optional() }), req.body, "review body");
    await ctx.db.query("UPDATE findings SET review_decision = $2, review_note = $3, reviewed_by = $4, reviewed_at = $5 WHERE id = $1", [id, body.decision, body.note ?? null, user.id, ctx.deps.now()]);
    await audit(ctx.db, user.id, f.project_id, "finding.review", id, { decision: body.decision });
    return summary((await ctx.db.one<FindingRow>("SELECT * FROM findings WHERE id = $1", [id]))!);
  });

  /** Queues a fix job: propose a patch, then re-run the exploit (must fail) and the project's tests (must pass). */
  app.post("/v1/findings/:id/fix", async (req, reply) => {
    const user = requireUser(req.user);
    const { id } = parse(IdParams, req.params, "finding params");
    const f = await loadFinding(user, id, "maintainer");
    const body = parse(z.object({ ai: z.boolean().optional() }).optional().default({}), req.body ?? {}, "fix body");
    if (f.status !== "reproduced") throw conflict(`only a reproduced finding can be fixed (this one is ${f.status}); "no proof, no finding"`, "NOT_REPRODUCED");
    const source: JobSource = { type: "finding", findingId: id };
    const { job } = await enqueueJob(ctx.db, { projectId: f.project_id, kind: "fix", source, params: { findingId: id, ...(body.ai ? { ai: true } : {}) }, createdBy: user.id });
    await audit(ctx.db, user.id, f.project_id, "finding.fix", id, { job: job.id });
    return reply.code(202).send({ job: jobDto(job) });
  });

  app.get("/v1/findings/:id/evidence/:sha256", async (req, reply) => {
    const user = requireUser(req.user);
    const { id, sha256 } = parse(z.object({ id: z.string().uuid(), sha256: z.string().regex(/^[0-9a-f]{64}$/) }), req.params, "evidence params");
    await loadFinding(user, id, "viewer");
    const ev = await ctx.db.one<{ body: string }>("SELECT body FROM evidence WHERE finding_id = $1 AND sha256 = $2", [id, sha256]);
    if (!ev) throw notFound("evidence");
    // exact canonical bytes: their sha256 is the published identifier
    return reply.header("content-type", "application/json; charset=utf-8").header("cache-control", "private, max-age=31536000, immutable").send(ev.body);
  });

  /**
   * Opens a pull request with a VERIFIED fix on the source repository. Never merges and never pushes to the default
   * branch: the change goes to a new `pramaan/fix-*` branch and a human reviews the PR.
   */
  app.post("/v1/fixes/:id/pull-request", async (req, reply) => {
    const user = requireUser(req.user);
    const { id } = parse(IdParams, req.params, "fix params");
    const fix = await ctx.db.one<FixRow>("SELECT * FROM fix_proposals WHERE id = $1", [id]);
    if (!fix) throw notFound("fix");
    const finding = await loadFinding(user, fix.finding_id, "maintainer");
    const token = ctx.cfg.GITHUB_TOKEN;
    if (!token) throw notConfigured("GITHUB_NOT_CONFIGURED", "pull requests need GITHUB_TOKEN on the server");
    if (fix.pr_url) return { url: fix.pr_url };
    if (fix.status !== "verified" || fix.after_source === null) throw conflict("only a verified fix (exploit now fails, tests pass) can become a pull request", "FIX_NOT_VERIFIED");
    const origin = await ctx.db.one<JobRow>("SELECT * FROM analysis_jobs WHERE id = $1", [finding.job_id]);
    const src = origin?.source;
    if (!src || src.type !== "github") throw notConfigured("NOT_A_GITHUB_SOURCE", "pull requests are only available when the analysis source was a GitHub repository");
    const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(src.url);
    if (!m) throw badRequest("unsupported repository URL");
    const [, owner, repo] = m;

    const api = ctx.cfg.GITHUB_API_URL.replace(/\/$/, "");
    const gh = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
      const res = await ctx.deps.fetch(`${api}/repos/${owner}/${repo}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "pramaan", ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "error",
      });
      if (!res.ok) throw new HttpError(502, "GITHUB_ERROR", `GitHub ${method} ${path.split("?")[0]} failed with HTTP ${res.status}`);
      return (await res.json()) as T;
    };

    const info = await gh<{ default_branch: string }>("GET", "");
    const base = src.ref && !/^[0-9a-f]{40}$/.test(src.ref) ? src.ref : info.default_branch;
    const baseSha = origin?.commit_sha && /^[0-9a-f]{40}$/.test(origin.commit_sha) ? origin.commit_sha : (await gh<{ object: { sha: string } }>("GET", `/git/ref/heads/${encodeURIComponent(base).replace(/%2F/g, "/")}`)).object.sha;
    // the analysed Foundry project may sit in a sub-directory; find the one repository path the fix's file maps to
    const tree = await gh<{ tree: { path: string; type: string }[]; truncated?: boolean }>("GET", `/git/trees/${baseSha}?recursive=1`);
    const hits = tree.tree.filter((e) => e.type === "blob" && (e.path === fix.file || e.path.endsWith(`/${fix.file}`)));
    if (hits.length !== 1) throw conflict(`could not map ${fix.file} to exactly one file in the repository (${hits.length} candidates)`, "PATH_AMBIGUOUS");
    const path = hits[0]!.path;
    const branch = `pramaan/fix-${finding.label.toLowerCase()}-${fix.id.slice(0, 8)}`;
    await gh("POST", "/git/refs", { ref: `refs/heads/${branch}`, sha: baseSha });
    const current = await gh<{ sha: string }>("GET", `/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`);
    await gh("PUT", `/contents/${path.split("/").map(encodeURIComponent).join("/")}`, {
      message: `Pramaan: fix ${finding.vuln_class} in ${finding.contract}`,
      content: Buffer.from(fix.after_source, "utf8").toString("base64"),
      sha: current.sha,
      branch,
    });
    const pr = await gh<{ html_url: string }>("POST", "/pulls", {
      title: `Pramaan: fix ${finding.title}`,
      head: branch,
      base: info.default_branch === base ? info.default_branch : base,
      body: `${fix.explanation}\n\n**Proof.** The exploit test that drained the vulnerable code now fails, and the project's own tests pass (job ${fix.job_id ?? "n/a"}).\n\n\`\`\`diff\n${fix.diff.slice(0, 6000)}\n\`\`\`\n\nOpened by Pramaan. This is a proposal for human review: nothing is merged automatically, and "fixed" means the proven exploit no longer works, not that the code is safe.`,
    });
    await ctx.db.query("UPDATE fix_proposals SET pr_url = $2 WHERE id = $1", [id, pr.html_url]);
    await audit(ctx.db, user.id, finding.project_id, "fix.pull-request", id, { url: pr.html_url });
    return reply.code(201).send({ url: pr.html_url });
  });
}

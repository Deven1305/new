import { existsSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { canonicalize } from "@pramaan/manifest";
import {
  analyzeProject,
  buildEvidence,
  createAiSlotFiller,
  draftFixWithAi,
  proposeFix,
  renderMarkdownReport,
  verifyFix,
  type AnalysisReport,
  type ContractInfo,
  type ExploitPlan,
  type FindingResult,
  type FixProposal,
  type ProjectConfig,
} from "@pramaan/engine";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { addEvent, claimJob, finishJob, heartbeat, recoverStale, type JobRow, type JobSource } from "./queue.js";
import { materialize } from "./sources.js";

type Log = { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void };

function readConfig(dir: string): ProjectConfig | undefined {
  const p = join(dir, "pramaan.json");
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as ProjectConfig) : undefined;
}

export async function storeFinding(db: Db, job: JobRow, report: AnalysisReport, f: FindingResult): Promise<string> {
  const contract = report.contracts.find((c) => c.name === f.candidate.contract) ?? null;
  const row = await db.one<{ id: string }>(
    `INSERT INTO findings (project_id, job_id, label, finding_key, vuln_class, title, severity, confidence, status, contract, function_sig, file, lines,
       sources, template_id, plan, plan_error, contract_info, gates, vulnerable_run, pairs, engine_result)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING id`,
    [
      job.project_id,
      job.id,
      f.id,
      f.candidate.key,
      f.candidate.vulnClass,
      f.candidate.title,
      f.status === "reproduced" && f.candidate.vulnClass === "access-control" ? "critical" : f.candidate.severity,
      f.candidate.confidence,
      f.status,
      f.candidate.contract,
      f.candidate.function,
      f.candidate.file,
      f.candidate.lines,
      JSON.stringify(f.candidate.sources),
      f.templateId,
      f.plan ? JSON.stringify(f.plan) : null,
      f.planError,
      contract ? JSON.stringify(contract) : null,
      JSON.stringify(f.gates),
      JSON.stringify(f.vulnerableRun),
      JSON.stringify(f.pairs),
      JSON.stringify(f),
    ],
  );
  if (f.test) {
    await db.query("INSERT INTO exploit_tests (finding_id, file_name, contract_name, source, sha256) VALUES ($1,$2,$3,$4,$5)", [row!.id, f.test.fileName, f.test.contractName, f.test.source, f.test.sha256]);
  }
  if (f.status === "reproduced") {
    const { evidence, sha256 } = buildEvidence(report, f);
    await db.query("INSERT INTO evidence (finding_id, sha256, body) VALUES ($1,$2,$3)", [row!.id, sha256, canonicalize(evidence)]);
  }
  return row!.id;
}

async function runFix(
  db: Db,
  args: { repoDir: string; findingRowId: string; finding: FindingResult; contract: ContractInfo; config?: ProjectConfig; ai: boolean; jobId: string; signal: AbortSignal; report?: AnalysisReport },
): Promise<{ verified: boolean; detail: string }> {
  const fn = args.contract.functions.find((x) => x.name === args.finding.candidate.function?.replace(/\(.*$/, ""));
  if (!fn) return { verified: false, detail: "function not found" };
  let proposal = proposeFix(args.repoDir, args.contract, fn, args.finding.candidate.vulnClass);
  if (!proposal.ok && args.ai && args.finding.test) {
    const ai = await draftFixWithAi({ repoDir: args.repoDir, contract: args.contract, candidate: args.finding.candidate, exploitTest: args.finding.test.source, failureReason: proposal.reason });
    if (ai) proposal = { ok: true, fix: ai };
  }
  if (!proposal.ok) {
    await addEvent(db, args.jobId, "fix", "info", `${args.finding.id}: ${proposal.reason}`);
    return { verified: false, detail: proposal.reason };
  }
  const fix: FixProposal = proposal.fix;
  const fp = await db.one<{ id: string }>(
    "INSERT INTO fix_proposals (finding_id, generator, file, diff, after_source, change, explanation, status, job_id) VALUES ($1,$2,$3,$4,$5,$6,$7,'verifying',$8) RETURNING id",
    [args.findingRowId, fix.generator, fix.file, fix.diff, fix.after, fix.change, fix.explanation, args.jobId],
  );
  const v = await verifyFix({
    repoDir: args.repoDir,
    finding: args.finding,
    fix,
    config: args.config,
    signal: args.signal,
    onProgress: (e) => void addEvent(db, args.jobId, e.step, e.status, e.message),
  });
  await db.query("UPDATE fix_proposals SET status = $2, verification = $3 WHERE id = $1", [fp!.id, v.verified ? "verified" : "failed", JSON.stringify(v)]);
  if (v.verified) {
    await db.query("UPDATE findings SET status = 'fixed-verified' WHERE id = $1", [args.findingRowId]);
    if (args.report) {
      const { evidence, sha256 } = buildEvidence(args.report, args.finding, { fixVerification: v, fixedRef: `fix proposal ${fp!.id}` });
      await db.query("INSERT INTO evidence (finding_id, sha256, body) VALUES ($1,$2,$3)", [args.findingRowId, sha256, canonicalize(evidence)]);
    }
  }
  return { verified: v.verified, detail: v.detail };
}

async function processAnalyze(db: Db, cfg: Config, job: JobRow, signal: AbortSignal): Promise<unknown> {
  const ws = await materialize(db, cfg, job.source, job.id);
  try {
    await db.query("UPDATE analysis_jobs SET commit_sha = $2 WHERE id = $1", [job.id, ws.commit]);
    await addEvent(db, job.id, "source", "completed", `${ws.label} @ ${ws.commit.slice(0, 12)}`);
    const config = readConfig(ws.dir);
    const report = await analyzeProject({
      repoDir: ws.dir,
      repo: ws.label,
      commit: ws.commit,
      config,
      signal,
      slotFiller: job.params["ai"] ? createAiSlotFiller(ws.dir) : null,
      onProgress: (e) => void addEvent(db, job.id, e.step, e.status, e.message),
    });
    const ids = new Map<string, string>();
    for (const f of report.findings) ids.set(f.id, await storeFinding(db, job, report, f));
    const fixes: Record<string, { verified: boolean; detail: string }> = {};
    if (job.params["fix"]) {
      for (const f of report.findings.filter((x) => x.status === "reproduced")) {
        const contract = report.contracts.find((c) => c.name === f.candidate.contract);
        if (contract) fixes[f.id] = await runFix(db, { repoDir: ws.dir, findingRowId: ids.get(f.id)!, finding: f, contract, config, ai: Boolean(job.params["ai"]), jobId: job.id, signal, report });
      }
    }
    return {
      repo: ws.label,
      commit: ws.commit,
      tools: report.tools,
      build: report.build.ok,
      scanners: report.scanners,
      regression: report.regression,
      sandbox: report.sandbox,
      counts: {
        candidates: report.candidates.length,
        reproduced: report.findings.filter((f) => f.status === "reproduced").length,
        notReproduced: report.findings.filter((f) => f.status === "not-reproduced").length,
        candidatesOnly: report.findings.filter((f) => f.status === "candidate").length,
        fixesVerified: Object.values(fixes).filter((x) => x.verified).length,
      },
      fixes,
      reportMarkdown: renderMarkdownReport(report),
    };
  } finally {
    ws.cleanup();
  }
}

async function processFix(db: Db, cfg: Config, job: JobRow, signal: AbortSignal): Promise<unknown> {
  const findingId = String(job.params["findingId"] ?? "");
  const row = await db.one<{ id: string; label: string; job_id: string; status: string; plan: ExploitPlan | null; contract_info: ContractInfo | null; finding_key: string; vuln_class: string; contract: string; function_sig: string | null; title: string; severity: string; confidence: string; file: string; lines: number[]; sources: FindingResult["candidate"]["sources"] }>(
    "SELECT * FROM findings WHERE id = $1",
    [findingId],
  );
  if (!row || !row.plan || !row.contract_info) throw new Error("finding has no exploit plan to re-prove");
  const test = await db.one<{ file_name: string; contract_name: string; source: string; sha256: string }>("SELECT * FROM exploit_tests WHERE finding_id = $1 ORDER BY created_at LIMIT 1", [findingId]);
  const origin = await db.one<{ source: JobSource }>("SELECT source FROM analysis_jobs WHERE id = $1", [row.job_id]);
  if (!test || !origin) throw new Error("finding is missing its exploit test or source");
  const ws = await materialize(db, cfg, origin.source, job.id);
  try {
    const finding: FindingResult = {
      id: row.label,
      candidate: { key: row.finding_key, vulnClass: row.vuln_class, title: row.title, severity: row.severity as never, confidence: row.confidence as never, contract: row.contract, function: row.function_sig, file: row.file, lines: row.lines ?? [], sources: row.sources },
      templateId: row.plan.templateId,
      plan: row.plan,
      planError: null,
      test: { fileName: test.file_name, contractName: test.contract_name, source: test.source, sha256: test.sha256 },
      gates: [],
      vulnerableRun: { result: "passed", reason: null, logs: [], durationMs: null },
      status: "reproduced",
      pairs: [],
    };
    return await runFix(db, { repoDir: ws.dir, findingRowId: row.id, finding, contract: row.contract_info, config: readConfig(ws.dir), ai: Boolean(job.params["ai"]), jobId: job.id, signal });
  } finally {
    ws.cleanup();
  }
}

/** Polls the Postgres queue. Several workers (processes or hosts) can run against one database. */
export function startWorker(db: Db, cfg: Config, log: Log): { stop: () => Promise<void> } {
  const workerId = `${hostname()}:${process.pid}`;
  let stopped = false;
  let current: Promise<void> | null = null;
  const tick = async () => {
    if (stopped) return;
    try {
      const recovered = await recoverStale(db);
      if (recovered) log.warn({ recovered }, "requeued stale jobs");
      const job = await claimJob(db, workerId);
      if (job) {
        current = run(job);
        await current;
        current = null;
      }
    } catch (err) {
      log.error({ err }, "worker tick failed");
    } finally {
      if (!stopped) setTimeout(tick, 1500);
    }
  };
  const run = async (job: JobRow) => {
    const controller = new AbortController();
    const beat = setInterval(async () => {
      if (await heartbeat(db, job.id).catch(() => false)) controller.abort();
    }, 2000);
    log.info({ job: job.id, kind: job.kind }, "job started");
    await addEvent(db, job.id, "job", "started", `${job.kind} job claimed by ${workerId}`);
    try {
      const result = job.kind === "analyze" ? await processAnalyze(db, cfg, job, controller.signal) : await processFix(db, cfg, job, controller.signal);
      const status = controller.signal.aborted ? "CANCELLED" : "COMPLETED";
      await finishJob(db, job.id, status, result, null);
      await addEvent(db, job.id, "job", status === "COMPLETED" ? "completed" : "failed", status === "COMPLETED" ? "job completed" : "job cancelled");
    } catch (err) {
      const message = (err as Error).message.slice(0, 4000);
      await finishJob(db, job.id, controller.signal.aborted ? "CANCELLED" : "FAILED", null, message);
      await addEvent(db, job.id, "job", "failed", message);
      log.warn({ job: job.id, err: message }, "job failed");
    } finally {
      clearInterval(beat);
    }
  };
  void tick();
  return {
    stop: async () => {
      stopped = true;
      if (current) await Promise.race([current, new Promise((r) => setTimeout(r, 5000))]);
    },
  };
}

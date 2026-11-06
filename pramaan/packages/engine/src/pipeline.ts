import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "@pramaan/manifest";
import { collectCandidates } from "./candidates.js";
import { classifyFixedRun, parseForgeJson, summarizeSuite, type FixedOutcome } from "./forge.js";
import type { FixProposal } from "./fixers.js";
import { staticGates, type Gate } from "./gates.js";
import { runSandbox, SANDBOX_IMAGE, type SandboxResult } from "./sandbox.js";
import { planExploit, renderExploit, retarget, testContractName, testFileName, type ExploitPlan, type ProjectConfig, type TemplateId } from "./templates.js";
import type { AnalyzeOutput, Candidate, ContractInfo, ForgeTestResult, SuiteSummary, ToolVersion } from "./types.js";
import { copyProject } from "./workspace.js";

export interface ProgressEvent {
  step: string;
  status: "started" | "completed" | "failed" | "info";
  message: string;
  at: string;
}
export type Progress = (e: ProgressEvent) => void;

/** Optional AI slot filler (see ai.ts). It may only propose slot values; the gates and the test run decide. */
export type SlotFiller = (input: { candidate: Candidate; contract: ContractInfo; reason: string; needs: string[] }) => Promise<ExploitPlan | null>;

export interface AnalyzeRequest {
  repoDir: string;
  repo: string;
  commit: string | null;
  config?: ProjectConfig;
  findingPrefix?: string;
  maxExploits?: number;
  skipAderyn?: boolean;
  signal?: AbortSignal;
  onProgress?: Progress;
  slotFiller?: SlotFiller | null;
  image?: string;
}

export interface RunRecord {
  result: "passed" | "failed" | "error" | "not-run";
  reason: string | null;
  logs: string[];
  durationMs: number | null;
}

export interface TestFile {
  fileName: string;
  contractName: string;
  source: string;
  sha256: string;
}

export interface PairVerification {
  fixedContract: string;
  test: TestFile;
  outcome: FixedOutcome;
  verified: boolean;
}

export interface FindingResult {
  id: string;
  candidate: Candidate;
  templateId: TemplateId | null;
  plan: ExploitPlan | null;
  planError: string | null;
  test: TestFile | null;
  gates: Gate[];
  vulnerableRun: RunRecord;
  status: "reproduced" | "not-reproduced" | "candidate" | "inconclusive";
  pairs: PairVerification[];
}

export interface AnalysisReport {
  repo: string;
  commit: string | null;
  startedAt: string;
  finishedAt: string;
  tools: ToolVersion[];
  build: { ok: boolean; log: string };
  scanners: { slither: { ok: boolean; error: string | null; results: number }; aderyn: { ok: boolean; error: string | null; results: number } };
  contracts: ContractInfo[];
  candidates: Candidate[];
  findings: FindingResult[];
  regression: SuiteSummary;
  sandbox: { image: string; analyzeMs: number; testMs: number };
}

const now = () => new Date().toISOString();

function testFile(plan: ExploitPlan, findingId: string, suffix = ""): TestFile {
  const source = renderExploit(plan, { findingId, suffix });
  return { fileName: testFileName(findingId, suffix), contractName: testContractName(findingId, suffix), source, sha256: sha256Hex(source) };
}

function suiteExclude(config?: ProjectConfig & { regression?: { excludePaths?: string[] } }): string {
  const extra = config?.regression?.excludePaths ?? [];
  return extra.length ? `{test/pramaan/*,${extra.join(",")}}` : "test/pramaan/*";
}

function sandboxFailure(label: string, r: SandboxResult): Error {
  const why = r.timedOut ? "timed out" : r.cancelled ? "was cancelled" : `exited with ${r.exitCode}`;
  return new Error(`${label} ${why}: ${r.stderrTail.slice(-1500)}`);
}

async function runTests(
  repoDir: string,
  files: TestFile[],
  opts: { suite: boolean; config?: ProjectConfig; signal?: AbortSignal; image?: string; onLog?: (l: string) => void },
): Promise<{ results: ForgeTestResult[]; suite: SuiteSummary; compiled: boolean; raw: SandboxResult }> {
  const inputs = mkdtempSync(join(tmpdir(), "pramaan-inputs-"));
  try {
    mkdirSync(join(inputs, "tests"));
    for (const f of files) writeFileSync(join(inputs, "tests", f.fileName), f.source);
    const r = await runSandbox({
      mode: "test",
      srcDir: repoDir,
      inputsDir: inputs,
      suite: opts.suite,
      suiteExclude: suiteExclude(opts.config as never),
      signal: opts.signal,
      image: opts.image,
      onLog: opts.onLog,
    });
    if (!r.result) throw sandboxFailure("sandbox test run", r);
    const exploit = r.result["exploit"] as { json: unknown; log: string } | undefined;
    const suite = r.result["suite"] as { json: unknown } | undefined;
    const results = parseForgeJson(exploit?.json);
    return {
      results,
      compiled: files.length === 0 || results.length > 0,
      suite: opts.suite ? summarizeSuite(parseForgeJson(suite?.json), suite?.json != null) : { ran: false, passed: 0, failed: 0, skipped: 0, failures: [] },
      raw: r,
    };
  } finally {
    rmSync(inputs, { recursive: true, force: true });
  }
}

function resultFor(results: ForgeTestResult[], contractName: string): ForgeTestResult | undefined {
  return results.find((r) => r.contract === contractName && r.test.startsWith("test_exploit")) ?? results.find((r) => r.contract === contractName);
}

function runRecord(r: ForgeTestResult | undefined): RunRecord {
  if (!r) return { result: "error", reason: "the test did not run (compile error or missing result)", logs: [], durationMs: null };
  return { result: r.status === "Success" ? "passed" : r.status === "Skipped" ? "not-run" : "failed", reason: r.reason, logs: r.logs, durationMs: r.durationMs };
}

/**
 * PROVE: scanners produce candidates; each candidate with a template gets a generated Foundry exploit; the exploit is
 * executed in the network-less sandbox. A candidate becomes "reproduced" only if its exploit passes on this code and
 * every static gate holds. Configured contract pairs (vulnerable → fixed) are checked in the same run.
 */
export async function analyzeProject(req: AnalyzeRequest): Promise<AnalysisReport> {
  const startedAt = now();
  const emit = (step: string, status: ProgressEvent["status"], message: string) => req.onProgress?.({ step, status, message, at: now() });
  const prefix = req.findingPrefix ?? "PRM";

  emit("analyze", "started", "running Slither, Aderyn and forge build in the sandbox");
  const an = await runSandbox({ mode: "analyze", srcDir: req.repoDir, skipAderyn: req.skipAderyn, signal: req.signal, image: req.image, onLog: (l) => emit("analyze", "info", l) });
  if (!an.result) {
    emit("analyze", "failed", an.stderrTail.slice(-500));
    throw sandboxFailure("sandbox analysis", an);
  }
  const analysis = an.result as unknown as AnalyzeOutput;
  emit("analyze", "completed", `build ${analysis.build.ok ? "ok" : "FAILED"}, ${analysis.slither.detectors.length} Slither results, ${analysis.aderyn?.ok ? "Aderyn ok" : "Aderyn unavailable"}`);
  if (!analysis.build.ok) throw new Error(`forge build failed in the sandbox:\n${analysis.build.log.slice(-2000)}`);

  const exclude = (req.config?.exclude ?? []).map((p) => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}`));
  const candidates = collectCandidates(analysis, { exclude });
  emit("candidates", "completed", `${candidates.length} candidates after de-duplication`);

  const byName = new Map(analysis.contracts.filter((c) => !/^(lib|test|script)\//.test(c.source)).map((c) => [c.name, c]));
  const findings: FindingResult[] = [];
  const files: TestFile[] = [];
  let n = 0;
  for (const candidate of candidates) {
    const id = `${prefix}-${++n}`;
    const base: FindingResult = {
      id, candidate, templateId: null, plan: null, planError: null, test: null, gates: [],
      vulnerableRun: { result: "not-run", reason: null, logs: [], durationMs: null }, status: "candidate", pairs: [],
    };
    const contract = byName.get(candidate.contract);
    if (!contract) {
      findings.push({ ...base, planError: `contract ${candidate.contract} not found in build output` });
      continue;
    }
    let planned = planExploit({ candidate, contract, config: req.config });
    if (!planned.ok && planned.needs.length && req.slotFiller) {
      emit("plan", "info", `${id}: heuristics could not fill ${planned.needs.join(", ")}; asking the AI slot filler`);
      const aiPlan = await req.slotFiller({ candidate, contract, reason: planned.reason, needs: planned.needs }).catch(() => null);
      if (aiPlan) planned = { ok: true, plan: aiPlan };
    }
    if (!planned.ok) {
      findings.push({ ...base, planError: planned.reason });
      continue;
    }
    if (files.length >= (req.maxExploits ?? 8) * 2) {
      findings.push({ ...base, templateId: planned.plan.templateId, plan: planned.plan, planError: "exploit budget for this run reached" });
      continue;
    }
    const test = testFile(planned.plan, id);
    const gates = staticGates(planned.plan, test.source);
    const finding: FindingResult = { ...base, templateId: planned.plan.templateId, plan: planned.plan, test, gates };
    if (gates.some((g) => !g.passed)) {
      finding.status = "inconclusive";
      finding.planError = `static gate failed: ${gates.filter((g) => !g.passed).map((g) => g.id).join(", ")}`;
      findings.push(finding);
      continue;
    }
    files.push(test);
    for (const pair of req.config?.pairs ?? []) {
      const fixed = pair.vulnerable === contract.name ? byName.get(pair.fixed) : undefined;
      if (!fixed) continue;
      const fixedTest = testFile(retarget(planned.plan, fixed), id, `_${fixed.name}`);
      files.push(fixedTest);
      finding.pairs.push({ fixedContract: fixed.name, test: fixedTest, outcome: { kind: "missing" }, verified: false });
    }
    findings.push(finding);
  }
  emit("exploits", "completed", `${files.length} exploit tests generated from templates`);

  emit("prove", "started", "running exploit tests and the project's own suite in the sandbox");
  let run = await runTests(req.repoDir, files, { suite: true, config: req.config, signal: req.signal, image: req.image });
  if (!run.compiled && files.length > 1) {
    // One bad test breaks compilation for all; rerun them one by one to isolate it.
    emit("prove", "info", "combined run did not compile; isolating tests");
    const merged: ForgeTestResult[] = [];
    for (const f of files) merged.push(...(await runTests(req.repoDir, [f], { suite: false, config: req.config, signal: req.signal, image: req.image })).results);
    run = { ...run, results: merged };
  }

  for (const f of findings) {
    if (!f.test) continue;
    const r = resultFor(run.results, f.test.contractName);
    f.vulnerableRun = runRecord(r);
    f.status = !r ? "inconclusive" : r.status === "Success" ? "reproduced" : "not-reproduced";
    for (const p of f.pairs) {
      p.outcome = classifyFixedRun(resultFor(run.results, p.test.contractName));
      p.verified = f.status === "reproduced" && (p.outcome.kind === "reverted" || p.outcome.kind === "assertion-failed");
    }
  }
  const reproduced = findings.filter((f) => f.status === "reproduced").length;
  emit("prove", "completed", `${reproduced} reproduced, ${findings.filter((f) => f.status === "not-reproduced").length} not reproduced; suite ${run.suite.passed} passed / ${run.suite.failed} failed`);

  return {
    repo: req.repo,
    commit: req.commit,
    startedAt,
    finishedAt: now(),
    tools: analysis.tools,
    build: { ok: analysis.build.ok, log: analysis.build.log.slice(-4000) },
    scanners: {
      slither: { ok: analysis.slither.ok, error: analysis.slither.error, results: analysis.slither.detectors.length },
      aderyn: {
        ok: !!analysis.aderyn?.ok,
        error: analysis.aderyn?.error ?? null,
        results: (analysis.aderyn?.report?.high_issues?.issues.length ?? 0) + (analysis.aderyn?.report?.low_issues?.issues.length ?? 0),
      },
    },
    contracts: analysis.contracts.filter((c) => !/^(lib|test|script)\//.test(c.source)),
    candidates,
    findings,
    regression: run.suite,
    sandbox: { image: req.image ?? SANDBOX_IMAGE, analyzeMs: an.durationMs, testMs: run.raw.durationMs },
  };
}

export interface FixVerification {
  verified: boolean;
  exploit: FixedOutcome;
  regression: SuiteSummary;
  test: TestFile;
  detail: string;
  durationMs: number;
}

/**
 * RE-PROVE: apply the proposed fix to a COPY of the project and run the same exploit test plus the regression suite.
 * The fix counts as verified only if the exploit now fails as expected AND the suite passes. Nothing is merged.
 */
export async function verifyFix(args: {
  repoDir: string;
  finding: FindingResult;
  fix?: FixProposal;
  fixedDir?: string;
  config?: ProjectConfig;
  signal?: AbortSignal;
  image?: string;
  onProgress?: Progress;
}): Promise<FixVerification> {
  if (!args.finding.plan || !args.finding.test) throw new Error(`finding ${args.finding.id} has no exploit test to re-run`);
  const started = Date.now();
  let dir = args.fixedDir;
  let temp: string | null = null;
  if (!dir) {
    if (!args.fix) throw new Error("either a fix or a fixed directory is required");
    temp = mkdtempSync(join(tmpdir(), "pramaan-fixed-"));
    copyProject(args.repoDir, temp);
    writeFileSync(join(temp, args.fix.file), args.fix.after);
    dir = temp;
  }
  try {
    args.onProgress?.({ step: "reprove", status: "started", message: "re-running the exploit and the regression suite on the fixed code", at: now() });
    const run = await runTests(dir, [args.finding.test], { suite: true, config: args.config, signal: args.signal, image: args.image });
    const outcome = classifyFixedRun(resultFor(run.results, args.finding.test.contractName));
    const exploitBlocked = outcome.kind === "reverted" || outcome.kind === "assertion-failed";
    const suiteOk = run.suite.ran && run.suite.failed === 0;
    const verified = exploitBlocked && suiteOk;
    const detail = !exploitBlocked
      ? outcome.kind === "passed"
        ? "the exploit still succeeds on the fixed code"
        : `inconclusive: ${outcome.kind}${"reason" in outcome ? ` (${outcome.reason})` : ""}`
      : !suiteOk
        ? `the exploit is blocked but the regression suite has ${run.suite.failed} failing test(s)`
        : `exploit blocked (${outcome.kind}: ${"reason" in outcome ? outcome.reason : ""}); ${run.suite.passed} regression tests pass`;
    args.onProgress?.({ step: "reprove", status: verified ? "completed" : "failed", message: detail, at: now() });
    return { verified, exploit: outcome, regression: run.suite, test: args.finding.test, detail, durationMs: Date.now() - started };
  } finally {
    if (temp) rmSync(temp, { recursive: true, force: true });
  }
}

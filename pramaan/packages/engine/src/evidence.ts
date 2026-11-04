import { canonicalBytes, EVIDENCE_SCHEMA_V1, EvidenceV1, sha256Hex, type FindingEntry } from "@pramaan/manifest";
import type { AnalysisReport, FindingResult, FixVerification } from "./pipeline.js";

/** Machine-readable proof record for one finding (schema from the research, Deliverable 6.4). */
export function buildEvidence(
  report: AnalysisReport,
  finding: FindingResult,
  opts: { fixVerification?: FixVerification | null; fixedRef?: string | null; humanReviewed?: boolean } = {},
): { evidence: EvidenceV1; sha256: string } {
  if (!finding.test || !finding.plan) throw new Error(`finding ${finding.id} has no exploit test`);
  const source = finding.candidate.sources[0]!;
  const pair = finding.pairs.find((p) => p.verified) ?? finding.pairs[0];
  const fixed = opts.fixVerification;
  const fixedRun: EvidenceV1["fixedRun"] = fixed
    ? {
        result: fixed.exploit.kind === "reverted" || fixed.exploit.kind === "assertion-failed" ? "failed-as-expected" : fixed.exploit.kind === "passed" ? "passed-unexpectedly" : "error",
        revertReason: "reason" in fixed.exploit ? fixed.exploit.reason : null,
        ref: opts.fixedRef ?? "patched copy",
      }
    : pair
      ? {
          result: pair.verified ? "failed-as-expected" : pair.outcome.kind === "passed" ? "passed-unexpectedly" : pair.outcome.kind === "missing" ? "not-run" : "error",
          revertReason: "reason" in pair.outcome ? pair.outcome.reason : null,
          ref: `contract ${pair.fixedContract}`,
        }
      : { result: "not-run", revertReason: null, ref: null };
  const regression = fixed?.regression ?? report.regression;
  const gates = [
    ...finding.gates,
    { id: "passes-on-vulnerable", passed: finding.vulnerableRun.result === "passed", detail: finding.vulnerableRun.reason ?? "exploit test passed on the analysed code" },
    { id: "fails-on-fixed", passed: fixedRun.result === "failed-as-expected", detail: fixedRun.result },
    { id: "human-review", passed: !!opts.humanReviewed, detail: opts.humanReviewed ? "reviewed by a maintainer" : "awaiting human review" },
  ];
  const evidence = EvidenceV1.parse({
    schema: EVIDENCE_SCHEMA_V1,
    findingId: finding.id,
    createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    target: {
      repo: report.repo,
      commit: report.commit,
      contract: finding.candidate.contract,
      function: finding.candidate.function,
      fixedRef: fixedRun.ref,
    },
    candidateSource: {
      tool: source.tool,
      detector: finding.candidate.sources.map((s) => `${s.tool}:${s.detector}`).join(", "),
      location: { file: finding.candidate.file, lines: finding.candidate.lines, contract: finding.candidate.contract, function: finding.candidate.function },
    },
    template: { id: finding.plan.templateId, version: finding.plan.version, filledBy: finding.plan.filledBy },
    preconditions: finding.plan.preconditions,
    property: finding.plan.property,
    testPath: `test/pramaan/${finding.test.fileName}`,
    testSha256: finding.test.sha256,
    gates,
    vulnerableRun: {
      result: finding.vulnerableRun.result,
      reason: finding.vulnerableRun.reason,
      traceExcerpt: finding.vulnerableRun.logs.join("\n").slice(0, 4000),
      durationMs: finding.vulnerableRun.durationMs,
    },
    fixedRun,
    regressionSuite: { passed: regression.passed, failed: regression.failed, skipped: regression.skipped, ran: regression.ran },
    confidence: finding.status === "reproduced" ? "reproduced" : "not-reproduced",
    humanReviewed: !!opts.humanReviewed,
    tools: report.tools,
  });
  return { evidence, sha256: sha256Hex(canonicalBytes(evidence)) };
}

/** The manifest's `findings[]` entry for a finding, linking the exploit test and evidence by hash. */
export function manifestFinding(finding: FindingResult, evidenceSha256: string | null, fixCommit: string | null, fixVerified: boolean): FindingEntry {
  const severity = finding.candidate.vulnClass === "access-control" && finding.status === "reproduced" ? "critical" : finding.candidate.severity;
  return {
    id: finding.id,
    title: finding.candidate.title,
    class: finding.candidate.vulnClass,
    severity,
    status: finding.status === "reproduced" ? (fixVerified ? "fixed-verified" : "reproduced") : finding.status === "not-reproduced" ? "not-reproduced" : "candidate",
    exploitTestSha256: finding.test?.sha256 ?? null,
    evidenceSha256,
    fixCommit,
  };
}

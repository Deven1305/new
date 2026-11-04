import type { AnalysisReport, FindingResult, FixVerification } from "./pipeline.js";

const STATUS_TEXT: Record<FindingResult["status"], string> = {
  reproduced: "REPRODUCED: the exploit test passed on this code",
  "not-reproduced": "not reproduced: the exploit test failed, so this candidate is not reported as a vulnerability",
  candidate: "candidate only: no exploit template could be applied",
  inconclusive: "inconclusive: the exploit could not be run reliably",
};

function code(text: string, lang = ""): string {
  return `\`\`\`${lang}\n${text.trimEnd()}\n\`\`\``;
}

/** Human-readable security evidence report (Markdown). The JSON report is the AnalysisReport itself. */
export function renderMarkdownReport(report: AnalysisReport, fixes: Record<string, { verification: FixVerification; diff: string; explanation: string } | undefined> = {}): string {
  const lines: string[] = [];
  const reproduced = report.findings.filter((f) => f.status === "reproduced");
  lines.push(`# Pramaan security evidence report`, "");
  lines.push(`- Repository: ${report.repo}`);
  lines.push(`- Commit: ${report.commit ?? "(not a git checkout)"}`);
  lines.push(`- Analysed: ${report.startedAt} → ${report.finishedAt}`);
  lines.push(`- Tools: ${report.tools.map((t) => `${t.name} ${t.version}`).join(", ")}`);
  lines.push(`- Sandbox: \`${report.sandbox.image}\`, no network, read-only root, analysis ${Math.round(report.sandbox.analyzeMs / 1000)} s, tests ${Math.round(report.sandbox.testMs / 1000)} s`);
  lines.push(`- Scanners: Slither ${report.scanners.slither.ok ? `${report.scanners.slither.results} results` : `failed (${report.scanners.slither.error})`}, Aderyn ${report.scanners.aderyn.ok ? `${report.scanners.aderyn.results} issues` : "unavailable"}`);
  lines.push(`- Regression suite on the analysed code: ${report.regression.passed} passed, ${report.regression.failed} failed, ${report.regression.skipped} skipped`, "");
  lines.push(`**${reproduced.length} reproduced** out of ${report.candidates.length} scanner candidates. "No proof, no finding": a candidate is reported as a vulnerability only when a Foundry exploit test reproduces it.`, "");
  lines.push("| ID | Class | Contract.function | Status |", "|---|---|---|---|");
  for (const f of report.findings) lines.push(`| ${f.id} | ${f.candidate.vulnClass} | ${f.candidate.contract}.${f.candidate.function ?? "-"} | ${f.status} |`);
  lines.push("");
  for (const f of report.findings.filter((x) => x.test)) {
    lines.push(`## ${f.id}: ${f.candidate.title}`, "");
    lines.push(`- Location: \`${f.candidate.file}\` lines ${f.candidate.lines.slice(0, 1).join("")}${f.candidate.lines.length > 1 ? `-${f.candidate.lines.at(-1)}` : ""}`);
    lines.push(`- Found by: ${f.candidate.sources.map((s) => `${s.tool} \`${s.detector}\``).join(", ")}`);
    lines.push(`- Template: ${f.plan?.templateId}@${f.plan?.version} (slots filled by ${f.plan?.filledBy})`);
    lines.push(`- Hypothesis: ${f.plan?.hypothesis}`);
    lines.push(`- Property: ${f.plan?.property}`);
    lines.push(`- Result: **${STATUS_TEXT[f.status]}**${f.vulnerableRun.reason ? ` (${f.vulnerableRun.reason})` : ""}`);
    lines.push(`- Gates: ${f.gates.map((g) => `${g.passed ? "✓" : "✗"} ${g.id}`).join(", ")}`);
    if (f.vulnerableRun.logs.length) lines.push("", "Execution log:", "", code(f.vulnerableRun.logs.join("\n")));
    for (const p of f.pairs) {
      lines.push(`- Same exploit against \`${p.fixedContract}\`: ${p.verified ? "**fails as expected**" : p.outcome.kind}${"reason" in p.outcome ? ` (${p.outcome.reason})` : ""}`);
    }
    const fix = fixes[f.id];
    if (fix) {
      lines.push("", `### Proposed fix (${fix.verification.verified ? "verified" : "NOT verified"})`, "", fix.explanation, "", code(fix.diff, "diff"), "");
      lines.push(`Re-verification: ${fix.verification.detail}`);
    }
    lines.push("", `<details><summary>Exploit test (sha256 ${f.test!.sha256})</summary>`, "", code(f.test!.source, "solidity"), "", "</details>", "");
  }
  const rest = report.findings.filter((x) => !x.test);
  if (rest.length) {
    lines.push("## Candidates without an exploit", "");
    for (const f of rest) lines.push(`- ${f.id} ${f.candidate.contract}.${f.candidate.function ?? "-"} (${f.candidate.sources.map((s) => s.detector).join(", ")}): ${f.planError ?? "no template"}`);
    lines.push("");
  }
  lines.push("---", "Pramaan reports what was proven or disproven for the bug classes it has templates for. It does not claim the code is free of other vulnerabilities.");
  return lines.join("\n");
}

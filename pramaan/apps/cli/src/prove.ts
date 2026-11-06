import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { canonicalize } from "@pramaan/manifest";
import {
  analyzeProject,
  buildEvidence,
  createAiSlotFiller,
  draftFixWithAi,
  exportGitRef,
  findFoundryRoot,
  manifestFinding,
  proposeFix,
  renderMarkdownReport,
  treeDigest,
  verifyFix,
  type AnalysisReport,
  type FixProposal,
  type FixVerification,
  type Progress,
  type ProjectConfig,
} from "@pramaan/engine";
import type { FindingEntry } from "@pramaan/manifest";

export interface ProveOptions {
  repoDir: string;
  repoLabel?: string;
  commit?: string | null;
  configPath?: string;
  outDir: string;
  fix?: boolean;
  ai?: boolean;
  vulnerableRef?: string;
  fixedRef?: string;
  fixedDir?: string;
  onProgress?: Progress;
}

export interface ProveResult {
  report: AnalysisReport;
  fixes: Record<string, { fix: FixProposal; verification: FixVerification }>;
  manifestFindings: FindingEntry[];
  outDir: string;
}

function loadConfig(dir: string, explicit?: string): ProjectConfig | undefined {
  const path = explicit ?? join(dir, "pramaan.json");
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as ProjectConfig) : undefined;
}

/**
 * prove → (fix) → re-prove, writing report.md, report.json, tests/, evidence/ and fixes/ to `outDir`. With
 * `vulnerableRef`/`fixedRef` the two git refs are exported (no checkout of the working tree) and compared.
 */
export async function runProve(opts: ProveOptions): Promise<ProveResult> {
  const temp: string[] = [];
  let repoDir = resolve(opts.repoDir);
  let commit = opts.commit ?? null;
  let fixedDir = opts.fixedDir ? resolve(opts.fixedDir) : undefined;
  try {
    if (opts.vulnerableRef) {
      const v = mkdtempSync(join(tmpdir(), "pramaan-vuln-"));
      temp.push(v);
      commit = (await exportGitRef(repoDir, opts.vulnerableRef, v)).commit;
      if (opts.fixedRef) {
        const f = mkdtempSync(join(tmpdir(), "pramaan-fixed-"));
        temp.push(f);
        await exportGitRef(repoDir, opts.fixedRef, f);
        fixedDir = findFoundryRoot(f) ?? f;
      }
      repoDir = findFoundryRoot(v) ?? v;
    }
    const root = findFoundryRoot(repoDir);
    if (!root) throw new Error(`no foundry.toml found in ${repoDir}`);
    const config = loadConfig(root, opts.configPath);
    const report = await analyzeProject({
      repoDir: root,
      repo: opts.repoLabel ?? `local:${root.replace(/\\/g, "/").split("/").slice(-2).join("/")}`,
      commit: commit ?? treeDigest(root),
      config,
      onProgress: opts.onProgress,
      slotFiller: opts.ai ? createAiSlotFiller(root) : null,
    });

    const fixes: ProveResult["fixes"] = {};
    for (const f of report.findings.filter((x) => x.status === "reproduced")) {
      if (fixedDir) {
        const verification = await verifyFix({ repoDir: root, finding: f, fixedDir, config, onProgress: opts.onProgress });
        fixes[f.id] = { fix: { generator: "deterministic", file: "", before: "", after: "", diff: `(fixed tree: ${opts.fixedRef ?? fixedDir})`, explanation: "developer-provided fix", change: "fixed ref" }, verification };
        continue;
      }
      if (!opts.fix) continue;
      const contract = report.contracts.find((c) => c.name === f.candidate.contract);
      const fn = contract?.functions.find((x) => x.name === f.candidate.function?.replace(/\(.*$/, ""));
      if (!contract || !fn) continue;
      let proposal = proposeFix(root, contract, fn, f.candidate.vulnClass);
      if (!proposal.ok && opts.ai && f.test) {
        const ai = await draftFixWithAi({ repoDir: root, contract, candidate: f.candidate, exploitTest: f.test.source, failureReason: proposal.reason });
        if (ai) proposal = { ok: true, fix: ai };
      }
      if (!proposal.ok) {
        opts.onProgress?.({ step: "fix", status: "info", message: `${f.id}: ${proposal.reason}`, at: new Date().toISOString() });
        continue;
      }
      const verification = await verifyFix({ repoDir: root, finding: f, fix: proposal.fix, config, onProgress: opts.onProgress });
      fixes[f.id] = { fix: proposal.fix, verification };
    }

    // Write the evidence bundle.
    const out = resolve(opts.outDir);
    for (const d of ["tests", "evidence", "fixes"]) mkdirSync(join(out, d), { recursive: true });
    const manifestFindings: FindingEntry[] = [];
    for (const f of report.findings) {
      if (f.test) writeFileSync(join(out, "tests", f.test.fileName), f.test.source);
      // Only reproduced findings enter the release record; disproven candidates stay in report.md/json.
      if (f.status !== "reproduced" || !f.test) continue;
      const fx = fixes[f.id];
      const { evidence, sha256 } = buildEvidence(report, f, { fixVerification: fx?.verification ?? null, fixedRef: fx ? fx.fix.change : null });
      writeFileSync(join(out, "evidence", `${f.id}.json`), canonicalize(evidence));
      if (fx?.fix.diff && fx.fix.file) writeFileSync(join(out, "fixes", `${f.id}.patch`), fx.fix.diff);
      const pairVerified = f.pairs.some((p) => p.verified);
      manifestFindings.push(manifestFinding(f, sha256, null, Boolean(fx?.verification.verified) || pairVerified));
    }
    writeFileSync(join(out, "report.json"), JSON.stringify({ ...report, fixes }, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
    writeFileSync(join(out, "findings.json"), JSON.stringify(manifestFindings, null, 2));
    writeFileSync(
      join(out, "report.md"),
      renderMarkdownReport(report, Object.fromEntries(Object.entries(fixes).map(([id, x]) => [id, { verification: x.verification, diff: x.fix.diff, explanation: x.fix.explanation }]))),
    );
    return { report, fixes, manifestFindings, outDir: out };
  } finally {
    for (const t of temp) rmSync(t, { recursive: true, force: true });
  }
}

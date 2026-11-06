import type { AderynIssue, AnalyzeOutput, Candidate, ContractInfo, Severity, SlitherDetector, VulnClass } from "./types.js";

/** Scanner detector → vulnerability class Pramaan has an exploit template for. Everything else stays a candidate. */
const CLASS_BY_DETECTOR: Record<string, VulnClass> = {
  "pramaan-unprotected-sweep": "access-control",
  "arbitrary-send-eth": "access-control",
  "arbitrary-send-erc20": "access-control",
  "suicidal": "access-control",
  "unprotected-upgrade": "access-control",
  "send-ether-no-checks": "access-control",
  "eth-send-unchecked-address": "access-control",
  "reentrancy-state-change": "reentrancy",
  "reentrancy-eth": "reentrancy",
  "reentrancy-no-eth": "reentrancy",
  "state-change-after-external-call": "reentrancy",
  "pramaan-unprotected-initializer": "unprotected-initializer",
  "unprotected-initializer": "unprotected-initializer",
  "pramaan-unchecked-oracle": "unchecked-oracle",
};

const TITLE_BY_CLASS: Record<string, string> = {
  "access-control": "Missing access control on a value-moving function",
  reentrancy: "Reentrancy: state updated after an external call",
  "unprotected-initializer": "Initializer can be called again by anyone",
  "unchecked-oracle": "Oracle answer used without checking that it is positive",
};

function severityFrom(impact: string): Severity {
  if (impact === "High") return "high";
  if (impact === "Medium") return "medium";
  if (impact === "Low") return "low";
  return "info";
}

function functionName(signature: string | undefined, name: string): string {
  return signature ?? name;
}

function fromSlither(d: SlitherDetector): Candidate | null {
  const fn = d.elements.find((e) => e.type === "function");
  const primary = fn ?? d.elements[0];
  if (!primary) return null;
  const contract = fn?.type_specific_fields?.parent?.name ?? primary.type_specific_fields?.parent?.type_specific_fields?.parent?.name ?? primary.name;
  const vulnClass = CLASS_BY_DETECTOR[d.check] ?? d.check;
  const func = fn ? functionName(fn.type_specific_fields?.signature, fn.name) : null;
  return {
    key: `${vulnClass}:${contract}:${func ?? "-"}`,
    vulnClass,
    title: TITLE_BY_CLASS[vulnClass] ?? d.check,
    severity: severityFrom(d.impact),
    confidence: d.confidence.toLowerCase() as Candidate["confidence"],
    contract,
    function: func,
    file: primary.source_mapping?.filename_relative?.replace(/\\/g, "/") ?? "",
    lines: primary.source_mapping?.lines ?? [],
    sources: [{ tool: "slither", detector: d.check, description: d.description.trim() }],
  };
}

/** Aderyn reports file + line; map the line back to the enclosing function using the forge AST spans. */
function fromAderyn(issue: AderynIssue, severity: Severity, contracts: ContractInfo[]): Candidate[] {
  const out: Candidate[] = [];
  for (const inst of issue.instances) {
    const file = inst.contract_path.replace(/\\/g, "/");
    const owner = contracts.find((c) => c.source === file && c.functions.some((f) => f.lines[0] <= inst.line_no && inst.line_no <= f.lines[1]));
    const fn = owner?.functions.find((f) => f.lines[0] <= inst.line_no && inst.line_no <= f.lines[1]);
    const vulnClass = CLASS_BY_DETECTOR[issue.detector_name] ?? issue.detector_name;
    const signature = fn ? `${fn.name}(${fn.parameters.map((p) => p.type.replace(/^contract /, "address").replace(/ payable$/, "")).join(",")})` : null;
    out.push({
      key: `${vulnClass}:${owner?.name ?? file}:${signature ?? `L${inst.line_no}`}`,
      vulnClass,
      title: TITLE_BY_CLASS[vulnClass] ?? issue.title,
      severity,
      confidence: "medium",
      contract: owner?.name ?? file,
      function: signature,
      file,
      lines: [inst.line_no],
      sources: [{ tool: "aderyn", detector: issue.detector_name, description: issue.title }],
    });
  }
  return out;
}

const RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

/**
 * Normalizes and de-duplicates scanner output. Two tools reporting the same class on the same function become one
 * candidate with two sources (higher confidence, not two findings).
 */
export function collectCandidates(analysis: AnalyzeOutput, opts: { exclude?: RegExp[] } = {}): Candidate[] {
  const raw: Candidate[] = [];
  for (const d of analysis.slither.detectors) {
    const c = fromSlither(d);
    if (c) raw.push(c);
  }
  const report = analysis.aderyn?.report;
  for (const issue of report?.high_issues?.issues ?? []) raw.push(...fromAderyn(issue, "high", analysis.contracts));
  for (const issue of report?.low_issues?.issues ?? []) raw.push(...fromAderyn(issue, "low", analysis.contracts));

  const merged = new Map<string, Candidate>();
  for (const c of raw) {
    if (opts.exclude?.some((re) => re.test(c.file))) continue;
    if (/^(lib|test|script|node_modules)\//.test(c.file)) continue;
    const prev = merged.get(c.key);
    if (!prev) {
      merged.set(c.key, { ...c, sources: [...c.sources] });
      continue;
    }
    for (const s of c.sources) if (!prev.sources.some((p) => p.tool === s.tool && p.detector === s.detector)) prev.sources.push(s);
    if (RANK[c.severity] > RANK[prev.severity]) prev.severity = c.severity;
    if (new Set(prev.sources.map((s) => s.tool)).size > 1) prev.confidence = "high";
  }
  return [...merged.values()].sort((a, b) => RANK[b.severity] - RANK[a.severity] || a.key.localeCompare(b.key));
}

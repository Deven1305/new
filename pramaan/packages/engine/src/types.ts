export interface ToolVersion {
  name: string;
  version: string;
}

export interface ContractFunction {
  name: string;
  kind: "function" | "constructor" | "receive" | "fallback" | "freeFunction";
  visibility: string;
  stateMutability: string;
  modifiers: string[];
  parameters: { name: string; type: string }[];
  src: { start: number; length: number; bodyStart: number | null };
  lines: [number, number];
}

export interface ContractInfo {
  name: string;
  source: string;
  kind: "contract" | "interface" | "library";
  abstract: boolean;
  bases: string[];
  deployable: boolean;
  abi: { type: string; name?: string; inputs?: { name: string; type: string }[]; stateMutability?: string }[];
  functions: ContractFunction[];
}

export interface SlitherElement {
  type: string;
  name: string;
  source_mapping?: { filename_relative?: string; lines?: number[]; start?: number; length?: number };
  type_specific_fields?: { parent?: { type: string; name: string; type_specific_fields?: { parent?: { name: string } } }; signature?: string };
}

export interface SlitherDetector {
  check: string;
  impact: "High" | "Medium" | "Low" | "Informational" | "Optimization";
  confidence: "High" | "Medium" | "Low";
  description: string;
  elements: SlitherElement[];
  id?: string;
}

export interface AderynIssue {
  title: string;
  description: string;
  detector_name: string;
  instances: { contract_path: string; line_no: number; src?: string; src_char?: string; hint?: string }[];
}

export interface AnalyzeOutput {
  mode: "analyze";
  tools: ToolVersion[];
  slither: { ok: boolean; error: string | null; detectors: SlitherDetector[]; durationMs: number };
  build: { ok: boolean; exitCode: number; log: string; durationMs: number };
  contracts: ContractInfo[];
  aderyn?: { ok: boolean; report?: { high_issues?: { issues: AderynIssue[] }; low_issues?: { issues: AderynIssue[] } }; error?: string; durationMs: number };
}

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type VulnClass = "access-control" | "reentrancy" | "unprotected-initializer" | (string & {});

export interface Candidate {
  key: string;
  vulnClass: VulnClass;
  title: string;
  severity: Severity;
  confidence: "high" | "medium" | "low";
  contract: string;
  function: string | null;
  file: string;
  lines: number[];
  sources: { tool: "slither" | "aderyn"; detector: string; description: string }[];
}

export interface ForgeTestResult {
  suite: string;
  file: string;
  contract: string;
  test: string;
  status: "Success" | "Failure" | "Skipped";
  reason: string | null;
  logs: string[];
  durationMs: number | null;
}

export interface SuiteSummary {
  ran: boolean;
  passed: number;
  failed: number;
  skipped: number;
  failures: { test: string; reason: string | null }[];
}

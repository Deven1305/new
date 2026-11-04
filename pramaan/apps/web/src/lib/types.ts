/** Shapes of the Pramaan backend API (docs: API contract; server: apps/server). */

export interface User {
  id: string;
  address: string | null;
  isAdmin: boolean;
  displayName?: string | null;
}

export interface MeResponse {
  user: User;
  csrfToken: string | null;
  via?: "session" | "token";
}

export interface SiweResponse {
  user: User;
  csrfToken: string;
}

export interface BackendConfig {
  telegram: boolean;
  ipfs: boolean;
  github: boolean;
  proposer: boolean;
  ai: boolean;
  cre: boolean;
}

export interface Readiness {
  ok: boolean;
  db: unknown;
  worker: unknown;
  docker?: { available: boolean; image?: string | null; detail?: string | null } | null;
}

export type JobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
export const JOB_STATUSES: JobStatus[] = ["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"];
export const TERMINAL_JOB_STATUSES: ReadonlySet<string> = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

export interface Stats {
  projects: number;
  jobs: Record<JobStatus, number>;
  findings: { reproduced: number; fixedVerified: number; notReproduced: number; candidate: number; falsePositive: number };
  releases: { active: number; queued: number };
  alerts: { open: number; critical: number };
}

export type Role = "owner" | "maintainer" | "viewer";

export interface ActiveReleaseRef {
  id: string;
  tag: string;
  sha256: string;
  status: ReleaseStatus;
}

export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  ensName: string | null;
  domain: string | null;
  repoUrl: string | null;
  chainId: number | null;
  isDemo: boolean;
  role: Role | null;
  activeRelease: ActiveReleaseRef | null;
  counts: { findings: number; openAlerts: number };
  rpcUrl?: string | null;
  resolverAddress?: string | null;
  timelockAddress?: string | null;
  createdAt?: string;
}

export interface ProjectMember {
  userId?: string;
  id?: string;
  address?: string | null;
  displayName?: string | null;
  role: Role | string;
}

export interface ProjectContract {
  id?: string;
  label: string;
  chainId: number;
  address: string;
  runtimeCodehash?: string | null;
  proxyType?: string | null;
  implAddress?: string | null;
  implCodehash?: string | null;
  sourcifyStatus?: string | null;
  releaseTag?: string | null;
}

export type MonitorKind = "timelock" | "resolver" | "registry" | "proxy" | "upgrade-timelock";
export const MONITOR_KINDS: MonitorKind[] = ["timelock", "resolver", "registry", "proxy", "upgrade-timelock"];

export interface Monitor {
  id: string;
  projectId?: string;
  kind: MonitorKind | string;
  chainId: number;
  address: string;
  rpcUrl?: string | null;
  label: string;
  status: "active" | "paused" | "error" | string;
  lastBlock?: number | string | null;
  lastCheckedAt?: string | null;
  lastError?: string | null;
  createdAt?: string;
}

export interface ProjectDetail extends ProjectSummary {
  members: ProjectMember[];
  contracts: ProjectContract[];
  monitors: Monitor[];
}

export type JobSource =
  | { type: "example"; name: string }
  | { type: "github"; url: string; ref?: string }
  | { type: "upload"; uploadId: string }
  | { type: "finding"; findingId: string };

export interface AnalyzeResult {
  repo?: string;
  commit?: string | null;
  tools?: { name: string; version: string }[];
  build?: boolean;
  scanners?: { slither?: { ok: boolean; error: string | null; results: number }; aderyn?: { ok: boolean; error: string | null; results: number } };
  regression?: { ran: boolean; passed: number; failed: number; skipped: number; failures?: { test: string; reason: string | null }[] };
  sandbox?: { image?: string; analyzeMs?: number | null; testMs?: number | null };
  counts?: { candidates: number; reproduced: number; notReproduced: number; candidatesOnly: number; fixesVerified: number };
  fixes?: Record<string, { verified: boolean; detail: string }>;
  reportMarkdown?: string;
  verified?: boolean;
  detail?: string;
}

export interface Job {
  id: string;
  projectId: string;
  kind: "analyze" | "fix";
  status: JobStatus;
  source: JobSource;
  params: { fix?: boolean; ai?: boolean; findingId?: string; [k: string]: unknown };
  commitSha: string | null;
  toolchainHash: string;
  attempts: number;
  error: string | null;
  result: AnalyzeResult | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface JobEvent {
  seq: number;
  step: string;
  status: string;
  message: string;
  createdAt: string;
}

export type FindingStatus = "reproduced" | "not-reproduced" | "candidate" | "fixed-verified" | "false-positive" | "inconclusive";
export const FINDING_STATUSES: FindingStatus[] = ["reproduced", "fixed-verified", "not-reproduced", "candidate", "false-positive", "inconclusive"];

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface FindingSource {
  tool: string;
  detector: string;
  description?: string;
}

export interface Gate {
  id: string;
  passed: boolean;
  detail: string;
}

export interface RunRecord {
  result: "passed" | "failed" | "error" | "not-run" | string;
  reason: string | null;
  logs?: string[];
  durationMs?: number | null;
}

export interface FindingReview {
  decision: "confirmed" | "false-positive" | string;
  note?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
}

export interface FindingSummary {
  id: string;
  projectId?: string;
  jobId?: string;
  label: string;
  vulnClass: string;
  title: string;
  severity: Severity | string;
  confidence: string;
  status: FindingStatus | string;
  contract: string;
  functionSig: string | null;
  file: string | null;
  lines: number[] | null;
  sources?: FindingSource[];
  review?: FindingReview | null;
  createdAt?: string;
}

export interface FixVerification {
  verified: boolean;
  detail: string;
  exploit?: { kind: string; reason?: string | null } | null;
  regression?: { ran: boolean; passed: number; failed: number; skipped: number; failures?: { test: string; reason: string | null }[] } | null;
  durationMs?: number | null;
}

export interface FixProposal {
  id: string;
  generator: "deterministic" | "ai" | string;
  file: string;
  diff: string;
  explanation: string;
  status: "proposed" | "verifying" | "verified" | "failed" | "rejected" | string;
  verification: FixVerification | null;
  prUrl?: string | null;
  jobId?: string | null;
  createdAt?: string;
}

export interface FindingDetail extends FindingSummary {
  sources: FindingSource[];
  templateId: string | null;
  plan: Record<string, unknown> | null;
  gates: Gate[];
  vulnerableRun: RunRecord | null;
  review: FindingReview | null;
  exploitTest: { fileName: string; source: string; sha256: string } | null;
  evidence: { sha256: string; createdAt: string }[];
  fixes: FixProposal[];
}

export type ReleaseStatus = "draft" | "signed" | "queued" | "active" | "superseded" | "cancelled" | "revoked";
export type SignatureStatus = "verified" | "invalid" | "unsigned";

export interface Release {
  id: string;
  projectId: string;
  tag: string;
  sha256: string;
  pointer: string;
  cid: string | null;
  signatureStatus: SignatureStatus | string;
  signatureDetail?: string | null;
  storage: Record<string, unknown> | null;
  timelockOpId: string | null;
  eta: string | null;
  queueTx: string | null;
  executeTx: string | null;
  status: ReleaseStatus | string;
  createdAt: string;
  updatedAt?: string;
  commitSha?: string | null;
}

export interface ManifestFile {
  path: string;
  sha256: string;
  sri: string;
  size?: number;
}

export interface ManifestContract {
  label: string;
  chainId: number;
  address: string;
  runtimeCodehash: string;
  proxy: { type: string; implAddress: string; implCodehash: string } | null;
  sourcify: { status: string };
}

export interface ManifestFinding {
  id: string;
  title?: string;
  class: string;
  severity: string;
  status: string;
  exploitTestSha256: string | null;
  evidenceSha256: string | null;
  fixCommit: string | null;
}

export interface ManifestV1 {
  schema: string;
  app: { name: string; ensName: string; domain: string; spaFallback?: string };
  repo: string;
  commit: string;
  tag: string;
  workflow: string | null;
  builtAt: string;
  files: ManifestFile[];
  contracts: ManifestContract[];
  findings: ManifestFinding[];
  descriptors: { chainId: number; address: string; erc7730Sha256: string; path: string }[];
  thirdParties: { host: string; purpose: string; receivesAddress: boolean }[];
  tools: { name: string; version: string }[];
}

export interface ReleaseDetail extends Release {
  manifest: ManifestV1 | null;
}

export interface MonitorEvent {
  id: string;
  monitorId?: string;
  monitorLabel?: string | null;
  monitorKind?: string | null;
  chainId: number;
  blockNumber: number | string;
  txHash: string;
  logIndex?: number;
  eventName: string;
  data?: Record<string, unknown>;
  assessment: "ok" | "alert" | "info" | string;
  detail: string;
  createdAt: string;
}

export interface Alert {
  id: string;
  projectId: string | null;
  source: "monitor" | "cre" | "test" | string;
  severity: Severity | string;
  title: string;
  body: string;
  status?: "open" | "acked" | string;
  ackedAt?: string | null;
  ackedBy?: string | null;
  delivery?: Record<string, unknown> | null;
  createdAt: string;
}

export interface ApiToken {
  id: string;
  name: string;
  projectId: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface CreatedToken {
  id: string;
  token: string;
}

export interface UploadResult {
  uploadId: string;
  sha256: string;
  size: number;
}

export interface CreateJobResponse {
  job: Job;
  deduplicated: boolean;
}

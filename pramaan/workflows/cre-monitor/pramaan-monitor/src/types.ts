import { z } from "zod";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected a 20-byte hex address");

export const appConfigSchema = z.object({
  /** Short app id (vaultlab | mirroryield | permitmarket). One cron handler = one execution = one quota budget per app. */
  app: z.string().min(1).max(64),
  ensName: z.string().min(3).max(255),
  /** Resolver that stores pramaan.record / pramaan.revoked. */
  resolver: address,
  /** PramaanTimelock (release-pointer queue). null = the app has none. */
  timelock: address.nullable(),
  /** OpenZeppelin TimelockController that owns the proxies' upgrade right. null = none. */
  upgradeTimelock: address.nullable(),
  /** ERC-1967 proxies whose implementation must equal the release manifest. */
  proxies: z.array(z.object({ label: z.string(), address })).default([]),
  /** URL of the manifest bytes; `{sha256}` is replaced by the pointer's digest. */
  manifestUrlTemplate: z.string().includes("{sha256}"),
  /** First block that can contain relevant logs (deployment block). null = unknown, so log history is never "complete". */
  logsFromBlock: z.number().int().nonnegative().nullable(),
});
export type AppConfig = z.infer<typeof appConfigSchema>;

export const limitsSchema = z.object({
  /** CRE production quota: PerWorkflow.ChainRead.CallLimit = 15 per execution. */
  evmCalls: z.number().int().min(4).max(15).default(15),
  /** How many of the newest queued PramaanTimelock operations / scheduled upgrades are inspected. */
  maxPendingOps: z.number().int().min(1).max(5).default(3),
  /** eth_getLogs windows per execution; each window counts as one EVM read. */
  maxLogWindows: z.number().int().min(1).max(10).default(4),
  /** Blocks per window. CRE quota PerWorkflow.ChainRead.LogQueryBlockLimit = 100 blocks. */
  windowBlocks: z.number().int().min(1).max(100).default(99),
});

export const configSchema = z.object({
  /** 6-field cron (seconds first). CRE minimum interval is 30 s. */
  schedule: z.string(),
  workflowName: z.string().default("pramaan-monitor"),
  /** CRE chain selector name used for every EVM read, e.g. ethereum-testnet-sepolia. */
  chainSelectorName: z.string(),
  /** Chain id reported in the ingest payload (31337 for the local demo fork, 11155111 for Sepolia). */
  chainId: z.number().int().positive(),
  blockTag: z.enum(["latest", "finalized"]).default("latest"),
  /** Base URL of the Pramaan server (`PRAMAAN_INGEST_URL`). "" = decide and log only, never POST. */
  ingestUrl: z.string(),
  limits: limitsSchema.default({}),
  apps: z.array(appConfigSchema).min(1).max(10),
});
export type Config = z.infer<typeof configSchema>;

export type Hex = `0x${string}`;
export type Address = `0x${string}`;

export const DECISIONS = [
  "OK",
  "PENDING_RELEASE_CHANGE",
  "PENDING_UPGRADE",
  "UNEXPECTED_IMPLEMENTATION",
  "RELEASE_REVOKED",
  "MANIFEST_MISMATCH",
  "UNKNOWN",
] as const;
export type DecisionKind = (typeof DECISIONS)[number];
export type Severity = "info" | "low" | "medium" | "high" | "critical";

/** PramaanTimelock.State */
export type OpState = "None" | "Queued" | "Executed" | "Cancelled";

export interface TimelockOp {
  id: string; // decimal
  value: string;
  eta: number; // unix seconds
  state: OpState;
}

export interface ScheduledUpgrade {
  /** bytes32 operation id of the TimelockController. */
  id: Hex;
  target: Address;
  /** Implementation decoded from upgradeToAndCall(address,bytes); null when the calldata is something else. */
  implementation: Address | null;
  selector: Hex;
  /** unix seconds the operation becomes executable. */
  eta: number;
  /** Block it was scheduled in. */
  block: number;
}

export interface LiveImplementation {
  proxy: Address;
  label: string;
  /** Latest Upgraded(implementation) in the scanned range, null if none was found. */
  current: Address | null;
  block: number | null;
}

export interface ManifestFacts {
  ensName: string;
  tag: string;
  contracts: { address: Address; chainId: number; label: string; implementation: Address | null }[];
}

export interface ManifestObservation {
  /** HTTP status, or 0 when the request failed. */
  status: number;
  /** sha256 of the exact bytes received (lowercase hex), "" when no body. */
  sha256: string;
  size: number;
  /** null when the body is not a manifest this workflow understands. */
  facts: ManifestFacts | null;
  /** Why facts is null, or the transport error. */
  error: string | null;
}

export interface Observation {
  app: string;
  ensName: string;
  chainId: number;
  /** Chain time of the head block, unix seconds. All ETA arithmetic uses this, never the wall clock. */
  now: number;
  headBlock: number;
  /** Raw pramaan.record text; null = not readable, "" = empty. */
  record: string | null;
  /** Raw pramaan.revoked text. */
  revokedRaw: string | null;
  timelock: { operationCount: number; lastExecutedId: number; ops: TimelockOp[] } | null;
  scheduledUpgrades: ScheduledUpgrade[];
  implementations: LiveImplementation[];
  /** True when the log scan reached logsFromBlock, so "no scheduled upgrade" is a real statement. */
  logsComplete: boolean;
  /** Manifest of the ACTIVE pointer, null when no fetch was attempted (no valid pointer). */
  manifest: ManifestObservation | null;
  /** Everything that could not be read. Any entry prevents OK. */
  gaps: string[];
}

export interface Finding {
  decision: Exclude<DecisionKind, "OK">;
  severity: Severity;
  /** Stable identity of the thing found (operation id, impl address, digest...); feeds the idempotency key. */
  subject: string;
  summary: string;
  details: Record<string, unknown>;
}

export interface Decision {
  decision: DecisionKind;
  severity: Severity;
  subject: string;
  summary: string;
  details: Record<string, unknown>;
  /** Every finding, highest priority first. findings[0] is the headline unless the decision is OK. */
  findings: Finding[];
}

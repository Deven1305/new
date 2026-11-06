import type { Explanation, Lang, RiskLevel } from "@pramaan/decoder";
import type { Check, Color, ObservedResource, ReleaseStatus, ResourceCheck, VerdictRow } from "@pramaan/verifier-core";
import type { BlockReason } from "./policy.js";
import type { ReadRecord } from "./rpc-log.js";

/** MAIN world <-> isolated world (private MessagePort). */
export type InpageToContent =
  | { type: "request"; id: string; method: string; params: unknown[]; chainId: string | null; walletName: string | null }
  | { type: "accounts"; accounts: string[] }
  | { type: "unguarded"; walletName: string; reason: string };
export type ContentToInpage = { type: "decision"; id: string; decision: "continue" | "reject"; reason: string };

/** Content script -> service worker. */
export type ContentToBackground =
  | { type: "page"; url: string }
  | { type: "resources"; items: ObservedResource[] }
  | { type: "accounts"; accounts: string[] }
  | { type: "unguarded"; walletName: string; reason: string };

export interface GuardRequest {
  type: "guard";
  id: string;
  method: string;
  params: unknown[];
  chainId: string | null;
  walletName: string | null;
}

export interface LeakRecord {
  /** Destination host[:port]; blocking applies to this host on every scheme. */
  host: string;
  origin: string;
  url: string;
  method: string;
  channel: string;
  form: string;
  where: string;
  /** Shortened address that was found. */
  account: string;
  declared: boolean;
  purpose: string | null;
  blocked: boolean;
  count: number;
  firstSeen: string;
}

export interface TabView {
  tabId: number;
  origin: string | null;
  status: ReleaseStatus | "checking" | "idle";
  reason: string | null;
  color: Exclude<Color, "neutral">;
  siteRow: VerdictRow | null;
  ensName: string | null;
  tag: string | null;
  signer: string | null;
  signatureMode: string | null;
  manifestSha256: string | null;
  manifestSource: string | null;
  checks: Check[];
  site: { status: string; severity: string; summary: string; resources: ResourceCheck[] } | null;
  contracts: { label: string; address: string; chainId: number; proxy: string | null }[];
  thirdParties: { host: string; purpose: string; receivesAddress: boolean }[];
  findings: { id: string; title: string; status: string; severity: string }[];
  pending: { tag: string | null; eta: string; ready: boolean }[];
  leaks: LeakRecord[];
  blockedHosts: string[];
  strict: boolean;
  transport: string;
  anon: { state: string; detail: string };
  reads: ReadRecord[];
  unguarded: { walletName: string; reason: string }[];
  singleSource: boolean;
  updatedAt: string;
}

export interface PendingView {
  id: string;
  tabId: number;
  origin: string;
  method: string;
  createdAt: string;
  /** checking: still waiting for verification; ready: decided rows; interrupted: Pramaan restarted, request rejected. */
  state: "checking" | "ready" | "interrupted";
  blocked: boolean;
  blockReasons: BlockReason[];
  verdictColor: Exclude<Color, "neutral">;
  rows: VerdictRow[];
  explanations: Record<Lang, Explanation> | null;
  riskLevel: RiskLevel | null;
  descriptorIntent: string | null;
  target: string | null;
  chainId: number | null;
  reads: ReadRecord[];
  raw: string;
  windowId?: number;
}

export type PageToBackground =
  | { type: "tab-view"; tabId: number }
  | { type: "reverify"; tabId: number }
  | { type: "block-host"; tabId: number; host: string }
  | { type: "unblock-host"; tabId: number; host: string }
  | { type: "set-strict"; tabId: number; strict: boolean }
  | { type: "pending"; id: string }
  | { type: "decide"; id: string; decision: "continue" | "reject"; override?: boolean };

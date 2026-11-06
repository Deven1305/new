import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./chain.js";

/**
 * The local (or Sepolia) demo environment written by `pnpm demo:up` and read by the backend's demo import, the demo
 * build/serve scripts, the CRE workflow config generator and the extension E2E tests. Public data only: private keys
 * live in keys.json next to it (gitignored) and never in this file.
 */
export type Address = `0x${string}`;
export type DemoAppId = "vaultlab" | "mirroryield" | "permitmarket";
export const DEMO_APP_IDS: readonly DemoAppId[] = ["vaultlab", "mirroryield", "permitmarket"];

/** Default origins. Each app is a separate origin with its own release identity. */
export const DEMO_ORIGINS: Record<DemoAppId, string> = {
  vaultlab: "http://localhost:5180",
  mirroryield: "http://localhost:5182",
  permitmarket: "http://localhost:5184",
};
export const DEMO_HOSTS = {
  /** Serves the MirrorYield build from a different origin, so `pramaan.domain` does not match. */
  lookalikeOrigin: "http://127.0.0.1:5183",
  /** Tamper/restore/status endpoints, bound to 127.0.0.1 only. */
  adminUrl: "http://127.0.0.1:5189",
  /** Controlled third-party "analytics" endpoint; runs only when fixtures are enabled. */
  trackerUrl: "http://127.0.0.1:5190",
} as const;

export interface DemoMonitor {
  /**
   * timelock = PramaanTimelock (release pointer queue), resolver = PermissionedResolver records, registry = ENSv2
   * (sub)registry, proxy = ERC-1967 proxy (Upgraded), upgrade-timelock = OpenZeppelin TimelockController that owns a
   * proxy's upgrade right (CallScheduled/CallExecuted/Cancelled).
   */
  kind: "timelock" | "resolver" | "registry" | "proxy" | "upgrade-timelock";
  address: Address;
  label: string;
}

export interface DemoRelease {
  tag: string;
  sha256: string;
  /** `pramaan:v1:<tag>:<sha256>` - the value of the `pramaan.record` text record once executed. */
  pointer: string;
  /** Canonical (RFC 8785) manifest bytes. */
  manifestPath: string;
  /** DSSE envelope signed by the release key whose SPKI is in `pramaan.signer`. */
  signaturePath: string;
  cid: string | null;
  timelockOpId: string | null;
  queueTx: string | null;
  executeTx: string | null;
  eta: number | null;
  status: "signed" | "queued" | "active" | "superseded" | "revoked";
}

export interface DemoApp {
  id: DemoAppId;
  name: string;
  ensName: string;
  origin: string;
  distDir: string;
  resolver: Address;
  timelock: Address;
  /** Contracts listed in this app's release manifest, by role (e.g. vault, vaultImplementation, token). */
  contracts: Record<string, Address>;
  /** Deployed on purpose but NOT in the release (vulnerable legacy vault, unaudited implementation, attacker...). */
  unlisted: Record<string, Address>;
  monitors: DemoMonitor[];
  release: DemoRelease | null;
}

export interface DemoNegativeTest {
  attempt: string;
  reverted: boolean;
  detail: string;
  txHash: string | null;
}

export interface DemoFindingSummary {
  id: string;
  title: string;
  class: string;
  severity: string;
  status: string;
  exploitTestSha256: string | null;
  evidenceSha256: string | null;
  fixCommit: string | null;
}

export interface DemoStateV2 {
  version: 2;
  createdAt: string;
  network: {
    kind: "anvil-fork" | "sepolia";
    chainId: number;
    chainName: string;
    rpcUrl: string;
    forkUrl: string | null;
    explorer: string | null;
  };
  ens: {
    /** Parent name the three app identities live under (or, without subname support, the shared suffix). */
    parent: string;
    parentTokenId: string | null;
    subregistry: Address | null;
    registrationTxs: string[];
    negativeTests: DemoNegativeTest[];
  };
  /** Public addresses only. */
  accounts: Record<"owner" | "proposer" | "guardian" | "user" | "attacker", Address>;
  shared: { token: Address; nft: Address };
  apps: Record<DemoAppId, DemoApp>;
  hosts: { adminUrl: string; trackerUrl: string | null; lookalikeOrigin: string | null };
  prove: { reportJson: string; reportMd: string; findings: DemoFindingSummary[] } | null;
  signer: { spki: string; record: string };
  fixturesEnabled: boolean;
}

export const DEMO_STATE_DIR = join(REPO_ROOT, ".pramaan", "demo");
export const demoStatePath = (): string => process.env["PRAMAAN_DEMO_STATE"] ?? join(DEMO_STATE_DIR, "state.json");

/** Returns null when there is no demo yet or the file is from the old single-app format. */
export function loadDemoState(path = demoStatePath()): DemoStateV2 | null {
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<DemoStateV2>;
  if (raw.version !== 2 || !raw.apps || !raw.network) return null;
  for (const id of DEMO_APP_IDS) {
    if (!raw.apps[id]) throw new Error(`demo state ${path} has no app "${id}"`);
  }
  return raw as DemoStateV2;
}

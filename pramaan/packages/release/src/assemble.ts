import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  buildManifest,
  FindingEntry as FindingEntrySchema,
  encodePointer,
  hashDirectory,
  manifestBytes,
  rawCidForBytes,
  sha256Hex,
  type ContractEntry,
  type DeploymentRecord,
  type FindingEntry,
  type ManifestV1,
  type ThirdPartyEntry,
} from "@pramaan/manifest/node";
import { inspectAddress, sourcifyStatus } from "@pramaan/verifier-core";
import { REPO_ROOT, type ChainCtx } from "./chain.js";
import type { DemoAppId, DemoStateV2 } from "./demo-state.js";

export interface AssembleInput {
  siteDir: string;
  app: { name: string; ensName: string; domain: string; spaFallback?: string };
  repo: string;
  commit: string;
  tag: string;
  workflow: string | null;
  builtAt?: string;
  ctx: ChainCtx;
  /** Legacy single-app input (the old Kosh Vault demo). Mutually exclusive with `contracts`. */
  deployment?: DeploymentRecord;
  /**
   * Contracts to list, read LIVE from the chain: the code hash and, for proxies, the implementation and its code hash
   * come from `eth_getCode` / the proxy slots at assembly time, never from a saved record.
   */
  contracts?: { label: string; address: `0x${string}` }[];
  findings: FindingEntry[];
  /** ERC-7730 descriptors served by the site, keyed by the contract they describe. */
  descriptors?: { address: `0x${string}`; path: string }[];
  thirdParties?: ThirdPartyEntry[];
  tools?: { name: string; version: string }[];
  checkSourcify?: boolean;
}

export interface AssembledRelease {
  manifest: ManifestV1;
  bytes: Uint8Array;
  sha256: string;
  pointer: string;
  cid: string;
}

async function legacyEntries(input: AssembleInput, deployment: DeploymentRecord): Promise<ContractEntry[]> {
  const d = deployment;
  if (d.chainId !== input.ctx.chain.id) throw new Error(`deployment is for chain ${d.chainId}, connected to ${input.ctx.chain.id}`);
  const listed: { label: string; entry: DeploymentRecord["vault"] }[] = [
    { label: "VaultV2", entry: d.vault },
    { label: "pUSD", entry: d.token },
    { label: "pNFT", entry: d.nft },
  ];
  const contracts: ContractEntry[] = [];
  for (const { label, entry } of listed) {
    const live = await inspectAddress(input.ctx.pub, entry.address as `0x${string}`);
    if (live.codehash?.toLowerCase() !== entry.runtimeCodehash.toLowerCase()) throw new Error(`${label}: on-chain code differs from the deployment record`);
    if (entry.proxy === "eip1967") {
      if (live.proxy?.type !== "eip1967" || live.proxy.implementation.toLowerCase() !== entry.implementation?.toLowerCase() || live.proxy.implCodehash?.toLowerCase() !== entry.implementationCodehash?.toLowerCase()) {
        throw new Error(`${label}: on-chain proxy implementation differs from the deployment record`);
      }
    }
    const status = input.checkSourcify ? await sourcifyStatus(d.chainId, entry.address) : d.chainId === 31337 ? "not_applicable" : "not_checked";
    contracts.push({
      label,
      chainId: d.chainId,
      address: entry.address as `0x${string}`,
      runtimeCodehash: entry.runtimeCodehash.toLowerCase() as `0x${string}`,
      proxy: entry.proxy === "eip1967" ? { type: "eip1967", implAddress: entry.implementation!, implCodehash: entry.implementationCodehash!.toLowerCase() as `0x${string}` } : null,
      sourcify: { status },
    });
  }
  return contracts;
}

async function liveEntries(input: AssembleInput, listed: { label: string; address: `0x${string}` }[]): Promise<ContractEntry[]> {
  const chainId = input.ctx.chain.id;
  const out: ContractEntry[] = [];
  const seen = new Set<string>();
  for (const { label, address } of listed) {
    if (seen.has(address.toLowerCase())) continue;
    seen.add(address.toLowerCase());
    const live = await inspectAddress(input.ctx.pub, address);
    if (live.kind !== "contract" || !live.codehash) throw new Error(`${label} (${address}) has no code on chain ${chainId}`);
    if (live.unsupported) throw new Error(`${label} (${address}): ${live.unsupported}`);
    const status = input.checkSourcify ? await sourcifyStatus(chainId, address) : chainId === 31337 ? "not_applicable" : "not_checked";
    out.push({
      label,
      chainId,
      address,
      runtimeCodehash: live.codehash.toLowerCase() as `0x${string}`,
      proxy: live.proxy ? { type: live.proxy.type, implAddress: live.proxy.implementation, implCodehash: (live.proxy.implCodehash ?? "").toLowerCase() as `0x${string}` } : null,
      sourcify: { status },
    });
  }
  return out;
}

/**
 * Builds the release manifest. Contract entries are re-read from the chain (and, in the legacy path, must equal the
 * deployment record), so a stale or wrong code hash can never be published. The result is validated against the
 * manifest schema by buildManifest.
 */
export async function assembleRelease(input: AssembleInput): Promise<AssembledRelease> {
  if (!input.deployment === !input.contracts) throw new Error("assembleRelease needs exactly one of `deployment` or `contracts`");
  const contracts = input.deployment ? await legacyEntries(input, input.deployment) : await liveEntries(input, input.contracts!);
  const chainId = input.ctx.chain.id;
  const descriptors = (input.descriptors ?? []).map((desc) => ({
    chainId,
    address: desc.address,
    path: desc.path,
    erc7730Sha256: sha256Hex(readFileSync(join(input.siteDir, desc.path.replace(/^\//, "")))),
  }));
  const manifest = buildManifest({
    app: input.app,
    repo: input.repo,
    commit: input.commit,
    tag: input.tag,
    workflow: input.workflow,
    builtAt: input.builtAt,
    files: hashDirectory(input.siteDir),
    contracts,
    findings: input.findings,
    descriptors,
    thirdParties: input.thirdParties ?? [],
    tools: input.tools ?? [],
  });
  const bytes = manifestBytes(manifest);
  const sha256 = sha256Hex(bytes);
  return { manifest, bytes, sha256, pointer: encodePointer(input.tag, sha256), cid: rawCidForBytes(bytes) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Per-app assembly for the three demo dApps
// ---------------------------------------------------------------------------------------------------------------------

/** Manifest label for each contract role used in DemoApp.contracts. */
export const DEMO_CONTRACT_LABELS: Record<string, string> = {
  vault: "VaultV2",
  token: "pUSD",
  nft: "pNFT",
  upgradeTimelock: "VaultV2 upgrade timelock",
  farm: "MirrorYieldFarm",
  marketplace: "PermitMarketplace",
};

export interface AssembleDemoAppOptions {
  ctx: ChainCtx;
  state: DemoStateV2;
  appId: DemoAppId;
  tag?: string;
  /** Overrides state.apps[appId].distDir. */
  siteDir?: string;
  builtAt?: string;
  workflow?: string | null;
  checkSourcify?: boolean;
  tools?: { name: string; version: string }[];
}

const resolveRepoPath = (p: string): string => (isAbsolute(p) ? p : join(REPO_ROOT, p));

/** The ERC-7730 descriptors the build wrote under <site>/erc7730/, keyed by the first deployment address they declare. */
function readDescriptors(siteDir: string): { address: `0x${string}`; path: string }[] {
  const dir = join(siteDir, "erc7730");
  if (!existsSync(dir)) return [];
  const out: { address: `0x${string}`; path: string }[] = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const json = JSON.parse(readFileSync(join(dir, name), "utf8")) as { context?: { contract?: { deployments?: { address?: string }[] } } };
    const address = json.context?.contract?.deployments?.[0]?.address;
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error(`erc7730/${name} declares no deployment address`);
    out.push({ address: address as `0x${string}`, path: `/erc7730/${name}` });
  }
  return out;
}

/**
 * Assembles one demo app's release from its own dist directory, its listed contracts (live code hashes, ERC-1967
 * implementation pinned through the proxy entry), its declared third parties (the chain RPC endpoint, never a tracker)
 * and, for VaultLab, the PROVE findings. The build must have written the evidence files the findings point to.
 */
export async function assembleDemoApp(options: AssembleDemoAppOptions): Promise<AssembledRelease> {
  const { ctx, state, appId } = options;
  const app = state.apps[appId];
  if (!app) throw new Error(`demo state has no app "${appId}"`);
  if (state.network.chainId !== ctx.chain.id) throw new Error(`state is for chain ${state.network.chainId}, connected to ${ctx.chain.id}`);
  const siteDir = options.siteDir ?? resolveRepoPath(app.distDir);
  if (!existsSync(join(siteDir, "index.html"))) throw new Error(`${siteDir} has no index.html: build the demos first (pnpm build:demos)`);

  const listed = Object.entries(app.contracts)
    .filter(([role]) => role !== "vaultImplementation")
    .map(([role, address]) => ({ label: DEMO_CONTRACT_LABELS[role] ?? role, address }));

  const findings: FindingEntry[] = appId === "vaultlab" && state.prove ? state.prove.findings.map((f) => FindingEntrySchema.parse({ ...f, title: f.title.slice(0, 200) })) : [];
  for (const f of findings) {
    if (!f.evidenceSha256) continue;
    const file = join(siteDir, ".well-known", "pramaan", "evidence", `${f.evidenceSha256}.json`);
    if (!existsSync(file) || sha256Hex(readFileSync(file)) !== f.evidenceSha256) throw new Error(`finding ${f.id}: evidence ${f.evidenceSha256} is missing from (or differs in) ${siteDir}`);
  }

  const rpc = new URL(state.network.rpcUrl);
  const files = hashDirectory(siteDir);
  const commit = sha256Hex(files.map((f) => `${f.path}:${f.sha256}\n`).join(""));
  return assembleRelease({
    siteDir,
    app: { name: app.name, ensName: app.ensName, domain: app.origin },
    repo: `local:pramaan/demos/${appId}`,
    commit,
    tag: options.tag ?? "v1.0.0",
    workflow: options.workflow ?? null,
    builtAt: options.builtAt,
    ctx,
    contracts: listed,
    findings,
    descriptors: readDescriptors(siteDir),
    thirdParties: [{ host: rpc.host.toLowerCase(), purpose: `Ethereum JSON-RPC (${state.network.chainName}) used by the dApp to read chain state`, receivesAddress: true }],
    tools: options.tools,
    checkSourcify: options.checkSourcify,
  });
}

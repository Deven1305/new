import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createPublicClient, formatEther, formatUnits, getAddress, http, zeroAddress, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { erc20Abi, ethRegistrarAbi, ethRegistryAbi } from "./abis.js";
import { REPO_ROOT, type ChainCtx } from "./chain.js";
import { loadIdentityConfig, setupAppIdentities, type AppIdentitiesResult, type IdentityConfig, type SetupAppIdentitiesInput } from "./identity.js";

export const SEPOLIA_CHAIN_ID = 11155111;
export const SEPOLIA_EXPLORER = "https://sepolia.etherscan.io";
/** Public Sepolia RPCs used when SEPOLIA_RPC_URL_A/B are unset (all answered eth_chainId on 2026-11-04). */
export const PUBLIC_SEPOLIA_RPCS = [
  "https://sepolia.gateway.tenderly.co",
  "https://rpc.sepolia.ethpandaops.io",
  "https://sepolia.rpc.thirdweb.com",
  "https://ethereum-sepolia-rpc.publicnode.com",
];

/**
 * Gas used by `setupAppIdentities` on an anvil fork of Sepolia (Amsterdam pricing), measured by
 * packages/release/test/identities.fork.test.ts on 2026-11-04 and rounded up. Used only for the doctor's balance check.
 */
export const GAS_ESTIMATE = {
  /** UserRegistry proxy + setParent + MockUSDC mint/approve + commit + register. */
  parent: 2_600_000n,
  /** CREATE2 PramaanTimelock + resolver proxy with records + two key-scoped grants + subname registration. */
  perApp: 12_000_000n,
  /** One queue + one execute (proposer pays queue; anyone executes) per release. */
  perRelease: 400_000n,
  /** Guardian: a cancel or a revocation. */
  guardianAction: 250_000n,
};

export type DoctorStatus = "ok" | "fail" | "warn" | "info";
export interface DoctorCheck {
  id: string;
  status: DoctorStatus;
  title: string;
  detail: string;
  /** Exact next step when the check is not ok. */
  action?: string;
}
export interface DoctorReport {
  network: "sepolia" | "local";
  ready: boolean;
  checks: DoctorCheck[];
  rpcUrls: string[];
}

export interface RpcProbe {
  url: string;
  ok: boolean;
  chainId?: number;
  block?: bigint;
  ageSeconds?: number;
  detail: string;
}

function client(url: string): PublicClient {
  return createPublicClient({ transport: http(url, { timeout: 12_000, retryCount: 0 }) }) as PublicClient;
}

export async function probeRpc(url: string, expectedChainId: number): Promise<RpcProbe> {
  try {
    const c = client(url);
    const [chainId, block] = await Promise.all([c.getChainId(), c.getBlock({ blockTag: "latest" })]);
    const ageSeconds = Math.max(0, Math.round(Date.now() / 1000 - Number(block.timestamp)));
    if (chainId !== expectedChainId) return { url, ok: false, chainId, detail: `serves chain ${chainId}, expected ${expectedChainId}` };
    if (ageSeconds > 300) return { url, ok: false, chainId, block: block.number, ageSeconds, detail: `latest block is ${ageSeconds}s old (stale node)` };
    return { url, ok: true, chainId, block: block.number, ageSeconds, detail: `block ${block.number}, ${ageSeconds}s old` };
  } catch (err) {
    return { url, ok: false, detail: (err as Error).message.split("\n")[0]!.slice(0, 160) };
  }
}

/** Two endpoints agree when they return the same block hash for a recent block both have. */
export async function rpcsAgree(a: string, b: string, aBlock: bigint, bBlock: bigint): Promise<{ ok: boolean; detail: string }> {
  const height = (aBlock < bBlock ? aBlock : bBlock) - 3n;
  try {
    const [x, y] = await Promise.all([client(a).getBlock({ blockNumber: height }), client(b).getBlock({ blockNumber: height })]);
    return x.hash === y.hash ? { ok: true, detail: `same hash for block ${height}` } : { ok: false, detail: `different hashes for block ${height}` };
  } catch (err) {
    return { ok: false, detail: (err as Error).message.split("\n")[0]!.slice(0, 160) };
  }
}

export function sepoliaRpcCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  return [...new Set([env["SEPOLIA_RPC_URL_A"], env["SEPOLIA_RPC_URL_B"], ...PUBLIC_SEPOLIA_RPCS].filter((u): u is string => !!u && /^https?:\/\//.test(u)))];
}

const KEY_RE = /^0x[0-9a-fA-F]{64}$/;
/** Derives the address of a key from the environment. The key itself is never returned, logged or printed. */
export function addressFromEnvKey(env: NodeJS.ProcessEnv, name: string): { address: `0x${string}` | null; problem: string | null } {
  const v = env[name];
  if (!v) return { address: null, problem: `${name} is not set` };
  if (!KEY_RE.test(v.trim())) return { address: null, problem: `${name} is not a 0x-prefixed 32-byte hex key` };
  return { address: privateKeyToAccount(v.trim() as `0x${string}`).address, problem: null };
}

function run(cmd: string, args: string[], timeoutMs = 20_000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => resolve({ code: err ? 1 : 0, out: `${stdout}${stderr}` }));
  });
}

export interface DoctorOptions {
  network: "sepolia" | "local";
  parentLabel?: string;
  appCount?: number;
  localRpcUrl?: string;
  env?: NodeJS.ProcessEnv;
  ens?: IdentityConfig;
}

/**
 * Readiness checklist for a Sepolia (or local fork) deployment. Read-only: it sends no transaction, never prints a key
 * and only reports whether optional credentials are present.
 */
export async function runDoctor(opts: DoctorOptions): Promise<DoctorReport> {
  const env = opts.env ?? process.env;
  const ens = opts.ens ?? loadIdentityConfig();
  const checks: DoctorCheck[] = [];
  const add = (c: DoctorCheck) => checks.push(c);
  const expected = opts.network === "sepolia" ? SEPOLIA_CHAIN_ID : 31337;
  let rpcUrls: string[] = [];

  // 1. RPC endpoints.
  if (opts.network === "local") {
    const url = opts.localRpcUrl ?? env["LOCAL_RPC_URL"] ?? "http://127.0.0.1:8545";
    const p = await probeRpc(url, expected);
    rpcUrls = p.ok ? [url] : [];
    add(p.ok
      ? { id: "rpc", status: "ok", title: "local fork RPC", detail: `${url}: ${p.detail}` }
      : { id: "rpc", status: "fail", title: "local fork RPC", detail: `${url}: ${p.detail}`, action: "start an anvil fork of Sepolia: anvil --fork-url https://sepolia.gateway.tenderly.co --chain-id 31337 (or pnpm demo:up)" });
  } else {
    const probes = await Promise.all(sepoliaRpcCandidates(env).map((u) => probeRpc(u, expected)));
    for (const p of probes) add({ id: `rpc:${new URL(p.url).host}`, status: p.ok ? "ok" : "warn", title: "Sepolia RPC", detail: `${p.url}: ${p.detail}` });
    const good = probes.filter((p) => p.ok);
    if (good.length < 2) {
      add({ id: "rpc", status: "fail", title: "two independent Sepolia RPCs", detail: `${good.length} of the endpoints answered correctly`, action: "set SEPOLIA_RPC_URL_A and SEPOLIA_RPC_URL_B in .env to two different providers (e.g. Alchemy/Infura free keys, or the public endpoints listed in .env.example)" });
    } else {
      const agree = await rpcsAgree(good[0]!.url, good[1]!.url, good[0]!.block!, good[1]!.block!);
      rpcUrls = [good[0]!.url, good[1]!.url];
      add(agree.ok
        ? { id: "rpc", status: "ok", title: "two Sepolia RPCs agree", detail: `${new URL(good[0]!.url).host} + ${new URL(good[1]!.url).host}: ${agree.detail}` }
        : { id: "rpc", status: "fail", title: "two Sepolia RPCs agree", detail: agree.detail, action: "one endpoint is lagging or lying: replace SEPOLIA_RPC_URL_A or _B" });
      if (!env["SEPOLIA_RPC_URL_A"] || !env["SEPOLIA_RPC_URL_B"]) add({ id: "rpc-env", status: "warn", title: "RPCs from public fallbacks", detail: "SEPOLIA_RPC_URL_A/B not both set; public endpoints are rate-limited", action: "set SEPOLIA_RPC_URL_A and SEPOLIA_RPC_URL_B in .env" });
    }
  }
  const c = rpcUrls[0] ? client(rpcUrls[0]) : null;

  // 2. ENSv2 contracts.
  if (c) {
    const entries = Object.entries({ universalResolver: ens.universalResolver, ethRegistrar: ens.ethRegistrar, ethRegistry: ens.ethRegistry, verifiableFactory: ens.verifiableFactory, permissionedResolverImpl: ens.permissionedResolverImpl, userRegistryImpl: ens.userRegistryImpl, mockUsdc: ens.mockUsdc, create2Deployer: "0x4e59b44847b379578588920cA78FbF26c0B4956C" as const });
    const missing: string[] = [];
    for (const [name, address] of entries) if (((await c.getCode({ address }).catch(() => "0x")) ?? "0x") === "0x") missing.push(`${name} ${address}`);
    add(missing.length === 0
      ? { id: "ensv2", status: "ok", title: "ENSv2 contracts", detail: `${entries.length} contracts have code (config/ensv2.sepolia.json)` }
      : { id: "ensv2", status: "fail", title: "ENSv2 contracts", detail: `no code at: ${missing.join(", ")}`, action: "the Sepolia ENS deployment was probably reset: copy the new addresses from https://docs.ens.domains/learn/deployments into config/ensv2.sepolia.json (or ENSV2_* env overrides)" });
  }

  // 3. Accounts (addresses derived from env keys; keys never printed).
  const gasPrice = c ? await c.getGasPrice().catch(() => null) : null;
  const apps = BigInt(opts.appCount ?? 3);
  const need = {
    OWNER_PRIVATE_KEY: GAS_ESTIMATE.parent + GAS_ESTIMATE.perApp * apps,
    PROPOSER_PRIVATE_KEY: GAS_ESTIMATE.perRelease * apps * 2n,
    GUARDIAN_PRIVATE_KEY: GAS_ESTIMATE.guardianAction * apps * 2n,
  } as const;
  const addresses: Record<string, `0x${string}` | null> = {};
  if (opts.network === "local") {
    add({ id: "accounts", status: "info", title: "accounts", detail: "local fork: fresh throwaway keys are generated and funded with anvil_setBalance" });
  } else {
    for (const [name, gas] of Object.entries(need)) {
      const { address, problem } = addressFromEnvKey(env, name);
      addresses[name] = address;
      if (!address) {
        add({ id: `key:${name}`, status: "fail", title: name, detail: problem!, action: `create a NEW testnet-only account (MetaMask "Add account", or: cast wallet new), put its key in .env as ${name}=0x… and never reuse a mainnet key` });
        continue;
      }
      if (!c) continue;
      const [balance, code] = await Promise.all([c.getBalance({ address }), c.getCode({ address }).catch(() => "0x")]);
      const floor = 3_000_000_000n; // 3 gwei: Sepolia fees spike; budget conservatively
      const price = gasPrice && (gasPrice * 15n) / 10n > floor ? (gasPrice * 15n) / 10n : floor;
      const want = gas * price;
      if ((code ?? "0x") !== "0x") add({ id: `code:${name}`, status: "warn", title: `${name} has code`, detail: `${address} carries EIP-7702 delegation code`, action: "use a fresh key without a delegation" });
      add(balance >= want
        ? { id: `balance:${name}`, status: "ok", title: `${name} balance`, detail: `${address}: ${formatEther(balance)} ETH (needs ≈${formatEther(want)} for ~${gas} gas)` }
        : { id: `balance:${name}`, status: "fail", title: `${name} balance`, detail: `${address}: ${formatEther(balance)} ETH, needs ≈${formatEther(want)} (~${gas} gas at max(1.5x current ${gasPrice ? formatUnits(gasPrice, 9) : "?"} gwei, 3 gwei))`, action: `fund ${address} with Sepolia ETH from a faucet (docs/FAUCETS.md), then re-run pnpm run doctor --network sepolia` });
    }
    const set = Object.values(addresses).filter(Boolean).map((a) => a!.toLowerCase());
    if (set.length === 3 && new Set(set).size !== 3) add({ id: "distinct", status: "fail", title: "separate keys", detail: "owner, proposer and guardian must be three different accounts", action: "generate a separate key for each role" });
  }

  // 4. Parent name + MockUSDC.
  const label = opts.parentLabel ?? env["PRAMAAN_PARENT_LABEL"];
  if (!label) {
    add({ id: "parent", status: "fail", title: "parent name", detail: "no parent label given", action: "pass --parent <label> (or set PRAMAAN_PARENT_LABEL), e.g. --parent pramaan-<yourteam>" });
  } else if (!/^[a-z0-9-]{3,63}$/.test(label)) {
    add({ id: "parent", status: "fail", title: "parent name", detail: `"${label}" is not a valid label`, action: "use 3-63 characters a-z, 0-9 and -" });
  } else if (c) {
    const owner = getAddress(await c.readContract({ address: ens.ethRegistry, abi: ethRegistryAbi, functionName: "findOwner", args: [label] }).catch(() => zeroAddress));
    const available = await c.readContract({ address: ens.ethRegistrar, abi: ethRegistrarAbi, functionName: "isAvailable", args: [label] }).catch(() => false);
    const ownerKey = addresses["OWNER_PRIVATE_KEY"];
    if (available) {
      add({ id: "parent", status: "ok", title: "parent name", detail: `${label}.eth is available` });
      const price = await c.readContract({ address: ens.ethRegistrar, abi: ethRegistrarAbi, functionName: "getRegisterPrice", args: [label, 31_536_000n, ens.mockUsdc] }).catch(() => null);
      if (price) {
        const total = price[0] + price[1];
        const bal = ownerKey ? await c.readContract({ address: ens.mockUsdc, abi: erc20Abi, functionName: "balanceOf", args: [ownerKey] }).catch(() => 0n) : 0n;
        add({
          id: "mockusdc",
          status: bal >= total ? "ok" : "info",
          title: "MockUSDC for registration",
          detail: `1-year price ${formatUnits(total, 6)} MockUSDC; owner holds ${formatUnits(bal, 6)}${bal >= total ? "" : ". MockUSDC.mint() is public on Sepolia: the deploy mints exactly the price (test token, no value)"}`,
        });
      }
    } else if (ownerKey && owner === getAddress(ownerKey)) {
      add({ id: "parent", status: "ok", title: "parent name", detail: `${label}.eth is already owned by the owner key (the deploy resumes)` });
    } else {
      add({ id: "parent", status: "fail", title: "parent name", detail: `${label}.eth is taken${owner !== getAddress(zeroAddress) ? ` by ${owner}` : " (grace period/reserved)"}`, action: "choose another --parent label" });
    }
  }

  // 5. Contracts compiled.
  const art = join(REPO_ROOT, "contracts", "out", "PramaanTimelock.sol", "PramaanTimelock.json");
  add(existsSync(art) ? { id: "artifacts", status: "ok", title: "Foundry artifacts", detail: "PramaanTimelock compiled" } : { id: "artifacts", status: "fail", title: "Foundry artifacts", detail: "contracts/out is missing", action: "cd contracts && forge build" });

  // 6. Optional credentials (presence only, values never shown).
  const present = (k: string) => !!env[k]?.trim();
  const optional: [string, boolean, string, string][] = [
    ["ipfs", present("PINATA_JWT") || present("IPFS_API_URL"), "IPFS publication (PINATA_JWT or IPFS_API_URL)", "set PINATA_JWT (pinata.cloud, files:write) or IPFS_API_URL (a Kubo node); without it the manifest is served by the site/GitHub only"],
    ["telegram", present("TELEGRAM_BOT_TOKEN") && present("TELEGRAM_CHAT_ID"), "Telegram alerts (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)", "create a bot with @BotFather and set both variables; without them alerts stay in the dashboard"],
    ["anthropic", present("ANTHROPIC_API_KEY"), "AI-assisted PROVE (ANTHROPIC_API_KEY)", "optional: set ANTHROPIC_API_KEY to enable --ai"],
    ["github", present("GITHUB_TOKEN"), "GitHub API (GITHUB_TOKEN)", "optional: a fine-grained read-only token raises GitHub rate limits"],
  ];
  for (const [id, ok, title, action] of optional) add(ok ? { id: `opt:${id}`, status: "ok", title, detail: "configured" } : { id: `opt:${id}`, status: "info", title, detail: "not configured (optional)", action });
  const creBin = join(homedir(), ".cre", "bin", process.platform === "win32" ? "cre.exe" : "cre");
  if (existsSync(creBin)) {
    const who = await run(creBin, ["whoami"]);
    const loggedIn = who.code === 0 && !/not logged in/i.test(who.out);
    add({ id: "opt:cre", status: loggedIn ? "ok" : "info", title: "Chainlink CRE CLI login", detail: loggedIn ? "logged in" : "not logged in (optional; simulation works without deploy access)", action: loggedIn ? undefined : "cre login (or set CRE_API_KEY)" });
  } else {
    add({ id: "opt:cre", status: "info", title: "Chainlink CRE CLI", detail: "not installed (optional)", action: "install the CRE CLI to simulate the WATCH workflow" });
  }

  return { network: opts.network, ready: !checks.some((x) => x.status === "fail"), checks, rpcUrls };
}

// --- deployment record ---

export interface IdentityDeploymentFile {
  network: string;
  chainId: number;
  explorer: string | null;
  writtenAt: string;
  identities: AppIdentitiesResult;
  links: Record<string, string>;
}

export function explorerFor(chainId: number): string | null {
  return chainId === SEPOLIA_CHAIN_ID ? SEPOLIA_EXPLORER : null;
}

export function identityLinks(r: AppIdentitiesResult, explorer: string | null): Record<string, string> {
  if (!explorer) return {};
  const links: Record<string, string> = {};
  if (r.subregistry) links[`${r.parent} subregistry`] = `${explorer}/address/${r.subregistry}`;
  r.registrationTxs.forEach((h, i) => (links[`${r.parent} tx ${i + 1}`] = `${explorer}/tx/${h}`));
  for (const app of Object.values(r.apps)) {
    links[`${app.ensName} resolver`] = `${explorer}/address/${app.resolver}`;
    links[`${app.ensName} timelock`] = `${explorer}/address/${app.timelock}`;
    app.txs.forEach((h, i) => (links[`${app.ensName} tx ${i + 1}`] = `${explorer}/tx/${h}`));
  }
  for (const t of r.negativeTests) if (t.txHash) links[`negative ${t.app}/${t.actor}: ${t.attempt}`] = `${explorer}/tx/${t.txHash}`;
  links["ENS app"] = `https://sepolia.app.ens.domains/${r.parent}`;
  return links;
}

/**
 * Writes the identities into `path` under the key "ens", MERGING with what is already there (the demo contract
 * deployment record lives in the same contracts/deployments/<chainId>.json). Atomic (temp file + rename).
 */
export function writeIdentityDeployment(path: string, r: AppIdentitiesResult, network: string): IdentityDeploymentFile {
  const explorer = explorerFor(r.chainId);
  const entry: IdentityDeploymentFile = { network, chainId: r.chainId, explorer, writtenAt: new Date().toISOString(), identities: r, links: identityLinks(r, explorer) };
  let existing: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      existing = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch {
      throw new Error(`${path} is not valid JSON; refusing to overwrite it`);
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...existing, ens: entry }, null, 2));
  renameSync(tmp, path);
  return entry;
}

export function readIdentityDeployment(path: string): IdentityDeploymentFile | null {
  if (!existsSync(path)) return null;
  const j = JSON.parse(readFileSync(path, "utf8")) as { ens?: IdentityDeploymentFile };
  return j.ens ?? null;
}

export const deploymentPathFor = (chainId: number) => join(REPO_ROOT, "contracts", "deployments", `${chainId}.json`);

/**
 * The single code path for `pramaan deploy identities` on Sepolia AND on an anvil fork: runs setupAppIdentities and
 * checkpoints the (partial) result to `outPath` after every step, so an interrupted run leaves an exact record.
 */
export async function deployIdentities(ctx: ChainCtx, input: SetupAppIdentitiesInput & { outPath: string; network: string }): Promise<IdentityDeploymentFile> {
  const { outPath, network, ...setup } = input;
  const result = await setupAppIdentities(ctx, { ...setup, onCheckpoint: (partial) => writeIdentityDeployment(outPath, partial, network) });
  return writeIdentityDeployment(outPath, result, network);
}


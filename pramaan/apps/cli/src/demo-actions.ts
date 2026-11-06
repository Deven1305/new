/**
 * Live-demo actions that need no running server:
 *
 *   pnpm demo:tamper                 patch MirrorYield's built JavaScript on disk (farm address -> attacker address)
 *   pnpm demo:restore                put the original bytes back
 *   pnpm demo:tamper status          original vs current sha256
 *   pnpm demo:upgrade schedule       VaultLab: TimelockController.schedule(vault.upgradeToAndCall(VaultV3Unaudited))
 *   pnpm demo:upgrade status         operation state, time left, current implementation
 *   pnpm demo:upgrade execute        TimelockController.execute(...); reverts until the delay has passed
 *                                    (--advance moves a LOCAL chain's clock past the delay first)
 *
 * Options: --state <file> (default $PRAMAAN_DEMO_STATE or .pramaan/demo/state.json), --out <dir> (dist root, as for the
 * build). Private keys are read from keys.json next to the state file (field `owner`) and are never printed.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { encodeFunctionData, getAddress, keccak256, parseAbi, toBytes, type Hex } from "viem";
import { cancelOp, connect, loadDemoState, queuePointer, REPO_ROOT, send, signerFromKey, waitSeconds, write, type ChainCtx, type DemoStateV2, type Signer } from "@pramaan/release";
import { backupDirFor, restore as restoreFiles, status as fileStatus, tamper as tamperFiles, type TamperStatus } from "../../demos/scripts/tamper.mjs";

const repoPath = (p: string): string => (isAbsolute(p) ? p : join(REPO_ROOT, p));

export function requireState(path?: string): { state: DemoStateV2; statePath: string } {
  const statePath = resolve(path ?? process.env["PRAMAAN_DEMO_STATE"] ?? join(REPO_ROOT, ".pramaan", "demo", "state.json"));
  const state = loadDemoState(statePath);
  if (!state) throw new Error(`no DemoStateV2 at ${statePath}: run \`pnpm demo:up\` first`);
  return { state, statePath };
}

// ---------------------------------------------------------------------------------------------------------------------
// MirrorYield tamper / restore (real bytes on disk)
// ---------------------------------------------------------------------------------------------------------------------

function mirrorYieldPaths(state: DemoStateV2, out?: string): { distDir: string; backupDir: string; farm: string; attacker: string } {
  const app = state.apps.mirroryield;
  const distDir = out ? join(resolve(out), "dist", "mirroryield") : repoPath(app.distDir);
  const farm = app.contracts["farm"];
  const attacker = app.unlisted["attacker"];
  if (!farm) throw new Error("demo state has no apps.mirroryield.contracts.farm");
  if (!attacker) throw new Error("demo state has no apps.mirroryield.unlisted.attacker");
  return { distDir, backupDir: backupDirFor(distDir), farm, attacker };
}

export function demoTamper(state: DemoStateV2, out?: string) {
  const p = mirrorYieldPaths(state, out);
  return tamperFiles({ distDir: p.distDir, backupDir: p.backupDir, from: p.farm, to: p.attacker });
}

export function demoRestore(state: DemoStateV2, out?: string) {
  const p = mirrorYieldPaths(state, out);
  return restoreFiles({ distDir: p.distDir, backupDir: p.backupDir });
}

export function demoTamperStatus(state: DemoStateV2, out?: string): TamperStatus {
  const p = mirrorYieldPaths(state, out);
  return fileStatus({ distDir: p.distDir, backupDir: p.backupDir, address: p.farm });
}

// ---------------------------------------------------------------------------------------------------------------------
// VaultLab upgrade through the OpenZeppelin TimelockController
// ---------------------------------------------------------------------------------------------------------------------

const timelockAbi = parseAbi([
  "function schedule(address target, uint256 value, bytes data, bytes32 predecessor, bytes32 salt, uint256 delay)",
  "function execute(address target, uint256 value, bytes payload, bytes32 predecessor, bytes32 salt) payable",
  "function hashOperation(address target, uint256 value, bytes data, bytes32 predecessor, bytes32 salt) pure returns (bytes32)",
  "function getOperationState(bytes32 id) view returns (uint8)",
  "function getTimestamp(bytes32 id) view returns (uint256)",
  "function getMinDelay() view returns (uint256)",
]);
const vaultAbi = parseAbi(["function upgradeToAndCall(address newImplementation, bytes data) payable", "function version() view returns (string)", "function owner() view returns (address)"]);
const IMPLEMENTATION_SLOT: Hex = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const STATES = ["Unset", "Waiting", "Ready", "Done"] as const;
const NO_PREDECESSOR: Hex = `0x${"00".repeat(32)}`;
const SALT: Hex = keccak256(toBytes("pramaan-demo-vault-upgrade-v1"));

export class UpgradeNotReadyError extends Error {
  constructor(
    readonly secondsRemaining: number,
    readonly readyAt: number,
  ) {
    super(`the upgrade is still in its timelock delay: ${secondsRemaining}s remaining (ready at unix ${readyAt}). Execute after that time.`);
    this.name = "UpgradeNotReadyError";
  }
}

export interface UpgradePlan {
  timelock: `0x${string}`;
  vault: `0x${string}`;
  newImplementation: `0x${string}`;
  data: Hex;
  operationId: Hex;
}

export async function upgradePlan(ctx: ChainCtx, state: DemoStateV2): Promise<UpgradePlan> {
  const app = state.apps.vaultlab;
  const timelock = app.contracts["upgradeTimelock"];
  const vault = app.contracts["vault"];
  const newImplementation = app.unlisted["unauditedImpl"];
  if (!timelock || !vault || !newImplementation) throw new Error("demo state lacks vaultlab contracts.upgradeTimelock / contracts.vault / unlisted.unauditedImpl");
  const data = encodeFunctionData({ abi: vaultAbi, functionName: "upgradeToAndCall", args: [newImplementation, "0x"] });
  const operationId = (await ctx.pub.readContract({ address: timelock, abi: timelockAbi, functionName: "hashOperation", args: [vault, 0n, data, NO_PREDECESSOR, SALT] })) as Hex;
  return { timelock, vault, newImplementation, data, operationId };
}

export function keySigner(ctx: ChainCtx, statePath: string, role: "owner" | "proposer" | "guardian"): Signer {
  const keysPath = join(dirname(statePath), "keys.json");
  if (!existsSync(keysPath)) throw new Error(`missing ${keysPath} (written by demo:up; holds the local test keys)`);
  const keys = JSON.parse(readFileSync(keysPath, "utf8")) as Record<string, unknown>;
  const key = keys[role];
  return signerFromKey(ctx, typeof key === "string" ? key : undefined, `keys.json ${role}`);
}
export const ownerSigner = (ctx: ChainCtx, statePath: string): Signer => keySigner(ctx, statePath, "owner");

export interface UpgradeStatus {
  operationId: Hex;
  state: (typeof STATES)[number];
  readyAt: number | null;
  secondsRemaining: number | null;
  minDelay: number;
  currentImplementation: `0x${string}`;
  targetImplementation: `0x${string}`;
  version: string;
}

export async function upgradeStatus(ctx: ChainCtx, state: DemoStateV2): Promise<UpgradeStatus> {
  const plan = await upgradePlan(ctx, state);
  const [stateIdx, ts, minDelay, block, slot, version] = await Promise.all([
    ctx.pub.readContract({ address: plan.timelock, abi: timelockAbi, functionName: "getOperationState", args: [plan.operationId] }) as Promise<number>,
    ctx.pub.readContract({ address: plan.timelock, abi: timelockAbi, functionName: "getTimestamp", args: [plan.operationId] }) as Promise<bigint>,
    ctx.pub.readContract({ address: plan.timelock, abi: timelockAbi, functionName: "getMinDelay" }) as Promise<bigint>,
    ctx.pub.getBlock(),
    ctx.pub.getStorageAt({ address: plan.vault, slot: IMPLEMENTATION_SLOT }),
    ctx.pub.readContract({ address: plan.vault, abi: vaultAbi, functionName: "version" }) as Promise<string>,
  ]);
  const opState = STATES[Number(stateIdx)] ?? "Unset";
  const readyAt = ts > 1n ? Number(ts) : null; // 0 = unset, 1 = done
  return {
    operationId: plan.operationId,
    state: opState,
    readyAt,
    secondsRemaining: opState === "Waiting" && readyAt !== null ? Math.max(0, readyAt - Number(block.timestamp)) : opState === "Ready" ? 0 : null,
    minDelay: Number(minDelay),
    currentImplementation: getAddress(`0x${(slot ?? "0x").slice(-40)}`) as `0x${string}`,
    targetImplementation: plan.newImplementation,
    version,
  };
}

/** Owner key proposes the upgrade to the unaudited implementation. It takes effect only after the timelock's delay. */
export async function scheduleUpgrade(ctx: ChainCtx, state: DemoStateV2, owner: Signer): Promise<{ txHash: Hex; operationId: Hex; readyAt: number }> {
  const plan = await upgradePlan(ctx, state);
  const delay = (await ctx.pub.readContract({ address: plan.timelock, abi: timelockAbi, functionName: "getMinDelay" })) as bigint;
  const txHash = await send(ctx, await write(ctx, owner, { address: plan.timelock, abi: timelockAbi, functionName: "schedule", args: [plan.vault, 0n, plan.data, NO_PREDECESSOR, SALT, delay] }), "timelock schedule");
  const st = await upgradeStatus(ctx, state);
  return { txHash, operationId: plan.operationId, readyAt: st.readyAt ?? 0 };
}

/** Executes the scheduled upgrade. Throws UpgradeNotReadyError before the delay has elapsed (the contract would revert too). */
export async function executeUpgrade(ctx: ChainCtx, state: DemoStateV2, owner: Signer, opts: { advance?: boolean; log?: (m: string) => void } = {}): Promise<{ txHash: Hex; implementation: `0x${string}`; version: string }> {
  const plan = await upgradePlan(ctx, state);
  let st = await upgradeStatus(ctx, state);
  if (st.state === "Unset") throw new Error("nothing is scheduled: run `pnpm demo:upgrade schedule` first");
  if (st.state === "Done") throw new Error("this upgrade was already executed");
  if (st.state === "Waiting" && opts.advance) {
    if (!ctx.local) throw new Error("--advance only works on a local chain; on Sepolia wait for the delay");
    await waitSeconds(ctx, (st.secondsRemaining ?? 0) + 1, opts.log);
    st = await upgradeStatus(ctx, state);
  }
  if (st.state !== "Ready") throw new UpgradeNotReadyError(st.secondsRemaining ?? 0, st.readyAt ?? 0);
  const txHash = await send(ctx, await write(ctx, owner, { address: plan.timelock, abi: timelockAbi, functionName: "execute", args: [plan.vault, 0n, plan.data, NO_PREDECESSOR, SALT] }), "timelock execute");
  const after = await upgradeStatus(ctx, state);
  return { txHash, implementation: after.currentImplementation, version: after.version };
}

// ---------------------------------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------------------------------

async function main(argv: string[]): Promise<void> {
  const args = argv.filter((a) => a !== "--");
  const opt = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--state" || a === "--out" || a === "--app" || a === "--id") i++;
    else if (!a.startsWith("--")) positional.push(a);
  }
  const [command, sub] = positional;
  const { state, statePath } = requireState(opt("state"));
  const out = opt("out");
  const log = (m: string) => console.log(m);

  if (command === "tamper" && (sub === undefined || sub === "status")) {
    if (sub === "status") return void console.log(JSON.stringify(demoTamperStatus(state, out), null, 2));
    const r = demoTamper(state, out);
    log(`tampered: ${r.replacements} replacement(s) of the MirrorYield farm address with the attacker address`);
    for (const f of r.files) log(`  ${f.path}\n    original ${f.originalSha256}\n    patched  ${f.patchedSha256}`);
    return void log("reload http://localhost:5182 - the page looks identical, but the served JavaScript no longer matches the signed release");
  }
  if (command === "restore" && sub === undefined) {
    const r = demoRestore(state, out);
    for (const f of r.files) log(`restored ${f.path} (sha256 ${f.sha256})`);
    return;
  }
  if (command === "upgrade" && (sub === "schedule" || sub === "execute" || sub === "status")) {
    const ctx = await connect(state.network.rpcUrl);
    if (ctx.chain.id !== state.network.chainId) throw new Error(`state is for chain ${state.network.chainId}, ${state.network.rpcUrl} is chain ${ctx.chain.id}`);
    if (sub === "status") return void console.log(JSON.stringify(await upgradeStatus(ctx, state), null, 2));
    const owner = ownerSigner(ctx, statePath);
    if (sub === "schedule") {
      const r = await scheduleUpgrade(ctx, state, owner);
      log(`scheduled operation ${r.operationId} (tx ${r.txHash}); executable at unix ${r.readyAt} (${new Date(r.readyAt * 1000).toISOString()})`);
      return;
    }
    const r = await executeUpgrade(ctx, state, owner, { advance: args.includes("--advance"), log });
    log(`executed (tx ${r.txHash}): proxy now points at ${r.implementation}, version "${r.version}"`);
    return;
  }
  if (command === "release" && (sub === "queue-evil" || sub === "cancel")) {
    const appId = (opt("app") ?? "vaultlab") as keyof DemoStateV2["apps"];
    const app = state.apps[appId];
    if (!app) throw new Error(`demo state has no app "${appId}"`);
    const ctx = await connect(state.network.rpcUrl);
    if (sub === "queue-evil") {
      // A pointer nobody released: the proposer key can only QUEUE it, and it stays pending behind the timelock delay.
      const pointer = `pramaan:v1:v9.9.9-evil:${keccak256(toBytes("pramaan-demo-malicious-manifest")).slice(2)}`;
      const r = await queuePointer(ctx, keySigner(ctx, statePath, "proposer"), app.timelock, pointer);
      return void log(`queued operation #${r.id} on ${app.ensName} (tx ${r.txHash}); executable at unix ${r.eta} (${new Date(Number(r.eta) * 1000).toISOString()})
  pointer ${pointer}
  cancel it with: pnpm demo:release cancel --id ${r.id}`);
    }
    const id = opt("id");
    if (!id || !/^[0-9]+$/.test(id)) throw new Error("release cancel needs --id <operation number>");
    const tx = await cancelOp(ctx, keySigner(ctx, statePath, "guardian"), app.timelock, BigInt(id));
    return void log(`cancelled operation #${id} on ${app.ensName} (guardian tx ${tx})`);
  }
  throw new Error("usage: demo-actions tamper [status] | restore | upgrade schedule|execute [--advance]|status | release queue-evil|cancel --id N [--app <id>]   [--state <file>] [--out <dir>]");
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(resolve(entry)).href) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(`demo action failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}

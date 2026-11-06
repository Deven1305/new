import { getAddress, parseEventLogs, type Hex } from "viem";
import { dnsEncode } from "@pramaan/verifier-core";
import { parsePointer } from "@pramaan/manifest";
import { timelockAbi, TIMELOCK_STATE } from "./abis.js";
import { deployArtifact, loadArtifact, send, write, type ChainCtx, type Signer } from "./chain.js";

export async function deployTimelock(
  ctx: ChainCtx,
  deployer: Signer,
  args: { resolver: `0x${string}`; ensName: string; delaySeconds: number; proposer: `0x${string}`; guardian: `0x${string}` },
): Promise<{ timelock: `0x${string}`; txHash: Hex }> {
  const { address, txHash } = await deployArtifact(ctx, deployer, loadArtifact("PramaanTimelock"), [
    args.resolver,
    dnsEncode(args.ensName),
    BigInt(args.delaySeconds),
    args.proposer,
    args.guardian,
  ]);
  return { timelock: address, txHash };
}

export interface QueuedOp {
  id: bigint;
  value: string;
  eta: bigint;
  state: (typeof TIMELOCK_STATE)[number];
}

export async function queuePointer(ctx: ChainCtx, proposer: Signer, timelock: `0x${string}`, pointer: string): Promise<{ id: bigint; eta: bigint; txHash: Hex }> {
  if (!parsePointer(pointer).ok) throw new Error(`not a valid Pramaan pointer: ${pointer}`);
  const txHash = await write(ctx, proposer, { address: timelock, abi: timelockAbi, functionName: "queue", args: [pointer] });
  const receipt = await ctx.pub.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`queue reverted (${txHash})`);
  const [event] = parseEventLogs({ abi: timelockAbi, logs: receipt.logs, eventName: "Queued" });
  if (!event) throw new Error("Queued event not found");
  return { id: event.args.id, eta: event.args.eta, txHash };
}

export async function executeOp(ctx: ChainCtx, executor: Signer, timelock: `0x${string}`, id: bigint): Promise<Hex> {
  const txHash = await write(ctx, executor, { address: timelock, abi: timelockAbi, functionName: "execute", args: [id] });
  return send(ctx, txHash, `execute(${id})`);
}

export async function cancelOp(ctx: ChainCtx, guardian: Signer, timelock: `0x${string}`, id: bigint): Promise<Hex> {
  const txHash = await write(ctx, guardian, { address: timelock, abi: timelockAbi, functionName: "cancel", args: [id] });
  return send(ctx, txHash, `cancel(${id})`);
}

export async function readTimelock(ctx: ChainCtx, timelock: `0x${string}`) {
  const [delay, proposer, guardian, resolver, count, lastExecutedId] = await Promise.all([
    ctx.pub.readContract({ address: timelock, abi: timelockAbi, functionName: "delay" }),
    ctx.pub.readContract({ address: timelock, abi: timelockAbi, functionName: "proposer" }),
    ctx.pub.readContract({ address: timelock, abi: timelockAbi, functionName: "guardian" }),
    ctx.pub.readContract({ address: timelock, abi: timelockAbi, functionName: "resolver" }),
    ctx.pub.readContract({ address: timelock, abi: timelockAbi, functionName: "operationCount" }),
    ctx.pub.readContract({ address: timelock, abi: timelockAbi, functionName: "lastExecutedId" }),
  ]);
  const ops: QueuedOp[] = [];
  for (let id = count; id >= 1n && ops.length < 20; id--) {
    const [value, eta, state] = await ctx.pub.readContract({ address: timelock, abi: timelockAbi, functionName: "getOperation", args: [id] });
    ops.push({ id, value, eta, state: TIMELOCK_STATE[state] ?? "None" });
  }
  return { timelock: getAddress(timelock), delay, proposer, guardian, resolver, operationCount: count, lastExecutedId, ops };
}

import { getAddress, parseAbi, type PublicClient } from "viem";
import { parsePointer, type Pointer } from "@pramaan/manifest";
import { agreed, assertChainId, makeClients, requiredAgreement, type ChainConfig } from "./rpc.js";

/** The PramaanTimelock views the verifier needs (contracts/src/PramaanTimelock.sol). */
export const pramaanTimelockReadAbi = parseAbi([
  "function KEY() view returns (string)",
  "function dnsName() view returns (bytes)",
  "function delay() view returns (uint256)",
  "function operationCount() view returns (uint256)",
  "function lastExecutedId() view returns (uint256)",
  "function GRACE_PERIOD() view returns (uint256)",
  "function getOperation(uint256 id) view returns (string value, uint64 eta, uint8 state)",
]);

export const TIMELOCK_OP_STATES = ["None", "Queued", "Executed", "Cancelled"] as const;
export type TimelockOpState = (typeof TIMELOCK_OP_STATES)[number];

export interface TimelockOp {
  id: number;
  value: string;
  eta: number;
  state: TimelockOpState;
}

export interface TimelockState {
  address: `0x${string}`;
  key: string;
  dnsName: `0x${string}`;
  delay: number;
  gracePeriod: number;
  operationCount: number;
  lastExecutedId: number;
  /** Most recent operations, newest first (at most `MAX_TIMELOCK_OPS`). */
  ops: TimelockOp[];
  /** Chain time of the read (latest block timestamp). */
  now: number;
}

export const MAX_TIMELOCK_OPS = 12;

async function readOnce(client: PublicClient, chainId: number, address: `0x${string}`): Promise<TimelockState> {
  await assertChainId(client, chainId);
  const read = <T>(functionName: string, args?: readonly unknown[]) =>
    client.readContract({ address, abi: pramaanTimelockReadAbi, functionName: functionName as never, args: args as never }) as Promise<T>;
  const [key, dnsName, delay, grace, count, last, block] = await Promise.all([
    read<string>("KEY"),
    read<`0x${string}`>("dnsName"),
    read<bigint>("delay"),
    read<bigint>("GRACE_PERIOD"),
    read<bigint>("operationCount"),
    read<bigint>("lastExecutedId"),
    client.getBlock({ blockTag: "latest" }),
  ]);
  const ops: TimelockOp[] = [];
  for (let id = count; id >= 1n && ops.length < MAX_TIMELOCK_OPS; id--) {
    const [value, eta, state] = await read<readonly [string, bigint, number]>("getOperation", [id]);
    ops.push({ id: Number(id), value, eta: Number(eta), state: TIMELOCK_OP_STATES[state] ?? "None" });
  }
  // The executed op may be older than the window: fetch it explicitly so the active pointer can always be compared.
  if (last > 0n && !ops.some((o) => o.id === Number(last))) {
    const [value, eta, state] = await read<readonly [string, bigint, number]>("getOperation", [last]);
    ops.push({ id: Number(last), value, eta: Number(eta), state: TIMELOCK_OP_STATES[state] ?? "None" });
  }
  return {
    address: getAddress(address) as `0x${string}`,
    key,
    dnsName: dnsName.toLowerCase() as `0x${string}`,
    delay: Number(delay),
    gracePeriod: Number(grace),
    operationCount: Number(count),
    lastExecutedId: Number(last),
    ops,
    now: Number(block.timestamp),
  };
}

export type TimelockRead = { status: "ok"; state: TimelockState } | { status: "disagree" | "error"; detail: string };

/**
 * Reads the release timelock from every configured RPC; the answers must agree. The block timestamp is excluded from
 * the comparison (two honest RPCs may be a block apart); the smaller one is used.
 */
export async function readTimelockState(cfg: ChainConfig, address: `0x${string}`, clients: PublicClient[] = makeClients(cfg)): Promise<TimelockRead> {
  const r = await agreed(clients, requiredAgreement(cfg), (c) => readOnce(c, cfg.chainId, address), (s) => JSON.stringify({ ...s, now: 0 }));
  if (r.status === "agreed") return { status: "ok", state: r.value };
  return { status: r.status === "disagree" ? "disagree" : "error", detail: r.detail };
}

export interface PendingRelease {
  id: number;
  value: string;
  pointer: Pointer | null;
  eta: number;
  /** true when the delay has passed: anyone can execute it now. */
  ready: boolean;
}

export type TimelockAssessment =
  | { kind: "consistent"; pending: PendingRelease[] }
  | { kind: "replayed"; detail: string; pending: PendingRelease[] }
  | { kind: "not-from-timelock"; detail: string; pending: PendingRelease[] }
  | { kind: "wrong-timelock"; detail: string };

/**
 * Relates the live `pramaan.record` value to the timelock's history:
 *  - consistent: the record equals the value of the last executed operation;
 *  - replayed: the record equals an OLDER executed operation (a superseded release was written back directly);
 *  - not-from-timelock: the record was written by something other than the timelock;
 *  - pending: newer, still executable operations (queued, not cancelled, not expired).
 */
export function assessTimelock(state: TimelockState, record: string, expectedDnsName: `0x${string}`): TimelockAssessment {
  if (state.key !== "pramaan.record") return { kind: "wrong-timelock", detail: `timelock writes "${state.key}", not pramaan.record` };
  if (state.dnsName !== expectedDnsName.toLowerCase()) return { kind: "wrong-timelock", detail: "pramaan.timelock controls a different ENS name" };
  const pending = state.ops
    .filter((o) => o.id > state.lastExecutedId && o.state === "Queued" && state.now <= o.eta + state.gracePeriod)
    .map((o) => {
      const p = parsePointer(o.value);
      return { id: o.id, value: o.value, pointer: p.ok ? p.pointer : null, eta: o.eta, ready: state.now >= o.eta };
    });
  const executed = state.ops.find((o) => o.id === state.lastExecutedId);
  if (state.lastExecutedId === 0 || !executed) {
    return { kind: "not-from-timelock", detail: "pramaan.record is set but the timelock never executed a pointer", pending };
  }
  if (executed.value === record) return { kind: "consistent", pending };
  const older = state.ops.find((o) => o.state === "Executed" && o.id < state.lastExecutedId && o.value === record);
  if (older) {
    return { kind: "replayed", detail: `pramaan.record holds superseded release #${older.id}; the timelock last activated #${state.lastExecutedId}`, pending };
  }
  return { kind: "not-from-timelock", detail: `pramaan.record differs from the pointer the timelock activated (#${state.lastExecutedId})`, pending };
}

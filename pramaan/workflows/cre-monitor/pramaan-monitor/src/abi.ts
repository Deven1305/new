import { decodeAbiParameters, getAddress, parseAbi, toEventSelector } from "viem";
import type { Address, Hex, OpState, ScheduledUpgrade } from "./types";

export const resolverAbi = parseAbi(["function text(bytes32 node, string key) view returns (string)"]);

export const pramaanTimelockAbi = parseAbi([
  "function operationCount() view returns (uint256)",
  "function lastExecutedId() view returns (uint256)",
  "function getOperation(uint256 id) view returns (string value, uint64 eta, uint8 state)",
]);

export const controllerAbi = parseAbi(["function getTimestamp(bytes32 id) view returns (uint256)"]);

/** topic0 of ERC-1967 Upgraded(address indexed implementation). */
export const UPGRADED_TOPIC = toEventSelector("Upgraded(address)");
/** topic0 of OpenZeppelin TimelockController CallScheduled(bytes32 indexed id, uint256 indexed index, address target, uint256 value, bytes data, bytes32 predecessor, uint256 delay). */
export const CALL_SCHEDULED_TOPIC = toEventSelector("CallScheduled(bytes32,uint256,address,uint256,bytes,bytes32,uint256)");
/** upgradeToAndCall(address,bytes) */
export const UPGRADE_TO_AND_CALL_SELECTOR = "0x4f1ef286";

export const OP_STATES: readonly OpState[] = ["None", "Queued", "Executed", "Cancelled"];

export interface RawLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: number;
  logIndex: number;
}

/** Upgraded(address indexed implementation): the address is the last 20 bytes of topic1. */
export function decodeUpgraded(log: RawLog): Address | null {
  if (log.topics[0]?.toLowerCase() !== UPGRADED_TOPIC.toLowerCase() || log.topics.length < 2) return null;
  const t = log.topics[1] as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(t)) return null;
  return getAddress(`0x${t.slice(26)}`) as Address;
}

export interface DecodedCallScheduled {
  id: Hex;
  index: number;
  target: Address;
  value: bigint;
  data: Hex;
  delay: bigint;
}

export function decodeCallScheduled(log: RawLog): DecodedCallScheduled | null {
  if (log.topics[0]?.toLowerCase() !== CALL_SCHEDULED_TOPIC.toLowerCase() || log.topics.length < 3) return null;
  try {
    const [target, value, data, , delay] = decodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "bytes" }, { type: "bytes32" }, { type: "uint256" }],
      log.data,
    );
    return { id: log.topics[1] as Hex, index: Number(BigInt(log.topics[2] as Hex)), target: getAddress(target) as Address, value, data, delay };
  } catch {
    return null;
  }
}

/** Implementation address inside upgradeToAndCall(address,bytes) calldata, or null if the call is something else. */
export function decodeUpgradeCall(data: Hex): { selector: Hex; implementation: Address | null } {
  const selector = (data.slice(0, 10).toLowerCase() || "0x") as Hex;
  if (selector !== UPGRADE_TO_AND_CALL_SELECTOR) return { selector, implementation: null };
  try {
    const [implementation] = decodeAbiParameters([{ type: "address" }, { type: "bytes" }], `0x${data.slice(10)}`);
    return { selector, implementation: getAddress(implementation) as Address };
  } catch {
    return { selector, implementation: null };
  }
}

/**
 * OpenZeppelin TimelockController.getTimestamp(id): 0 = unset or cancelled, 1 = done, otherwise the unix time the
 * operation becomes ready. Returns the pending ETA or null when the operation is not pending.
 */
export function pendingEta(timestamp: bigint): number | null {
  return timestamp > 1n ? Number(timestamp) : null;
}

export function toScheduledUpgrade(call: DecodedCallScheduled, eta: number, block: number): ScheduledUpgrade {
  const { selector, implementation } = decodeUpgradeCall(call.data);
  return { id: call.id, target: call.target, implementation, selector, eta, block };
}

// HexFence's recipient check, folded into the Pramaan review window as the "Recipient" row.
// A Safe payment is recognised the same way the standalone HexFence extension does it (SafeTx typed data or an
// execTransaction call); the Safe's approved payees are read from the HexFence Guard and compared with the
// lookalike rule that the Guard itself enforces on-chain. Pure and unit-tested; the chain client is injected.
import {
  decodeSafeCall,
  hexFenceGuardAbi,
  safeCallFromExecTransaction,
  safeCallFromTypedData,
  verdictFor,
  type SafeCall,
  type Verdict,
} from "@hexfence/shared";
import { getAddress, isAddress, zeroAddress, type Address, type Hex } from "viem";
import type { VerdictRow } from "@pramaan/verifier-core";

/** Safe 1.3/1.4 GuardManager: `getGuard` is internal, so the documented storage slot is read. */
export const SAFE_GUARD_SLOT = "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8" as const;
const EXEC_TRANSACTION = "0x6a761202";

export interface SafeCapture {
  kind: "SafeTx" | "execTransaction";
  safe?: Address;
  chainId?: string;
  call: SafeCall | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const asAddress = (v: unknown): Address | undefined => (typeof v === "string" && isAddress(v, { strict: false }) ? (v as Address) : undefined);

/** Recognises a Safe payment request. Returns null for anything that is not a Safe SafeTx / execTransaction. */
export function matchSafeRequest(method: string, params: readonly unknown[]): SafeCapture | null {
  if (method === "eth_signTypedData_v4") {
    let td: unknown = params[1];
    try {
      if (typeof td === "string") td = JSON.parse(td);
    } catch {
      return null;
    }
    if (!isRecord(td) || td.primaryType !== "SafeTx") return null;
    const domain = isRecord(td.domain) ? td.domain : {};
    return {
      kind: "SafeTx",
      safe: asAddress(domain.verifyingContract),
      chainId: typeof domain.chainId === "string" || typeof domain.chainId === "number" ? String(domain.chainId) : undefined,
      call: safeCallFromTypedData(td),
    };
  }
  if (method === "eth_sendTransaction") {
    const tx = params[0];
    if (!isRecord(tx)) return null;
    const data = tx.data ?? tx.input;
    if (typeof data !== "string" || data.slice(0, 10).toLowerCase() !== EXEC_TRANSACTION) return null;
    return { kind: "execTransaction", safe: asAddress(tx.to), call: safeCallFromExecTransaction(data as Hex) };
  }
  return null;
}

/** The three chain reads the check needs. A viem PublicClient satisfies this. */
export interface RecipientClient {
  getBlockNumber(): Promise<bigint>;
  getStorageAt(args: { address: Address; slot: Hex; blockNumber?: bigint }): Promise<Hex | undefined>;
  readContract(args: { address: Address; abi: typeof hexFenceGuardAbi; functionName: "payees"; args: [Address]; blockNumber?: bigint }): Promise<readonly Address[]>;
}

const row = (color: VerdictRow["color"], key: string, params: Record<string, string>, detail: string, blocking = false): VerdictRow => ({
  id: "recipient",
  color,
  key,
  params,
  detail,
  blocking,
});

export interface RecipientInput {
  method: string;
  params: readonly unknown[];
  /** Guard configured for the chain the request is on; undefined = HexFence has no Guard there. */
  guard: Address | undefined;
  client: RecipientClient | undefined;
}

/**
 * Returns the Recipient row for a Safe payment, or null when the request is not a Safe payment (the row is simply
 * absent). Never green for something unchecked: a missing Guard, an unreadable list or an unsupported call is
 * amber/grey, and only a confirmed lookalike is red (and blocking, like every red row).
 */
export async function recipientRow(input: RecipientInput): Promise<VerdictRow | null> {
  const capture = matchSafeRequest(input.method, input.params);
  if (!capture) return null;
  if (!capture.safe || !capture.call) return row("neutral", "verify.recipient.unsupported", {}, "the Safe request could not be decoded");
  if (!input.guard) return row("neutral", "verify.recipient.no-guard", {}, "no HexFence Guard is configured for this chain");
  if (!input.client) return row("amber", "verify.recipient.unreadable", {}, "no RPC for this chain");
  try {
    const block = await input.client.getBlockNumber();
    const slot = await input.client.getStorageAt({ address: capture.safe, slot: SAFE_GUARD_SLOT, blockNumber: block });
    if (!slot || !/^0x[0-9a-fA-F]{64}$/.test(slot)) throw new Error("guard slot unreadable");
    const activeGuard = getAddress(`0x${slot.slice(-40)}`);
    const guardActive = activeGuard !== zeroAddress && activeGuard.toLowerCase() === input.guard.toLowerCase();
    const payees = [...(await input.client.readContract({ address: input.guard, abi: hexFenceGuardAbi, functionName: "payees", args: [capture.safe], blockNumber: block }))];
    const verdict = verdictFor(decodeSafeCall(capture.call, { safe: capture.safe, guard: input.guard }), payees);
    return fromVerdict(verdict, guardActive);
  } catch {
    return row("amber", "verify.recipient.unreadable", {}, "the Safe's approved payees could not be read");
  }
}

/** Maps a HexFence verdict onto a Pramaan row. Exported for tests. */
export function fromVerdict(v: Verdict, guardActive: boolean): VerdictRow {
  const note = guardActive ? "" : "; the HexFence Guard is not active on this Safe, so nothing on-chain will stop it";
  switch (v.level) {
    case "GREEN":
      return row("green", "verify.recipient.approved", { recipient: v.recipient }, `approved payee${note}`);
    case "RED":
      if (v.reason === "resembles") return row("red", "verify.recipient.resembles", { recipient: v.recipient, payee: v.payee }, `lookalike of an approved payee${note}`, true);
      return row("red", "verify.recipient.resembles", { recipient: v.recipient, payee: v.recipient }, "listed in public poisoning evidence", true);
    case "AMBER":
      return row("amber", "verify.recipient.new", { recipient: v.recipient }, `new recipient${note}`);
    case "GREY":
      return v.reason === "delegatecall"
        ? row("neutral", "verify.recipient.delegatecall", {}, "delegatecall")
        : row("neutral", "verify.recipient.unsupported", {}, v.reason);
  }
}

import { decodeFunctionData, getAddress, hexToBytes, hexToString, isAddress, isHex, keccak256, parseAbiItem, size, toFunctionSelector, bytesToHex } from "viem";
import type { AbiFunction } from "viem";
import { parseSiweMessage } from "viem/siwe";
import { erc1155Abi, erc20Abi, erc721Abi, multicallAbi, multiSendAbi, permit2Abi, PERMIT2_ADDRESS, safeAbi, SAFE_MULTISEND, SELECTORS } from "./abis.js";
import { isUnlimited } from "./format.js";
import type { Action, Address, BatchSource, DecodeContext, DecodedArg, Hex, TokenRef, TxRequest, VerifiedDescriptor } from "./types.js";

/** Nesting limit for batches inside batches (Safe → MultiSend → Multicall → …). */
export const MAX_DEPTH = 4;
/** Total number of calls decoded for one request, across every nesting level. */
export const MAX_CALLS = 64;
const UINT256_LIMIT = 2n ** 256n;

/** Shared across one request so a deep or wide batch cannot make decoding explode. */
interface Budget {
  calls: number;
}

/** Calls a caller-supplied hook; a hook that throws (sync or async) counts as "no answer". */
export async function safeCall<T>(fn: () => T | Promise<T> | undefined): Promise<T | null> {
  try {
    return (await fn()) ?? null;
  } catch {
    return null;
  }
}

function addr(value: unknown): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) throw new Error(`invalid address ${String(value).slice(0, 50)}`);
  return getAddress(value) as Address;
}

/** Strict unsigned integer: bigint, safe non-negative number, decimal or 0x-hex string, below 2^256. */
function uint(value: unknown, bits = 256): bigint {
  let v: bigint;
  if (typeof value === "bigint") v = value;
  else if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error(`not an integer: ${value}`);
    v = BigInt(value);
  } else if (typeof value === "string" && /^(0x[0-9a-fA-F]+|[0-9]+)$/.test(value.trim())) v = BigInt(value.trim());
  else throw new Error(`not an unsigned integer: ${String(value).slice(0, 40)}`);
  if (v < 0n || v >= 2n ** BigInt(bits)) throw new Error(`out of range for uint${bits}`);
  return v;
}

/** Lenient value parsing for tx fields (wallets accept hex or decimal); malformed values are reported, not thrown. */
function txValue(value: unknown): bigint | null {
  if (value === undefined || value === null || value === "") return 0n;
  try {
    return uint(value);
  } catch {
    return null;
  }
}

async function tokenRef(ctx: DecodeContext, address: Address): Promise<TokenRef & { kind: string }> {
  const info = await safeCall(() => ctx.tokenInfo?.(address));
  return { address, symbol: info?.symbol ?? null, decimals: info?.decimals ?? null, kind: info?.kind ?? "unknown" };
}

function stripKind(t: TokenRef & { kind?: string }): TokenRef {
  return { address: t.address, symbol: t.symbol, decimals: t.decimals };
}

type UnknownOpts = { selector?: Hex | null; to?: Address | null; value?: bigint; malformed?: boolean; facts?: { key: string; params: Record<string, string> }[] };

export function unknownAction(subject: "transaction" | "signature", reason: string, reasonKey: string, reasonParams: Record<string, string> = {}, o: UnknownOpts = {}): Action {
  return {
    kind: "unknown",
    subject,
    reason,
    reasonKey,
    reasonParams,
    malformed: o.malformed ?? false,
    selector: o.selector ?? null,
    to: o.to ?? null,
    value: o.value ?? 0n,
    ...(o.facts?.length ? { facts: o.facts } : {}),
  };
}

// --- ERC-7730 descriptors as an ABI source -------------------------------------------------------------------------

interface DescriptorFunction {
  abi: AbiFunction;
  selector: Hex;
  signature: string;
  intent: string | null;
}

/** Parses `display.formats` keys (e.g. `depositToken(uint256 amount)`) of a verified descriptor into ABI items. */
export function descriptorFunctions(descriptor: VerifiedDescriptor["descriptor"]): DescriptorFunction[] {
  const display = descriptor["display"] as { formats?: Record<string, { intent?: unknown }> } | undefined;
  const out: DescriptorFunction[] = [];
  for (const [key, spec] of Object.entries(display?.formats ?? {})) {
    try {
      const abi = parseAbiItem(`function ${key}`) as AbiFunction;
      const intent = typeof spec?.intent === "string" ? spec.intent : null;
      out.push({ abi, selector: toFunctionSelector(abi), signature: key, intent });
    } catch {
      // Not a function signature (e.g. an EIP-712 primary type); ignore.
    }
  }
  return out;
}

function findDescriptor(ctx: DecodeContext, to: Address): VerifiedDescriptor | undefined {
  return ctx.descriptors?.find((d) => d.chainId === ctx.chainId && d.address.toLowerCase() === to.toLowerCase());
}

function stringifyArg(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return `[${value.map(stringifyArg).join(", ")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).map(([k, v]) => `${k}: ${stringifyArg(v)}`).join(", ")}}`;
  }
  return String(value);
}

// --- transactions ---------------------------------------------------------------------------------------------------

/**
 * Decodes an `eth_sendTransaction` request deterministically. Only ABIs Pramaan ships (ERC-20/721/1155, Permit2,
 * Safe, Multicall, MultiSend) or descriptors pinned by a verified release are used. No selector database, no LLM:
 * anything else is reported as unknown. Never throws.
 */
export async function decodeTransaction(tx: TxRequest, ctx: DecodeContext, budget: Budget = { calls: 0 }): Promise<Action> {
  if (!tx || typeof tx !== "object") return unknownAction("transaction", "transaction is not an object", "reason.no-params", {}, { malformed: true });
  const value = txValue(tx.value);
  if (value === null) return unknownAction("transaction", "value is not an unsigned integer", "reason.bad-value", {}, { malformed: true });
  const authList = Array.isArray(tx.authorizationList) ? tx.authorizationList : [];
  if (authList.length > 0) {
    const delegates = authList
      .map((a) => a?.address ?? a?.contractAddress)
      .filter((a): a is string => typeof a === "string" && isAddress(a, { strict: false }))
      .map(addr);
    return { kind: "eip7702-authorization", delegates };
  }
  const rawData = tx.data ?? tx.input ?? "0x";
  if (typeof rawData !== "string" || !isHex(rawData) || rawData.length % 2 !== 0) {
    return unknownAction("transaction", "calldata is not hex", "reason.not-hex", {}, { malformed: true, value });
  }
  const data = rawData as Hex;
  if (tx.to === undefined || tx.to === null || tx.to === "" || tx.to === "0x") {
    if (size(data) === 0) return unknownAction("transaction", "contract deployment without code", "reason.empty-deployment", {}, { malformed: true, value });
    return { kind: "contract-deployment", bytecodeSize: size(data), codehash: keccak256(data), value };
  }
  if (typeof tx.to !== "string" || !isAddress(tx.to, { strict: false })) {
    return unknownAction("transaction", "invalid recipient", "reason.invalid-recipient", { to: String(tx.to).slice(0, 48) }, { malformed: true, value });
  }
  return decodeCall(addr(tx.to), data, value, ctx, 0, budget);
}

async function decodeCall(to: Address, data: Hex, value: bigint, ctx: DecodeContext, depth: number, budget: Budget): Promise<Action> {
  budget.calls += 1;
  if (data === "0x" || size(data) === 0) {
    if (value > 0n) return { kind: "native-transfer", to, amount: value };
    return unknownAction("transaction", "empty call with no value", "reason.empty-call", {}, { to, value });
  }
  if (size(data) < 4) return unknownAction("transaction", "calldata shorter than a selector", "reason.short-calldata", {}, { to, value, malformed: true });
  const selector = data.slice(0, 10).toLowerCase() as Hex;
  const malformed = (fn: string) =>
    unknownAction("transaction", "calldata does not match the standard ABI for its selector", "reason.abi-mismatch", { function: fn }, { selector, to, value, malformed: true });

  // 1. A descriptor pinned by the verified release wins for that release's own contracts.
  const descriptor = findDescriptor(ctx, to);
  if (descriptor) {
    const fn = descriptorFunctions(descriptor.descriptor).find((f) => f.selector === selector);
    if (fn) {
      try {
        const decoded = decodeFunctionData({ abi: [fn.abi], data });
        const args: DecodedArg[] = fn.abi.inputs.map((input, i) => ({
          name: input.name ?? `arg${i}`,
          type: input.type,
          value: stringifyArg((decoded.args ?? [])[i]),
        }));
        return {
          kind: "contract-call",
          to,
          label: ctx.labels?.[to.toLowerCase()] ?? null,
          functionName: fn.abi.name,
          signature: fn.signature,
          args,
          value,
          descriptorIntent: fn.intent,
        };
      } catch {
        return unknownAction("transaction", "calldata does not match the release descriptor", "reason.descriptor-mismatch", {}, { selector, to, value, malformed: true });
      }
    }
  }

  switch (selector) {
    case SELECTORS.transfer: {
      const d = tryDecode(erc20Abi, data);
      if (!d) return malformed("transfer");
      return { kind: "erc20-transfer", token: stripKind(await tokenRef(ctx, to)), to: addr(d[0]), amount: d[1] as bigint };
    }
    case SELECTORS.approve: {
      const d = tryDecode(erc20Abi, data);
      if (!d) return malformed("approve");
      const t = await tokenRef(ctx, to);
      if (t.kind === "erc721") return { kind: "nft-approve", collection: stripKind(t), spender: addr(d[0]), tokenId: d[1] as bigint };
      const amount = d[1] as bigint;
      return { kind: "erc20-approve", token: stripKind(t), spender: addr(d[0]), amount, unlimited: isUnlimited(amount) };
    }
    case SELECTORS.increaseAllowance: {
      const d = tryDecode(erc20Abi, data);
      if (!d) return malformed("increaseAllowance");
      const amount = d[1] as bigint;
      return { kind: "erc20-increase-allowance", token: stripKind(await tokenRef(ctx, to)), spender: addr(d[0]), amount, unlimited: isUnlimited(amount) };
    }
    case SELECTORS.transferFrom: {
      const d = tryDecode(erc20Abi, data);
      if (!d) return malformed("transferFrom");
      const t = await tokenRef(ctx, to);
      if (t.kind === "erc721") return { kind: "nft-transfer", collection: stripKind(t), from: addr(d[0]), to: addr(d[1]), tokenId: d[2] as bigint, amount: null };
      return { kind: "token-transfer-from", token: stripKind(t), from: addr(d[0]), to: addr(d[1]), amount: d[2] as bigint };
    }
    case SELECTORS.setApprovalForAll: {
      const d = tryDecode(erc721Abi, data);
      if (!d) return malformed("setApprovalForAll");
      return { kind: "nft-approval-for-all", collection: stripKind(await tokenRef(ctx, to)), operator: addr(d[0]), approved: Boolean(d[1]) };
    }
    case SELECTORS.safeTransferFrom721:
    case SELECTORS.safeTransferFrom721Data: {
      const d = tryDecode(erc721Abi, data);
      if (!d) return malformed("safeTransferFrom");
      return { kind: "nft-transfer", collection: stripKind(await tokenRef(ctx, to)), from: addr(d[0]), to: addr(d[1]), tokenId: d[2] as bigint, amount: null };
    }
    case SELECTORS.safeTransferFrom1155: {
      const d = tryDecode(erc1155Abi, data);
      if (!d) return malformed("safeTransferFrom");
      return { kind: "nft-transfer", collection: stripKind(await tokenRef(ctx, to)), from: addr(d[0]), to: addr(d[1]), tokenId: d[2] as bigint, amount: d[3] as bigint };
    }
    case SELECTORS.safeBatchTransferFrom1155: {
      const d = tryDecode(erc1155Abi, data);
      if (!d) return malformed("safeBatchTransferFrom");
      const ids = [...(d[2] as readonly bigint[])];
      const amounts = [...(d[3] as readonly bigint[])];
      if (ids.length !== amounts.length || ids.length === 0) return malformed("safeBatchTransferFrom");
      return { kind: "nft-batch-transfer", collection: stripKind(await tokenRef(ctx, to)), from: addr(d[0]), to: addr(d[1]), ids, amounts };
    }
    case SELECTORS.permit2612: {
      const d = tryDecode(erc20Abi, data);
      if (!d) return malformed("permit");
      const amount = d[2] as bigint;
      return {
        kind: "permit",
        standard: "eip2612",
        tokens: [{ token: stripKind(await tokenRef(ctx, to)), amount, unlimited: isUnlimited(amount) }],
        spender: addr(d[1]),
        deadline: d[3] as bigint,
        chainId: null,
        onChain: true,
      };
    }
    case SELECTORS.permit2Approve: {
      if (to.toLowerCase() !== PERMIT2_ADDRESS) break;
      const d = tryDecode(permit2Abi, data);
      if (!d) return malformed("approve");
      const amount = d[2] as bigint;
      return {
        kind: "permit",
        standard: "permit2-approve",
        tokens: [{ token: stripKind(await tokenRef(ctx, addr(d[0]))), amount, unlimited: isUnlimited(amount, 160) }],
        spender: addr(d[1]),
        deadline: null,
        expiration: BigInt(d[3] as number | bigint),
        chainId: null,
        onChain: true,
      };
    }
    case SELECTORS.safeExecTransaction: {
      const d = tryDecode(safeAbi, data);
      if (!d) return malformed("execTransaction");
      return safeExec(to, addr(d[0]), d[1] as bigint, d[2] as Hex, Number(d[3]), ctx, depth, budget);
    }
    case SELECTORS.aggregate:
    case SELECTORS.aggregate3:
    case SELECTORS.aggregate3Value:
    case SELECTORS.tryAggregate:
    case SELECTORS.blockAndAggregate:
    case SELECTORS.tryBlockAndAggregate:
    case SELECTORS.multicall:
    case SELECTORS.multicallDeadline:
    case SELECTORS.multicallBlockhash:
      return decodeMulticall(to, data, value, ctx, depth, budget);
    case SELECTORS.multiSend: {
      const d = tryDecode(multiSendAbi, data);
      if (!d) return malformed("multiSend");
      return decodeMultiSend(to, d[0] as Hex, ctx, depth, budget, false);
    }
  }
  return unknownAction("transaction", "unrecognised function selector", "reason.unknown-selector", { selector }, { selector, to, value });
}

function tryDecode(abi: readonly unknown[], data: Hex): readonly unknown[] | null {
  try {
    const { args } = decodeFunctionData({ abi: abi as never, data });
    return (args ?? []) as readonly unknown[];
  } catch {
    return null;
  }
}

function isMultiSend(ctx: DecodeContext, target: Address): "call-only" | "full" | null {
  if (!(SAFE_MULTISEND.chains as readonly number[]).includes(ctx.chainId)) return null;
  const t = target.toLowerCase();
  if ((SAFE_MULTISEND.callOnly as readonly string[]).includes(t)) return "call-only";
  if ((SAFE_MULTISEND.full as readonly string[]).includes(t)) return "full";
  return null;
}

async function safeExec(safe: Address, target: Address, value: bigint, data: Hex, operation: number, ctx: DecodeContext, depth: number, budget: Budget): Promise<Action> {
  const multisend = operation === 1 ? isMultiSend(ctx, target) : null;
  let inner: Action | null = null;
  if (depth + 1 > MAX_DEPTH) inner = tooDeep(target);
  else if (operation === 0) inner = await decodeCall(target, data, value, ctx, depth + 1, budget);
  else if (multisend && data.slice(0, 10).toLowerCase() === SELECTORS.multiSend) {
    const d = tryDecode(multiSendAbi, data);
    inner = d ? await decodeMultiSend(target, d[0] as Hex, ctx, depth + 1, budget, true) : null;
  }
  return { kind: "safe-exec", safe, target, value, operation, inner, ...(multisend ? { multisend } : {}) };
}

function tooDeep(to: Address | null): Action {
  return unknownAction("transaction", "nested batch too deep", "reason.too-deep", { max: String(MAX_DEPTH) }, { to });
}

async function decodeMulticall(to: Address, data: Hex, value: bigint, ctx: DecodeContext, depth: number, budget: Budget): Promise<Action> {
  const selector = data.slice(0, 10) as Hex;
  if (depth + 1 > MAX_DEPTH) return tooDeep(to);
  let decoded: { functionName: string; args: readonly unknown[] };
  try {
    const r = decodeFunctionData({ abi: multicallAbi, data });
    decoded = { functionName: r.functionName, args: (r.args ?? []) as readonly unknown[] };
  } catch {
    return unknownAction("transaction", "calldata does not match the standard ABI for its selector", "reason.abi-mismatch", { function: "multicall" }, { selector, to, value, malformed: true });
  }
  let calls: { target: Address; data: Hex; value: bigint }[];
  let source: BatchSource = "multicall3";
  if (decoded.functionName === "multicall") {
    // multicall(bytes[]) / multicall(deadline|blockhash, bytes[]) call the contract itself (Uniswap routers, vaults).
    const list = (decoded.args.length === 2 ? decoded.args[1] : decoded.args[0]) as readonly Hex[];
    calls = list.map((d) => ({ target: to, data: d, value: 0n }));
    source = "multicall";
  } else {
    const list = (decoded.functionName.startsWith("try") ? decoded.args[1] : decoded.args[0]) as readonly { target: string; callData: Hex; value?: bigint }[];
    calls = list.map((c) => ({ target: addr(c.target), data: c.callData, value: c.value ?? 0n }));
  }
  return decodeList(calls, source, ctx, depth, budget, to, value);
}

async function decodeList(
  calls: { target: Address; data: Hex; value: bigint; operation?: number }[],
  source: BatchSource,
  ctx: DecodeContext,
  depth: number,
  budget: Budget,
  to: Address | null,
  value: bigint,
): Promise<Action> {
  if (calls.length === 0) return unknownAction("transaction", "empty batch", "reason.empty-batch", {}, { to, value, malformed: true });
  if (calls.length > MAX_CALLS || budget.calls + calls.length > MAX_CALLS) {
    return unknownAction("transaction", `batch of ${calls.length} calls is too large to review`, "reason.too-many-calls", { max: String(MAX_CALLS) }, { to, value });
  }
  const decoded: Action[] = [];
  for (const c of calls) {
    if (c.operation === 1) {
      budget.calls += 1;
      decoded.push({ kind: "delegatecall", target: c.target, dataSize: size(c.data) });
    } else decoded.push(await decodeCall(c.target, c.data, c.value, ctx, depth + 1, budget));
  }
  return { kind: "batch", source, calls: decoded, targets: calls.map((c) => c.target) };
}

/** Safe MultiSend packed encoding: operation (1) ‖ to (20) ‖ value (32) ‖ dataLength (32) ‖ data, repeated. */
export function parseMultiSend(packed: Hex): { operation: number; target: Address; value: bigint; data: Hex }[] | null {
  let bytes: Uint8Array;
  try {
    bytes = hexToBytes(packed);
  } catch {
    return null;
  }
  const out: { operation: number; target: Address; value: bigint; data: Hex }[] = [];
  let i = 0;
  while (i < bytes.length) {
    if (bytes.length - i < 85 || out.length > MAX_CALLS) return null;
    const operation = bytes[i]!;
    if (operation > 1) return null;
    const target = getAddress(bytesToHex(bytes.slice(i + 1, i + 21))) as Address;
    const value = BigInt(bytesToHex(bytes.slice(i + 21, i + 53)));
    const len = BigInt(bytesToHex(bytes.slice(i + 53, i + 85)));
    if (len > BigInt(bytes.length - i - 85)) return null;
    const n = Number(len);
    out.push({ operation, target, value, data: bytesToHex(bytes.slice(i + 85, i + 85 + n)) });
    i += 85 + n;
  }
  return out;
}

async function decodeMultiSend(to: Address, packed: Hex, ctx: DecodeContext, depth: number, budget: Budget, viaSafe: boolean): Promise<Action> {
  const entries = parseMultiSend(packed);
  if (!entries) return unknownAction("transaction", "malformed MultiSend data", "reason.bad-multisend", {}, { to, selector: SELECTORS.multiSend, malformed: true });
  if (depth + 1 > MAX_DEPTH) return tooDeep(to);
  void viaSafe;
  return decodeList(entries, "safe-multisend", ctx, depth, budget, to, 0n);
}

/** EIP-5792 `wallet_sendCalls`. */
export async function decodeCalls(calls: unknown, ctx: DecodeContext): Promise<Action> {
  if (!Array.isArray(calls)) return unknownAction("transaction", "calls is not a list", "reason.no-params", {}, { malformed: true });
  if (calls.length === 0) return unknownAction("transaction", "empty batch", "reason.empty-batch", {}, { malformed: true });
  if (calls.length > MAX_CALLS) return unknownAction("transaction", "batch too large", "reason.too-many-calls", { max: String(MAX_CALLS) });
  const budget: Budget = { calls: 0 };
  const decoded: Action[] = [];
  const targets: (Address | null)[] = [];
  for (const c of calls as { to?: string; data?: string; value?: string }[]) {
    const call = c && typeof c === "object" ? c : {};
    decoded.push(await decodeTransaction({ to: call.to ?? null, data: call.data ?? "0x", value: call.value ?? "0x0" }, ctx, budget));
    targets.push(typeof call.to === "string" && isAddress(call.to, { strict: false }) ? addr(call.to) : null);
  }
  return decoded.length === 1 ? decoded[0]! : { kind: "batch", source: "wallet_sendCalls", calls: decoded, targets };
}

// --- EIP-712 typed data ----------------------------------------------------------------------------------------------

export interface TypedDataInput {
  domain?: Record<string, unknown>;
  primaryType?: string;
  types?: Record<string, { name: string; type: string }[]>;
  message?: Record<string, unknown>;
}

function fieldNames(td: TypedDataInput, type: string): string[] {
  const fields = td.types?.[type];
  return Array.isArray(fields) ? fields.map((f) => f?.name).filter((n): n is string => typeof n === "string").sort() : [];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The EIP-712 domain chain id, or null when absent. Throws on a malformed value. */
export function typedDataChainId(td: TypedDataInput): number | null {
  const raw = td.domain?.["chainId"];
  if (raw === undefined || raw === null) return null;
  const v = uint(raw);
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("chainId too large");
  return Number(v);
}

/** Parses a typed-data payload (JSON string or object). Returns null when it is not even an object. */
export function parseTypedData(input: unknown): TypedDataInput | null {
  let td: unknown = input;
  if (typeof input === "string") {
    try {
      td = JSON.parse(input);
    } catch {
      return null;
    }
  }
  return isObject(td) ? (td as TypedDataInput) : null;
}

const PERMIT2_TYPES = new Set(["PermitSingle", "PermitBatch", "PermitTransferFrom", "PermitBatchTransferFrom", "PermitWitnessTransferFrom", "PermitBatchWitnessTransferFrom"]);

/** Decodes `eth_signTypedData_v4` payloads (JSON string or object). Never throws. */
export async function decodeTypedData(input: unknown, ctx: DecodeContext): Promise<Action> {
  if (Array.isArray(input)) {
    return unknownAction("signature", "legacy eth_signTypedData (v1) payload", "reason.typed-legacy");
  }
  const td = parseTypedData(input);
  if (!td) return unknownAction("signature", "typed data is not valid JSON", "reason.typed-not-json", {}, { malformed: true });
  if (typeof td.primaryType !== "string" || !isObject(td.types) || !isObject(td.message) || (td.domain !== undefined && !isObject(td.domain))) {
    return unknownAction("signature", "typed data has no valid domain/primaryType/types/message", "reason.typed-shape", {}, { malformed: true });
  }
  const primary = td.primaryType;
  const msg = td.message;
  const domain = td.domain ?? {};
  const rawVerifying = domain["verifyingContract"];
  const verifying = typeof rawVerifying === "string" && isAddress(rawVerifying, { strict: false }) ? addr(rawVerifying) : null;
  let chainId: number | null = null;
  try {
    chainId = typedDataChainId(td);
  } catch {
    return unknownAction("signature", "typed data domain has an invalid chainId", "reason.typed-malformed", { primaryType: primary }, { malformed: true, to: verifying });
  }
  const facts: { key: string; params: Record<string, string> }[] = [
    { key: "fact.typed.type", params: { primaryType: primary.slice(0, 80) } },
    ...(typeof domain["name"] === "string" ? [{ key: "fact.typed.domain", params: { name: String(domain["name"]).slice(0, 80) } }] : []),
    ...(verifying ? [{ key: "fact.typed.contract", params: { contract: verifying } }] : []),
    ...(chainId !== null ? [{ key: "fact.typed.chain", params: { chain: String(chainId) } }] : []),
  ];
  const malformedTyped = () =>
    unknownAction("signature", `typed data for ${primary} is malformed`, "reason.typed-malformed", { primaryType: primary.slice(0, 80) }, { malformed: true, to: verifying, facts });
  try {
    if (primary === "Permit") {
      const names = fieldNames(td, "Permit").join(",");
      if (names === "deadline,nonce,owner,spender,value") {
        if (!verifying) return malformedTyped();
        const amount = uint(msg["value"]);
        uint(msg["nonce"]);
        addr(msg["owner"]);
        return {
          kind: "permit",
          standard: "eip2612",
          tokens: [{ token: stripKind(await tokenRef(ctx, verifying)), amount, unlimited: isUnlimited(amount) }],
          spender: addr(msg["spender"]),
          deadline: uint(msg["deadline"]),
          chainId,
          onChain: false,
        };
      }
      if (names === "allowed,expiry,holder,nonce,spender") {
        if (!verifying) return malformedTyped();
        if (typeof msg["allowed"] !== "boolean") return malformedTyped();
        const allowed = msg["allowed"];
        const expiry = uint(msg["expiry"]);
        addr(msg["holder"]);
        return {
          kind: "permit",
          standard: "dai",
          tokens: [{ token: stripKind(await tokenRef(ctx, verifying)), amount: allowed ? UINT256_LIMIT - 1n : 0n, unlimited: allowed }],
          spender: addr(msg["spender"]),
          deadline: expiry === 0n ? null : expiry,
          chainId,
          onChain: false,
        };
      }
    }
    if (PERMIT2_TYPES.has(primary)) {
      if (verifying?.toLowerCase() !== PERMIT2_ADDRESS) {
        return unknownAction("signature", `${primary} typed data for a contract that is not Permit2`, "reason.typed-not-permit2", { primaryType: primary, contract: verifying ?? "?" }, { to: verifying, facts });
      }
      if (primary === "PermitSingle" || primary === "PermitBatch") {
        const details = primary === "PermitSingle" ? [msg["details"]] : msg["details"];
        if (!Array.isArray(details) || details.length === 0 || !details.every(isObject)) return malformedTyped();
        const tokens = [];
        let expiration: bigint | null = null;
        for (const d of details as Record<string, unknown>[]) {
          const amount = uint(d["amount"], 160);
          const exp = uint(d["expiration"], 48);
          uint(d["nonce"], 48);
          expiration = expiration === null || exp > expiration ? exp : expiration;
          tokens.push({ token: stripKind(await tokenRef(ctx, addr(d["token"]))), amount, unlimited: isUnlimited(amount, 160) });
        }
        return {
          kind: "permit",
          standard: primary === "PermitSingle" ? "permit2-single" : "permit2-batch",
          tokens,
          spender: addr(msg["spender"]),
          deadline: uint(msg["sigDeadline"]),
          expiration,
          chainId,
          onChain: false,
        };
      }
      const single = primary === "PermitTransferFrom" || primary === "PermitWitnessTransferFrom";
      const permitted = single ? [msg["permitted"]] : msg["permitted"];
      if (!Array.isArray(permitted) || permitted.length === 0 || !permitted.every(isObject)) return malformedTyped();
      const tokens = [];
      for (const p of permitted as Record<string, unknown>[]) {
        const amount = uint(p["amount"]);
        tokens.push({ token: stripKind(await tokenRef(ctx, addr(p["token"]))), amount, unlimited: isUnlimited(amount) });
      }
      uint(msg["nonce"]);
      return {
        kind: "permit",
        standard: primary.includes("Witness") ? "permit2-witness-transfer" : "permit2-transfer",
        tokens,
        spender: addr(msg["spender"]),
        deadline: uint(msg["deadline"]),
        chainId,
        onChain: false,
      };
    }
    if (primary === "SafeTx" && verifying) {
      const target = addr(msg["to"]);
      const operation = Number(uint(msg["operation"] ?? 0, 8));
      const value = uint(msg["value"] ?? 0);
      const data = (typeof msg["data"] === "string" && isHex(msg["data"]) ? msg["data"] : "0x") as Hex;
      return safeExec(verifying, target, value, data, operation, { ...ctx, chainId: chainId ?? ctx.chainId }, 0, { calls: 0 });
    }
  } catch {
    return malformedTyped();
  }
  return unknownAction("signature", `unrecognised typed data (${primary})`, "reason.typed-unknown", { primaryType: primary.slice(0, 80) }, { to: verifying, facts });
}

// --- personal_sign / eth_sign ----------------------------------------------------------------------------------------

function isPrintable(text: string): boolean {
  return text.length > 0 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f�]/.test(text);
}

const SIWE_HEADER = / wants you to sign in with your Ethereum account:\r?\n/;

/** Decodes `personal_sign` params ([message, address], or the common reversed order). Never throws. */
export function decodePersonalSign(params: unknown[]): Action {
  const [a, b] = params as [unknown, unknown];
  const isAddr = (v: unknown) => typeof v === "string" && isAddress(v, { strict: false });
  // Spec order is [message, address]; only swap when the first is an address and the second is not.
  const message = isAddr(a) && typeof b === "string" && !isAddr(b) ? b : a;
  if (typeof message !== "string") return unknownAction("signature", "message is not a string", "reason.message-not-string", {}, { malformed: true });
  let text = message;
  if (isHex(message)) {
    if (message.length % 2 === 0 && size(message) === 32) return { kind: "raw-hash-sign", hash: message };
    try {
      text = hexToString(message);
    } catch {
      return unknownAction("signature", "message is not UTF-8", "reason.message-not-utf8", {}, { malformed: true });
    }
  }
  if (!isPrintable(text)) {
    return isHex(message) ? { kind: "raw-hash-sign", hash: message } : unknownAction("signature", "message is not readable text", "reason.message-unreadable", {}, { malformed: true });
  }
  if (SIWE_HEADER.test(text)) return decodeSiwe(text);
  return { kind: "message", text: text.length > 2000 ? `${text.slice(0, 2000)}…` : text };
}

/** EIP-4361. A message that claims to be a sign-in request but does not parse is reported, never shown as plain text. */
function decodeSiwe(text: string): Action {
  const claimed = text.split(/\r?\n/)[0]?.replace(/ wants you to sign in with your Ethereum account:$/, "").replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "") ?? null;
  if (text.includes("\r\n")) return { kind: "siwe-invalid", claimedDomain: claimed, reason: "uses CRLF line endings" };
  let siwe: ReturnType<typeof parseSiweMessage>;
  try {
    siwe = parseSiweMessage(text);
  } catch {
    return { kind: "siwe-invalid", claimedDomain: claimed, reason: "does not parse" };
  }
  const missing = (["domain", "address", "uri", "version", "chainId", "nonce", "issuedAt"] as const).find((k) => siwe[k] === undefined || siwe[k] === "");
  if (missing) return { kind: "siwe-invalid", claimedDomain: claimed, reason: `missing ${missing}` };
  if (siwe.issuedAt && Number.isNaN(siwe.issuedAt.getTime())) return { kind: "siwe-invalid", claimedDomain: claimed, reason: "invalid Issued At" };
  return {
    kind: "siwe",
    domain: siwe.domain!,
    address: siwe.address!,
    uri: siwe.uri ?? null,
    chainId: siwe.chainId ?? null,
    statement: siwe.statement ?? null,
  };
}

export function decodeEthSign(params: unknown[]): Action {
  const hash = params.find((p) => typeof p === "string" && isHex(p) && !isAddress(p, { strict: false })) as Hex | undefined;
  return { kind: "eth-sign", hash: hash ?? "0x" };
}

/** The contract a decoded action calls (what the extension checks against the release), if any. */
export function targetOf(action: Action): Address | null {
  switch (action.kind) {
    case "native-transfer":
      return action.to;
    case "erc20-transfer":
    case "erc20-approve":
    case "erc20-increase-allowance":
    case "token-transfer-from":
      return action.token.address;
    case "nft-transfer":
    case "nft-batch-transfer":
    case "nft-approve":
    case "nft-approval-for-all":
      return action.collection.address;
    case "safe-exec":
      return action.safe;
    case "contract-call":
    case "unknown":
      return action.to;
    case "sign-transaction":
      return targetOf(action.inner);
    default:
      return null;
  }
}

import { isAddress } from "viem";
import { decodeCalls, decodeEthSign, decodePersonalSign, decodeTransaction, decodeTypedData, parseTypedData, targetOf, typedDataChainId, unknownAction } from "./decode.js";
import { explainAll } from "./explain.js";
import { assess, type AssessOptions } from "./risk.js";
import type { Action, Assessment, DecodeContext, Explanation, Lang, TxRequest } from "./types.js";

export * from "./types.js";
export * from "./abis.js";
export * from "./format.js";
export * from "./decode.js";
export * from "./risk.js";
export * from "./explain.js";
export * from "./i18n.js";
export { clearSignFormat } from "./clearsign.js";

/** Wallet methods Pramaan pauses for review. Everything else passes straight through to the wallet. */
export const GUARDED_METHODS = [
  "eth_sendTransaction",
  "eth_signTransaction",
  "eth_signTypedData_v4",
  "eth_signTypedData_v3",
  "eth_signTypedData",
  "personal_sign",
  "eth_sign",
  "wallet_sendCalls",
] as const;
export type GuardedMethod = (typeof GUARDED_METHODS)[number];

export function isGuardedMethod(method: string): method is GuardedMethod {
  return (GUARDED_METHODS as readonly string[]).includes(method);
}

export interface RequestAnalysis {
  method: GuardedMethod;
  action: Action;
  assessment: Assessment;
  explanations: Record<Lang, Explanation>;
  target: `0x${string}` | null;
  /** The chain the request is for (EIP-712 domain, wallet_sendCalls chainId, tx chainId or the wallet's chain). */
  chainId: number;
}

function chainNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^(0x[0-9a-fA-F]+|[0-9]+)$/.test(value)) {
    const n = Number(BigInt(value));
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }
  return null;
}

/** The typed-data payload is whichever param is an object or a JSON object string (dApps disagree on the order). */
function typedPayload(params: unknown[]): unknown {
  const candidates = params.filter((p) => (typeof p === "string" && !isAddress(p, { strict: false })) || (typeof p === "object" && p !== null));
  return candidates.find((p) => typeof p === "object" || (typeof p === "string" && p.trim().startsWith("{"))) ?? candidates[0];
}

/**
 * Decodes, assesses and explains one guarded wallet request in all three languages. Never throws: malformed or
 * unexpected input becomes an "unknown" action with a reason, which is never rated below "medium".
 */
export async function analyzeRequest(method: GuardedMethod, rawParams: unknown, ctx: DecodeContext): Promise<RequestAnalysis> {
  const params = Array.isArray(rawParams) ? rawParams : rawParams === undefined || rawParams === null ? [] : [rawParams];
  let action: Action;
  let target: `0x${string}` | null = null;
  let requestChainId = ctx.chainId;
  const opts: AssessOptions = {};
  try {
    switch (method) {
      case "eth_sendTransaction":
      case "eth_signTransaction": {
        const tx = (params[0] ?? null) as TxRequest | null;
        const decoded = await decodeTransaction(tx as TxRequest, ctx);
        action = method === "eth_signTransaction" ? { kind: "sign-transaction", inner: decoded } : decoded;
        target = tx && typeof tx.to === "string" && isAddress(tx.to, { strict: false }) ? (tx.to as `0x${string}`) : null;
        requestChainId = chainNumber(tx?.chainId) ?? ctx.chainId;
        break;
      }
      case "eth_signTypedData_v4":
      case "eth_signTypedData_v3":
      case "eth_signTypedData": {
        const payload = typedPayload(params);
        action = await decodeTypedData(payload, ctx);
        const td = Array.isArray(payload) ? null : parseTypedData(payload);
        try {
          requestChainId = (td && typedDataChainId(td)) ?? ctx.chainId;
        } catch {
          requestChainId = ctx.chainId;
        }
        target = action.kind === "permit" ? (action.tokens[0]?.token.address ?? null) : targetOf(action);
        break;
      }
      case "personal_sign":
        action = decodePersonalSign(params);
        opts.chainBound = false;
        break;
      case "eth_sign":
        action = decodeEthSign(params);
        opts.chainBound = false;
        break;
      case "wallet_sendCalls": {
        const req = (params[0] ?? {}) as { calls?: unknown; chainId?: unknown };
        action = await decodeCalls(req && typeof req === "object" ? req.calls : undefined, ctx);
        requestChainId = chainNumber(req?.chainId) ?? ctx.chainId;
        target = targetOf(action);
        break;
      }
      default:
        action = unknownAction("transaction", "unsupported method", "reason.no-params");
    }
  } catch (err) {
    action = unknownAction(method === "personal_sign" || method === "eth_sign" || method.startsWith("eth_signTypedData") ? "signature" : "transaction", `decoder error: ${(err as Error)?.message ?? String(err)}`, "reason.internal", {}, { malformed: true });
  }
  opts.requestChainId = requestChainId;
  let assessment: Assessment;
  try {
    assessment = await assess(action, ctx, opts);
  } catch {
    assessment = { level: "high", findings: [{ code: "MALFORMED_REQUEST", level: "high", params: {} }] };
  }
  return { method, action, assessment, explanations: explainAll(action, assessment, ctx), target: target ?? targetOf(action), chainId: requestChainId };
}

/** JSON-safe copy of an analysis (bigint -> decimal string), for extension messaging. */
export function toJsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) as T;
}

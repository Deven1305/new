import type { Action, Address, Assessment, DecodeContext, RiskCode, RiskFinding, RiskLevel } from "./types.js";
import { RISK_ORDER } from "./types.js";
import { safeCall } from "./decode.js";

/**
 * Findings that contradict the verified release itself (not merely risky actions). The extension fails closed on
 * these: signing is blocked unless the user explicitly overrides with a warning.
 */
export const BLOCKING_CODES: ReadonlySet<RiskCode> = new Set<RiskCode>(["SPENDER_NOT_IN_RELEASE", "WRONG_CHAIN"]);

/** A permit or allowance that outlives this horizon counts as long-lived. */
export const LONG_DEADLINE_SECONDS = 365n * 24n * 3600n;

function maxLevel(levels: RiskLevel[]): RiskLevel {
  return levels.reduce<RiskLevel>((acc, l) => (RISK_ORDER[l] > RISK_ORDER[acc] ? l : acc), "info");
}

async function isEoa(ctx: DecodeContext, address: string): Promise<boolean> {
  const result = await safeCall(() => ctx.isContract?.(address as Address));
  return result === false;
}

/** host[:port] of an origin with the scheme's default port dropped. */
function authority(value: string): string | null {
  try {
    const u = new URL(value.includes("://") ? value : `https://${value}`);
    return u.host.toLowerCase();
  } catch {
    return null;
  }
}

function originOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin.toLowerCase() : null;
  } catch {
    return null;
  }
}

function baseLevel(action: Action): RiskLevel {
  switch (action.kind) {
    case "native-transfer":
    case "erc20-transfer":
    case "token-transfer-from":
    case "nft-transfer":
    case "nft-batch-transfer":
      return "low";
    case "contract-call":
      return action.value > 0n ? "low" : "info";
    default:
      return "info";
  }
}

export interface AssessOptions {
  /** Chain the request is for (EIP-712 domain, wallet_sendCalls chainId, or the wallet's chain). */
  requestChainId?: number | null;
  /** false for plain messages: they are not bound to a chain. */
  chainBound?: boolean;
}

/**
 * Fixed, auditable rules. The level of an action is the highest level of its findings. Nothing here is decided by
 * a model; an AI explanation layer may only rephrase these results, never lower them.
 */
export async function assess(action: Action, ctx: DecodeContext, opts: AssessOptions = {}): Promise<Assessment> {
  const findings: RiskFinding[] = [];
  const add = (code: RiskCode, level: RiskLevel, params: Record<string, string> = {}) => findings.push({ code, level, params });
  const release = ctx.release;
  const chain = opts.requestChainId ?? ctx.chainId;
  const inRelease = (a: string) =>
    !!release?.contracts.some((c) => c.address.toLowerCase() === a.toLowerCase() && (c.chainId === chain || c.chainId === ctx.chainId));
  const isSelf = (a: string) => !!ctx.from && ctx.from.toLowerCase() === a.toLowerCase();
  const now = BigInt(Math.floor(ctx.now ?? Date.now() / 1000));

  if (release && release.chainIds.length > 0 && opts.chainBound !== false && chain && !release.chainIds.includes(chain)) {
    add("WRONG_CHAIN", "high", { chain: String(chain), expected: release.chainIds.join(", ") });
  }

  const checkSpender = async (spender: Address, token?: { address: Address; amount: bigint; unlimited: boolean; decimals: number | null }) => {
    if (release && !inRelease(spender)) add("SPENDER_NOT_IN_RELEASE", "high", { spender });
    if (await isEoa(ctx, spender)) add("APPROVAL_TO_EOA", "high");
    if (token && !token.unlimited && token.amount > 0n && ctx.balanceOf && ctx.from) {
      const from = ctx.from;
      const balanceOf = ctx.balanceOf;
      const balance = await safeCall(() => balanceOf(token.address, from));
      if (typeof balance === "bigint" && token.amount >= balance) add("LARGE_APPROVAL", "medium", { balanceRaw: balance.toString(), decimals: String(token.decimals ?? "") });
    }
  };
  const checkLongLived = (value: bigint | null | undefined, kind: "deadline" | "expiration") => {
    if (value === undefined) return;
    if (value === null || value >= now + LONG_DEADLINE_SECONDS) add("LONG_DEADLINE", "medium", { which: kind });
  };

  const walk = async (a: Action, depth: number): Promise<void> => {
    switch (a.kind) {
      case "erc20-approve":
      case "erc20-increase-allowance":
        if (a.kind === "erc20-approve" && a.amount === 0n) add("REVOKE", "info");
        else {
          if (a.unlimited) add("UNLIMITED_APPROVAL", "high");
          await checkSpender(a.spender, { address: a.token.address, amount: a.amount, unlimited: a.unlimited, decimals: a.token.decimals });
        }
        break;
      case "nft-approve":
        await checkSpender(a.spender);
        break;
      case "nft-approval-for-all":
        if (!a.approved) add("REVOKE", "info");
        else {
          add("APPROVE_ALL_NFTS", "high");
          await checkSpender(a.operator);
        }
        break;
      case "permit": {
        const unlimited = a.tokens.some((t) => t.unlimited);
        if (a.onChain) {
          if (unlimited) add("UNLIMITED_APPROVAL", "high");
        } else if (unlimited) add("UNLIMITED_PERMIT", "high");
        else add("OFFCHAIN_PERMIT", "medium");
        const first = a.tokens[0];
        await checkSpender(a.spender, a.tokens.length === 1 && first ? { address: first.token.address, amount: first.amount, unlimited: first.unlimited, decimals: first.token.decimals } : undefined);
        if (a.standard !== "permit2-approve") {
          if (a.deadline !== null && a.deadline < now) add("EXPIRED_PERMIT", "info");
          else checkLongLived(a.deadline, "deadline");
        }
        // Permit2 expiration 0 means "this block only", which is short-lived.
        if (a.expiration !== undefined && a.expiration !== 0n) checkLongLived(a.expiration, "expiration");
        if (a.chainId !== undefined && a.chainId !== null && ctx.chainId && a.chainId !== ctx.chainId) {
          add("TYPED_DATA_CHAIN_MISMATCH", "high", { chain: String(a.chainId), walletChain: String(ctx.chainId) });
        }
        break;
      }
      case "safe-exec":
        if (a.operation === 1 && !a.multisend) add("SAFE_DELEGATECALL", "critical", { target: a.target });
        if (a.operation === 1 && a.multisend && !a.inner) add("UNPARSED_BATCH", "medium");
        if (a.inner) {
          if (depth >= 0 && release && a.operation === 0 && !inRelease(a.target) && a.inner.kind !== "native-transfer") add("CALL_TARGET_NOT_IN_RELEASE", "medium", { target: a.target });
          await walk(a.inner, depth + 1);
        }
        break;
      case "delegatecall":
        add("SAFE_DELEGATECALL", "critical", { target: a.target });
        break;
      case "eip7702-authorization":
        add("EIP7702_DELEGATION", "critical");
        break;
      case "batch": {
        let unknown = false;
        for (const [i, call] of a.calls.entries()) {
          const target = a.targets[i] ?? null;
          if (release && target && call.kind !== "native-transfer" && !inRelease(target)) add("CALL_TARGET_NOT_IN_RELEASE", "medium", { target });
          if (call.kind === "unknown") {
            unknown = true;
            if (call.malformed) add("MALFORMED_REQUEST", "medium");
          } else await walk(call, depth + 1);
        }
        if (unknown) add("UNPARSED_BATCH", "medium");
        break;
      }
      case "erc20-transfer":
        if (a.to.toLowerCase() === a.token.address.toLowerCase()) add("TRANSFER_TO_TOKEN_CONTRACT", "medium");
        if (release && !inRelease(a.to) && !isSelf(a.to)) add("RECIPIENT_NOT_IN_RELEASE", "medium", { to: a.to });
        break;
      case "token-transfer-from":
      case "nft-transfer":
      case "nft-batch-transfer":
        if (release && !inRelease(a.to) && !isSelf(a.to)) add("RECIPIENT_NOT_IN_RELEASE", "medium", { to: a.to });
        break;
      case "native-transfer":
        if (release && !inRelease(a.to) && !isSelf(a.to)) add("RECIPIENT_NOT_IN_RELEASE", "medium", { to: a.to });
        break;
      case "contract-deployment":
        add("CONTRACT_DEPLOYMENT", "medium");
        break;
      case "sign-transaction":
        add("SIGN_ONLY_TRANSACTION", "medium");
        await walk(a.inner, depth);
        break;
      case "siwe": {
        const host = ctx.origin ? authority(ctx.origin) : null;
        const domain = authority(a.domain);
        if (host && domain !== host) add("SIWE_DOMAIN_MISMATCH", "high", { domain: a.domain, origin: host });
        const page = originOf(ctx.origin);
        const uri = originOf(a.uri);
        if (page && uri && uri !== page) add("SIWE_URI_MISMATCH", "high", { uri: a.uri ?? "", origin: page });
        if (ctx.from && a.address.toLowerCase() !== ctx.from.toLowerCase()) add("SIWE_ADDRESS_MISMATCH", "medium", { address: a.address });
        break;
      }
      case "siwe-invalid": {
        add("SIWE_MALFORMED", "medium", { reason: a.reason });
        const host = ctx.origin ? authority(ctx.origin) : null;
        if (host && a.claimedDomain && authority(a.claimedDomain) !== host) add("SIWE_DOMAIN_MISMATCH", "high", { domain: a.claimedDomain, origin: host });
        break;
      }
      case "raw-hash-sign":
        add("RAW_HASH_SIGNATURE", "high");
        break;
      case "eth-sign":
        add("ETH_SIGN", "critical");
        break;
      case "unknown":
        add("UNKNOWN_ACTION", "medium");
        if (a.malformed) add("MALFORMED_REQUEST", a.subject === "signature" ? "high" : "medium");
        break;
      default:
        break;
    }
  };
  await walk(action, 0);

  // Deduplicate identical codes from nested calls, keeping the highest level.
  const byCode = new Map<string, RiskFinding>();
  for (const f of findings) {
    const prev = byCode.get(f.code);
    if (!prev || RISK_ORDER[f.level] > RISK_ORDER[prev.level]) byCode.set(f.code, f);
  }
  const unique = [...byCode.values()];
  return { level: maxLevel([baseLevel(action), ...unique.map((f) => f.level)]), findings: unique };
}

/** True when any finding contradicts the verified release (the extension blocks signing on these). */
export function contradictsRelease(assessment: Assessment): boolean {
  return assessment.findings.some((f) => BLOCKING_CODES.has(f.code));
}

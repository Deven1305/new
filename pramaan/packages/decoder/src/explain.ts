import { formatDeadline, formatTokenAmount, formatUnitsExact, labelAddress, shortAddress, tokenName } from "./format.js";
import { riskKey, t } from "./i18n.js";
import type { Action, Assessment, DecodeContext, Explanation, Lang, RiskFinding } from "./types.js";

const LANGS: Lang[] = ["en", "hi", "mr"];

function nativeSymbol(ctx: DecodeContext): string {
  return ctx.nativeSymbol ?? "ETH";
}

/** Placeholder values shared by an action's headline and its risk texts. Every value comes from decoded fields. */
function placeholders(action: Action, lang: Lang, ctx: DecodeContext): Record<string, string> {
  const L = (a: string) => labelAddress(a as `0x${string}`, ctx.labels);
  switch (action.kind) {
    case "native-transfer":
      return { to: L(action.to), amount: formatUnitsExact(action.amount, 18, lang), symbol: nativeSymbol(ctx) };
    case "erc20-transfer":
      return { to: L(action.to), amount: formatTokenAmount(action.amount, action.token, lang), token: tokenName(action.token) };
    case "erc20-approve":
    case "erc20-increase-allowance":
      return {
        spender: L(action.spender),
        amount: formatTokenAmount(action.amount, action.token, lang, action.unlimited),
        token: tokenName(action.token),
      };
    case "token-transfer-from":
      return { from: L(action.from), to: L(action.to), amount: formatTokenAmount(action.amount, action.token, lang), token: tokenName(action.token) };
    case "nft-transfer":
      return { collection: tokenName(action.collection), tokenId: action.tokenId.toString(), to: L(action.to) };
    case "nft-batch-transfer":
      return { collection: tokenName(action.collection), count: String(action.ids.length), to: L(action.to) };
    case "nft-approve":
      return { collection: tokenName(action.collection), tokenId: action.tokenId.toString(), spender: L(action.spender) };
    case "nft-approval-for-all":
      return { collection: tokenName(action.collection), operator: L(action.operator), spender: L(action.operator) };
    case "permit": {
      const first = action.tokens[0];
      const tokens = action.tokens.map((x) => tokenName(x.token)).join(", ");
      return {
        spender: L(action.spender),
        token: tokens || "tokens",
        amount: first ? formatTokenAmount(first.amount, first.token, lang, first.unlimited) : "?",
        deadline:
          action.standard === "permit2-approve"
            ? action.expiration === 0n
              ? t(lang, "detail.this-block")
              : formatDeadline(action.expiration ?? null, lang)
            : formatDeadline(action.deadline, lang),
      };
    }
    case "safe-exec":
      return { target: L(action.target), amount: formatUnitsExact(action.value, 18, lang), symbol: nativeSymbol(ctx) };
    case "delegatecall":
      return { target: L(action.target) };
    case "eip7702-authorization":
      return { delegate: action.delegates.map((d) => L(d)).join(", ") || "?" };
    case "batch":
      return { count: String(action.calls.length) };
    case "contract-call":
      return {
        function: action.functionName,
        contract: action.label ? `${action.label} (${shortAddress(action.to)})` : shortAddress(action.to),
        amount: formatUnitsExact(action.value, 18, lang),
        symbol: nativeSymbol(ctx),
      };
    case "contract-deployment":
      return { size: String(action.bytecodeSize), amount: formatUnitsExact(action.value, 18, lang), symbol: nativeSymbol(ctx) };
    case "sign-transaction":
      return { ...placeholders(action.inner, lang, ctx), inner: headline(action.inner, lang, ctx) };
    case "siwe":
      return { domain: action.domain, address: shortAddress(action.address) };
    case "siwe-invalid":
      return { domain: action.claimedDomain ?? "?" };
    case "message":
      return { text: action.text };
    case "raw-hash-sign":
    case "eth-sign":
      return { hash: action.hash };
    case "unknown":
      return { reason: reasonText(action, lang) };
  }
}

function reasonText(action: Extract<Action, { kind: "unknown" }>, lang: Lang): string {
  return action.reasonKey ? t(lang, action.reasonKey, action.reasonParams ?? {}) : action.reason;
}

export function headlineKey(action: Action): string {
  switch (action.kind) {
    case "erc20-approve":
      if (action.amount === 0n) return "action.erc20-approve.revoke";
      return action.unlimited ? "action.erc20-approve.unlimited" : "action.erc20-approve";
    case "nft-approval-for-all":
      return action.approved ? "action.nft-approval-for-all" : "action.nft-approval-for-all.revoke";
    case "permit":
      if (action.onChain) return "action.permit.onchain";
      return action.tokens.some((x) => x.unlimited) ? "action.permit.unlimited" : "action.permit";
    case "safe-exec":
      if (action.operation === 1) return action.multisend ? "action.safe-exec.multisend" : "action.safe-exec.delegatecall";
      return "action.safe-exec";
    case "unknown":
      return `action.unknown.${action.subject}`;
    default:
      return `action.${action.kind}`;
  }
}

function headline(action: Action, lang: Lang, ctx: DecodeContext): string {
  return t(lang, headlineKey(action), placeholders(action, lang, ctx));
}

/** Nested actions are listed as "1.", "1.2." ... so every call in a batch is visible. */
function nestedLines(action: Action, lang: Lang, ctx: DecodeContext, prefix: string, out: string[], depth = 0): void {
  if (action.kind !== "batch" || depth > 6) return;
  action.calls.forEach((call, i) => {
    const index = `${prefix}${i + 1}`;
    out.push(t(lang, "detail.batch-item", { index, inner: headline(call, lang, ctx) }));
    if (call.kind === "batch") nestedLines(call, lang, ctx, `${index}.`, out, depth + 1);
    if (call.kind === "safe-exec" && call.inner?.kind === "batch") nestedLines(call.inner, lang, ctx, `${index}.`, out, depth + 1);
  });
}

function details(action: Action, lang: Lang, ctx: DecodeContext): string[] {
  const out: string[] = [];
  switch (action.kind) {
    case "contract-call":
      if (action.descriptorIntent) out.push(t(lang, "detail.descriptor", { intent: action.descriptorIntent }));
      for (const arg of action.args) out.push(t(lang, "detail.argument", { name: arg.name, value: arg.value }));
      if (action.value > 0n) out.push(t(lang, "detail.value", placeholders(action, lang, ctx)));
      break;
    case "safe-exec":
      if (action.inner) out.push(t(lang, "detail.safe-inner", { inner: headline(action.inner, lang, ctx) }));
      if (action.inner?.kind === "batch") nestedLines(action.inner, lang, ctx, "", out);
      if (action.value > 0n) out.push(t(lang, "detail.value", placeholders(action, lang, ctx)));
      break;
    case "batch":
      nestedLines(action, lang, ctx, "", out);
      break;
    case "nft-batch-transfer":
      out.push(t(lang, "detail.nft-ids", { list: action.ids.map((id, i) => `#${id} × ${action.amounts[i] ?? 0n}`).join(", ") }));
      break;
    case "permit":
      if (action.standard !== "permit2-approve" && action.expiration !== undefined && action.expiration !== null) {
        out.push(t(lang, "detail.permit-expiration", { expiration: action.expiration === 0n ? t(lang, "detail.this-block") : formatDeadline(action.expiration, lang) }));
      }
      if (action.chainId) out.push(t(lang, "fact.typed.chain", { chain: String(action.chainId) }));
      break;
    case "contract-deployment":
      out.push(t(lang, "detail.codehash", { codehash: action.codehash }));
      if (action.value > 0n) out.push(t(lang, "detail.value", placeholders(action, lang, ctx)));
      break;
    case "sign-transaction":
      out.push(...details(action.inner, lang, ctx));
      break;
    case "siwe":
      if (action.uri) out.push(t(lang, "detail.siwe-uri", { uri: action.uri }));
      if (action.chainId !== null) out.push(t(lang, "fact.typed.chain", { chain: String(action.chainId) }));
      if (action.statement) out.push(t(lang, "detail.message", { text: action.statement }));
      break;
    case "siwe-invalid":
      out.push(t(lang, "detail.unknown", { reason: action.reason }));
      break;
    case "message":
      out.push(t(lang, "detail.message", { text: action.text }));
      break;
    case "unknown":
      out.push(t(lang, "detail.unknown", { reason: reasonText(action, lang) }));
      for (const f of action.facts ?? []) out.push(t(lang, f.key, f.params));
      if (action.selector) out.push(t(lang, "detail.selector", { selector: action.selector }));
      if (action.value > 0n) out.push(t(lang, "detail.value", { amount: formatUnitsExact(action.value, 18, lang), symbol: nativeSymbol(ctx) }));
      break;
    default:
      break;
  }
  return out;
}

/** For nested actions (Safe inner call, batch item), find the sub-action a finding most likely came from. */
function innermost(action: Action, code: RiskFinding["code"]): Action | null {
  const wants: Partial<Record<RiskFinding["code"], Action["kind"][]>> = {
    UNLIMITED_APPROVAL: ["erc20-approve", "erc20-increase-allowance", "permit"],
    UNLIMITED_PERMIT: ["permit"],
    OFFCHAIN_PERMIT: ["permit"],
    LONG_DEADLINE: ["permit"],
    LARGE_APPROVAL: ["erc20-approve", "erc20-increase-allowance", "permit"],
    APPROVAL_TO_EOA: ["erc20-approve", "erc20-increase-allowance", "nft-approve", "nft-approval-for-all", "permit"],
    SPENDER_NOT_IN_RELEASE: ["erc20-approve", "erc20-increase-allowance", "nft-approve", "nft-approval-for-all", "permit"],
    APPROVE_ALL_NFTS: ["nft-approval-for-all"],
    TRANSFER_TO_TOKEN_CONTRACT: ["erc20-transfer"],
    RECIPIENT_NOT_IN_RELEASE: ["erc20-transfer", "token-transfer-from", "nft-transfer", "nft-batch-transfer", "native-transfer"],
    REVOKE: ["erc20-approve", "nft-approval-for-all"],
    SAFE_DELEGATECALL: ["safe-exec", "delegatecall"],
  };
  const kinds = wants[code];
  if (!kinds) return null;
  const visit = (a: Action): Action | null => {
    if (kinds.includes(a.kind) && !(a.kind === "safe-exec" && a.operation !== 1)) return a;
    if (a.kind === "safe-exec" && a.inner) return visit(a.inner);
    if (a.kind === "sign-transaction") return visit(a.inner);
    if (a.kind === "batch") for (const c of a.calls) { const hit = visit(c); if (hit) return hit; }
    return null;
  };
  return visit(action);
}

/** Placeholders for a risk text: the action's own values plus anything the rule attached (e.g. SIWE domains). */
function riskText(finding: RiskFinding, action: Action, lang: Lang, ctx: DecodeContext): string {
  const base = innermost(action, finding.code) ?? action;
  const params: Record<string, string> = { ...placeholders(base, lang, ctx) };
  for (const [k, v] of Object.entries(finding.params)) {
    params[k] = /^0x[0-9a-fA-F]{40}$/.test(v) ? labelAddress(v as `0x${string}`, ctx.labels) : v;
  }
  if (finding.code === "LARGE_APPROVAL") {
    const decimals = finding.params["decimals"] ? Number(finding.params["decimals"]) : null;
    const raw = BigInt(finding.params["balanceRaw"] ?? "0");
    params["balance"] = decimals === null ? `${raw} ${lang === "en" ? "base units" : "units"}` : formatUnitsExact(raw, decimals, lang);
  }
  if (finding.code === "LONG_DEADLINE") params["which"] = t(lang, finding.params["which"] === "expiration" ? "word.expiration" : "word.deadline");
  if (finding.code === "SIWE_MALFORMED") params["reason"] = finding.params["reason"] ?? "";
  return t(lang, riskKey(finding.code), params);
}

export function explain(action: Action, assessment: Assessment, lang: Lang, ctx: DecodeContext): Explanation {
  return {
    lang,
    headline: headline(action, lang, ctx),
    details: details(action, lang, ctx),
    risks: assessment.findings.map((f) => ({ level: f.level, code: f.code, text: riskText(f, action, lang, ctx) })),
    level: assessment.level,
  };
}

export function explainAll(action: Action, assessment: Assessment, ctx: DecodeContext): Record<Lang, Explanation> {
  return Object.fromEntries(LANGS.map((lang) => [lang, explain(action, assessment, lang, ctx)])) as Record<Lang, Explanation>;
}

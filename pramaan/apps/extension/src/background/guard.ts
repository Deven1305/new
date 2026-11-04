import { parseAbi, type PublicClient } from "viem";
import { analyzeRequest, isGuardedMethod, toJsonSafe, type DecodeContext, type RequestAnalysis, type TokenInfo } from "@pramaan/decoder";
import { actionRow, combine, compareContract, contractRow, inspectAgreed, makeClients, privacyRow, siteRow, type VerdictRow } from "./verifier.js";
import type { GuardRequest, PendingView } from "../shared/messages.js";
import { loadSettings } from "../shared/settings.js";
import { chainConfig } from "./transport.js";
import { awaitVerification, getTab } from "./state.js";
import { leakList } from "./privacy.js";
import { decide as policyDecision, timeoutRow } from "../shared/policy.js";

const tokenAbi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
]);
const tokenCache = new Map<string, TokenInfo | null>();

async function tokenInfo(client: PublicClient, chainId: number, address: `0x${string}`): Promise<TokenInfo | null> {
  const key = `${chainId}:${address.toLowerCase()}`;
  if (tokenCache.has(key)) return tokenCache.get(key)!;
  const read = <T>(functionName: "symbol" | "decimals" | "name", args?: unknown[]) =>
    client.readContract({ address, abi: tokenAbi, functionName, args: args as never }).then((v) => v as T).catch(() => undefined);
  const supports = (id: `0x${string}`) =>
    client.readContract({ address, abi: tokenAbi, functionName: "supportsInterface", args: [id] }).catch(() => false);
  const [is721, is1155, symbol, decimals, name] = await Promise.all([
    supports("0x80ac58cd"),
    supports("0xd9b67a26"),
    read<string>("symbol"),
    read<number>("decimals"),
    read<string>("name"),
  ]);
  const info: TokenInfo | null =
    symbol === undefined && decimals === undefined && !is721 && !is1155
      ? null
      : { address, kind: is721 ? "erc721" : is1155 ? "erc1155" : decimals !== undefined ? "erc20" : "unknown", symbol, decimals: is721 ? undefined : decimals, name };
  tokenCache.set(key, info);
  return info;
}

interface Waiting {
  resolve: (d: "continue" | "reject") => void;
  windowId?: number;
  blocked: boolean;
}
const waiting = new Map<string, Waiting>();

function fallbackAnalysis(method: GuardRequest["method"], error: string): RequestAnalysis {
  const explanation = (lang: "en" | "hi" | "mr") => ({
    lang,
    headline: lang === "en" ? "Unable to confidently interpret this request." : lang === "hi" ? "इस अनुरोध को भरोसे के साथ समझा नहीं जा सका।" : "या विनंतीचा खात्रीने अर्थ लावता आला नाही.",
    details: [error],
    risks: [],
    level: "medium" as const,
  });
  return {
    method: method as RequestAnalysis["method"],
    action: { kind: "unknown", subject: "transaction", reason: error, selector: null, to: null, value: 0n },
    assessment: { level: "medium", findings: [{ code: "UNKNOWN_ACTION", level: "medium", params: {} }] },
    explanations: { en: explanation("en"), hi: explanation("hi"), mr: explanation("mr") },
    target: null,
    chainId: 0,
  };
}

/** Builds the verdict for one guarded request, shows it in an extension window and waits for the user. */
export async function handleGuard(port: chrome.runtime.Port, req: GuardRequest): Promise<void> {
  const reply = (decision: "continue" | "reject", reason: string) => {
    try {
      port.postMessage({ type: "decision", id: req.id, decision, reason });
    } catch {
      // page went away
    }
  };
  const tabId = port.sender?.tab?.id;
  if (tabId === undefined || !isGuardedMethod(req.method)) {
    reply("reject", "unexpected request");
    return;
  }
  const tab = await getTab(tabId);
  const finished = await awaitVerification(tabId, 30_000);
  if ((await getTab(tabId)) !== tab) { reply("reject", "page navigated during verification"); return; }
  const settings = await loadSettings();
  const chainId = req.chainId ? Number(req.chainId) : tab.release?.chainId ?? null;
  const cfg = chainId !== null && Number.isFinite(chainId) ? await chainConfig(chainId, settings) : null;
  const clients = cfg ? makeClients(cfg) : [];
  const client = clients[0];
  const manifest = tab.release?.status === "verified" ? tab.release.manifest : null;
  const ctx: DecodeContext = {
    chainId: chainId ?? 0,
    origin: tab.origin ?? undefined,
    nativeSymbol: "ETH",
    tokenInfo: client && chainId !== null ? (a) => tokenInfo(client, chainId, a) : undefined,
    isContract: client ? async (a) => ((await client.getCode({ address: a })) ?? "0x") !== "0x" : undefined,
    descriptors: tab.descriptors,
    labels: manifest ? Object.fromEntries(manifest.contracts.map((c) => [c.address.toLowerCase(), c.label])) : {},
  };
  let analysis: RequestAnalysis;
  try {
    analysis = await analyzeRequest(req.method, req.params, ctx);
  } catch (err) {
    analysis = fallbackAnalysis(req.method, (err as Error).message);
  }
  const local = chainId !== null && Boolean(settings.chains[String(chainId)]?.local);
  const rows: VerdictRow[] = [finished ? siteRow(tab.release, tab.site, { acceptSingleSource: local }) : timeoutRow(30_000)];
  if (analysis.target) {
    if (!cfg) rows.push(contractRow(null, `no RPC is configured for chain ${chainId ?? "unknown"}`));
    else {
      const insp = await inspectAgreed(cfg, analysis.target, clients);
      if (insp.status !== "ok") rows.push(contractRow(null, insp.detail));
      else if (manifest) rows.push(contractRow(compareContract(manifest, chainId!, insp.inspection)));
      else
        rows.push(
          contractRow({
            status: insp.inspection.kind === "eoa" ? "eoa" : "unlisted",
            address: insp.inspection.address,
            chainId: chainId!,
            label: null,
            detail: insp.inspection.kind === "eoa" ? "the recipient is a wallet" : "there is no verified release to compare this contract with",
          }),
        );
    }
  }
  rows.push(actionRow(analysis.assessment.level));
  rows.push(privacyRow(leakList(tab)));
  const verdict = combine(rows);
  const policy = policyDecision(rows, analysis.assessment, { timedOut: !finished });
  const blocked = verdict.blocked || policy.blocked || tab.status !== "done" || tab.release?.status !== "verified" || tab.site?.status !== "verified";

  const pending: PendingView = {
    id: req.id,
    tabId,
    origin: tab.origin ?? "",
    method: req.method,
    createdAt: new Date().toISOString(),
    state: "ready",
    blocked,
    blockReasons: policy.reasons,
    reads: tab.reads,
    verdictColor: verdict.color,
    rows,
    explanations: toJsonSafe(analysis.explanations),
    riskLevel: analysis.assessment.level,
    descriptorIntent: analysis.action.kind === "contract-call" ? analysis.action.descriptorIntent : null,
    target: analysis.target,
    chainId,
    raw: JSON.stringify(req.params, null, 2).slice(0, 6000),
  };
  await chrome.storage.session.set({ [`pending:${req.id}`]: pending });

  const decision = await new Promise<"continue" | "reject">((resolve) => {
    const entry: Waiting = { resolve, blocked };
    waiting.set(req.id, entry);
    port.onDisconnect.addListener(() => resolve("reject"));
    void chrome.windows
      .create({ url: chrome.runtime.getURL(`verdict.html?id=${encodeURIComponent(req.id)}`), type: "popup", width: 500, height: 780, focused: true })
      .then((w) => {
        entry.windowId = w?.id;
      })
      .catch(() => resolve("reject"));
  });
  const entry = waiting.get(req.id);
  waiting.delete(req.id);
  await chrome.storage.session.remove(`pending:${req.id}`);
  if (entry?.windowId !== undefined) void chrome.windows.remove(entry.windowId).catch(() => undefined);
  reply(
    decision,
    decision === "continue" ? "" : blocked ? "signing blocked: the website or contract does not match its published release" : "rejected in the Pramaan review window",
  );
}

/** Called by the verdict window. A blocked request can only be rejected. */
export function decide(id: string, decision: "continue" | "reject"): boolean {
  const w = waiting.get(id);
  if (!w) return false;
  if (decision === "continue" && w.blocked) return false;
  w.resolve(decision);
  return true;
}

export function onWindowRemoved(windowId: number): void {
  for (const w of waiting.values()) if (w.windowId === windowId) w.resolve("reject");
}

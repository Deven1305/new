import { parseAbi, type PublicClient } from "viem";
import { analyzeRequest, isGuardedMethod, toJsonSafe, type DecodeContext, type RequestAnalysis, type TokenInfo } from "@pramaan/decoder";
import { actionRow, combine, compareContract, contractRow, inspectAgreed, makeClients, privacyRow, type VerdictRow } from "./verifier.js";
import type { GuardRequest, PendingView } from "../shared/messages.js";
import { decide as policyDecide, refineContractRow, timeoutRow } from "../shared/policy.js";
import type { ReadRecord } from "../shared/rpc-log.js";
import { loadSettings } from "../shared/settings.js";
import { chainConfig } from "./transport.js";
import { awaitVerification, getTab, inflightFor, type TabState } from "./state.js";
import { leakList } from "./privacy.js";
import { tabSiteRow, verifyTab } from "./verify.js";

const tokenAbi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);
const tokenCache = new Map<string, TokenInfo | null>();

async function tokenInfo(client: PublicClient, chainId: number, address: `0x${string}`): Promise<TokenInfo | null> {
  const key = `${chainId}:${address.toLowerCase()}`;
  if (tokenCache.has(key)) return tokenCache.get(key)!;
  const read = <T>(functionName: "symbol" | "decimals" | "name") => client.readContract({ address, abi: tokenAbi, functionName }).then((v) => v as T).catch(() => undefined);
  const supports = (id: `0x${string}`) => client.readContract({ address, abi: tokenAbi, functionName: "supportsInterface", args: [id] }).catch(() => false);
  const [is721, is1155, symbol, decimals, name] = await Promise.all([supports("0x80ac58cd"), supports("0xd9b67a26"), read<string>("symbol"), read<number>("decimals"), read<string>("name")]);
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

async function savePending(p: PendingView): Promise<void> {
  await chrome.storage.session.set({ [`pending:${p.id}`]: p });
}

/** Builds rows and the decision for a request. Re-run when a verification that timed out finishes later. */
async function evaluate(tab: TabState, req: GuardRequest, timedOut: boolean, base: PendingView): Promise<PendingView> {
  const settings = await loadSettings();
  const reads: ReadRecord[] = [];
  const chainId = req.chainId ? Number(req.chainId) : (tab.release?.chainId ?? null);
  const cfg = chainId !== null && Number.isFinite(chainId) ? await chainConfig(chainId, settings, (r) => reads.push(r)) : null;
  const clients = cfg ? makeClients(cfg) : [];
  const client = clients[0];
  const manifest = tab.release?.status === "verified" ? tab.release.manifest : null;
  const privateReads = !!cfg && (/local|Anon-RPC/.test(cfg.transportLabel ?? ""));
  const from = (tab.accounts[0] ?? undefined) as `0x${string}` | undefined;
  const ctx: DecodeContext = {
    chainId: chainId ?? 0,
    from,
    origin: tab.origin ?? undefined,
    nativeSymbol: "ETH",
    tokenInfo: client && chainId !== null ? (a) => tokenInfo(client, chainId, a) : undefined,
    isContract: client ? async (a) => ((await client.getCode({ address: a })) ?? "0x") !== "0x" : undefined,
    // Reading your balance reveals your address to the RPC: only done on a local chain or through Anon-RPC.
    balanceOf: client && privateReads ? (token, owner) => client.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [owner] }) as Promise<bigint> : undefined,
    descriptors: tab.descriptors,
    labels: manifest ? Object.fromEntries(manifest.contracts.map((c) => [c.address.toLowerCase(), c.label])) : {},
    release: manifest ? { ensName: manifest.app.ensName, chainIds: [...new Set(manifest.contracts.map((c) => c.chainId))], contracts: manifest.contracts } : undefined,
  };
  const analysis: RequestAnalysis = await analyzeRequest(req.method as never, req.params, ctx);
  const rows: VerdictRow[] = [timedOut ? timeoutRow(settings.verificationWaitMs) : await tabSiteRow(tab)];
  if (analysis.target) {
    if (!cfg) rows.push(contractRow(null, `no RPC is configured for chain ${chainId ?? "unknown"}`));
    else {
      const insp = await inspectAgreed(cfg, analysis.target, clients);
      if (insp.status !== "ok") rows.push(contractRow(null, insp.detail));
      else if (manifest) {
        const check = compareContract(manifest, chainId!, insp.inspection);
        rows.push(refineContractRow(contractRow(check), check));
      } else
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
  const decision = policyDecide(rows, analysis.assessment, { timedOut });
  return {
    ...base,
    state: "ready",
    blocked: decision.blocked,
    blockReasons: decision.reasons,
    verdictColor: decision.blocked && verdict.color === "green" ? "amber" : verdict.color,
    rows,
    explanations: toJsonSafe(analysis.explanations),
    riskLevel: analysis.assessment.level,
    descriptorIntent: analysis.action.kind === "contract-call" ? analysis.action.descriptorIntent : null,
    target: analysis.target,
    chainId: analysis.chainId || chainId,
    reads,
  };
}

/** Shows the review window at once, waits (bounded) for verification, and fails closed on timeout. */
export async function handleGuard(port: chrome.runtime.Port, req: GuardRequest): Promise<void> {
  const reply = (decision: "continue" | "reject", reason: string) => {
    try {
      port.postMessage({ type: "decision", id: req.id, decision, reason });
    } catch {
      // page went away
    }
  };
  const tabId = port.sender?.tab?.id;
  if (tabId === undefined || !isGuardedMethod(req.method) || typeof req.id !== "string" || !/^[0-9a-f]{8,64}$/.test(req.id)) {
    reply("reject", "unexpected request");
    return;
  }
  const tab = await getTab(tabId);
  const settings = await loadSettings();
  let base: PendingView = {
    id: req.id,
    tabId,
    origin: tab.origin ?? "",
    method: req.method,
    createdAt: new Date().toISOString(),
    state: "checking",
    blocked: true,
    blockReasons: [],
    verdictColor: "amber",
    rows: [],
    explanations: null,
    riskLevel: null,
    descriptorIntent: null,
    target: null,
    chainId: req.chainId ? Number(req.chainId) : null,
    reads: [],
    raw: JSON.stringify(req.params, null, 2).slice(0, 6000),
  };
  await savePending(base);

  const entry: Waiting = { resolve: () => undefined, blocked: true };
  const decision = new Promise<"continue" | "reject">((resolve) => {
    entry.resolve = resolve;
    waiting.set(req.id, entry);
    port.onDisconnect.addListener(() => resolve("reject"));
  });
  // Keepalive messages from the content script keep this worker alive while the user reads the window.
  port.onMessage.addListener(() => undefined);
  void chrome.windows
    .create({ url: chrome.runtime.getURL(`verdict.html?id=${encodeURIComponent(req.id)}`), type: "popup", width: 500, height: 800, focused: true })
    .then((w) => {
      entry.windowId = w?.id;
      void chrome.storage.session.get(`pending:${req.id}`).then((s) => {
        const cur = s[`pending:${req.id}`] as PendingView | undefined;
        if (cur && w?.id !== undefined) void savePending({ ...cur, windowId: w.id });
      });
    })
    .catch(() => entry.resolve("reject"));

  void (async () => {
    // A verification cut off by a worker restart is started again rather than skipped.
    if (tab.status === "checking" && !inflightFor(tabId)) void verifyTab(tab);
    const finished = await awaitVerification(tabId, settings.verificationWaitMs);
    try {
      base = { ...(await evaluate(tab, req, !finished, base)), windowId: entry.windowId };
    } catch (err) {
      base = { ...base, state: "ready", blocked: true, blockReasons: ["verification-unknown"], rows: [timeoutRow(0)], raw: `${base.raw}\n\n${(err as Error).message}` };
    }
    entry.blocked = base.blocked;
    if (waiting.has(req.id)) await savePending(base);
    // Late completion: re-evaluate once so the block lifts (or stays) on the real result.
    if (!finished) {
      const p = inflightFor(tabId);
      if (p) {
        await p;
        if (!waiting.has(req.id)) return;
        base = { ...(await evaluate(tab, req, false, base)), windowId: entry.windowId };
        entry.blocked = base.blocked;
        await savePending(base);
      }
    }
  })();

  const result = await decision;
  waiting.delete(req.id);
  await chrome.storage.session.remove(`pending:${req.id}`);
  if (entry.windowId !== undefined) void chrome.windows.remove(entry.windowId).catch(() => undefined);
  reply(result, result === "continue" ? "" : entry.blocked ? "signing blocked: Pramaan could not confirm this site, contract and request against the signed release" : "rejected in the Pramaan review window");
}

/**
 * Called by the review window. While a request is blocked (or still being checked), "continue" is only accepted with
 * an explicit override, which the window shows behind a warning and a confirmation checkbox.
 */
export function decide(id: string, decision: "continue" | "reject", override = false): boolean {
  const w = waiting.get(id);
  if (!w) return false;
  if (decision === "continue" && w.blocked && !override) return false;
  w.resolve(decision);
  return true;
}

export function onWindowRemoved(windowId: number): void {
  for (const w of waiting.values()) if (w.windowId === windowId) w.resolve("reject");
}

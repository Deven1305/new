import { createPublicClient, defineChain, http, type Chain, type PublicClient } from "viem";
import { mainnet, sepolia } from "viem/chains";

export interface ChainConfig {
  chainId: number;
  name?: string;
  /** Independent RPC endpoints. With two or more, security-relevant reads must agree. */
  rpcUrls: string[];
  /** ENS Universal Resolver. Defaults to the address viem ships for Sepolia/mainnet; required for custom chains. */
  universalResolver?: `0x${string}`;
  nativeSymbol?: string;
  /** Custom fetch, e.g. the Anon-RPC worker's `fetch`, so the RPC provider cannot link reads to the user's IP. */
  fetchFn?: typeof fetch;
  /** Shown in the UI: "direct", "anon-rpc (nox)", ... */
  transportLabel?: string;
  /** Minimum number of agreeing RPCs. Defaults to 2 when two URLs are configured, else 1 (reported as single-source). */
  minAgreement?: number;
  timeoutMs?: number;
}

const KNOWN: Record<number, Chain> = { [sepolia.id]: sepolia, [mainnet.id]: mainnet };

export function chainFor(cfg: ChainConfig): Chain {
  const known = KNOWN[cfg.chainId];
  const ur = cfg.universalResolver ?? known?.contracts?.ensUniversalResolver?.address;
  return defineChain({
    id: cfg.chainId,
    name: cfg.name ?? known?.name ?? `chain-${cfg.chainId}`,
    nativeCurrency: known?.nativeCurrency ?? { name: "Ether", symbol: cfg.nativeSymbol ?? "ETH", decimals: 18 },
    rpcUrls: { default: { http: cfg.rpcUrls } },
    contracts: ur ? { ensUniversalResolver: { address: ur } } : {},
  });
}

export function makeClients(cfg: ChainConfig): PublicClient[] {
  if (cfg.rpcUrls.length === 0) throw new Error(`no RPC configured for chain ${cfg.chainId}`);
  const chain = chainFor(cfg);
  return cfg.rpcUrls.map(
    (url) =>
      createPublicClient({
        chain,
        transport: http(url, { fetchFn: cfg.fetchFn, timeout: cfg.timeoutMs ?? 15_000, retryCount: 1 }),
        batch: { multicall: false },
      }) as PublicClient,
  );
}

export function requiredAgreement(cfg: ChainConfig): number {
  return cfg.minAgreement ?? (cfg.rpcUrls.length >= 2 ? 2 : 1);
}

export type Agreed<T> =
  | { status: "agreed"; value: T; sources: number; singleSource: boolean }
  | { status: "disagree"; detail: string }
  | { status: "insufficient"; detail: string };

/**
 * Runs `read` against every client. The value counts only if at least `need` clients returned the SAME value and no
 * client returned a different one; one lying or failing RPC makes the read "unknown", never "verified".
 */
export async function agreed<T>(
  clients: PublicClient[],
  need: number,
  read: (client: PublicClient) => Promise<T>,
  key: (value: T) => string = (v) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)),
): Promise<Agreed<T>> {
  const settled = await Promise.allSettled(clients.map((c) => read(c)));
  const ok = settled.filter((s): s is PromiseFulfilledResult<Awaited<T>> => s.status === "fulfilled").map((s) => s.value as T);
  const failures = settled.filter((s) => s.status === "rejected").map((s) => String((s as PromiseRejectedResult).reason?.message ?? s));
  const distinct = new Set(ok.map(key));
  if (distinct.size > 1) return { status: "disagree", detail: `RPC endpoints returned ${distinct.size} different answers` };
  if (ok.length < need) {
    return { status: "insufficient", detail: `${ok.length} of ${need} required RPC answers (${failures.slice(0, 2).join("; ") || "no answer"})` };
  }
  return { status: "agreed", value: ok[0] as T, sources: ok.length, singleSource: ok.length < 2 };
}

const chainIdCache = new WeakMap<PublicClient, Promise<number>>();

/**
 * Every security-relevant read first confirms the endpoint really serves `expected` (eth_chainId). A misconfigured or
 * malicious RPC that serves another network makes the read fail, so it is counted as "unknown", never as an answer.
 */
export async function assertChainId(client: PublicClient, expected: number): Promise<void> {
  let p = chainIdCache.get(client);
  if (!p) {
    p = client.getChainId();
    chainIdCache.set(client, p);
    p.catch(() => chainIdCache.delete(client));
  }
  const actual = await p;
  if (actual !== expected) throw new Error(`RPC endpoint serves chain ${actual}, expected ${expected}`);
}

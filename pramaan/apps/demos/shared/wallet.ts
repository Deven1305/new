import { createPublicClient, createWalletClient, custom, defineChain, http, type Account, type Chain, type EIP1193Provider, type PublicClient, type Transport, type WalletClient } from "viem";
import { getConfig, type AppConfig } from "./config.js";

export type { EIP1193Provider } from "viem";

export interface WalletInfo {
  name: string;
  icon: string;
  rdns: string;
}
export interface DiscoveredWallet {
  info: WalletInfo;
  provider: EIP1193Provider;
}
export interface Connection {
  address: `0x${string}`;
  walletClient: WalletClient<Transport, Chain, Account>;
  publicClient: PublicClient;
}

interface Announce {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: EIP1193Provider;
}

/** The chain the app is configured for, as a viem Chain. */
export function chainOf(cfg: AppConfig = getConfig()): Chain {
  return defineChain({
    id: cfg.chainId,
    name: cfg.chainName,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
    ...(cfg.explorer ? { blockExplorers: { default: { name: "Explorer", url: cfg.explorer } } } : {}),
  });
}

let publicClientCache: PublicClient | null = null;
/** Read-only client over the configured RPC endpoint (the endpoint the release manifest declares as a third party). */
export function getPublicClient(): PublicClient {
  if (!publicClientCache) {
    const cfg = getConfig();
    publicClientCache = createPublicClient({ chain: chainOf(cfg), transport: http(cfg.rpcUrl) }) as PublicClient;
  }
  return publicClientCache;
}

/**
 * EIP-6963 discovery, with the legacy `window.ethereum` as a fallback when it did not announce itself.
 * Resolves after `waitMs` (wallets announce synchronously on request in practice).
 */
export function discoverWallets(waitMs = 250): Promise<DiscoveredWallet[]> {
  return new Promise((resolve) => {
    const found = new Map<string, DiscoveredWallet>();
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<Announce>).detail;
      if (!detail?.provider || !detail.info?.uuid || found.has(detail.info.uuid)) return;
      found.set(detail.info.uuid, { info: { name: detail.info.name, icon: detail.info.icon, rdns: detail.info.rdns }, provider: detail.provider });
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    window.setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      const list = [...found.values()];
      const legacy = (window as unknown as { ethereum?: EIP1193Provider & { isMetaMask?: boolean } }).ethereum;
      if (legacy && !list.some((w) => w.provider === legacy)) {
        list.push({ info: { name: legacy.isMetaMask ? "MetaMask" : "Injected wallet", icon: "", rdns: "window.ethereum" }, provider: legacy });
      }
      resolve(list);
    }, waitMs);
  });
}

// --- account / chain change subscriptions (they follow the provider passed to the latest connect()) ----------------

type Listener<T> = (value: T) => void;
const accountListeners = new Set<Listener<`0x${string}`[]>>();
const chainListeners = new Set<Listener<number>>();
let attached: EIP1193Provider | null = null;

function attach(provider: EIP1193Provider): void {
  if (attached === provider) return;
  attached = provider;
  provider.on("accountsChanged", (accounts: string[]) => accountListeners.forEach((cb) => cb(accounts as `0x${string}`[])));
  provider.on("chainChanged", (chainId: string) => chainListeners.forEach((cb) => cb(Number(chainId))));
}

export function onAccountsChanged(cb: Listener<`0x${string}`[]>): () => void {
  accountListeners.add(cb);
  return () => accountListeners.delete(cb);
}
export function onChainChanged(cb: Listener<number>): () => void {
  chainListeners.add(cb);
  return () => chainListeners.delete(cb);
}

/** Asks the wallet for accounts (eth_requestAccounts) and returns clients bound to the first one. */
export async function connect(provider: EIP1193Provider): Promise<Connection> {
  const cfg = getConfig();
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  const address = accounts[0];
  if (!address) throw new Error("The wallet returned no account.");
  attach(provider);
  const chain = chainOf(cfg);
  const walletClient = createWalletClient({ account: address as `0x${string}`, chain, transport: custom(provider) }) as WalletClient<Transport, Chain, Account>;
  return { address: address as `0x${string}`, walletClient, publicClient: getPublicClient() };
}

/** Switches the wallet to the configured chain, adding it first if the wallet does not know it (error 4902). */
export async function ensureChain(provider: EIP1193Provider, cfg: AppConfig): Promise<void> {
  const current = Number(await provider.request({ method: "eth_chainId" }));
  if (current === cfg.chainId) return;
  const chainId = `0x${cfg.chainId.toString(16)}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (err) {
    const code = (err as { code?: number; data?: { originalError?: { code?: number } } }).code ?? (err as { data?: { originalError?: { code?: number } } }).data?.originalError?.code;
    const message = String((err as { message?: unknown }).message ?? "");
    if (code !== 4902 && !/unrecogni[sz]ed chain|not (been )?added|try adding/i.test(message)) throw err;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName: cfg.chainName,
          rpcUrls: [cfg.rpcUrl],
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          ...(cfg.explorer ? { blockExplorerUrls: [cfg.explorer] } : {}),
        },
      ],
    });
  }
}

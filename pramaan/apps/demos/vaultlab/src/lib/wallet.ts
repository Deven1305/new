import { createPublicClient, createWalletClient, custom, defineChain, http, type EIP1193Provider, type PublicClient, type WalletClient } from "viem";
import { getConfig, type Hex } from "./config";

export interface WalletInfo { name: string; icon: string; rdns: string; provider: EIP1193Provider }
export function appChain() {
  const c = getConfig();
  return defineChain({ id: c.chainId, name: c.chainName, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [c.rpcUrl] } } });
}
let pub: PublicClient | null = null;
export function publicClient(): PublicClient {
  return (pub ??= createPublicClient({ chain: appChain(), transport: http(getConfig().rpcUrl) }));
}
/** EIP-6963 discovery; falls back to window.ethereum. */
export function discoverWallets(timeoutMs = 400): Promise<WalletInfo[]> {
  return new Promise((resolve) => {
    const found: WalletInfo[] = [];
    const onAnnounce = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.info && d?.provider && !found.some((w) => w.rdns === d.info.rdns)) found.push({ name: d.info.name, icon: d.info.icon, rdns: d.info.rdns, provider: d.provider });
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      const injected = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
      if (found.length === 0 && injected) found.push({ name: "Browser wallet", icon: "", rdns: "injected", provider: injected });
      resolve(found);
    }, timeoutMs);
  });
}
export interface Session { address: Hex; wallet: WalletClient; provider: EIP1193Provider }
export async function connect(provider: EIP1193Provider): Promise<Session> {
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as Hex[];
  if (!accounts[0]) throw new Error("The wallet returned no account.");
  await ensureChain(provider);
  const wallet = createWalletClient({ account: accounts[0], chain: appChain(), transport: custom(provider) });
  return { address: accounts[0], wallet, provider };
}
export async function ensureChain(provider: EIP1193Provider): Promise<void> {
  const c = getConfig();
  const hexId = `0x${c.chainId.toString(16)}`;
  const current = (await provider.request({ method: "eth_chainId" })) as string;
  if (current.toLowerCase() === hexId) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (err) {
    if ((err as { code?: number }).code !== 4902) throw err;
    await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: hexId, chainName: c.chainName, rpcUrls: [c.rpcUrl], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, blockExplorerUrls: c.explorer ? [c.explorer] : undefined }] });
  }
}
export function onWalletEvents(provider: EIP1193Provider, onChange: () => void): void {
  provider.on?.("accountsChanged", onChange as never);
  provider.on?.("chainChanged", onChange as never);
}


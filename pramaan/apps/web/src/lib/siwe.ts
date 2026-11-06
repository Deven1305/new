import { createWalletClient, custom, getAddress, isAddress, type EIP1193Provider } from "viem";
import { createSiweMessage } from "viem/siwe";
import type { ApiClient } from "./api";
import type { SiweResponse } from "./types";

/** Wallet access: EIP-6963 discovery with an EIP-1193 `window.ethereum` fallback. */

export interface DiscoveredWallet {
  id: string;
  name: string;
  icon: string | null;
  provider: EIP1193Provider;
}

interface Eip6963Detail {
  info?: { uuid?: string; name?: string; icon?: string; rdns?: string };
  provider?: EIP1193Provider;
}

/** Only data: URIs are used as icons (EIP-6963 requires it); anything else is dropped. */
export function safeIcon(icon: unknown): string | null {
  return typeof icon === "string" && /^data:image\/(png|svg\+xml|webp|jpeg|gif);/.test(icon) ? icon : null;
}

export function discoverWallets(timeoutMs = 350): Promise<DiscoveredWallet[]> {
  return new Promise((resolve) => {
    const found = new Map<string, DiscoveredWallet>();
    const onAnnounce = (ev: Event) => {
      const detail = (ev as CustomEvent<Eip6963Detail>).detail;
      if (!detail?.provider || typeof detail.provider.request !== "function") return;
      const id = detail.info?.uuid ?? detail.info?.rdns ?? detail.info?.name ?? `wallet-${found.size}`;
      found.set(id, { id, name: detail.info?.name ?? "Wallet", icon: safeIcon(detail.info?.icon), provider: detail.provider });
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      const list = [...found.values()];
      const injected = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
      if (list.length === 0 && injected && typeof injected.request === "function") {
        list.push({ id: "window.ethereum", name: "Browser wallet (window.ethereum)", icon: null, provider: injected });
      }
      resolve(list);
    }, timeoutMs);
  });
}

export const SIWE_STATEMENT = "Sign in to the Pramaan dashboard. This signature does not authorise any transaction or transfer.";

export function buildSiweMessage(input: { address: string; chainId: number; nonce: string; domain: string; uri: string; now?: Date }): string {
  const now = input.now ?? new Date();
  return createSiweMessage({
    address: getAddress(input.address),
    chainId: input.chainId,
    domain: input.domain,
    nonce: input.nonce,
    uri: input.uri,
    version: "1",
    statement: SIWE_STATEMENT,
    issuedAt: now,
    expirationTime: new Date(now.getTime() + 10 * 60_000),
  });
}

export class WalletError extends Error {
  override readonly name = "WalletError";
  readonly rejected: boolean;
  constructor(message: string, rejected = false) {
    super(message);
    this.rejected = rejected;
  }
}

function explainWalletFailure(err: unknown): WalletError {
  const e = err as { code?: number; message?: string; shortMessage?: string };
  if (e?.code === 4001) return new WalletError("You declined the request in your wallet.", true);
  if (e?.code === -32002) return new WalletError("Your wallet already has a pending request. Open it and approve or reject it.");
  return new WalletError(e?.shortMessage ?? e?.message ?? "The wallet request failed.");
}

/** Full SIWE flow: connect → server nonce → EIP-4361 message → personal_sign → POST /v1/auth/siwe. */
export async function signInWithWallet(client: ApiClient, wallet: DiscoveredWallet, location: Pick<Location, "host" | "origin"> = window.location): Promise<SiweResponse> {
  let address: string;
  let chainId: number;
  let message: string;
  try {
    const accounts = (await wallet.provider.request({ method: "eth_requestAccounts" })) as string[];
    const first = accounts?.[0];
    if (!first || !isAddress(first, { strict: false })) throw new WalletError("The wallet returned no account.");
    address = getAddress(first);
    const chainHex = (await wallet.provider.request({ method: "eth_chainId" })) as string;
    chainId = Number(chainHex);
    if (!Number.isInteger(chainId) || chainId <= 0) chainId = 1;
  } catch (err) {
    throw err instanceof WalletError ? err : explainWalletFailure(err);
  }
  const { nonce } = await client.get<{ nonce: string }>("/v1/auth/nonce");
  message = buildSiweMessage({ address, chainId, nonce, domain: location.host, uri: location.origin });
  let signature: string;
  try {
    const wc = createWalletClient({ account: address as `0x${string}`, transport: custom(wallet.provider) });
    signature = await wc.signMessage({ account: address as `0x${string}`, message });
  } catch (err) {
    throw explainWalletFailure(err);
  }
  return client.post<SiweResponse>("/v1/auth/siwe", { message, signature });
}

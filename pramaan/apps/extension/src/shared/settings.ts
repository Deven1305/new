import type { Lang } from "@pramaan/decoder";

export interface ChainSetting {
  label: string;
  rpcUrls: string[];
  universalResolver?: `0x${string}`;
  /** Route this chain's verification reads through Anon-RPC. */
  anonRpc: boolean;
  /** A local development chain: one RPC is accepted (reported as single-source). */
  local?: boolean;
}

export interface Settings {
  language: Lang;
  chains: Record<string, ChainSetting>;
  ipfsGateways: string[];
  /** Block requests to undeclared third parties on sites with a verified release. */
  strictPrivacy: boolean;
  /** Nox (Sphinx mixnet) anon-rpc specifier on Sepolia, from ethereum.github.io/anon-rpc/adopters. */
  anonRpcSpecifier: `0x${string}`;
  anonRpcBootTimeoutMs: number;
  /** When Anon-RPC is unavailable: read directly (shown in the Privacy panel) or fail the check ("couldn't check"). */
  anonRpcFallback: boolean;
  /** Longest a signing request waits for a running verification before failing closed as "unknown". */
  verificationWaitMs: number;
  /** Only opened when the user clicks "Dashboard"; verification never contacts it. */
  dashboardUrl: string;
}

export const DEFAULT_SETTINGS: Settings = {
  language: "en",
  chains: {
    "11155111": {
      label: "Sepolia",
      rpcUrls: ["https://sepolia.gateway.tenderly.co", "https://rpc.sepolia.ethpandaops.io"],
      anonRpc: true,
    },
    "1": { label: "Ethereum", rpcUrls: ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"], anonRpc: false },
    "31337": {
      label: "Local fork of Sepolia",
      rpcUrls: ["http://127.0.0.1:8545"],
      universalResolver: "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe",
      anonRpc: false,
      local: true,
    },
  },
  ipfsGateways: ["https://ipfs.io", "https://dweb.link", "http://127.0.0.1:8080"],
  strictPrivacy: false,
  anonRpcSpecifier: "0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A",
  anonRpcBootTimeoutMs: 25_000,
  anonRpcFallback: true,
  verificationWaitMs: 30_000,
  dashboardUrl: "http://localhost:5173",
};

export async function loadSettings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get("settings"))["settings"] as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...stored, chains: { ...DEFAULT_SETTINGS.chains, ...(stored?.chains ?? {}) } };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ settings });
}

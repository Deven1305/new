export type Hex = `0x${string}`;
export interface AppConfig {
  appId: "vaultlab" | "mirroryield" | "permitmarket";
  name: string;
  chainId: number;
  chainName: string;
  rpcUrl: string;
  explorer: string | null;
  ensName: string;
  origin: string;
  contracts: Record<string, Hex>;
}
let cached: AppConfig | null = null;
export function getConfig(): AppConfig {
  if (cached) return cached;
  const raw = import.meta.env.VITE_PRAMAAN_APP as string | undefined;
  if (!raw) throw new Error("App configuration missing: build this app with VITE_PRAMAAN_APP (see docs/apps/GEMINI_INSTRUCTIONS.md).");
  const cfg = JSON.parse(raw) as AppConfig;
  if (!cfg.chainId || !cfg.rpcUrl || !cfg.contracts) throw new Error("App configuration is incomplete.");
  cached = cfg;
  return cfg;
}
export function contract(name: string): Hex {
  const a = getConfig().contracts[name];
  if (!a) throw new Error(`Contract "${name}" is not configured for this app.`);
  return a;
}


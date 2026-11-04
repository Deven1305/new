/**
 * Deployment values baked into the bundle at build time by scripts/build.mjs (import.meta.env.VITE_PRAMAAN_APP, a JSON
 * string). Because they are inlined into the hashed JavaScript they are covered by the signed release manifest.
 *
 * The contract addresses appear in the bundle as ONE contiguous string literal each (the checksummed form from the demo
 * state). The MirrorYield tamper demo relies on that: do not split, re-case or obfuscate them.
 */
export interface AppConfig {
  appId: "vaultlab" | "mirroryield" | "permitmarket";
  name: string;
  chainId: number;
  chainName: string;
  rpcUrl: string;
  explorer: string | null;
  ensName: string;
  origin: string;
  contracts: Record<string, `0x${string}`>;
}

const APP_IDS = ["vaultlab", "mirroryield", "permitmarket"] as const;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function fatal(message: string): never {
  if (typeof document !== "undefined") {
    const box = document.createElement("div");
    box.setAttribute("role", "alert");
    box.style.cssText = "margin:24px;padding:16px;border:2px solid #c0392b;border-radius:8px;font:14px/1.5 system-ui,sans-serif;color:#c0392b;background:#fff5f5";
    box.textContent = `Configuration error: ${message}`;
    (document.body ?? document.documentElement).prepend(box);
  }
  throw new Error(`Configuration error: ${message}`);
}

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const raw = import.meta.env.VITE_PRAMAAN_APP as string | undefined;
  if (!raw) fatal("this build has no VITE_PRAMAAN_APP value. Build the demo with `pnpm build:demos` (scripts/build.mjs injects it).");
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return fatal("VITE_PRAMAAN_APP is not valid JSON");
  }
  const str = (k: string): string => {
    const v = json[k];
    if (typeof v !== "string" || v.length === 0) fatal(`VITE_PRAMAAN_APP.${k} must be a non-empty string`);
    return v;
  };
  const appId = str("appId");
  if (!(APP_IDS as readonly string[]).includes(appId)) fatal(`unknown appId "${appId}"`);
  const chainId = json["chainId"];
  if (typeof chainId !== "number" || !Number.isInteger(chainId) || chainId <= 0) fatal("VITE_PRAMAAN_APP.chainId must be a positive integer");
  const explorerRaw = json["explorer"];
  if (explorerRaw !== null && explorerRaw !== undefined && (typeof explorerRaw !== "string" || !/^https?:\/\//.test(explorerRaw))) fatal("VITE_PRAMAAN_APP.explorer must be null or an http(s) URL");
  const contractsRaw = json["contracts"];
  if (!contractsRaw || typeof contractsRaw !== "object") fatal("VITE_PRAMAAN_APP.contracts is missing");
  const contracts: Record<string, `0x${string}`> = {};
  for (const [role, value] of Object.entries(contractsRaw as Record<string, unknown>)) {
    if (typeof value !== "string" || !ADDRESS.test(value)) fatal(`contract "${role}" is not a valid address`);
    contracts[role] = value as `0x${string}`;
  }
  cached = {
    appId: appId as AppConfig["appId"],
    name: str("name"),
    chainId,
    chainName: str("chainName"),
    rpcUrl: str("rpcUrl"),
    explorer: typeof explorerRaw === "string" ? explorerRaw.replace(/\/+$/, "") : null,
    ensName: str("ensName"),
    origin: str("origin"),
    contracts,
  };
  return cached;
}

/** The address configured for a contract role; throws a visible error if this build does not carry it. */
export function contractAddress(cfg: AppConfig, role: string): `0x${string}` {
  const a = cfg.contracts[role];
  if (!a) return fatal(`this build has no "${role}" contract address`);
  return a;
}

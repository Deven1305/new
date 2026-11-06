import { decodeAbiParameters, decodeFunctionData, parseAbi, toFunctionSelector, type Hex } from "viem";

const UR_SELECTORS = new Set([toFunctionSelector("resolve(bytes,bytes)"), toFunctionSelector("resolveWithGateways(bytes,bytes,string[])")]);

/**
 * One blockchain read the extension made for a verification, as shown in the Privacy panel: what was asked, of whom,
 * and over which path. Pure and unit-tested.
 */
export type ReadPath = "anon-rpc" | "direct" | "direct-local" | "direct-fallback";

export interface ReadRecord {
  method: string;
  /** Human description, e.g. `ENS text "pramaan.record" of vaultlab.kosh.eth`. */
  what: string;
  endpoint: string;
  path: ReadPath;
  /** Why the fallback happened (direct-fallback only). */
  note: string | null;
  ok: boolean;
  ms: number;
  at: string;
}

const textAbi = parseAbi(["function text(bytes32 node, string key) view returns (string)"]);
const SELECTORS: Record<string, string> = {
  "0x95d89b41": "symbol()",
  "0x313ce567": "decimals()",
  "0x06fdde03": "name()",
  "0x01ffc9a7": "supportsInterface(bytes4)",
  "0x5c60da1b": "implementation()",
  "0x70a08231": "balanceOf(your address)",
  "0xa619486e": "masterCopy()",
};
const SLOTS: Record<string, string> = {
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc": "EIP-1967 implementation slot",
  "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50": "EIP-1967 beacon slot",
  "0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7": "EIP-1822 slot",
  "0x0000000000000000000000000000000000000000000000000000000000000000": "slot 0 (Safe singleton)",
};

/** DNS wire format → dotted name. */
export function dnsDecode(hex: Hex): string | null {
  const b = hex.slice(2).match(/../g)?.map((x) => parseInt(x, 16)) ?? [];
  const labels: string[] = [];
  let i = 0;
  while (i < b.length) {
    const len = b[i]!;
    if (len === 0) return labels.join(".");
    labels.push(new TextDecoder().decode(new Uint8Array(b.slice(i + 1, i + 1 + len))));
    i += 1 + len;
  }
  return null;
}

/** Describes a JSON-RPC request body (as viem sends it) for the Privacy panel. */
export function describeRpc(body: unknown): { method: string; what: string } {
  let req: { method?: unknown; params?: unknown[] } | null = null;
  try {
    req = typeof body === "string" ? JSON.parse(body) : (body as typeof req);
  } catch {
    return { method: "?", what: "unparseable request" };
  }
  if (Array.isArray(req)) return { method: "batch", what: `${req.length} requests in one batch` };
  const method = typeof req?.method === "string" ? req.method : "?";
  const p = Array.isArray(req?.params) ? req!.params : [];
  switch (method) {
    case "eth_chainId":
      return { method, what: "chain id of the endpoint" };
    case "eth_getCode":
      return { method, what: `contract code of ${String(p[0])}` };
    case "eth_getStorageAt":
      return { method, what: `${SLOTS[String(p[1]).toLowerCase()] ?? `storage slot ${String(p[1]).slice(0, 12)}…`} of ${String(p[0])}` };
    case "eth_call": {
      const call = (p[0] ?? {}) as { to?: string; data?: Hex };
      const data = (call.data ?? "0x") as Hex;
      const ens = describeEnsCall(data);
      if (ens) return { method, what: ens };
      const sel = data.slice(0, 10).toLowerCase();
      return { method, what: `${SELECTORS[sel] ?? `call ${sel}`} on ${call.to ?? "?"}` };
    }
    default:
      return { method, what: method };
  }
}

/** Universal Resolver resolve/resolveWithGateways(bytes name, bytes data, …): decode the name and text key. */
function describeEnsCall(data: Hex): string | null {
  const sel = data.slice(0, 10).toLowerCase();
  if (!UR_SELECTORS.has(sel as Hex)) return null;
  try {
    const [name, inner] = decodeAbiParameters([{ type: "bytes" }, { type: "bytes" }], `0x${data.slice(10)}`);
    const ensName = dnsDecode(name) ?? "?";
    try {
      const { args } = decodeFunctionData({ abi: textAbi, data: inner });
      return `ENS text "${args[1]}" of ${ensName}`;
    } catch {
      return `ENS record of ${ensName}`;
    }
  } catch {
    return "ENS Universal Resolver call";
  }
}

/** What each kind of provider can and cannot observe. Shown next to the reads. */
export const OBSERVES: Record<ReadPath, { sees: string[]; doesNotSee: string[] }> = {
  "anon-rpc": {
    sees: [
      "RPC endpoint: which names, addresses and slots were queried, and when (shifted by mixnet delay)",
      "Nox exit node: which RPC host was contacted, timing and size (not the content: TLS runs inside the worker)",
      "Nox entry node: your IP address and that you use Nox",
      "Bootstrap RPC (direct, once per boot): your IP and that you read the Nox specifier contract",
    ],
    doesNotSee: ["the RPC endpoint does not see your IP address", "no single party links your IP to the dApps you check"],
  },
  direct: {
    sees: ["RPC endpoint: your IP address, every name/address queried and when — it can link your IP to the dApps you check"],
    doesNotSee: ["your wallet keys, signatures or browsing outside these reads"],
  },
  "direct-fallback": {
    sees: ["RPC endpoint: your IP address, every name/address queried and when (Anon-RPC was unavailable for these reads)"],
    doesNotSee: ["your wallet keys, signatures or browsing outside these reads"],
  },
  "direct-local": {
    sees: [
      "your own local node only; nothing leaves this machine",
      "exception: an anvil fork fetches state it has not cached from its upstream fork RPC, which then sees those addresses from this machine's IP",
    ],
    doesNotSee: ["Anon-RPC cannot reach a local chain (chain 31337), so it is not used"],
  },
};

import { getAddress, keccak256, parseAbi, type PublicClient } from "viem";
import type { ManifestV1, proxyTypes } from "@pramaan/manifest";
import { agreed, assertChainId, makeClients, requiredAgreement, type ChainConfig } from "./rpc.js";

export const SLOTS = {
  eip1967Implementation: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  eip1967Beacon: "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50",
  eip1822Proxiable: "0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7",
  safeSingleton: "0x0000000000000000000000000000000000000000000000000000000000000000",
} as const;

const EIP1167 = /^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/;
const EIP7702 = /^0xef0100([0-9a-f]{40})$/;
/** ERC-7511 (PUSH0) minimal proxy and other clone variants that forward every call to an address in their code. */
const ERC7511 = /^0x365f5f375f5f365f73([0-9a-f]{40})5af43d5f5f3e5f3d91602a57fd5bf3$/;
const CLONE_PREFIXES = ["0x363d3d373d3d3d363d73", "0x365f5f375f5f365f73", "0x3d3d3d3d363d3d37363d73"];
const SAFE_MASTER_COPY_SELECTOR = "a619486e"; // masterCopy()
const DIAMOND_SELECTORS = ["7a0ed627", "cdffacc6", "1f931c1c"]; // facets(), facetAddress(bytes4), diamondCut(...)
const beaconAbi = parseAbi(["function implementation() view returns (address)"]);

export type ProxyType = (typeof proxyTypes)[number];

export interface CodeInspection {
  address: `0x${string}`;
  kind: "eoa" | "contract";
  codehash: `0x${string}` | null;
  proxy: { type: ProxyType; implementation: `0x${string}`; implCodehash: `0x${string}` | null } | null;
  unsupported: string | null;
}

function slotAddress(value: `0x${string}` | undefined): `0x${string}` | null {
  if (!value || /^0x0*$/.test(value)) return null;
  const hex = value.slice(-40);
  if (/^0+$/.test(hex)) return null;
  return getAddress(`0x${hex}`);
}

async function codehashOf(client: PublicClient, address: `0x${string}`): Promise<`0x${string}` | null> {
  const code = await client.getCode({ address });
  return code && code !== "0x" ? keccak256(code) : null;
}

/**
 * Reads deployed code and resolves supported proxies, in the order from the research:
 * EIP-7702 delegation, EIP-1167 clone, EIP-1967 implementation slot, EIP-1967 beacon, EIP-1822, Safe singleton.
 * Diamonds (EIP-2535) are reported as unsupported rather than guessed.
 */
export async function inspectAddress(client: PublicClient, address: `0x${string}`): Promise<CodeInspection> {
  const addr = getAddress(address);
  const code = (await client.getCode({ address: addr })) ?? "0x";
  if (code === "0x") return { address: addr, kind: "eoa", codehash: null, proxy: null, unsupported: null };
  const lower = code.toLowerCase() as `0x${string}`;
  const codehash = keccak256(code);
  const withImpl = async (type: ProxyType, impl: `0x${string}`): Promise<CodeInspection> => ({
    address: addr,
    kind: "contract",
    codehash,
    proxy: { type, implementation: impl, implCodehash: await codehashOf(client, impl) },
    unsupported: null,
  });

  const delegated = lower.match(EIP7702);
  if (delegated) return withImpl("eip7702", getAddress(`0x${delegated[1]}`));
  const clone = lower.match(EIP1167);
  if (clone) return withImpl("eip1167", getAddress(`0x${clone[1]}`));

  if (lower.match(ERC7511)) {
    return { address: addr, kind: "contract", codehash, proxy: null, unsupported: "ERC-7511 (PUSH0) minimal proxy: not a supported proxy type in this version" };
  }

  const impl1967 = slotAddress(await client.getStorageAt({ address: addr, slot: SLOTS.eip1967Implementation }));
  if (impl1967) return withImpl("eip1967", impl1967);

  const beacon = slotAddress(await client.getStorageAt({ address: addr, slot: SLOTS.eip1967Beacon }));
  if (beacon) {
    const impl = await client.readContract({ address: beacon, abi: beaconAbi, functionName: "implementation" }).catch(() => null);
    if (impl) return withImpl("eip1967-beacon", getAddress(impl));
    return { address: addr, kind: "contract", codehash, proxy: null, unsupported: "EIP-1967 beacon without a readable implementation()" };
  }

  const impl1822 = slotAddress(await client.getStorageAt({ address: addr, slot: SLOTS.eip1822Proxiable }));
  if (impl1822) return withImpl("eip1822", impl1822);

  if (lower.includes(SAFE_MASTER_COPY_SELECTOR) && lower.length < 2 + 2 * 1200) {
    const singleton = slotAddress(await client.getStorageAt({ address: addr, slot: SLOTS.safeSingleton }));
    if (singleton && (await codehashOf(client, singleton))) return withImpl("safe", singleton);
  }

  if (CLONE_PREFIXES.some((p) => lower.startsWith(p)) && lower.length < 2 + 2 * 256) {
    return { address: addr, kind: "contract", codehash, proxy: null, unsupported: "non-standard minimal proxy (forwards calls; implementation cannot be pinned)" };
  }
  if (DIAMOND_SELECTORS.some((s) => lower.includes(s))) {
    return { address: addr, kind: "contract", codehash, proxy: null, unsupported: "EIP-2535 diamond (facets cannot be verified in this version)" };
  }
  return { address: addr, kind: "contract", codehash, proxy: null, unsupported: null };
}

export type InspectionResult =
  | { status: "ok"; inspection: CodeInspection; singleSource: boolean }
  | { status: "unknown"; detail: string };

/** Inspects an address on every configured RPC; all must agree on code hash and proxy implementation. */
export async function inspectAgreed(cfg: ChainConfig, address: `0x${string}`, clients: PublicClient[] = makeClients(cfg)): Promise<InspectionResult> {
  const r = await agreed(clients, requiredAgreement(cfg), async (c) => {
    await assertChainId(c, cfg.chainId);
    return inspectAddress(c, address);
  });
  if (r.status === "agreed") return { status: "ok", inspection: r.value, singleSource: r.singleSource };
  return { status: "unknown", detail: r.detail };
}

export type ContractStatus =
  | "verified"
  | "unlisted"
  | "code-mismatch"
  | "impl-mismatch"
  | "impl-not-covered"
  | "unsupported-proxy"
  | "eoa"
  | "wrong-chain"
  | "unknown";

export interface ContractCheck {
  status: ContractStatus;
  address: `0x${string}`;
  chainId: number;
  label: string | null;
  detail: string;
  expected?: { runtimeCodehash: string; implAddress?: string; implCodehash?: string };
  actual?: { codehash: string | null; implAddress?: string | null; implCodehash?: string | null; proxyType?: string | null };
}

/**
 * Compares deployed code (and the current proxy implementation) with what the signed release lists.
 *
 * The comparison is deployed-vs-deployed: `runtimeCodehash` in the manifest is keccak256(eth_getCode) read back from the
 * chain after deployment (release/deploy.ts, re-checked by assemble.ts), and the verifier hashes eth_getCode again.
 * Immutables and the Solidity metadata hash are part of the deployed runtime code, so both sides contain them: a
 * contract with different constructor arguments (immutables) or a recompilation is a different codehash and therefore a
 * mismatch, while the same deployment always matches. Compiler output (artifact bytecode) is never compared.
 */
export function compareContract(manifest: ManifestV1, chainId: number, inspection: CodeInspection): ContractCheck {
  const entry = manifest.contracts.find((c) => c.chainId === chainId && c.address.toLowerCase() === inspection.address.toLowerCase());
  const base = { address: inspection.address, chainId, label: entry?.label ?? null };
  if (!entry) {
    const elsewhere = manifest.contracts.find((c) => c.address.toLowerCase() === inspection.address.toLowerCase());
    if (elsewhere) {
      return {
        ...base,
        label: elsewhere.label,
        status: "wrong-chain",
        detail: `the release lists ${elsewhere.label} on chain ${elsewhere.chainId}, but this request is for chain ${chainId}; the code at this address on chain ${chainId} was never checked`,
        actual: { codehash: inspection.codehash, proxyType: inspection.proxy?.type ?? null },
      };
    }
  }
  const actual = {
    codehash: inspection.codehash,
    implAddress: inspection.proxy?.implementation ?? null,
    implCodehash: inspection.proxy?.implCodehash ?? null,
    proxyType: inspection.proxy?.type ?? null,
  };
  if (inspection.kind === "eoa") {
    return {
      ...base,
      status: entry ? "code-mismatch" : "eoa",
      detail: entry ? `the release lists ${entry.label} at this address, but it has no code (an EOA or a self-destructed contract)` : "the address is a wallet, not a contract",
      actual,
    };
  }
  if (!entry) return { ...base, status: "unlisted", detail: "this contract is not part of the published release", actual };
  const expected = {
    runtimeCodehash: entry.runtimeCodehash,
    implAddress: entry.proxy?.implAddress,
    implCodehash: entry.proxy?.implCodehash,
  };
  if (inspection.codehash?.toLowerCase() !== entry.runtimeCodehash.toLowerCase()) {
    return { ...base, status: "code-mismatch", detail: "the deployed bytecode differs from the release", expected, actual };
  }
  if (inspection.unsupported) return { ...base, status: "unsupported-proxy", detail: inspection.unsupported, expected, actual };
  if (inspection.proxy?.type === "eip1967-beacon" || entry.proxy?.type === "eip1967-beacon") {
    // The beacon (not pinned by the release) can switch the implementation of every proxy at once, and a beacon's
    // implementation() can answer differently to eth_call than to the real call path. Never green.
    return { ...base, status: "unsupported-proxy", detail: "EIP-1967 beacon proxy: the beacon is not pinned by the release, so the implementation cannot be verified", expected, actual };
  }
  if (entry.proxy) {
    if (!inspection.proxy) return { ...base, status: "impl-mismatch", detail: "the release lists a proxy but no implementation was found", expected, actual };
    if (inspection.proxy.type !== entry.proxy.type) {
      return { ...base, status: "impl-mismatch", detail: `proxy type is ${inspection.proxy.type}, release says ${entry.proxy.type}`, expected, actual };
    }
    if (inspection.proxy.implementation.toLowerCase() !== entry.proxy.implAddress.toLowerCase()) {
      return { ...base, status: "impl-mismatch", detail: `the proxy now points to ${inspection.proxy.implementation}, not the released implementation`, expected, actual };
    }
    if (inspection.proxy.implCodehash?.toLowerCase() !== entry.proxy.implCodehash.toLowerCase()) {
      return { ...base, status: "impl-mismatch", detail: "the implementation's bytecode differs from the release", expected, actual };
    }
    return { ...base, status: "verified", detail: `${entry.label}: proxy and implementation code match the release`, expected, actual };
  }
  if (inspection.proxy) {
    return { ...base, status: "impl-not-covered", detail: `this is a ${inspection.proxy.type} proxy but the release does not pin its implementation`, expected, actual };
  }
  return { ...base, status: "verified", detail: `${entry.label}: deployed code matches the release`, expected, actual };
}

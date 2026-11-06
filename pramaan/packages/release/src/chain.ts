import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeDeployData,
  getAddress,
  http,
  type Abi,
  type Account,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "../../..");

export interface Ensv2Config {
  chainId: number;
  universalResolver: `0x${string}`;
  ethRegistrar: `0x${string}`;
  ethRegistry: `0x${string}`;
  verifiableFactory: `0x${string}`;
  permissionedResolverImpl: `0x${string}`;
  mockUsdc: `0x${string}`;
}

/** Loads the ENSv2 deployment addresses. Env vars override single entries (e.g. after a Sepolia ENS reset). */
export function loadEnsv2Config(path = join(REPO_ROOT, "config", "ensv2.sepolia.json")): Ensv2Config {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, string | number>;
  const pick = (key: string, env: string) => getAddress(String(process.env[env] ?? raw[key])) as `0x${string}`;
  return {
    chainId: Number(raw["chainId"]),
    universalResolver: pick("universalResolver", "ENSV2_UNIVERSAL_RESOLVER"),
    ethRegistrar: pick("ethRegistrar", "ENSV2_ETH_REGISTRAR"),
    ethRegistry: pick("ethRegistry", "ENSV2_ETH_REGISTRY"),
    verifiableFactory: pick("verifiableFactory", "ENSV2_VERIFIABLE_FACTORY"),
    permissionedResolverImpl: pick("permissionedResolverImpl", "ENSV2_PERMISSIONED_RESOLVER_IMPL"),
    mockUsdc: pick("mockUsdc", "ENSV2_MOCK_USDC"),
  };
}

/** Sepolia, or a local anvil fork of Sepolia (chain id 31337) that carries the same ENSv2 contracts. */
export function chainFor(chainId: number, rpcUrl: string, ens: Ensv2Config): Chain {
  if (chainId === sepolia.id) return { ...sepolia, rpcUrls: { default: { http: [rpcUrl] } } };
  return defineChain({
    id: chainId,
    name: chainId === 31337 ? "Local fork of Sepolia" : `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    contracts: { ensUniversalResolver: { address: ens.universalResolver } },
  });
}

export interface ChainCtx {
  chain: Chain;
  pub: PublicClient;
  rpcUrl: string;
  local: boolean;
}

export async function connect(rpcUrl: string, ens: Ensv2Config = loadEnsv2Config()): Promise<ChainCtx> {
  const probe = createPublicClient({ transport: http(rpcUrl) });
  const chainId = await probe.getChainId();
  const chain = chainFor(chainId, rpcUrl, ens);
  return { chain, pub: createPublicClient({ chain, transport: http(rpcUrl) }) as PublicClient, rpcUrl, local: chainId === 31337 || chainId === 1337 };
}

export type Signer = WalletClient<Transport, Chain, Account>;

/** Wallet for a TESTNET key held in an environment variable. Mainnet is refused. */
export function signerFromKey(ctx: ChainCtx, privateKey: string | undefined, label: string): Signer {
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error(`${label} is not set (expected a 0x-prefixed 32-byte hex testnet key)`);
  if (ctx.chain.id === 1) throw new Error("refusing to use a private key on Ethereum mainnet from this tool");
  return createWalletClient({ chain: ctx.chain, transport: http(ctx.rpcUrl), account: privateKeyToAccount(privateKey as Hex) });
}

/**
 * Fresh, funded account on a LOCAL chain. Never use anvil's well-known default keys on a fork of a public network:
 * on Sepolia those accounts carry EIP-7702 delegations to a third-party contract (verified 2026-11-04), so the
 * fork inherits code at "your" EOA.
 */
export async function freshLocalSigner(ctx: ChainCtx, label: string, ether = 100n): Promise<Signer & { privateKey: Hex }> {
  if (!ctx.local) throw new Error("freshLocalSigner only works on a local chain");
  const privateKey = generatePrivateKey();
  const signer = signerFromKey(ctx, privateKey, label);
  await ctx.pub.request({ method: "anvil_setBalance" as never, params: [signer.account.address, `0x${(ether * 10n ** 18n).toString(16)}`] as never });
  return Object.assign(signer, { privateKey });
}

/** Advances time on a local chain (anvil); on a live testnet waits in real time. */
export async function waitSeconds(ctx: ChainCtx, seconds: number, log?: (msg: string) => void): Promise<void> {
  if (ctx.local) {
    await ctx.pub.request({ method: "evm_increaseTime" as never, params: [seconds] as never });
    await ctx.pub.request({ method: "evm_mine" as never, params: [] as never });
    log?.(`advanced local chain time by ${seconds}s`);
    return;
  }
  log?.(`waiting ${seconds}s on ${ctx.chain.name}`);
  await new Promise((r) => setTimeout(r, seconds * 1000));
}

export interface Artifact {
  abi: Abi;
  bytecode: Hex;
}

export function loadArtifact(contract: string, file = `${contract}.sol`, outDir = join(REPO_ROOT, "contracts", "out")): Artifact {
  const path = join(outDir, file, `${contract}.json`);
  if (!existsSync(path)) throw new Error(`missing Foundry artifact ${path} (run: cd contracts && forge build)`);
  const json = JSON.parse(readFileSync(path, "utf8")) as { abi: Abi; bytecode: { object: Hex } };
  return { abi: json.abi, bytecode: json.bytecode.object };
}

/**
 * Gas with a 30% margin, capped below the EIP-7825 per-transaction limit (2^24). Needed since Sepolia moved to the
 * Amsterdam fork (higher state-creation costs): anvil 1.8.7's estimate for deployments came out exactly at the limit
 * and the transaction ran out of gas (observed 2026-11-04).
 */
export function withMargin(estimate: bigint): bigint {
  const padded = (estimate * 13n) / 10n;
  return padded > 16_000_000n ? 16_000_000n : padded;
}

/** writeContract with an explicit, padded gas limit. */
export async function write(ctx: ChainCtx, signer: Signer, req: { address: `0x${string}`; abi: Abi; functionName: string; args?: readonly unknown[]; value?: bigint }): Promise<Hex> {
  const estimate = await ctx.pub.estimateContractGas({ ...req, account: signer.account } as never);
  return signer.writeContract({ ...req, account: signer.account, chain: ctx.chain, gas: withMargin(estimate) } as never);
}

export async function deployArtifact(ctx: ChainCtx, signer: Signer, artifact: Artifact, args: unknown[] = []): Promise<{ address: `0x${string}`; txHash: Hex }> {
  const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args });
  const gas = withMargin(await ctx.pub.estimateGas({ account: signer.account, data }));
  const txHash = await signer.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args, account: signer.account, chain: ctx.chain, gas });
  const receipt = await ctx.pub.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`deployment reverted (${txHash})`);
  return { address: getAddress(receipt.contractAddress) as `0x${string}`, txHash };
}

export async function send(ctx: ChainCtx, txHash: Hex, what: string): Promise<Hex> {
  const receipt = await ctx.pub.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`${what} reverted (${txHash})`);
  return txHash;
}

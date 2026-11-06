import { encodeFunctionData, getAddress, keccak256, parseEventLogs, toBytes, toHex, zeroAddress, type Hex } from "viem";
import { normalize } from "viem/ens";
import { dnsEncode } from "@pramaan/verifier-core";
import { erc20Abi, ethRegistrarAbi, ethRegistryAbi, permissionedResolverAbi, rentPriceOracleAbi, ROLES, verifiableFactoryAbi } from "./abis.js";
import { send, waitSeconds, write, type ChainCtx, type Ensv2Config, type Signer } from "./chain.js";

export const RECORD_KEY = "pramaan.record";

/** Confirms every configured ENSv2 contract has code on the connected chain before anything is sent. */
export async function checkEnsv2(ctx: ChainCtx, ens: Ensv2Config): Promise<{ name: string; address: string; codeBytes: number }[]> {
  const entries = Object.entries(ens).filter(([k]) => k !== "chainId") as [string, `0x${string}`][];
  const out = [];
  for (const [name, address] of entries) {
    const code = (await ctx.pub.getCode({ address })) ?? "0x";
    out.push({ name, address, codeBytes: (code.length - 2) / 2 });
  }
  return out;
}

export function labelOf(ensName: string): string {
  const name = normalize(ensName);
  if (!name.endsWith(".eth") || name.split(".").length !== 2) throw new Error(`expected a second-level .eth name, got ${ensName}`);
  return name.slice(0, -".eth".length);
}

export async function nameStatus(ctx: ChainCtx, ens: Ensv2Config, ensName: string) {
  const label = labelOf(ensName);
  const [owner, resolver, available] = await Promise.all([
    ctx.pub.readContract({ address: ens.ethRegistry, abi: ethRegistryAbi, functionName: "findOwner", args: [label] }).catch(() => zeroAddress),
    ctx.pub.readContract({ address: ens.ethRegistry, abi: ethRegistryAbi, functionName: "getResolver", args: [label] }).catch(() => zeroAddress),
    ctx.pub.readContract({ address: ens.ethRegistrar, abi: ethRegistrarAbi, functionName: "isAvailable", args: [label] }).catch(() => false),
  ]);
  return { label, owner: getAddress(owner), resolver: getAddress(resolver), available };
}

export interface ResolverRecords {
  repo?: string;
  domain: string;
  attestation: "github" | "key" | `github:${string}`;
  signer?: string;
}

/**
 * Deploys the name's DEDICATED PermissionedResolver (ENSv2 roles are per resolver, not per name) through the
 * VerifiableFactory. The owner gets every role, and the owner-only records are written inside initialize().
 */
export async function deployResolver(
  ctx: ChainCtx,
  owner: Signer,
  ens: Ensv2Config,
  ensName: string,
  records: ResolverRecords,
  salt: bigint = BigInt(keccak256(toBytes(`pramaan:${ensName}:${Date.now()}`))),
): Promise<{ resolver: `0x${string}`; txHash: Hex }> {
  const name = dnsEncode(ensName);
  const setText = (key: string, value: string) => encodeFunctionData({ abi: permissionedResolverAbi, functionName: "setText", args: [name, key, value] });
  const calls: Hex[] = [setText("pramaan.domain", records.domain), setText("pramaan.attestation", records.attestation)];
  if (records.repo) calls.push(setText("pramaan.repo", records.repo));
  if (records.signer) calls.push(setText("pramaan.signer", records.signer));
  const init = encodeFunctionData({
    abi: permissionedResolverAbi,
    functionName: "initialize",
    args: [[{ account: owner.account.address, roleBitmap: ROLES.ALL_ROLES }], calls],
  });
  const txHash = await write(ctx, owner, { address: ens.verifiableFactory, abi: verifiableFactoryAbi, functionName: "deployProxy", args: [ens.permissionedResolverImpl, salt, init] });
  const receipt = await ctx.pub.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`resolver deployment reverted (${txHash})`);
  const [event] = parseEventLogs({ abi: verifiableFactoryAbi, logs: receipt.logs, eventName: "ProxyDeployed" });
  if (!event) throw new Error("ProxyDeployed event not found");
  return { resolver: getAddress(event.args.proxyAddress) as `0x${string}`, txHash };
}

/** Grants the timelock ROLE_SET_TEXT on keccak256("pramaan.record") only. The name argument of the setter is ignored. */
export async function grantRecordRole(ctx: ChainCtx, owner: Signer, resolver: `0x${string}`, timelock: `0x${string}`): Promise<Hex> {
  const setter = encodeFunctionData({ abi: permissionedResolverAbi, functionName: "setText", args: ["0x", RECORD_KEY, ""] });
  const txHash = await write(ctx, owner, { address: resolver, abi: permissionedResolverAbi, functionName: "grantSetterRoles", args: [setter, timelock] });
  return send(ctx, txHash, "grantSetterRoles");
}

export async function hasRecordRole(ctx: ChainCtx, resolver: `0x${string}`, account: `0x${string}`): Promise<boolean> {
  return ctx.pub.readContract({
    address: resolver,
    abi: permissionedResolverAbi,
    functionName: "hasRoles",
    args: [BigInt(keccak256(toBytes(RECORD_KEY))), ROLES.ROLE_SET_TEXT, account],
  });
}

export async function setOwnerText(ctx: ChainCtx, owner: Signer, resolver: `0x${string}`, ensName: string, key: string, value: string): Promise<Hex> {
  if (key === RECORD_KEY) throw new Error("pramaan.record is written only through the timelock");
  const txHash = await write(ctx, owner, { address: resolver, abi: permissionedResolverAbi, functionName: "setText", args: [dnsEncode(ensName), key, value] });
  return send(ctx, txHash, `setText(${key})`);
}

/**
 * Registers a .eth name on ENSv2 with commit-reveal, paying in the testnet MockUSDC (its mint() is open), and points it
 * straight at `resolver`. Testnet/local only.
 */
export async function registerName(
  ctx: ChainCtx,
  owner: Signer,
  ens: Ensv2Config,
  ensName: string,
  resolver: `0x${string}`,
  log: (msg: string) => void = () => undefined,
  opts: { subregistry?: `0x${string}`; durationSeconds?: bigint } = {},
): Promise<{ tokenId: bigint; txHashes: Hex[] }> {
  if (ctx.chain.id === 1) throw new Error("registration from this tool is testnet-only");
  const subregistry = opts.subregistry ?? zeroAddress;
  const label = labelOf(ensName);
  const available = await ctx.pub.readContract({ address: ens.ethRegistrar, abi: ethRegistrarAbi, functionName: "isAvailable", args: [label] });
  if (!available) throw new Error(`${ensName} is not available`);
  const [minAge, minDuration, oracle] = await Promise.all([
    ctx.pub.readContract({ address: ens.ethRegistrar, abi: ethRegistrarAbi, functionName: "MIN_COMMITMENT_AGE" }),
    ctx.pub.readContract({ address: ens.ethRegistrar, abi: ethRegistrarAbi, functionName: "MIN_REGISTER_DURATION" }),
    ctx.pub.readContract({ address: ens.ethRegistrar, abi: ethRegistrarAbi, functionName: "rentPriceOracle" }),
  ]);
  const accepted = await ctx.pub.readContract({ address: oracle, abi: rentPriceOracleAbi, functionName: "isPaymentToken", args: [ens.mockUsdc] });
  if (!accepted) throw new Error(`payment token ${ens.mockUsdc} is not accepted by the rent price oracle ${oracle}`);
  const wanted = opts.durationSeconds ?? 31_536_000n; // one year by default
  const duration = minDuration > wanted ? minDuration : wanted;
  const [base, premium] = await ctx.pub.readContract({ address: ens.ethRegistrar, abi: ethRegistrarAbi, functionName: "getRegisterPrice", args: [label, duration, ens.mockUsdc] });
  const price = base + premium;
  log(`price for ${ensName}: ${price} MockUSDC base units for ${duration}s`);
  const me = owner.account.address;
  const txHashes: Hex[] = [];
  txHashes.push(await send(ctx, await write(ctx, owner, { address: ens.mockUsdc, abi: erc20Abi, functionName: "mint", args: [me, price] }), "MockUSDC.mint"));
  txHashes.push(await send(ctx, await write(ctx, owner, { address: ens.mockUsdc, abi: erc20Abi, functionName: "approve", args: [ens.ethRegistrar, price] }), "MockUSDC.approve"));
  const secret = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const referrer = `0x${"00".repeat(32)}` as Hex;
  const commitment = await ctx.pub.readContract({
    address: ens.ethRegistrar,
    abi: ethRegistrarAbi,
    functionName: "makeCommitment",
    args: [label, me, secret, subregistry, resolver, duration, referrer],
  });
  txHashes.push(await send(ctx, await write(ctx, owner, { address: ens.ethRegistrar, abi: ethRegistrarAbi, functionName: "commit", args: [commitment] }), "commit"));
  log(`committed; waiting MIN_COMMITMENT_AGE (${minAge}s)`);
  await waitSeconds(ctx, Number(minAge) + 2, log);
  const txHash = await write(ctx, owner, { address: ens.ethRegistrar, abi: ethRegistrarAbi, functionName: "register", args: [label, me, secret, subregistry, resolver, duration, ens.mockUsdc, referrer] });
  const receipt = await ctx.pub.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`register reverted (${txHash})`);
  txHashes.push(txHash);
  const [event] = parseEventLogs({ abi: ethRegistrarAbi, logs: receipt.logs, eventName: "NameRegistered" });
  return { tokenId: event?.args.tokenId ?? 0n, txHashes };
}

export async function setNameResolver(ctx: ChainCtx, owner: Signer, ens: Ensv2Config, ensName: string, resolver: `0x${string}`): Promise<Hex> {
  const tokenId = await ctx.pub.readContract({ address: ens.ethRegistry, abi: ethRegistryAbi, functionName: "findTokenId", args: [labelOf(ensName)] });
  const txHash = await write(ctx, owner, { address: ens.ethRegistry, abi: ethRegistryAbi, functionName: "setResolver", args: [tokenId, resolver] });
  return send(ctx, txHash, "setResolver");
}

/**
 * Negative test: an account WITHOUT the root text role (e.g. the CI proposer key) tries to write records directly.
 * Each attempt must revert. With `broadcast`, the reverting transactions are actually mined (explorer evidence).
 */
export async function negativeWriteTest(
  ctx: ChainCtx,
  attacker: Signer,
  resolver: `0x${string}`,
  ensName: string,
  broadcast = false,
): Promise<{ attempt: string; reverted: boolean; detail: string; txHash: Hex | null }[]> {
  const name = dnsEncode(ensName);
  const attempts: { attempt: string; fn: "setText" | "setAddress"; args: readonly unknown[] }[] = [
    { attempt: 'setText("pramaan.record") directly', fn: "setText", args: [name, RECORD_KEY, `pramaan:v1:evil:${"0".repeat(64)}`] },
    { attempt: 'setText("url")', fn: "setText", args: [name, "url", "https://evil.example"] },
    { attempt: "setAddress(ETH)", fn: "setAddress", args: [name, 60n, attacker.account.address] },
  ];
  const out = [];
  for (const a of attempts) {
    try {
      await ctx.pub.simulateContract({ address: resolver, abi: permissionedResolverAbi, functionName: a.fn, args: a.args as never, account: attacker.account });
      out.push({ attempt: a.attempt, reverted: false, detail: "call would SUCCEED (role boundary broken!)", txHash: null });
      continue;
    } catch (err) {
      const detail = (err as Error).message.split("\n").find((l) => /EAC|revert/i.test(l))?.trim() ?? "reverted";
      let txHash: Hex | null = null;
      if (broadcast) {
        txHash = await attacker.writeContract({ address: resolver, abi: permissionedResolverAbi, functionName: a.fn, args: a.args as never, account: attacker.account, chain: ctx.chain, gas: 200_000n });
        const receipt = await ctx.pub.waitForTransactionReceipt({ hash: txHash });
        if (receipt.status === "success") throw new Error(`${a.attempt} was MINED SUCCESSFULLY: role boundary broken`);
      }
      out.push({ attempt: a.attempt, reverted: true, detail, txHash });
    }
  }
  return out;
}

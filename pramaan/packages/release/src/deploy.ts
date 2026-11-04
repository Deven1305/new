import { encodeFunctionData, getAddress, isAddress, keccak256, zeroAddress, type Hex } from "viem";
import { DeploymentRecord } from "@pramaan/manifest";
import { deployArtifact, loadArtifact, send, write, type ChainCtx, type Signer } from "./chain.js";
import type { DemoAppId, DemoMonitor } from "./demo-state.js";

async function codehash(ctx: ChainCtx, address: `0x${string}`): Promise<Hex> {
  const code = await ctx.pub.getCode({ address });
  if (!code || code === "0x") throw new Error(`no code at ${address}`);
  return keccak256(code);
}

/**
 * Deploys the demo dApp contracts (same set as contracts/script/Deploy.s.sol) and returns the deployment record with
 * keccak256(eth_getCode) of every contract, read back from the chain after deployment.
 */
export async function deployDemoContracts(ctx: ChainCtx, owner: Signer, log: (m: string) => void = () => undefined): Promise<DeploymentRecord> {
  const proxy = loadArtifact("ERC1967Proxy");
  const vaultArt = loadArtifact("VaultV2");
  const legacyArt = loadArtifact("VulnerableVault");
  const token = (await deployArtifact(ctx, owner, loadArtifact("DemoToken"))).address;
  log(`DemoToken ${token}`);
  const nft = (await deployArtifact(ctx, owner, loadArtifact("DemoNFT"))).address;
  log(`DemoNFT ${nft}`);
  const vaultImpl = (await deployArtifact(ctx, owner, vaultArt)).address;
  const vault = (await deployArtifact(ctx, owner, proxy, [vaultImpl, encodeFunctionData({ abi: vaultArt.abi, functionName: "initialize", args: [owner.account.address, token] })])).address;
  log(`VaultV2 proxy ${vault} -> implementation ${vaultImpl}`);
  const legacyImpl = (await deployArtifact(ctx, owner, legacyArt)).address;
  const legacyVault = (await deployArtifact(ctx, owner, proxy, [legacyImpl, encodeFunctionData({ abi: legacyArt.abi, functionName: "initialize", args: [owner.account.address, token] })])).address;
  log(`VulnerableVault proxy ${legacyVault} (deliberately NOT listed in the release)`);
  const unauditedImpl = (await deployArtifact(ctx, owner, loadArtifact("VaultV3Unaudited"))).address;
  log(`VaultV3Unaudited implementation ${unauditedImpl} (for the upgrade-alert demo)`);
  const entry = async (address: `0x${string}`, impl?: `0x${string}`) =>
    impl
      ? { address, runtimeCodehash: await codehash(ctx, address), proxy: "eip1967" as const, implementation: impl, implementationCodehash: await codehash(ctx, impl) }
      : { address, runtimeCodehash: await codehash(ctx, address), proxy: "none" as const };
  return DeploymentRecord.parse({
    chainId: ctx.chain.id,
    owner: owner.account.address,
    blockNumber: Number(await ctx.pub.getBlockNumber()),
    token: await entry(token),
    nft: await entry(nft),
    vault: await entry(vault, vaultImpl),
    legacyVault: await entry(legacyVault, legacyImpl),
    unauditedImpl: await entry(unauditedImpl),
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Three-app demo suite (VaultLab, MirrorYield, PermitMarket)
// ---------------------------------------------------------------------------------------------------------------------

export interface DeployDemoSuiteOptions {
  /** Deployer. Becomes the sole proposer + executor of the upgrade TimelockController and the owner of the farm. */
  owner: Signer;
  /** Public address of the attacker identity MirrorYield's tamper step redirects stakes to (recorded as an unlisted contract role). */
  attacker: `0x${string}`;
  /** Minimum delay of the VaultV2 upgrade TimelockController. Default 120 s. */
  upgradeDelaySeconds?: number;
  /** Reward pool streamed by MirrorYieldFarm (pUSD base units, seconds). Default 200,000 pUSD over 365 days. */
  farmRewards?: { amount: bigint; durationSeconds: bigint };
  log?: (message: string) => void;
}

export interface DemoSuiteApp {
  contracts: Record<string, `0x${string}`>;
  unlisted: Record<string, `0x${string}`>;
  monitors: DemoMonitor[];
}

export interface DemoSuite {
  chainId: number;
  blockNumber: number;
  owner: `0x${string}`;
  upgradeDelaySeconds: number;
  shared: { token: `0x${string}`; nft: `0x${string}` };
  apps: Record<DemoAppId, DemoSuiteApp>;
  /** Deployment transaction of the reward funding, for the record. */
  fundRewardsTx: Hex;
}

/**
 * Deploys the contracts of all three demo dApps with the padded-gas helpers of chain.ts (needed on Sepolia and on forks,
 * which run the Amsterdam fork):
 *  - pUSD (DemoToken, shared), pNFT (DemoNFT, shared)
 *  - VaultLab: OpenZeppelin TimelockController (proposer = executor = owner key, admin renounced from construction),
 *    VaultV2 implementation + ERC-1967 proxy OWNED BY THE TIMELOCK; unlisted: VulnerableVault proxy + implementation
 *    (the bug PROVE finds) and VaultV3Unaudited (the sneaky upgrade target)
 *  - MirrorYield: MirrorYieldFarm(pUSD, pUSD) with the reward pool funded via fundRewards; unlisted: attacker address
 *  - PermitMarket: PermitMarketplace(pUSD, pNFT)
 */
export async function deployDemoSuite(ctx: ChainCtx, options: DeployDemoSuiteOptions): Promise<DemoSuite> {
  const { owner, attacker } = options;
  const log = options.log ?? (() => undefined);
  const delay = options.upgradeDelaySeconds ?? 120;
  if (!Number.isInteger(delay) || delay < 0 || delay > 30 * 86_400) throw new Error(`upgradeDelaySeconds must be an integer between 0 and 2592000 (got ${delay})`);
  if (!isAddress(attacker)) throw new Error(`attacker is not an address: ${attacker}`);
  const rewards = options.farmRewards ?? { amount: 200_000n * 10n ** 6n, durationSeconds: 365n * 86_400n };
  const ownerAddress = getAddress(owner.account.address) as `0x${string}`;

  const tokenArt = loadArtifact("DemoToken");
  const proxyArt = loadArtifact("ERC1967Proxy");
  const vaultArt = loadArtifact("VaultV2");
  const legacyArt = loadArtifact("VulnerableVault");
  const timelockArt = loadArtifact("TimelockController");
  const farmArt = loadArtifact("MirrorYieldFarm");

  const token = (await deployArtifact(ctx, owner, tokenArt)).address;
  log(`pUSD ${token}`);
  const nft = (await deployArtifact(ctx, owner, loadArtifact("DemoNFT"))).address;
  log(`pNFT ${nft}`);

  // admin = address(0): the deployer never holds the timelock's admin role, so its delay can only be changed by an operation that itself waited the delay.
  const upgradeTimelock = (await deployArtifact(ctx, owner, timelockArt, [BigInt(delay), [ownerAddress], [ownerAddress], zeroAddress])).address;
  log(`upgrade TimelockController ${upgradeTimelock} (delay ${delay}s, proposer = executor = owner key, no admin)`);
  const vaultImplementation = (await deployArtifact(ctx, owner, vaultArt)).address;
  const vault = (await deployArtifact(ctx, owner, proxyArt, [vaultImplementation, encodeFunctionData({ abi: vaultArt.abi, functionName: "initialize", args: [upgradeTimelock, token] })])).address;
  log(`VaultV2 proxy ${vault} -> implementation ${vaultImplementation}, owner = timelock`);
  const legacyImpl = (await deployArtifact(ctx, owner, legacyArt)).address;
  const legacyVault = (await deployArtifact(ctx, owner, proxyArt, [legacyImpl, encodeFunctionData({ abi: legacyArt.abi, functionName: "initialize", args: [ownerAddress, token] })])).address;
  log(`VulnerableVault proxy ${legacyVault} (deliberately NOT listed in any release)`);
  const unauditedImpl = (await deployArtifact(ctx, owner, loadArtifact("VaultV3Unaudited"))).address;
  log(`VaultV3Unaudited implementation ${unauditedImpl} (upgrade-alert target)`);

  const farm = (await deployArtifact(ctx, owner, farmArt, [token, token, ownerAddress])).address;
  await send(ctx, await write(ctx, owner, { address: token, abi: tokenArt.abi, functionName: "approve", args: [farm, rewards.amount] }), "pUSD approve for the farm");
  const fundRewardsTx = await send(ctx, await write(ctx, owner, { address: farm, abi: farmArt.abi, functionName: "fundRewards", args: [rewards.amount, rewards.durationSeconds] }), "fundRewards");
  log(`MirrorYieldFarm ${farm} (rewards funded: ${rewards.amount} base units over ${rewards.durationSeconds}s)`);

  const marketplace = (await deployArtifact(ctx, owner, loadArtifact("PermitMarketplace"), [token, nft])).address;
  log(`PermitMarketplace ${marketplace}`);

  return {
    chainId: ctx.chain.id,
    blockNumber: Number(await ctx.pub.getBlockNumber()),
    owner: ownerAddress,
    upgradeDelaySeconds: delay,
    shared: { token, nft },
    fundRewardsTx,
    apps: {
      vaultlab: {
        contracts: { vault, vaultImplementation, token, upgradeTimelock },
        unlisted: { legacyVault, legacyVaultImplementation: legacyImpl, unauditedImpl },
        monitors: [
          { kind: "proxy", address: vault, label: "VaultV2 proxy (Upgraded events)" },
          { kind: "upgrade-timelock", address: upgradeTimelock, label: "VaultV2 upgrade timelock" },
        ],
      },
      mirroryield: { contracts: { farm, token }, unlisted: { attacker: getAddress(attacker) as `0x${string}` }, monitors: [] },
      permitmarket: { contracts: { marketplace, token, nft }, unlisted: {}, monitors: [] },
    },
  };
}

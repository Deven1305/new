import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  concat,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  getCreate2Address,
  keccak256,
  namehash,
  parseEventLogs,
  stringToHex,
  toBytes,
  zeroAddress,
  type Abi,
  type Hex,
} from "viem";
import { normalize } from "viem/ens";
import { dnsEncode, formatRevocations, parseRevocations, REVOKED_KEY } from "@pramaan/verifier-core";
import { adminOf, ethRegistrarAbi, ethRegistryAbi, permissionedResolverAbi, REGISTRY_ROLES, ROLES, timelockAbi, userRegistryAbi, verifiableFactoryAbi } from "./abis.js";
import { loadArtifact, loadEnsv2Config, REPO_ROOT, send, withMargin, write, type ChainCtx, type Ensv2Config, type Signer } from "./chain.js";
import { labelOf, RECORD_KEY, registerName } from "./ens.js";
import type { Address, DemoMonitor, DemoNegativeTest } from "./demo-state.js";



/** Owner-set record holding the app's PramaanTimelock address; the verifier uses it for pending/replay checks. */
export const TIMELOCK_RECORD_KEY = "pramaan.timelock";
export { REVOKED_KEY };
export const DEFAULT_TIMELOCK_DELAY_SECONDS = 120;
/** Deterministic CREATE2 deployer (Arachnid), present on Sepolia and on anvil forks of it. */
export const CREATE2_DEPLOYER: Address = "0x4e59b44847b379578588920cA78FbF26c0B4956C";

/**
 * Roles the OWNER (cold key) gets on its own UserRegistry and on each app's PermissionedResolver: every role and its
 * admin, as in the ENS docs' VerifiableFactory example. Nobody else gets any root role on either contract.
 */
export const OWNER_ROOT_ROLES = ROLES.ALL_ROLES;
/** Token roles for each app subname (the owner also holds them through the registry root, so these are informative). */
export const SUBNAME_TOKEN_ROLES =
  REGISTRY_ROLES.ROLE_SET_RESOLVER |
  adminOf(REGISTRY_ROLES.ROLE_SET_RESOLVER) |
  REGISTRY_ROLES.ROLE_SET_SUBREGISTRY |
  adminOf(REGISTRY_ROLES.ROLE_SET_SUBREGISTRY) |
  REGISTRY_ROLES.ROLE_RENEW |
  adminOf(REGISTRY_ROLES.ROLE_RENEW) |
  REGISTRY_ROLES.ROLE_CAN_TRANSFER_ADMIN;

export interface IdentityConfig extends Ensv2Config {
  userRegistryImpl: Address;
  rootRegistry: Address;
  labelStore: Address;
}

/** ENSv2 config plus the UserRegistry implementation (env ENSV2_USER_REGISTRY_IMPL overrides after a Sepolia reset). */
export function loadIdentityConfig(path = join(REPO_ROOT, "config", "ensv2.sepolia.json")): IdentityConfig {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
  const pick = (key: string, env: string) => getAddress(String(process.env[env] ?? raw[key])) as Address;
  return {
    ...loadEnsv2Config(path),
    userRegistryImpl: pick("userRegistryImpl", "ENSV2_USER_REGISTRY_IMPL"),
    rootRegistry: pick("rootRegistry", "ENSV2_ROOT_REGISTRY"),
    labelStore: pick("labelStore", "ENSV2_LABEL_STORE"),
  };
}

// --- deterministic addresses (makes every step idempotent: re-running resumes instead of redeploying) ---

const salt3 = (tag: string, node: Hex, version: bigint) =>
  BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }], [keccak256(stringToHex(tag)), node, version])));
/** ENS docs salt scheme for registries: keccak256("UserRegistry", namehash, version). */
export const userRegistrySalt = (name: string, version = 0n) => salt3("UserRegistry", namehash(normalize(name)), version);
export const resolverSalt = (name: string, version = 0n) => salt3("PramaanResolver", namehash(normalize(name)), version);
export const timelockSalt = (name: string, version = 0n) => `0x${salt3("PramaanTimelock", namehash(normalize(name)), version).toString(16).padStart(64, "0")}` as Hex;

export async function predictProxy(ctx: ChainCtx, ens: Ensv2Config, deployer: Address, salt: bigint): Promise<Address> {
  return getAddress(await ctx.pub.readContract({ address: ens.verifiableFactory, abi: verifiableFactoryAbi, functionName: "predictProxyAddress", args: [deployer, salt] })) as Address;
}

async function hasCode(ctx: ChainCtx, address: Address): Promise<boolean> {
  return ((await ctx.pub.getCode({ address })) ?? "0x") !== "0x";
}

async function deployProxy(ctx: ChainCtx, owner: Signer, ens: Ensv2Config, implementation: Address, salt: bigint, init: Hex, what: string): Promise<{ address: Address; txHash: Hex }> {
  const txHash = await write(ctx, owner, { address: ens.verifiableFactory, abi: verifiableFactoryAbi, functionName: "deployProxy", args: [implementation, salt, init] });
  const receipt = await ctx.pub.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`${what} deployment reverted (${txHash})`);
  const [event] = parseEventLogs({ abi: verifiableFactoryAbi, logs: receipt.logs, eventName: "ProxyDeployed" });
  if (!event) throw new Error(`${what}: ProxyDeployed event not found`);
  return { address: getAddress(event.args.proxyAddress) as Address, txHash };
}

/** CREATE2 through the deterministic deployer, so a re-run finds the same timelock instead of deploying another. */
export function timelockInitCode(args: { resolver: Address; ensName: string; delaySeconds: number; proposer: Address; guardian: Address }): Hex {
  const art = loadArtifact("PramaanTimelock");
  return encodeDeployData({ abi: art.abi as Abi, bytecode: art.bytecode, args: [args.resolver, dnsEncode(args.ensName), BigInt(args.delaySeconds), args.proposer, args.guardian] });
}

export function predictTimelock(initCode: Hex, salt: Hex): Address {
  return getCreate2Address({ from: CREATE2_DEPLOYER, salt, bytecodeHash: keccak256(initCode) }) as Address;
}

async function deployTimelockDeterministic(ctx: ChainCtx, owner: Signer, initCode: Hex, salt: Hex): Promise<{ address: Address; txHash: Hex | null }> {
  const address = predictTimelock(initCode, salt);
  if (await hasCode(ctx, address)) return { address, txHash: null };
  if (!(await hasCode(ctx, CREATE2_DEPLOYER))) throw new Error(`CREATE2 deployer ${CREATE2_DEPLOYER} has no code on chain ${ctx.chain.id}`);
  const data = concat([salt, initCode]);
  const gas = withMargin(await ctx.pub.estimateGas({ account: owner.account, to: CREATE2_DEPLOYER, data }));
  const txHash = await owner.sendTransaction({ account: owner.account, chain: ctx.chain, to: CREATE2_DEPLOYER, data, gas });
  await send(ctx, txHash, "timelock deployment");
  if (!(await hasCode(ctx, address))) throw new Error(`timelock not found at the predicted address ${address}`);
  return { address, txHash };
}

// --- inputs / outputs ---

export interface AppIdentityInput {
  /** Demo app id, e.g. "vaultlab". */
  id: string;
  /** Subname label, e.g. "vaultlab" → vaultlab.<parent>.eth. */
  label: string;
  /** Origin the app is served from (pramaan.domain). */
  domain: string;
  /** "p256-spki:…" release-key record (required for attestation "key"). */
  signerSpki?: string;
  attestation: "key" | "github" | `github:${string}`;
  repo?: string;
  /** Optional extra owner records (e.g. url, description). Keys starting with "pramaan." are refused. */
  extraRecords?: Record<string, string>;
}

export interface SetupAppIdentitiesInput {
  ens?: IdentityConfig;
  /** Cold key: registers the parent, owns the subregistry, every resolver and every subname. */
  owner: Signer;
  /** Release CI key: may only queue pointers in the timelocks. */
  proposer: Signer | Address;
  /** Cancels queued pointers and writes pramaan.revoked. */
  guardian: Signer | Address;
  /** Label of the parent .eth name, e.g. "pramaan-demo" → pramaan-demo.eth. */
  parentLabel: string;
  apps: AppIdentityInput[];
  timelockDelaySeconds?: number;
  /** Registration length for the parent (default one year). */
  registrationSeconds?: bigint;
  /** Mine the reverting negative-test transactions (explorer evidence). Default: only on a local chain. */
  broadcastNegativeTests?: boolean;
  /** Salt version; bump it to deploy a fresh set of contracts for the same names. */
  version?: bigint;
  log?: (msg: string) => void;
  /** Called after each completed step with the partial result (persist it to resume / audit). */
  onCheckpoint?: (partial: AppIdentitiesResult) => void;
}

export interface AppIdentity {
  id: string;
  label: string;
  ensName: string;
  tokenId: string;
  resolver: Address;
  timelock: Address;
  records: Record<string, string>;
  txs: Hex[];
}

export interface IdentityNegativeTest extends DemoNegativeTest {
  app: string;
  actor: "proposer" | "guardian" | "timelock" | "owner";
  /** Positive controls are expected to SUCCEED (they show the negative tests are not vacuous). */
  expect: "revert" | "success";
  ok: boolean;
}

export interface AppIdentitiesResult {
  chainId: number;
  parent: string;
  parentLabel: string;
  parentTokenId: string | null;
  parentExpiry: number | null;
  subregistry: Address | null;
  registrationTxs: Hex[];
  delaySeconds: number;
  accounts: { owner: Address; proposer: Address; guardian: Address };
  apps: Record<string, AppIdentity>;
  negativeTests: IdentityNegativeTest[];
  /** Transactions sent by this run (resumed steps send none). */
  txCount: number;
  complete: boolean;
}

const addressOf = (a: Signer | Address): Address => (typeof a === "string" ? (getAddress(a) as Address) : (a.account.address as Address));

function validateInput(input: SetupAppIdentitiesInput): void {
  if (!/^[a-z0-9-]{3,63}$/.test(input.parentLabel) || input.parentLabel.startsWith("-") || input.parentLabel.endsWith("-")) {
    throw new Error(`invalid parent label "${input.parentLabel}" (3-63 chars a-z, 0-9, -)`);
  }
  const owner = addressOf(input.owner);
  const proposer = addressOf(input.proposer);
  const guardian = addressOf(input.guardian);
  if (new Set([owner, proposer, guardian].map((a) => a.toLowerCase())).size !== 3) throw new Error("owner, proposer and guardian must be three different accounts (least privilege)");
  if (input.apps.length === 0 || input.apps.length > 10) throw new Error("expected 1-10 apps");
  const ids = new Set<string>();
  for (const app of input.apps) {
    if (!/^[a-z0-9-]{1,63}$/.test(app.label)) throw new Error(`invalid subname label "${app.label}"`);
    if (ids.has(app.label)) throw new Error(`duplicate subname label "${app.label}"`);
    ids.add(app.label);
    let url: URL;
    try {
      url = new URL(app.domain);
    } catch {
      throw new Error(`${app.id}: domain "${app.domain}" is not a URL`);
    }
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.origin !== app.domain.replace(/\/$/, "")) throw new Error(`${app.id}: domain must be a bare origin like https://app.example`);
    if (app.attestation === "key" && !app.signerSpki?.startsWith("p256-spki:")) throw new Error(`${app.id}: attestation "key" needs signerSpki = p256-spki:…`);
    if (app.attestation !== "key" && !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(app.repo ?? "")) throw new Error(`${app.id}: GitHub attestation needs repo = https://github.com/<owner>/<repo>`);
    for (const k of Object.keys(app.extraRecords ?? {})) if (k.startsWith("pramaan.")) throw new Error(`${app.id}: extra record "${k}" may not use the pramaan. prefix`);
  }
  const delay = input.timelockDelaySeconds ?? DEFAULT_TIMELOCK_DELAY_SECONDS;
  if (!Number.isInteger(delay) || delay < 60 || delay > 30 * 86400) throw new Error("timelock delay must be 60 s … 30 days");
}

/** Owner records written inside the resolver's initialize() (role checks are skipped there, one transaction). */
export function ownerRecords(app: AppIdentityInput, timelock: Address): Record<string, string> {
  const r: Record<string, string> = { "pramaan.domain": app.domain.replace(/\/$/, ""), "pramaan.attestation": app.attestation, [TIMELOCK_RECORD_KEY]: timelock, url: app.domain.replace(/\/$/, "") };
  if (app.signerSpki) r["pramaan.signer"] = app.signerSpki;
  if (app.repo) r["pramaan.repo"] = app.repo;
  return { ...r, ...(app.extraRecords ?? {}) };
}

const resource = (key: string) => BigInt(keccak256(toBytes(key)));

async function grantKeyRole(ctx: ChainCtx, owner: Signer, resolver: Address, key: string, account: Address): Promise<Hex | null> {
  const has = await ctx.pub.readContract({ address: resolver, abi: permissionedResolverAbi, functionName: "hasRoles", args: [resource(key), ROLES.ROLE_SET_TEXT, account] });
  if (has) return null;
  const setter = encodeFunctionData({ abi: permissionedResolverAbi, functionName: "setText", args: ["0x", key, ""] });
  return send(ctx, await write(ctx, owner, { address: resolver, abi: permissionedResolverAbi, functionName: "grantSetterRoles", args: [setter, account] }), `grantSetterRoles(${key})`);
}

/**
 * Creates (or resumes) the hierarchical release identities on ENSv2:
 *
 *   <parent>.eth          ETHRegistry token owned by `owner`, subregistry = owner's UserRegistry (VerifiableFactory proxy)
 *   └ <label>.<parent>.eth  registered in that UserRegistry, resolver = the app's own PermissionedResolver
 *       resolver roles: owner = all; app PramaanTimelock = ROLE_SET_TEXT on "pramaan.record" only;
 *                       guardian = ROLE_SET_TEXT on "pramaan.revoked" only; proposer = nothing.
 *
 * Every address is deterministic (VerifiableFactory salts, CREATE2 timelocks) and every step checks chain state first,
 * so the same call resumes an interrupted Sepolia run without redeploying. Testnet/local only.
 */
export async function setupAppIdentities(ctx: ChainCtx, input: SetupAppIdentitiesInput): Promise<AppIdentitiesResult> {
  if (ctx.chain.id === 1) throw new Error("identity setup from this tool is testnet-only");
  validateInput(input);
  const ens = input.ens ?? loadIdentityConfig();
  const log = input.log ?? (() => undefined);
  const owner = input.owner;
  const me = owner.account.address as Address;
  const proposer = addressOf(input.proposer);
  const guardian = addressOf(input.guardian);
  const delaySeconds = input.timelockDelaySeconds ?? DEFAULT_TIMELOCK_DELAY_SECONDS;
  const version = input.version ?? 0n;
  const parent = `${input.parentLabel}.eth`;
  const result: AppIdentitiesResult = {
    chainId: ctx.chain.id,
    parent,
    parentLabel: input.parentLabel,
    parentTokenId: null,
    parentExpiry: null,
    subregistry: null,
    registrationTxs: [],
    delaySeconds,
    accounts: { owner: me, proposer, guardian },
    apps: {},
    negativeTests: [],
    txCount: 0,
    complete: false,
  };
  const tx = (h: Hex | null, bucket: Hex[]) => {
    if (h) {
      bucket.push(h);
      result.txCount++;
    }
  };
  const checkpoint = () => input.onCheckpoint?.(structuredClone(result));

  for (const [name, address] of Object.entries({ ethRegistrar: ens.ethRegistrar, ethRegistry: ens.ethRegistry, verifiableFactory: ens.verifiableFactory, permissionedResolverImpl: ens.permissionedResolverImpl, userRegistryImpl: ens.userRegistryImpl, universalResolver: ens.universalResolver })) {
    if (!(await hasCode(ctx, address))) throw new Error(`ENSv2 ${name} ${address} has no code on chain ${ctx.chain.id} (Sepolia ENS reset? see config/ensv2.sepolia.json)`);
  }

  // 1. The owner's UserRegistry for <parent>.eth.
  const regSalt = userRegistrySalt(parent, version);
  const subregistry = await predictProxy(ctx, ens, me, regSalt);
  if (await hasCode(ctx, subregistry)) {
    const ok = await ctx.pub.readContract({ address: subregistry, abi: userRegistryAbi, functionName: "hasRootRoles", args: [REGISTRY_ROLES.ROLE_REGISTRAR, me] });
    if (!ok) throw new Error(`subregistry ${subregistry} exists but the owner has no registrar role on it`);
    log(`subregistry ${subregistry} (already deployed)`);
  } else {
    const init = encodeFunctionData({ abi: userRegistryAbi, functionName: "initialize", args: [[{ account: me, roleBitmap: OWNER_ROOT_ROLES }]] });
    const d = await deployProxy(ctx, owner, ens, ens.userRegistryImpl, regSalt, init, "UserRegistry");
    if (d.address !== subregistry) throw new Error(`UserRegistry deployed at ${d.address}, predicted ${subregistry}`);
    tx(d.txHash, result.registrationTxs);
    log(`subregistry ${subregistry} (UserRegistry proxy via VerifiableFactory)`);
  }
  result.subregistry = subregistry;
  const [parentRegistry, parentOfLabel] = await ctx.pub.readContract({ address: subregistry, abi: userRegistryAbi, functionName: "getParent" });
  if (getAddress(parentRegistry) !== getAddress(ens.ethRegistry) || parentOfLabel !== input.parentLabel) {
    tx(await send(ctx, await write(ctx, owner, { address: subregistry, abi: userRegistryAbi, functionName: "setParent", args: [ens.ethRegistry, input.parentLabel] }), "setParent"), result.registrationTxs);
    log(`subregistry canonical parent set to ${parent}`);
  }
  checkpoint();

  // 2. The parent name, registered (commit → wait → register, MockUSDC) straight onto the subregistry.
  const label = labelOf(parent);
  const currentOwner = getAddress(await ctx.pub.readContract({ address: ens.ethRegistry, abi: ethRegistryAbi, functionName: "findOwner", args: [label] }));
  if (currentOwner === getAddress(zeroAddress)) {
    const available = await ctx.pub.readContract({ address: ens.ethRegistrar, abi: ethRegistrarAbi, functionName: "isAvailable", args: [label] });
    if (!available) throw new Error(`${parent} is not available (in grace period or reserved)`);
    log(`registering ${parent} with subregistry ${subregistry}`);
    const reg = await registerName(ctx, owner, ens, parent, zeroAddress, log, { subregistry, durationSeconds: input.registrationSeconds });
    for (const h of reg.txHashes) tx(h, result.registrationTxs);
  } else if (currentOwner !== getAddress(me)) {
    throw new Error(`${parent} is owned by ${currentOwner}, not the owner key ${me}: choose another --parent label`);
  }
  const parentTokenId = await ctx.pub.readContract({ address: ens.ethRegistry, abi: ethRegistryAbi, functionName: "findTokenId", args: [label] });
  const attached = getAddress(await ctx.pub.readContract({ address: ens.ethRegistry, abi: ethRegistryAbi, functionName: "getSubregistry", args: [label] }));
  if (attached !== subregistry) {
    tx(await send(ctx, await write(ctx, owner, { address: ens.ethRegistry, abi: ethRegistryAbi, functionName: "setSubregistry", args: [parentTokenId, subregistry] }), "setSubregistry"), result.registrationTxs);
    log(`${parent} subregistry → ${subregistry}`);
  }
  const parentExpiry = await ctx.pub.readContract({ address: ens.ethRegistry, abi: ethRegistryAbi, functionName: "getExpiry", args: [parentTokenId] });
  result.parentTokenId = parentTokenId.toString();
  result.parentExpiry = Number(parentExpiry);
  checkpoint();

  // 3. Per app: timelock (CREATE2) → resolver (VerifiableFactory, records in initialize) → key-scoped roles → subname.
  for (const app of input.apps) {
    const ensName = `${app.label}.${parent}`;
    const txs: Hex[] = [];
    const rSalt = resolverSalt(ensName, version);
    const resolver = await predictProxy(ctx, ens, me, rSalt);
    const initCode = timelockInitCode({ resolver, ensName, delaySeconds, proposer, guardian });
    const tl = await deployTimelockDeterministic(ctx, owner, initCode, timelockSalt(ensName, version));
    tx(tl.txHash, txs);
    const records = ownerRecords(app, tl.address);
    if (await hasCode(ctx, resolver)) {
      log(`${ensName}: resolver ${resolver} (already deployed)`);
    } else {
      const name = dnsEncode(ensName);
      const calls = Object.entries(records).map(([k, v]) => encodeFunctionData({ abi: permissionedResolverAbi, functionName: "setText", args: [name, k, v] }));
      const init = encodeFunctionData({ abi: permissionedResolverAbi, functionName: "initialize", args: [[{ account: me, roleBitmap: OWNER_ROOT_ROLES }], calls] });
      const d = await deployProxy(ctx, owner, ens, ens.permissionedResolverImpl, rSalt, init, `${ensName} resolver`);
      if (d.address !== resolver) throw new Error(`resolver deployed at ${d.address}, predicted ${resolver}`);
      tx(d.txHash, txs);
      log(`${ensName}: resolver ${resolver} (owner records written in initialize)`);
    }
    tx(await grantKeyRole(ctx, owner, resolver, RECORD_KEY, tl.address), txs);
    tx(await grantKeyRole(ctx, owner, resolver, REVOKED_KEY, guardian), txs);
    const subOwner = getAddress(await ctx.pub.readContract({ address: subregistry, abi: userRegistryAbi, functionName: "findOwner", args: [app.label] }));
    if (subOwner === getAddress(zeroAddress)) {
      tx(
        await send(ctx, await write(ctx, owner, { address: subregistry, abi: userRegistryAbi, functionName: "register", args: [app.label, me, zeroAddress, resolver, SUBNAME_TOKEN_ROLES, parentExpiry] }), `register(${app.label})`),
        txs,
      );
    } else if (subOwner !== getAddress(me)) {
      throw new Error(`${ensName} is owned by ${subOwner}`);
    }
    const tokenId = await ctx.pub.readContract({ address: subregistry, abi: userRegistryAbi, functionName: "findTokenId", args: [app.label] });
    const currentResolver = getAddress(await ctx.pub.readContract({ address: subregistry, abi: userRegistryAbi, functionName: "getResolver", args: [app.label] }));
    if (currentResolver !== resolver) {
      tx(await send(ctx, await write(ctx, owner, { address: subregistry, abi: userRegistryAbi, functionName: "setResolver", args: [tokenId, resolver] }), "setResolver"), txs);
    }
    log(`${ensName}: timelock ${tl.address} (ROLE_SET_TEXT on pramaan.record only, ${delaySeconds}s), guardian ROLE_SET_TEXT on pramaan.revoked only`);
    result.apps[app.id] = { id: app.id, label: app.label, ensName, tokenId: tokenId.toString(), resolver, timelock: tl.address, records, txs };
    checkpoint();
  }

  // 4. Negative tests (and positive controls) for every app.
  result.negativeTests = await identityNegativeTests(ctx, ens, result, {
    proposer: input.proposer,
    guardian: input.guardian,
    owner,
    broadcast: input.broadcastNegativeTests ?? ctx.local,
  });
  const broken = result.negativeTests.filter((t) => !t.ok);
  if (broken.length) throw new Error(`role boundary check failed: ${broken.map((b) => `${b.app}/${b.actor}: ${b.attempt}`).join("; ")}`);
  result.complete = true;
  checkpoint();
  return result;
}

interface Attempt {
  actor: IdentityNegativeTest["actor"];
  attempt: string;
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  expect: "revert" | "success";
  broadcastable?: boolean;
}

/**
 * Tries every forbidden write as the proposer, the guardian and the timelock (eth_call from that address; the
 * timelock's own address needs no key), plus positive controls that must succeed. With `broadcast`, the reverting
 * proposer/guardian attempts on pramaan.record are also mined as transactions (explorer evidence; costs gas).
 */
export async function identityNegativeTests(
  ctx: ChainCtx,
  ens: IdentityConfig,
  identity: AppIdentitiesResult,
  actors: { proposer: Signer | Address; guardian: Signer | Address; owner: Signer | Address; broadcast?: boolean },
): Promise<IdentityNegativeTest[]> {
  const out: IdentityNegativeTest[] = [];
  const proposer = addressOf(actors.proposer);
  const guardian = addressOf(actors.guardian);
  const owner = addressOf(actors.owner);
  const sub = identity.subregistry!;
  const parentToken = BigInt(identity.parentTokenId ?? "0");
  for (const app of Object.values(identity.apps)) {
    const name = dnsEncode(app.ensName);
    const token = BigInt(app.tokenId);
    const recordSetter = encodeFunctionData({ abi: permissionedResolverAbi, functionName: "setText", args: ["0x", RECORD_KEY, ""] });
    /** An attempt against the app's resolver; the caller is derived from `actor`. */
    const r = (actor: Attempt["actor"], attempt: string, fn: string, args: readonly unknown[], extra: Partial<Attempt> = {}): Attempt => ({
      actor,
      attempt,
      address: app.resolver,
      abi: permissionedResolverAbi as Abi,
      functionName: fn,
      args,
      expect: "revert",
      ...extra,
    });
    const evil = `pramaan:v1:evil:${"0".repeat(64)}`;
    const attempts: Attempt[] = [
      r("proposer", 'setText("pramaan.record") directly', "setText", [name, RECORD_KEY, evil], { broadcastable: true }),
      r("proposer", 'setText("pramaan.domain")', "setText", [name, "pramaan.domain", "https://evil.example"]),
      r("proposer", 'setText("pramaan.revoked")', "setText", [name, REVOKED_KEY, ""]),
      r("proposer", 'setText("url")', "setText", [name, "url", "https://evil.example"]),
      r("proposer", "setAddress(ETH)", "setAddress", [name, 60n, proposer]),
      r("proposer", "grantSetterRoles(pramaan.record → self)", "grantSetterRoles", [recordSetter, proposer]),
      r("proposer", "revokeRoles(timelock's pramaan.record role)", "revokeRoles", [resource(RECORD_KEY), ROLES.ROLE_SET_TEXT, app.timelock]),
      r("proposer", "upgrade the resolver", "upgradeToAndCall", [ens.permissionedResolverImpl, "0x"]),
      { actor: "proposer", attempt: "subregistry.setResolver(app)", address: sub, abi: userRegistryAbi as Abi, functionName: "setResolver", args: [token, proposer], expect: "revert" },
      { actor: "proposer", attempt: 'subregistry.register("evil")', address: sub, abi: userRegistryAbi as Abi, functionName: "register", args: ["evil", proposer, zeroAddress, proposer, 0n, BigInt(identity.parentExpiry ?? 0)], expect: "revert" },
      { actor: "proposer", attempt: "ETHRegistry.setSubregistry(parent)", address: ens.ethRegistry, abi: ethRegistryAbi as Abi, functionName: "setSubregistry", args: [parentToken, proposer], expect: "revert" },
      { actor: "proposer", attempt: "ETHRegistry.setResolver(parent)", address: ens.ethRegistry, abi: ethRegistryAbi as Abi, functionName: "setResolver", args: [parentToken, proposer], expect: "revert" },
      r("guardian", 'setText("pramaan.record") directly', "setText", [name, RECORD_KEY, evil], { broadcastable: true }),
      r("guardian", 'setText("pramaan.domain")', "setText", [name, "pramaan.domain", "https://evil.example"]),
      r("guardian", "grantSetterRoles(pramaan.record → self)", "grantSetterRoles", [recordSetter, guardian]),
      { actor: "guardian", attempt: "subregistry.setResolver(app)", address: sub, abi: userRegistryAbi as Abi, functionName: "setResolver", args: [token, guardian], expect: "revert" },
      { actor: "guardian", attempt: "ETHRegistry.setSubregistry(parent)", address: ens.ethRegistry, abi: ethRegistryAbi as Abi, functionName: "setSubregistry", args: [parentToken, guardian], expect: "revert" },
      r("timelock", 'setText("pramaan.domain") from the timelock address', "setText", [name, "pramaan.domain", "https://evil.example"]),
      r("timelock", 'setText("pramaan.signer") from the timelock address', "setText", [name, "pramaan.signer", "p256-spki:evil"]),
      r("timelock", 'setText("pramaan.revoked") from the timelock address', "setText", [name, REVOKED_KEY, ""]),
      { actor: "timelock", attempt: "subregistry.setResolver(app) from the timelock address", address: sub, abi: userRegistryAbi as Abi, functionName: "setResolver", args: [token, app.timelock], expect: "revert" },
      // Positive controls: the intended holders CAN do exactly their job.
      r("timelock", 'control: timelock may setText("pramaan.record")', "setText", [name, RECORD_KEY, evil], { expect: "success" }),
      r("guardian", 'control: guardian may setText("pramaan.revoked")', "setText", [name, REVOKED_KEY, ""], { expect: "success" }),
      { actor: "owner", attempt: "control: owner may set the app resolver", address: sub, abi: userRegistryAbi as Abi, functionName: "setResolver", args: [token, app.resolver], expect: "success" },
    ];
    for (const a of attempts) {
      const from = a.actor === "proposer" ? proposer : a.actor === "guardian" ? guardian : a.actor === "owner" ? owner : app.timelock;
      let reverted: boolean;
      let detail: string;
      try {
        await ctx.pub.simulateContract({ address: a.address, abi: a.abi, functionName: a.functionName as never, args: a.args as never, account: from });
        reverted = false;
        detail = "call succeeds";
      } catch (err) {
        reverted = true;
        detail = (err as Error).message.split("\n").find((l) => /EAC|revert|Error/i.test(l))?.trim().slice(0, 200) ?? "reverted";
      }
      let txHash: Hex | null = null;
      const signer = a.actor === "proposer" ? actors.proposer : a.actor === "guardian" ? actors.guardian : null;
      if (actors.broadcast && a.broadcastable && reverted && signer && typeof signer !== "string") {
        txHash = await signer.writeContract({ address: a.address, abi: a.abi, functionName: a.functionName as never, args: a.args as never, account: signer.account, chain: ctx.chain, gas: 300_000n } as never);
        const receipt = await ctx.pub.waitForTransactionReceipt({ hash: txHash });
        if (receipt.status === "success") reverted = false;
      }
      out.push({ app: app.id, actor: a.actor, attempt: a.attempt, reverted, detail, txHash, expect: a.expect, ok: a.expect === "revert" ? reverted : !reverted });
    }
  }
  return out;
}

// --- revocation (guardian, immediate) ---

/** Reads one text record straight from a PermissionedResolver (ENSIP-10 resolve(name, text(node, key))). */
export async function readResolverText(ctx: ChainCtx, resolver: Address, ensName: string, key: string): Promise<string> {
  const call = encodeFunctionData({ abi: permissionedResolverAbi, functionName: "text", args: [namehash(normalize(ensName)), key] });
  const raw = await ctx.pub.readContract({ address: resolver, abi: permissionedResolverAbi, functionName: "resolve", args: [dnsEncode(ensName), call] });
  return decodeFunctionResult({ abi: permissionedResolverAbi, functionName: "text", data: raw });
}

export async function readRevocations(ctx: ChainCtx, resolver: Address, ensName: string): Promise<string[]> {
  const value = await readResolverText(ctx, resolver, ensName, REVOKED_KEY);
  const parsed = parseRevocations(value);
  if (!parsed.ok) throw new Error(`${ensName}: ${parsed.reason}`);
  return parsed.revoked;
}

/**
 * Adds a manifest sha256 to `pramaan.revoked` (guardian key, ROLE_SET_TEXT on that key only). Takes effect at once:
 * verifiers show the release as revoked (red) from the next block. Refuses a full list rather than dropping entries.
 */
export async function revokeRelease(ctx: ChainCtx, guardian: Signer, args: { resolver: Address; ensName: string; manifestSha256: string }): Promise<{ txHash: Hex | null; revoked: string[] }> {
  const digest = args.manifestSha256.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error("manifestSha256 must be 64 hex characters");
  const current = await readRevocations(ctx, args.resolver, args.ensName);
  if (current.includes(digest)) return { txHash: null, revoked: current };
  const value = formatRevocations([...current, digest]); // throws when the list is full
  const txHash = await send(
    ctx,
    await write(ctx, guardian, { address: args.resolver, abi: permissionedResolverAbi, functionName: "setText", args: [dnsEncode(args.ensName), REVOKED_KEY, value] }),
    "setText(pramaan.revoked)",
  );
  return { txHash, revoked: [...current, digest] };
}

/** Monitors for the WATCH side (server / CRE): the parent registry entry, the subregistry, resolver and timelock. */
export function identityMonitors(identity: AppIdentitiesResult, appId: string, ens: Pick<Ensv2Config, "ethRegistry"> = loadEnsv2Config()): DemoMonitor[] {
  const app = identity.apps[appId];
  if (!app) throw new Error(`unknown app ${appId}`);
  return [
    { kind: "timelock", address: app.timelock, label: `${app.ensName} PramaanTimelock` },
    { kind: "resolver", address: app.resolver, label: `${app.ensName} PermissionedResolver` },
    ...(identity.subregistry ? [{ kind: "registry" as const, address: identity.subregistry, label: `${identity.parent} UserRegistry` }] : []),
    { kind: "registry", address: ens.ethRegistry, label: `.eth registry (${identity.parent})` },
  ];
}

/** Read-only status of an identity (for `pramaan ens status` and the doctor). */
export async function readTimelockOps(ctx: ChainCtx, timelock: Address) {
  const [count, last] = await Promise.all([
    ctx.pub.readContract({ address: timelock, abi: timelockAbi, functionName: "operationCount" }),
    ctx.pub.readContract({ address: timelock, abi: timelockAbi, functionName: "lastExecutedId" }),
  ]);
  return { operationCount: count, lastExecutedId: last };
}

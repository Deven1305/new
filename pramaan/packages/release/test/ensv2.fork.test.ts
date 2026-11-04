import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodePointer, generateReleaseKey, parsePointer } from "@pramaan/manifest";
import { readPramaanRecords } from "@pramaan/verifier-core";
import {
  assembleRelease,
  connect,
  deployDemoContracts,
  deployResolver,
  deployTimelock,
  executeOp,
  freshLocalSigner,
  grantRecordRole,
  hasRecordRole,
  loadEnsv2Config,
  nameStatus,
  negativeWriteTest,
  queuePointer,
  readTimelock,
  registerName,
  waitSeconds,
  type ChainCtx,
} from "../src/index.js";
import { startAnvil, type Anvil } from "../../verifier-core/test/helpers/anvil.js";

/**
 * Full PUBLISH flow against the REAL ENSv2 contracts, on an anvil fork of Sepolia (free test funds, chain id 31337).
 * Needs network access to a Sepolia RPC that serves historical state; set PRAMAAN_FORK_RPC to override.
 */
const FORK_RPC = process.env.PRAMAAN_FORK_RPC ?? "https://sepolia.gateway.tenderly.co";
const ens = loadEnsv2Config();
const ensName = `pramaan-test-${Math.floor(Date.now() / 1000).toString(36)}.eth`;
let anvil: Anvil | null = null;
let ctx: ChainCtx;
let online = true;
let owner: Awaited<ReturnType<typeof freshLocalSigner>>;
let proposer: Awaited<ReturnType<typeof freshLocalSigner>>;
let anyone: Awaited<ReturnType<typeof freshLocalSigner>>;

beforeAll(async () => {
  try {
    anvil = await startAnvil({ forkUrl: FORK_RPC, chainId: 31337 });
    ctx = await connect(anvil.url, ens);
    owner = await freshLocalSigner(ctx, "owner");
    proposer = await freshLocalSigner(ctx, "proposer");
    anyone = await freshLocalSigner(ctx, "anyone");
  } catch {
    online = false;
  }
}, 120_000);

afterAll(() => anvil?.stop());

describe("ENSv2 + PramaanTimelock on a Sepolia fork", () => {
  const state: { resolver?: `0x${string}`; timelock?: `0x${string}`; pointer?: string } = {};

  it("finds every configured ENSv2 contract on the fork", async (c) => {
    if (!online) c.skip();
    for (const address of [ens.ethRegistrar, ens.ethRegistry, ens.verifiableFactory, ens.permissionedResolverImpl, ens.universalResolver, ens.mockUsdc]) {
      expect(((await ctx.pub.getCode({ address })) ?? "0x").length).toBeGreaterThan(2);
    }
  });

  it("deploys a dedicated resolver, the timelock, the key-scoped grant and registers the name", async (c) => {
    if (!online) c.skip();
    const key = await generateReleaseKey();
    const { resolver } = await deployResolver(ctx, owner, ens, ensName, { domain: "http://localhost:5180", attestation: "key", signer: key.signerRecord });
    const { timelock } = await deployTimelock(ctx, owner, { resolver, ensName, delaySeconds: 300, proposer: proposer.account.address, guardian: owner.account.address });
    await grantRecordRole(ctx, owner, resolver, timelock);
    expect(await hasRecordRole(ctx, resolver, timelock)).toBe(true);
    expect(await hasRecordRole(ctx, resolver, proposer.account.address)).toBe(false);
    const reg = await registerName(ctx, owner, ens, ensName, resolver);
    expect(reg.tokenId).not.toBe(0n);
    const status = await nameStatus(ctx, ens, ensName);
    expect(status.owner).toBe(owner.account.address);
    expect(status.resolver).toBe(resolver);
    Object.assign(state, { resolver, timelock });
  }, 300_000);

  it("resolves the owner records through the Universal Resolver (viem + verifier-core)", async (c) => {
    if (!online || !state.resolver) c.skip();
    const r = await readPramaanRecords({ chainId: 31337, rpcUrls: [anvil!.url], universalResolver: ens.universalResolver }, ensName);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.records["pramaan.domain"]).toBe("http://localhost:5180");
    expect(r.records["pramaan.attestation"]).toBe("key");
    expect(r.records["pramaan.signer"]).toMatch(/^p256-spki:/);
    expect(r.records["pramaan.record"]).toBeNull();
  }, 120_000);

  it("only the timelock can write pramaan.record, and only after the delay", async (c) => {
    if (!online || !state.timelock) c.skip();
    const pointer = encodePointer("v1.0.0", "a".repeat(64));
    const queued = await queuePointer(ctx, proposer, state.timelock!, pointer);
    const before = await readPramaanRecords({ chainId: 31337, rpcUrls: [anvil!.url], universalResolver: ens.universalResolver }, ensName);
    expect(before.status === "ok" && before.records["pramaan.record"]).toBeNull();
    await expect(executeOp(ctx, proposer, state.timelock!, queued.id)).rejects.toThrow();
    await waitSeconds(ctx, 301);
    await executeOp(ctx, anyone, state.timelock!, queued.id);
    const after = await readPramaanRecords({ chainId: 31337, rpcUrls: [anvil!.url], universalResolver: ens.universalResolver }, ensName);
    expect(after.status === "ok" && after.records["pramaan.record"]).toBe(pointer);
    expect(parsePointer(pointer).ok).toBe(true);
    const tl = await readTimelock(ctx, state.timelock!);
    expect(tl.ops[0]).toMatchObject({ id: queued.id, state: "Executed" });
    state.pointer = pointer;
  }, 300_000);

  it("the CI proposer key cannot write any record directly (negative test)", async (c) => {
    if (!online || !state.resolver) c.skip();
    const results = await negativeWriteTest(ctx, proposer, state.resolver!, ensName, true);
    expect(results.every((r) => r.reverted)).toBe(true);
    expect(results.every((r) => r.txHash)).toBe(true);
  }, 300_000);

  it("deploys the demo dApp contracts and assembles a manifest from live code hashes", async (c) => {
    if (!online) c.skip();
    const deployment = await deployDemoContracts(ctx, owner);
    const site = mkdtempSync(join(tmpdir(), "pramaan-site-"));
    mkdirSync(join(site, "erc7730"));
    writeFileSync(join(site, "index.html"), "<!doctype html><title>vault</title>");
    writeFileSync(join(site, "erc7730", "vault.json"), JSON.stringify({ display: { formats: {} } }));
    const release = await assembleRelease({
      siteDir: site,
      app: { name: "Pramaan Vault", ensName, domain: "http://localhost:5180" },
      repo: "local:pramaan/demo",
      commit: "0".repeat(40),
      tag: "v1.0.0",
      workflow: null,
      ctx,
      deployment,
      findings: [],
      descriptors: [{ address: deployment.vault.address as `0x${string}`, path: "/erc7730/vault.json" }],
    });
    expect(release.manifest.contracts.map((x) => x.label)).toEqual(expect.arrayContaining(["VaultV2", "pUSD", "pNFT"]));
    expect(release.manifest.contracts.find((x) => x.label === "VaultV2")?.proxy?.implAddress).toBe(deployment.vault.implementation);
    expect(release.manifest.contracts.some((x) => x.address === deployment.legacyVault.address)).toBe(false);
    expect(release.pointer).toBe(encodePointer("v1.0.0", release.sha256));
  }, 300_000);
});

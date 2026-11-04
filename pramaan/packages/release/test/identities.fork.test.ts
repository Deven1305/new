import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildManifest, encodePointer, generateReleaseKey, manifestBytes, manifestDigest, releaseStatement, sha256Hex, signStatementWithKey, sriSha384 } from "@pramaan/manifest/node";
import { assessTimelock, dnsEncode, memoryPinStore, readPramaanRecords, readTimelockState, verifySiteRelease } from "@pramaan/verifier-core";
import {
  cancelOp,
  connect,
  deployIdentities,
  executeOp,
  freshLocalSigner,
  loadIdentityConfig,
  queuePointer,
  readRevocations,
  revokeRelease,
  setupAppIdentities,
  timelockAbi,
  waitSeconds,
  type AppIdentitiesResult,
  type ChainCtx,
} from "../src/index.js";
import { startAnvil, type Anvil } from "../../verifier-core/test/helpers/anvil.js";

/**
 * Hierarchical ENSv2 release identities against the REAL Sepolia contracts on an anvil fork, through the same
 * deployIdentities() call `pramaan deploy identities --network sepolia` uses. Fresh keys only.
 */
const FORK_RPC = process.env.PRAMAAN_FORK_RPC ?? "https://sepolia.gateway.tenderly.co";
const ens = loadIdentityConfig();
const parentLabel = `pramaan-ids-${Math.floor(Date.now() / 1000).toString(36)}`;
let anvil: Anvil | null = null;
let ctx: ChainCtx;
let online = true;
let owner: Awaited<ReturnType<typeof freshLocalSigner>>;
let proposer: Awaited<ReturnType<typeof freshLocalSigner>>;
let guardian: Awaited<ReturnType<typeof freshLocalSigner>>;
let anyone: Awaited<ReturnType<typeof freshLocalSigner>>;
let site: Server;
let origin = "";
const routes = new Map<string, Uint8Array | string>();
let key: Awaited<ReturnType<typeof generateReleaseKey>>;
let ids: AppIdentitiesResult;
let outPath = "";
const cfg = () => ({ chainId: 31337, rpcUrls: [anvil!.url], universalResolver: ens.universalResolver, minAgreement: 1 });

beforeAll(async () => {
  site = createServer((req, res) => {
    const body = routes.get(new URL(req.url ?? "/", "http://x").pathname);
    if (body === undefined) return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": "application/json" }).end(body);
  });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  key = await generateReleaseKey();
  try {
    anvil = await startAnvil({ forkUrl: FORK_RPC, chainId: 31337 });
    ctx = await connect(anvil.url, ens);
    owner = await freshLocalSigner(ctx, "owner");
    proposer = await freshLocalSigner(ctx, "proposer");
    guardian = await freshLocalSigner(ctx, "guardian");
    anyone = await freshLocalSigner(ctx, "anyone");
  } catch {
    online = false;
  }
}, 120_000);

afterAll(() => {
  anvil?.stop();
  site?.close();
});

async function gasOf(hashes: readonly `0x${string}`[]): Promise<bigint> {
  let total = 0n;
  for (const hash of hashes) total += (await ctx.pub.getTransactionReceipt({ hash })).gasUsed;
  return total;
}

describe("ENSv2 hierarchical release identities on a Sepolia fork", () => {
  it("registers <parent>.eth with a UserRegistry and three subnames, each with its own resolver + timelock", async (c) => {
    if (!online) c.skip();
    outPath = join(mkdtempSync(join(tmpdir(), "pramaan-ids-")), "31337.json");
    const file = await deployIdentities(ctx, {
      outPath,
      network: "anvil-fork",
      ens,
      owner,
      proposer,
      guardian,
      parentLabel,
      timelockDelaySeconds: 120,
      apps: [
        { id: "vaultlab", label: "vaultlab", domain: origin, attestation: "key", signerSpki: key.signerRecord },
        { id: "mirroryield", label: "mirroryield", domain: "http://localhost:5182", attestation: "key", signerSpki: key.signerRecord },
        { id: "permitmarket", label: "permitmarket", domain: "http://localhost:5184", attestation: "key", signerSpki: key.signerRecord },
      ],
    });
    ids = file.identities;
    expect(ids.complete).toBe(true);
    expect(Object.keys(ids.apps)).toEqual(["vaultlab", "mirroryield", "permitmarket"]);
    expect(new Set(Object.values(ids.apps).map((a) => a.resolver)).size).toBe(3);
    expect(new Set(Object.values(ids.apps).map((a) => a.timelock)).size).toBe(3);
    expect(JSON.parse(readFileSync(outPath, "utf8")).ens.identities.parent).toBe(`${parentLabel}.eth`);
    const parentGas = await gasOf(ids.registrationTxs);
    const appGas = await gasOf(ids.apps["vaultlab"]!.txs);
    console.log(`gas: parent ${parentGas}, per app ${appGas}, total txs ${ids.txCount}`);
  }, 600_000);

  it("every role boundary holds (proposer, guardian, timelock) and the positive controls succeed", async (c) => {
    if (!online || !ids) c.skip();
    expect(ids.negativeTests.length).toBe(3 * 24);
    expect(ids.negativeTests.every((t) => t.ok)).toBe(true);
    expect(ids.negativeTests.filter((t) => t.txHash).length).toBe(6); // mined reverting txs (explorer evidence)
    expect(ids.negativeTests.filter((t) => t.expect === "success").every((t) => !t.reverted)).toBe(true);
  });

  it("the Universal Resolver resolves each subname's own records (two-level ENSv2 traversal)", async (c) => {
    if (!online || !ids) c.skip();
    for (const app of Object.values(ids.apps)) {
      const r = await readPramaanRecords(cfg(), app.ensName);
      expect(r.status).toBe("ok");
      if (r.status !== "ok") continue;
      expect(r.records["pramaan.domain"]).toBe(app.records["pramaan.domain"]);
      expect(r.records["pramaan.signer"]).toBe(key.signerRecord);
      expect(r.records["pramaan.timelock"]).toBe(app.timelock);
      expect(r.records["pramaan.record"]).toBeNull();
    }
    const unknown = await readPramaanRecords(cfg(), `nope.${parentLabel}.eth`);
    expect(unknown.status === "ok" && unknown.records["pramaan.domain"]).toBeNull();
  });

  it("re-running resumes without sending a transaction", async (c) => {
    if (!online || !ids) c.skip();
    const again = await setupAppIdentities(ctx, {
      ens,
      owner,
      proposer,
      guardian,
      parentLabel,
      timelockDelaySeconds: 120,
      broadcastNegativeTests: false,
      apps: Object.values(ids.apps).map((a) => ({ id: a.id, label: a.label, domain: a.records["pramaan.domain"]!, attestation: "key" as const, signerSpki: key.signerRecord })),
    });
    expect(again.txCount).toBe(0);
    expect(again.apps["vaultlab"]).toMatchObject({ resolver: ids.apps["vaultlab"]!.resolver, timelock: ids.apps["vaultlab"]!.timelock });
  }, 300_000);

  it("supersession and replay: execute-twice, re-queued old pointer, superseded id, cancelled and expired ops all revert", async (c) => {
    if (!online || !ids) c.skip();
    const tl = ids.apps["mirroryield"]!.timelock;
    const p = (n: string) => encodePointer(`v1.0.${n}`, sha256Hex(`release ${n}`));
    const sim = (id: bigint) => ctx.pub.simulateContract({ address: tl, abi: timelockAbi, functionName: "execute", args: [id], account: anyone.account });
    const q1 = await queuePointer(ctx, proposer, tl, p("1"));
    await waitSeconds(ctx, 121);
    await executeOp(ctx, anyone, tl, q1.id);
    await expect(sim(q1.id)).rejects.toThrow(/NotQueued/);
    const q2 = await queuePointer(ctx, proposer, tl, p("2"));
    await waitSeconds(ctx, 121);
    await executeOp(ctx, anyone, tl, q2.id);
    await expect(queuePointer(ctx, proposer, tl, p("1"))).rejects.toThrow(/AlreadyExecuted|reverted/);
    const older = await queuePointer(ctx, proposer, tl, p("3"));
    const newer = await queuePointer(ctx, proposer, tl, p("4"));
    await waitSeconds(ctx, 121);
    await executeOp(ctx, anyone, tl, newer.id);
    await expect(sim(older.id)).rejects.toThrow(/Superseded/);
    const cancelled = await queuePointer(ctx, proposer, tl, p("5"));
    await expect(cancelOp(ctx, proposer, tl, cancelled.id)).rejects.toThrow();
    await cancelOp(ctx, guardian, tl, cancelled.id);
    await waitSeconds(ctx, 121);
    await expect(sim(cancelled.id)).rejects.toThrow(/NotQueued/);
    const late = await queuePointer(ctx, proposer, tl, p("6"));
    await waitSeconds(ctx, 120 + 14 * 86400 + 5);
    await expect(sim(late.id)).rejects.toThrow(/Expired/);
    const r = await readPramaanRecords(cfg(), ids.apps["mirroryield"]!.ensName);
    expect(r.status === "ok" && r.records["pramaan.record"]).toBe(p("4"));
    const state = await readTimelockState(cfg(), tl);
    expect(state.status).toBe("ok");
    if (state.status === "ok") expect(assessTimelock(state.state, p("4"), dnsEncode(ids.apps["mirroryield"]!.ensName))).toMatchObject({ kind: "consistent", pending: [] });
  }, 600_000);

  it("end to end: verified → newer release pending (amber) → guardian revokes (red, immediately)", async (c) => {
    if (!online || !ids) c.skip();
    const app = ids.apps["vaultlab"]!;
    const html = "<!doctype html><title>vaultlab</title>";
    const manifest = buildManifest({
      app: { name: "VaultLab", ensName: app.ensName, domain: origin },
      repo: "local:pramaan/vaultlab",
      commit: "0".repeat(40),
      tag: "v1.0.0",
      workflow: null,
      builtAt: "2026-11-04T00:00:00Z",
      files: [{ path: "/index.html", sha256: sha256Hex(html), sri: sriSha384(html) }],
    });
    const digest = manifestDigest(manifest);
    routes.set("/.well-known/pramaan.json", JSON.stringify({ pramaan: 1, ensName: app.ensName, chainId: 31337 }));
    routes.set("/.well-known/pramaan-manifest.json", manifestBytes(manifest));
    routes.set("/.well-known/pramaan-manifest.dsse.json", JSON.stringify(await signStatementWithKey(releaseStatement(digest, { tag: "v1.0.0" }), key.privateKeyPkcs8Pem)));
    const q = await queuePointer(ctx, proposer, app.timelock, encodePointer("v1.0.0", digest));
    await waitSeconds(ctx, 121);
    await executeOp(ctx, anyone, app.timelock, q.id);
    const verify = () => verifySiteRelease({ origin, chains: { 31337: cfg() }, ipfsGateways: [], pins: memoryPinStore() });

    expect(await verify()).toMatchObject({ status: "verified", reason: null });

    await queuePointer(ctx, proposer, app.timelock, encodePointer("v1.1.0", "c".repeat(64)));
    const pending = await verify();
    expect(pending).toMatchObject({ status: "verified", reason: "update-pending" });
    expect(pending.pending[0]?.pointer?.tag).toBe("v1.1.0");

    await expect(revokeRelease(ctx, proposer, { resolver: app.resolver, ensName: app.ensName, manifestSha256: digest })).rejects.toThrow();
    const rev = await revokeRelease(ctx, guardian, { resolver: app.resolver, ensName: app.ensName, manifestSha256: digest });
    expect(rev.revoked).toEqual([digest]);
    expect(await readRevocations(ctx, app.resolver, app.ensName)).toEqual([digest]);
    expect(await verify()).toMatchObject({ status: "revoked", reason: "revoked" });
    // Revocation is per name: the sibling identity is untouched.
    expect(await readRevocations(ctx, ids.apps["permitmarket"]!.resolver, ids.apps["permitmarket"]!.ensName)).toEqual([]);
  }, 600_000);
});

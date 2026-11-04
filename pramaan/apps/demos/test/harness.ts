import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { generateReleaseKey, releaseStatement, signStatementWithKey } from "@pramaan/manifest/node";
import { assembleDemoApp, connect, deployDemoSuite, freshLocalSigner, REPO_ROOT, type ChainCtx, type DemoStateV2, type DemoSuite, type Signer } from "@pramaan/release";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAll } from "../scripts/build.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** All tests use anvil ports 9100-9109 (never 8545/8787/5173-5190). */
export const TEST_PORTS = { anvil: 9100, vaultlab: 9101, mirroryield: 9102, lookalike: 9103, permitmarket: 9104, admin: 9105, tracker: 9106 };

function foundryBin(name: string): string {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  const local = join(homedir(), ".foundry", "bin", exe);
  return existsSync(local) ? local : exe;
}

export async function startAnvil(port: number): Promise<{ stop(): void }> {
  const child: ChildProcess = spawn(foundryBin("anvil"), ["--port", String(port), "--host", "127.0.0.1", "--chain-id", "31337", "--silent"], { stdio: "ignore", windowsHide: true });
  const url = `http://127.0.0.1:${port}`;
  const end = Date.now() + 30_000;
  for (;;) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
      if (r.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > end) {
      child.kill();
      throw new Error(`anvil did not start on ${port}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return { stop: () => void child.kill() };
}

export interface DemoEnv {
  tmp: string;
  out: string;
  statePath: string;
  state: DemoStateV2;
  ctx: ChainCtx;
  owner: Signer & { privateKey: `0x${string}` };
  suite: DemoSuite;
  attackerAddress: `0x${string}`;
  releaseDirs: Record<string, string>;
}

const PLACEHOLDER_ENS = { vaultlab: "vaultlab.pramaan-test.eth", mirroryield: "mirroryield.pramaan-test.eth", permitmarket: "permitmarket.pramaan-test.eth" } as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;

/** Real PROVE output of a previous `demo:up` run, when present; otherwise null (tests that need it are skipped, never faked). */
export function realProveOutputs(): DemoStateV2["prove"] {
  const dir = join(REPO_ROOT, ".pramaan", "demo", "prove");
  const findingsFile = join(dir, "findings.json");
  if (!existsSync(findingsFile) || !existsSync(join(dir, "evidence"))) return null;
  const findings = JSON.parse(readFileSync(findingsFile, "utf8")) as NonNullable<DemoStateV2["prove"]>["findings"];
  return { reportJson: join(dir, "report.json"), reportMd: join(dir, "report.md"), findings };
}

/** Deploys the suite on a fresh anvil, writes a temp DemoStateV2 (placeholder ENS names), builds all apps and signs a release per app. */
export async function setupDemoEnv(options: { upgradeDelaySeconds?: number } = {}): Promise<DemoEnv> {
  const rpcUrl = `http://127.0.0.1:${TEST_PORTS.anvil}`;
  const ctx = await connect(rpcUrl);
  if (!ctx.local) throw new Error("test chain must be local");
  const owner = await freshLocalSigner(ctx, "test owner");
  const attackerAddress = privateKeyToAccount(generatePrivateKey()).address;
  const suite = await deployDemoSuite(ctx, { owner, attacker: attackerAddress, upgradeDelaySeconds: options.upgradeDelaySeconds ?? 120 });

  const tmp = mkdtempSync(join(tmpdir(), "pramaan-demos-test-"));
  const out = join(tmp, "out");
  mkdirSync(out, { recursive: true });
  const origin = (p: number) => `http://localhost:${p}`;
  const prove = realProveOutputs();
  const mkApp = (id: "vaultlab" | "mirroryield" | "permitmarket", name: string, port: number) => ({
    id,
    name,
    ensName: PLACEHOLDER_ENS[id],
    origin: origin(port),
    distDir: join(out, "dist", id),
    resolver: ZERO,
    timelock: ZERO,
    contracts: suite.apps[id].contracts,
    unlisted: suite.apps[id].unlisted,
    monitors: suite.apps[id].monitors,
    release: null,
  });
  const state: DemoStateV2 = {
    version: 2,
    createdAt: new Date().toISOString(),
    network: { kind: "anvil-fork", chainId: ctx.chain.id, chainName: "Local test chain", rpcUrl, forkUrl: null, explorer: null },
    ens: { parent: "pramaan-test.eth", parentTokenId: null, subregistry: null, registrationTxs: [], negativeTests: [] },
    accounts: { owner: owner.account.address, proposer: owner.account.address, guardian: owner.account.address, user: owner.account.address, attacker: attackerAddress },
    shared: suite.shared,
    apps: {
      vaultlab: mkApp("vaultlab", "VaultLab", TEST_PORTS.vaultlab),
      mirroryield: mkApp("mirroryield", "MirrorYield", TEST_PORTS.mirroryield),
      permitmarket: mkApp("permitmarket", "PermitMarket", TEST_PORTS.permitmarket),
    },
    hosts: { adminUrl: `http://127.0.0.1:${TEST_PORTS.admin}`, trackerUrl: `http://127.0.0.1:${TEST_PORTS.tracker}`, lookalikeOrigin: `http://127.0.0.1:${TEST_PORTS.lookalike}` },
    prove,
    signer: { spki: "test", record: "test" },
    fixturesEnabled: true,
  };
  const statePath = join(tmp, "state.json");
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  writeFileSync(join(tmp, "keys.json"), JSON.stringify({ note: "TEMP TEST KEYS on a throw-away anvil", owner: owner.privateKey }, null, 2));

  await buildAll(statePath, { out, appsRoot: join(__dirname, "placeholders") });

  // Sign one release per app and point the state at the sidecars, like demo:up does.
  const key = await generateReleaseKey();
  const releaseDirs: Record<string, string> = {};
  for (const id of ["vaultlab", "mirroryield", "permitmarket"] as const) {
    const release = await assembleDemoApp({ ctx, state, appId: id });
    const dir = join(tmp, "release", id);
    mkdirSync(dir, { recursive: true });
    const manifestPath = join(dir, "pramaan-manifest.json");
    const signaturePath = join(dir, "pramaan-manifest.dsse.json");
    writeFileSync(manifestPath, release.bytes);
    writeFileSync(signaturePath, JSON.stringify(await signStatementWithKey(releaseStatement(release.sha256, { tag: "v1.0.0", app: state.apps[id].name }), key.privateKeyPkcs8Pem), null, 2));
    state.apps[id].release = { tag: "v1.0.0", sha256: release.sha256, pointer: release.pointer, manifestPath, signaturePath, cid: release.cid, timelockOpId: null, queueTx: null, executeTx: null, eta: null, status: "signed" };
    releaseDirs[id] = dir;
  }
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  return { tmp, out, statePath, state, ctx, owner, suite, attackerAddress, releaseDirs };
}

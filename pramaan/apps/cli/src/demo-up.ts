/** Local Sepolia-fork demo; no real assets or mainnet transactions. */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { generateReleaseKey, releaseStatement, signStatementWithKey } from "@pramaan/manifest/node";
import { assembleDemoApp, connect, deployDemoSuite, deployResolver, deployTimelock, executeOp, freshLocalSigner, grantRecordRole, loadEnsv2Config, negativeWriteTest, queuePointer, registerName, REPO_ROOT, setOwnerText, waitSeconds, type DemoAppId, type DemoStateV2 } from "@pramaan/release";
import { verifySiteRelease } from "@pramaan/verifier-core";
import { dockerStatus } from "@pramaan/engine";
import { runProve } from "./prove.js";

const rpc = "http://127.0.0.1:8545";
const fork = process.env.SEPOLIA_RPC_URL_A ?? "https://sepolia.gateway.tenderly.co";
const dir = join(REPO_ROOT, ".pramaan", "demo");
const statePath = join(dir, "state.json");
const children: ChildProcess[] = [];
const ids: DemoAppId[] = ["vaultlab", "mirroryield", "permitmarket"];
const ports = { vaultlab: 5180, mirroryield: 5182, permitmarket: 5184 };
function start(cmd: string, args: string[], quiet = false) {
  const child = spawn(cmd, args, { cwd: REPO_ROOT, stdio: quiet ? "ignore" : "inherit", windowsHide: true });
  children.push(child);
  child.on("error", (e) => console.error(`child failed: ${e.message}`));
  return child;
}
function stop() { for (const child of children) child.kill(); }
process.on("SIGINT", () => { stop(); process.exit(0); });
process.on("SIGTERM", () => { stop(); process.exit(0); });
async function run(cmd: string, args: string[]) {
  const child = start(cmd, args);
  await new Promise<void>((resolve, reject) => { child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))); });
}
async function main() {
  if (!existsSync(join(REPO_ROOT, "contracts/out/VaultV2.sol/VaultV2.json"))) throw new Error("build contracts first: cd contracts && forge build");
  const withFixtures = process.argv.includes("--fixtures");
  for (const port of [8545, 5180, 5182, 5183, 5184, 5189, ...(withFixtures ? [5190] : [])]) {
    await new Promise<void>((resolve, reject) => {
      const probe = createServer();
      probe.once("error", () => reject(new Error(`port ${port} is already in use; refusing to use an existing service`)));
      probe.listen(port, "127.0.0.1", () => probe.close(() => resolve()));
    });
  }
  mkdirSync(dir, { recursive: true });
  const exe = process.platform === "win32" ? "anvil.exe" : "anvil";
  const local = join(homedir(), ".foundry", "bin", exe);
  start(existsSync(local) ? local : exe, ["--fork-url", fork, "--chain-id", "31337", "--port", "8545", "--host", "127.0.0.1", "--silent"], true);
  let ready = false;
  for (let i = 0; i < 200; i++) {
    try { const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) }); if (res.ok && (await res.json() as { result?: string }).result === "0x7a69") { ready = true; break; } } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!ready) throw new Error("local anvil did not start");
  const ens = loadEnsv2Config();
  const ctx = await connect(rpc, ens);
  const owner = await freshLocalSigner(ctx, "owner");
  const proposer = await freshLocalSigner(ctx, "proposer");
  const guardian = await freshLocalSigner(ctx, "guardian");
  const user = await freshLocalSigner(ctx, "user", 50n);
  const attacker = await freshLocalSigner(ctx, "attacker");
  const suite = await deployDemoSuite(ctx, { owner, attacker: attacker.account.address, log: console.log });
  const key = await generateReleaseKey();
  const suffix = Math.random().toString(16).slice(2, 8);
  const registrations: string[] = [];
  const negativeTests: DemoStateV2["ens"]["negativeTests"] = [];
  const apps = {} as DemoStateV2["apps"];
  for (const id of ids) {
    const ensName = `pramaan-${id}-${suffix}.eth`;
    const origin = `http://localhost:${ports[id]}`;
    const { resolver } = await deployResolver(ctx, owner, ens, ensName, { domain: origin, attestation: "key", signer: key.signerRecord });
    const { timelock } = await deployTimelock(ctx, owner, { resolver, ensName, delaySeconds: 120, proposer: proposer.account.address, guardian: guardian.account.address });
    await grantRecordRole(ctx, owner, resolver, timelock);
    await setOwnerText(ctx, owner, resolver, ensName, "pramaan.timelock", timelock);
    const registration = await registerName(ctx, owner, ens, ensName, resolver, console.log);
    registrations.push(...registration.txHashes);
    const negative = await negativeWriteTest(ctx, proposer, resolver, ensName, true);
    if (negative.some((test) => !test.reverted)) throw new Error(`${ensName}: proposer role boundary failed`);
    negativeTests.push(...negative);
    apps[id] = { id, name: id === "vaultlab" ? "VaultLab" : id === "mirroryield" ? "MirrorYield" : "PermitMarket", ensName, origin, distDir: `apps/demos/dist/${id}`, resolver, timelock, ...suite.apps[id], release: null };
  }
  const state: DemoStateV2 = { version: 2, createdAt: new Date().toISOString(), network: { kind: "anvil-fork", chainId: 31337, chainName: "Local Sepolia fork", rpcUrl: rpc, forkUrl: null, explorer: null }, ens: { parent: "eth", parentTokenId: null, subregistry: null, registrationTxs: registrations, negativeTests }, accounts: { owner: owner.account.address, proposer: proposer.account.address, guardian: guardian.account.address, user: user.account.address, attacker: attacker.account.address }, shared: suite.shared, apps, hosts: { adminUrl: "http://127.0.0.1:5189", trackerUrl: withFixtures ? "http://127.0.0.1:5190" : null, lookalikeOrigin: "http://127.0.0.1:5183" }, prove: null, signer: { spki: Buffer.from(key.publicKeySpki).toString("base64"), record: key.signerRecord }, fixturesEnabled: withFixtures };
  const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
  save();
  writeFileSync(join(dir, "keys.json"), JSON.stringify({ note: "LOCAL FORK ONLY", owner: owner.privateKey, proposer: proposer.privateKey, guardian: guardian.privateKey, user: user.privateKey }, null, 2), { mode: 0o600 });
  writeFileSync(join(dir, "release-key.pem"), key.privateKeyPkcs8Pem, { mode: 0o600 });
  // PROVE the demo contracts in the sandbox; the verified VaultLab finding goes into the signed release. Without Docker
  // (or with --skip-prove) no finding is claimed.
  const sandbox = process.argv.includes("--skip-prove") ? null : await dockerStatus();
  if (sandbox?.available && sandbox.imagePresent) {
    console.log("PROVE: analysing the demo contracts in the sandbox (about 3 minutes)...");
    const proveDir = join(dir, "prove");
    const result = await runProve({ repoDir: join(REPO_ROOT, "contracts"), outDir: proveDir, fix: true, onProgress: (p) => console.log(`  [${p.step}] ${p.status}: ${p.message}`) });
    state.prove = { reportJson: join(proveDir, "report.json"), reportMd: join(proveDir, "report.md"), findings: result.manifestFindings.map((f) => ({ id: f.id, title: f.title ?? f.id, class: f.class, severity: f.severity, status: f.status, exploitTestSha256: f.exploitTestSha256 ?? null, evidenceSha256: f.evidenceSha256 ?? null, fixCommit: f.fixCommit ?? null })) };
    save();
    console.log(`PROVE: ${result.manifestFindings.length} finding(s) with proof recorded in the VaultLab release.`);
  } else {
    console.log(sandbox ? "PROVE not run: the sandbox image is missing (pnpm pramaan sandbox build); releases will not claim findings." : "PROVE skipped (--skip-prove); releases will not claim findings.");
  }
  await run(process.execPath, [join(REPO_ROOT, "apps/demos/scripts/build.mjs"), "--state", statePath, ...(withFixtures ? [] : ["--no-fixtures"])]);
  for (const id of ids) {
    const release = await assembleDemoApp({ ctx, state, appId: id });
    const releaseDir = join(dir, "release", id); mkdirSync(releaseDir, { recursive: true });
    const manifestPath = join(releaseDir, "pramaan-manifest.json");
    const signaturePath = join(releaseDir, "pramaan-manifest.dsse.json");
    writeFileSync(manifestPath, release.bytes);
    writeFileSync(signaturePath, JSON.stringify(await signStatementWithKey(releaseStatement(release.sha256, { tag: "v1.0.0", app: state.apps[id].name }), key.privateKeyPkcs8Pem), null, 2));
    const q = await queuePointer(ctx, proposer, state.apps[id].timelock, release.pointer);
    await waitSeconds(ctx, 121);
    const executeTx = await executeOp(ctx, user, state.apps[id].timelock, q.id);
    state.apps[id].release = { tag: "v1.0.0", sha256: release.sha256, pointer: release.pointer, manifestPath, signaturePath, cid: release.cid, timelockOpId: q.id.toString(), queueTx: q.txHash, executeTx, eta: Number(q.eta), status: "active" };
    save();
  }
  start(process.execPath, [join(REPO_ROOT, "apps/demos/server/serve.mjs"), "--state", statePath, ...(withFixtures ? ["--fixtures"] : [])]);
  // wait until every host actually answers (a cold tsx start can take several seconds) instead of guessing a delay
  for (const id of ids) {
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      try { up = (await fetch(`${state.apps[id].origin}/.well-known/pramaan.json`, { signal: AbortSignal.timeout(2000) })).status < 500; } catch { await new Promise((r) => setTimeout(r, 300)); }
    }
    if (!up) throw new Error(`${id}: static host did not come up at ${state.apps[id].origin}`);
  }
  for (const id of ids) {
    const check = await verifySiteRelease({ origin: state.apps[id].origin, chains: { 31337: { chainId: 31337, rpcUrls: [rpc], universalResolver: ens.universalResolver, minAgreement: 1 } }, ipfsGateways: [] });
    console.log(`${id}: ${check.status}, manifest ${state.apps[id].release?.sha256}`);
    if (check.status !== "verified") throw new Error(`${id} release verification failed: ${check.reason}`);
  }
  console.log("Local fork demo ready; Ctrl+C stops the hosts and chain. " + (state.prove ? "Findings in the VaultLab release come from a real sandbox run." : "No sandbox analysis was run."));
}
main().catch((err: Error) => { console.error(`demo:up failed: ${err.message}`); stop(); process.exit(1); });

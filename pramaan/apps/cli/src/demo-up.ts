/**
 * The three demo dApps, signed and published through ENS + the release timelock.
 *
 *   pnpm demo:up [--fixtures] [--skip-prove]            local Sepolia fork on :8545, everything served locally (default)
 *   pnpm demo:rehearse [--skip-prove]                   the HOSTED code path on a separate local fork (+100 ports, own folders):
 *                                                       test the live flow without spending test ETH or touching a running demo
 *   pnpm demo:sepolia --origins vaultlab=https://a.example,mirroryield=https://b.example,permitmarket=https://c.example
 *                                                       LIVE: real Sepolia, keys from .env, you host the three folders it prints
 *
 * Sepolia needs OWNER_PRIVATE_KEY / PROPOSER_PRIVATE_KEY / GUARDIAN_PRIVATE_KEY (testnet-only, funded) in the git-ignored
 * .env. Nothing here runs on mainnet. Owner keys are never written to disk; only the release-signing key is.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { generateReleaseKey, releaseStatement, signStatementWithKey } from "@pramaan/manifest/node";
import { assembleDemoApp, connect, deployDemoSuite, deployResolver, deployTimelock, executeOp, freshLocalSigner, grantRecordRole, loadEnsv2Config, negativeWriteTest, queuePointer, registerName, REPO_ROOT, setOwnerText, signerFromKey, waitSeconds, type ChainCtx, type DemoAppId, type DemoStateV2, type Signer } from "@pramaan/release";
import { verifySiteRelease } from "@pramaan/verifier-core";
import { dockerStatus } from "@pramaan/engine";
import { runProve } from "./prove.js";

try { process.loadEnvFile(join(REPO_ROOT, ".env")); } catch { /* no .env: environment variables only */ }

type Network = "local" | "rehearsal" | "sepolia";
const argv = process.argv;
const flagValue = (name: string): string | undefined => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const network = (flagValue("--network") ?? "local") as Network;
if (!["local", "rehearsal", "sepolia"].includes(network)) { console.error(`--network must be local, rehearsal or sepolia (got "${network}")`); process.exit(2); }
const hosted = network !== "local";
const live = network === "sepolia";
const offset = Number(flagValue("--offset") ?? (network === "rehearsal" ? 100 : 0));
const rpcPort = 8545 + offset;
const rpc = `http://127.0.0.1:${rpcPort}`;
const fork = process.env.SEPOLIA_RPC_URL_A ?? "https://sepolia.gateway.tenderly.co";
/** What the PUBLISHED apps use to read Sepolia: must be keyless, because it is baked into public JavaScript. */
const publicRpc = flagValue("--public-rpc") ?? "https://ethereum-sepolia-rpc.publicnode.com";
const dir = join(REPO_ROOT, ".pramaan", network === "local" ? "demo" : `demo-${network}`);
const statePath = join(dir, "state.json");
const children: ChildProcess[] = [];
const ids: DemoAppId[] = ["vaultlab", "mirroryield", "permitmarket"];
const ports = { vaultlab: 5180 + offset, mirroryield: 5182 + offset, permitmarket: 5184 + offset };
const lookalikePort = 5183 + offset;
const adminPort = 5189 + offset;
const trackerPort = 5190 + offset;

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

/** `--origins vaultlab=https://a.example,...`: one https origin per app (an origin has no path and no trailing slash). */
function parseOrigins(): Partial<Record<DemoAppId, string>> {
  const out: Partial<Record<DemoAppId, string>> = {};
  for (const part of (flagValue("--origins") ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const eq = part.indexOf("=");
    const id = part.slice(0, eq) as DemoAppId;
    const url = part.slice(eq + 1);
    if (eq <= 0 || !ids.includes(id)) throw new Error(`--origins: "${part}" is not <vaultlab|mirroryield|permitmarket>=<https origin>`);
    if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(url)) throw new Error(`--origins ${id}: "${url}" must be an https origin like https://my-app.vercel.app (no path, no trailing slash)`);
    out[id] = url;
  }
  return out;
}

async function freePort(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", () => reject(new Error(`port ${port} is already in use; refusing to use an existing service`)));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve()));
  });
}

async function liveSigners(ctx: ChainCtx): Promise<{ owner: Signer; proposer: Signer; guardian: Signer }> {
  const owner = signerFromKey(ctx, process.env.OWNER_PRIVATE_KEY, "OWNER_PRIVATE_KEY");
  const proposer = signerFromKey(ctx, process.env.PROPOSER_PRIVATE_KEY, "PROPOSER_PRIVATE_KEY");
  const guardian = signerFromKey(ctx, process.env.GUARDIAN_PRIVATE_KEY, "GUARDIAN_PRIVATE_KEY");
  const distinct = new Set([owner, proposer, guardian].map((s) => s.account.address.toLowerCase()));
  if (distinct.size !== 3) throw new Error("OWNER, PROPOSER and GUARDIAN must be three different accounts (least privilege)");
  // Gas is measured on a fork (docs/FAUCETS.md): owner ~39M, proposer ~2.4M, guardian ~1.5M. Refuse to start a deployment
  // that cannot finish; an interrupted one leaves half-registered names behind.
  const price = await ctx.pub.getGasPrice();
  const need = (gas: bigint) => gas * price * 2n;
  const checks: [string, Signer, bigint][] = [["OWNER", owner, need(40_000_000n)], ["PROPOSER", proposer, need(4_000_000n)], ["GUARDIAN", guardian, need(1_500_000n)]];
  const short: string[] = [];
  for (const [label, s, wanted] of checks) {
    const have = await ctx.pub.getBalance({ address: s.account.address });
    console.log(`${label} ${s.account.address}: ${Number(have) / 1e18} ETH (needs about ${Number(wanted) / 1e18} at ${Number(price) / 1e9} gwei x2)`);
    if (have < wanted) short.push(`${label} ${s.account.address} has ${Number(have) / 1e18} ETH, needs about ${Number(wanted) / 1e18} (faucets: pramaan/docs/FAUCETS.md)`);
  }
  if (short.length) throw new Error(`fund these testnet accounts first:\n  ${short.join("\n  ")}`);
  return { owner, proposer, guardian };
}

async function main() {
  if (!existsSync(join(REPO_ROOT, "contracts/out/VaultV2.sol/VaultV2.json"))) throw new Error("build contracts first: cd contracts && forge build");
  const withFixtures = !hosted && argv.includes("--fixtures");
  const origins = parseOrigins();
  if (live) {
    const missing = ids.filter((id) => !origins[id]);
    if (missing.length) throw new Error(`--network sepolia needs the final https origin of every app: missing ${missing.join(", ")}. Example: --origins vaultlab=https://vaultlab-x.vercel.app,mirroryield=https://mirroryield-x.vercel.app,permitmarket=https://permitmarket-x.vercel.app`);
  }
  mkdirSync(dir, { recursive: true });

  const ens = loadEnsv2Config();
  let ctx: ChainCtx;
  let owner: Signer, proposer: Signer, guardian: Signer, executor: Signer;
  let userForKeys: { privateKey: string } | null = null;
  if (live) {
    ctx = await connect(fork, ens);
    if (ctx.chain.id !== 11155111) throw new Error(`SEPOLIA_RPC_URL_A is chain ${ctx.chain.id}, expected 11155111`);
    ({ owner, proposer, guardian } = await liveSigners(ctx));
    executor = proposer; // anyone may execute a release once its timelock delay has passed
  } else {
    for (const port of [rpcPort, ...Object.values(ports), lookalikePort, adminPort, ...(withFixtures ? [trackerPort] : [])]) await freePort(port);
    const exe = process.platform === "win32" ? "anvil.exe" : "anvil";
    const localAnvil = join(homedir(), ".foundry", "bin", exe);
    start(existsSync(localAnvil) ? localAnvil : exe, ["--fork-url", fork, "--chain-id", "31337", "--port", String(rpcPort), "--host", "127.0.0.1", "--silent"], true);
    let ready = false;
    for (let i = 0; i < 200; i++) {
      try { const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) }); if (res.ok && (await res.json() as { result?: string }).result === "0x7a69") { ready = true; break; } } catch { /* starting */ }
      await new Promise((r) => setTimeout(r, 300));
    }
    if (!ready) throw new Error("local anvil did not start");
    ctx = await connect(rpc, ens);
    owner = await freshLocalSigner(ctx, "owner");
    proposer = await freshLocalSigner(ctx, "proposer");
    guardian = await freshLocalSigner(ctx, "guardian");
    const user = await freshLocalSigner(ctx, "user", 50n);
    userForKeys = user;
    executor = hosted ? proposer : user;
  }
  // An address only: nobody holds the attacker key. (On a local chain it is funded like before; on Sepolia it is just random.)
  const attackerAddress = live ? privateKeyToAccount(generatePrivateKey()).address : (await freshLocalSigner(ctx, "attacker")).account.address;
  const suite = await deployDemoSuite(ctx, { owner, attacker: attackerAddress, log: console.log });
  const key = await generateReleaseKey();
  const suffix = Math.random().toString(16).slice(2, 8);
  const registrations: string[] = [];
  const negativeTests: DemoStateV2["ens"]["negativeTests"] = [];
  const apps = {} as DemoStateV2["apps"];
  const broadcastNegative = live ? argv.includes("--broadcast-negative") : true;
  for (const id of ids) {
    const ensName = `pramaan-${id}-${suffix}.eth`;
    const origin = origins[id] ?? `http://localhost:${ports[id]}`;
    const { resolver } = await deployResolver(ctx, owner, ens, ensName, { domain: origin, attestation: "key", signer: key.signerRecord });
    const { timelock } = await deployTimelock(ctx, owner, { resolver, ensName, delaySeconds: 120, proposer: proposer.account.address, guardian: guardian.account.address });
    await grantRecordRole(ctx, owner, resolver, timelock);
    await setOwnerText(ctx, owner, resolver, ensName, "pramaan.timelock", timelock);
    const registration = await registerName(ctx, owner, ens, ensName, resolver, console.log);
    registrations.push(...registration.txHashes);
    const negative = await negativeWriteTest(ctx, proposer, resolver, ensName, broadcastNegative);
    if (negative.some((test) => !test.reverted)) throw new Error(`${ensName}: proposer role boundary failed`);
    negativeTests.push(...negative);
    apps[id] = { id, name: id === "vaultlab" ? "VaultLab" : id === "mirroryield" ? "MirrorYield" : "PermitMarket", ensName, origin, distDir: hosted ? `apps/demos/hosted-${network}/${id}` : `apps/demos/dist/${id}`, resolver, timelock, ...suite.apps[id], release: null };
  }
  const state: DemoStateV2 = {
    version: 2,
    createdAt: new Date().toISOString(),
    network: live
      ? { kind: "sepolia", chainId: 11155111, chainName: "Sepolia", rpcUrl: publicRpc, forkUrl: null, explorer: "https://sepolia.etherscan.io" }
      : { kind: "anvil-fork", chainId: 31337, chainName: "Local Sepolia fork", rpcUrl: rpc, forkUrl: null, explorer: null },
    ens: { parent: "eth", parentTokenId: null, subregistry: null, registrationTxs: registrations, negativeTests },
    accounts: { owner: owner.account.address, proposer: proposer.account.address, guardian: guardian.account.address, user: executor.account.address, attacker: attackerAddress },
    shared: suite.shared,
    apps,
    hosts: { adminUrl: `http://127.0.0.1:${adminPort}`, trackerUrl: withFixtures ? `http://127.0.0.1:${trackerPort}` : null, lookalikeOrigin: hosted ? null : `http://127.0.0.1:${lookalikePort}` },
    prove: null,
    signer: { spki: Buffer.from(key.publicKeySpki).toString("base64"), record: key.signerRecord },
    fixturesEnabled: withFixtures,
  };
  const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
  save();
  // Owner/proposer/guardian keys exist on disk only for a throwaway local fork. On Sepolia they stay in .env and nowhere else.
  if (!live) writeFileSync(join(dir, "keys.json"), JSON.stringify({ note: "LOCAL FORK ONLY", owner: (owner as unknown as { privateKey: string }).privateKey, proposer: (proposer as unknown as { privateKey: string }).privateKey, guardian: (guardian as unknown as { privateKey: string }).privateKey, user: userForKeys?.privateKey }, null, 2), { mode: 0o600 });
  writeFileSync(join(dir, "release-key.pem"), key.privateKeyPkcs8Pem, { mode: 0o600 });
  // PROVE the demo contracts in the sandbox; the verified VaultLab finding goes into the signed release. Without Docker
  // (or with --skip-prove) no finding is claimed.
  const sandbox = argv.includes("--skip-prove") ? null : await dockerStatus();
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

  const queued: { id: DemoAppId; qid: bigint; txHash: string; eta: number; release: Awaited<ReturnType<typeof assembleDemoApp>>; manifestPath: string; signaturePath: string }[] = [];
  const publishRelease = async (id: DemoAppId, q: { id: bigint; txHash: string; eta: bigint }, release: Awaited<ReturnType<typeof assembleDemoApp>>, manifestPath: string, signaturePath: string) => {
    const executeTx = await executeOp(ctx, executor, state.apps[id].timelock, q.id);
    state.apps[id].release = { tag: "v1.0.0", sha256: release.sha256, pointer: release.pointer, manifestPath, signaturePath, cid: release.cid, timelockOpId: q.id.toString(), queueTx: q.txHash, executeTx, eta: Number(q.eta), status: "active" };
    save();
  };
  for (const id of ids) {
    const release = await assembleDemoApp({ ctx, state, appId: id });
    const releaseDir = join(dir, "release", id); mkdirSync(releaseDir, { recursive: true });
    const manifestPath = join(releaseDir, "pramaan-manifest.json");
    const signaturePath = join(releaseDir, "pramaan-manifest.dsse.json");
    writeFileSync(manifestPath, release.bytes);
    writeFileSync(signaturePath, JSON.stringify(await signStatementWithKey(releaseStatement(release.sha256, { tag: "v1.0.0", app: state.apps[id].name }), key.privateKeyPkcs8Pem), null, 2));
    const q = await queuePointer(ctx, proposer, state.apps[id].timelock, release.pointer);
    if (hosted) {
      // A static host serves these two files from /.well-known/ (the local demo host serves them from the state instead).
      const wk = join(REPO_ROOT, state.apps[id].distDir, ".well-known");
      mkdirSync(wk, { recursive: true });
      copyFileSync(manifestPath, join(wk, "pramaan-manifest.json"));
      copyFileSync(signaturePath, join(wk, "pramaan-manifest.dsse.json"));
      queued.push({ id, qid: q.id, txHash: q.txHash, eta: Number(q.eta), release, manifestPath, signaturePath });
    } else {
      await waitSeconds(ctx, 121);
      await publishRelease(id, q, release, manifestPath, signaturePath);
    }
  }
  if (hosted) {
    // All three releases are queued: wait the timelock delay ONCE (real time on Sepolia), then execute them.
    await waitSeconds(ctx, 125, console.log);
    for (const item of queued) await publishRelease(item.id, { id: item.qid, txHash: item.txHash, eta: BigInt(item.eta) }, item.release, item.manifestPath, item.signaturePath);
  }

  if (live) {
    const A = process.env.SEPOLIA_RPC_URL_A ?? "https://sepolia.gateway.tenderly.co";
    const B = process.env.SEPOLIA_RPC_URL_B ?? "https://rpc.sepolia.ethpandaops.io";
    console.log("\nLIVE on Sepolia: contracts, ENS names, timelocks and the three signed releases are on chain.\n");
    console.log("NOW upload each folder UNCHANGED to its own static host (no minify / asset optimisation; keep /.well-known/ and send Cache-Control: no-store for html and /.well-known/):");
    for (const id of ids) console.log(`  ${id.padEnd(13)} ${join(REPO_ROOT, state.apps[id].distDir)}  ->  ${state.apps[id].origin}   (ENS ${state.apps[id].ensName})`);
    console.log("\nThen verify from any machine:");
    for (const id of ids) console.log(`  pnpm pramaan verify ${state.apps[id].origin} --chain 11155111=${A},${B}`);
    console.log(`\nState: ${statePath}\nRelease signing key (keep private): ${join(dir, "release-key.pem")}`);
    return;
  }
  start(process.execPath, [join(REPO_ROOT, "apps/demos/server/serve.mjs"), "--state", statePath, "--ports", `vaultlab=${ports.vaultlab},mirroryield=${ports.mirroryield},lookalike=${lookalikePort},permitmarket=${ports.permitmarket},admin=${adminPort},tracker=${trackerPort}`, ...(withFixtures ? ["--fixtures"] : [])]);
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
  console.log((hosted ? "Rehearsal of the hosted flow complete (separate local fork, folder apps/demos/hosted-rehearsal); Ctrl+C stops it. " : "Local fork demo ready; Ctrl+C stops the hosts and chain. ") + (state.prove ? "Findings in the VaultLab release come from a real sandbox run." : "No sandbox analysis was run."));
}
main().catch((err: Error) => { console.error(`demo:up failed: ${err.message}`); stop(); process.exit(1); });

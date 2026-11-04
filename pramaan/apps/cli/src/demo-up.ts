/**
 * One-command local demo of the whole Pramaan trust chain, against the REAL ENSv2 contracts (anvil forking Sepolia):
 *
 *   pnpm demo:up              (add --skip-prove to reuse no analysis, --ipfs to publish via a local Kubo node)
 *
 * fork → fresh keys → deploy demo dApp contracts → prove/fix in the sandbox → ENSv2 name + dedicated resolver +
 * PramaanTimelock with a key-scoped role → build site (genuine + tampered) → manifest → DSSE signature → (IPFS) →
 * queue pointer → wait delay → execute → independent verification → serve. Keeps running until Ctrl+C.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { canonicalize, generateReleaseKey, releaseStatement, signStatementWithKey } from "@pramaan/manifest/node";
import {
  assembleRelease,
  connect,
  deployDemoContracts,
  deployResolver,
  deployTimelock,
  executeOp,
  freshLocalSigner,
  grantRecordRole,
  loadEnsv2Config,
  negativeWriteTest,
  publishToIpfs,
  queuePointer,
  registerName,
  REPO_ROOT,
  waitSeconds,
} from "@pramaan/release";
import { dockerStatus } from "@pramaan/engine";
import { verifySiteRelease } from "@pramaan/verifier-core";
import { runProve } from "./prove.js";

const args = new Set(process.argv.slice(2));
const FORK_URL = process.env.SEPOLIA_RPC_URL_A ?? "https://sepolia.gateway.tenderly.co";
const RPC = "http://127.0.0.1:8545";
const ORIGIN = "http://localhost:5180";
const DELAY = Number(process.env.TIMELOCK_DELAY_SECONDS ?? 120);
const STATE_DIR = join(REPO_ROOT, ".pramaan", "demo");
const RELEASE_DIR = join(STATE_DIR, "release");
const children: ChildProcess[] = [];
const t0 = Date.now();
const log = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s] ${m}`);

function bin(name: string): string {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  const local = join(homedir(), ".foundry", "bin", exe);
  return existsSync(local) ? local : exe;
}

function startChild(cmd: string, argv: string[], label: string): ChildProcess {
  const child = spawn(cmd, argv, { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  child.stdout?.on("data", (b: Buffer) => b.toString().split(/\r?\n/).filter(Boolean).forEach((l) => console.log(`  ${label} | ${l}`)));
  child.stderr?.on("data", (b: Buffer) => b.toString().split(/\r?\n/).filter(Boolean).forEach((l) => console.log(`  ${label} ! ${l}`)));
  children.push(child);
  return child;
}

async function rpcUp(url: string, timeoutMs = 60_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
      if (r.ok) return;
    } catch {
      // not yet
    }
    if (Date.now() > end) throw new Error(`${url} did not come up`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

function shutdown(): void {
  for (const c of children) c.kill();
}
process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});

async function main(): Promise<void> {
  mkdirSync(RELEASE_DIR, { recursive: true });
  if (!existsSync(join(REPO_ROOT, "contracts", "out", "VaultV2.sol", "VaultV2.json"))) throw new Error("run `cd contracts && forge build` first");

  log(`starting anvil fork of Sepolia (${FORK_URL}) as chain 31337 on ${RPC}`);
  startChild(bin("anvil"), ["--fork-url", FORK_URL, "--chain-id", "31337", "--port", "8545", "--host", "127.0.0.1", "--silent"], "anvil");
  await rpcUp(RPC);
  const ens = loadEnsv2Config();
  const ctx = await connect(RPC, ens);
  const owner = await freshLocalSigner(ctx, "owner");
  const proposer = await freshLocalSigner(ctx, "proposer");
  const user = await freshLocalSigner(ctx, "demo user", 50n);
  const marketplace = await freshLocalSigner(ctx, "marketplace operator", 1n);
  log(`owner ${owner.account.address} · proposer ${proposer.account.address} · demo user ${user.account.address}`);

  log("deploying the demo dApp contracts");
  const deployment = await deployDemoContracts(ctx, owner, (m) => log(`  ${m}`));
  writeFileSync(join(REPO_ROOT, "contracts", "deployments", "31337.json"), JSON.stringify(deployment, null, 2));

  let findings: Awaited<ReturnType<typeof runProve>>["manifestFindings"] = [];
  let tools: { name: string; version: string }[] = [];
  let proveReport: string | null = null;
  const docker = await dockerStatus();
  if (args.has("--skip-prove")) log("skipping PROVE (--skip-prove): the release will list no findings");
  else if (!docker.available || !docker.imagePresent) log(`skipping PROVE: ${docker.detail}`);
  else {
    log("PROVE: Slither + Aderyn + Foundry exploit tests in the network-less sandbox (2-4 minutes)");
    const r = await runProve({ repoDir: join(REPO_ROOT, "contracts"), repoLabel: "local:pramaan/contracts", outDir: join(STATE_DIR, "prove"), fix: true, onProgress: (e) => e.status !== "info" && log(`  [${e.step}] ${e.message}`) });
    findings = r.manifestFindings;
    tools = r.report.tools;
    proveReport = join(r.outDir, "report.md");
    for (const f of r.report.findings.filter((x) => x.status === "reproduced")) log(`  ${f.id} REPRODUCED ${f.candidate.contract}.${f.candidate.function}; fix ${r.fixes[f.id]?.verification.verified ? "VERIFIED" : "not verified"}`);
  }

  const ensName = `kosh-${Math.random().toString(16).slice(2, 8)}.eth`;
  const key = await generateReleaseKey();
  writeFileSync(join(STATE_DIR, "release-key.pem"), key.privateKeyPkcs8Pem, { mode: 0o600 });
  log(`ENSv2: dedicated resolver for ${ensName} (owner records written inside initialize)`);
  const { resolver } = await deployResolver(ctx, owner, ens, ensName, { domain: ORIGIN, attestation: "key", signer: key.signerRecord });
  const { timelock } = await deployTimelock(ctx, owner, { resolver, ensName, delaySeconds: DELAY, proposer: proposer.account.address, guardian: owner.account.address });
  await grantRecordRole(ctx, owner, resolver, timelock);
  log(`  resolver ${resolver}\n  timelock ${timelock} (holds ROLE_SET_TEXT on pramaan.record only, delay ${DELAY}s)`);
  log(`registering ${ensName} (commit → wait → register, paid in Sepolia MockUSDC)`);
  const reg = await registerName(ctx, owner, ens, ensName, resolver, (m) => log(`  ${m}`));
  const negative = await negativeWriteTest(ctx, proposer, resolver, ensName, true);
  for (const n of negative) log(`  proposer key: ${n.attempt} → ${n.reverted ? "REVERTED" : "SUCCEEDED (!)"}`);

  const state = {
    createdAt: new Date().toISOString(),
    chainId: 31337,
    chainName: "Local fork of Sepolia",
    rpcUrl: RPC,
    forkUrl: FORK_URL,
    ensName,
    origin: ORIGIN,
    lookalikeOrigin: "http://127.0.0.1:5181",
    adminUrl: "http://127.0.0.1:5189/mode",
    trackerUrl: "http://127.0.0.1:5190/collect",
    contracts: {
      vault: deployment.vault.address,
      vaultImplementation: deployment.vault.implementation,
      legacyVault: deployment.legacyVault.address,
      token: deployment.token.address,
      nft: deployment.nft.address,
      unauditedImpl: deployment.unauditedImpl.address,
      marketplace: marketplace.account.address,
    },
    ens: { resolver, timelock, tokenId: reg.tokenId.toString(), registrationTxs: reg.txHashes, negativeTest: negative },
    accounts: { owner: owner.account.address, proposer: proposer.account.address, user: user.account.address },
    release: null as null | Record<string, unknown>,
    prove: { findings, report: proveReport },
  };
  writeFileSync(join(STATE_DIR, "state.json"), JSON.stringify(state, null, 2));
  writeFileSync(join(STATE_DIR, "keys.json"), JSON.stringify({ note: "LOCAL FORK ONLY - never use these keys anywhere else", owner: owner.privateKey, proposer: proposer.privateKey, user: user.privateKey }, null, 2), { mode: 0o600 });

  log("building the demo dApp (genuine + tampered)");
  await new Promise<void>((resolve, reject) => {
    const b = spawn(process.execPath, [join(REPO_ROOT, "apps", "demo-dapp", "scripts", "build.mjs"), join(STATE_DIR, "state.json")], { cwd: REPO_ROOT, stdio: "inherit", windowsHide: true });
    b.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`demo build failed (${code})`))));
  });

  log("assembling the release manifest from the built files and the live deployed code");
  const release = await assembleRelease({
    siteDir: join(REPO_ROOT, "apps", "demo-dapp", "dist"),
    app: { name: "Kosh Vault", ensName, domain: ORIGIN },
    repo: "local:pramaan/kosh-vault",
    commit: deployment.vault.implementationCodehash!.slice(2),
    tag: "v1.0.0",
    workflow: null,
    ctx,
    deployment,
    findings,
    descriptors: [
      { address: deployment.vault.address as `0x${string}`, path: "/erc7730/vault.json" },
      { address: deployment.token.address as `0x${string}`, path: "/erc7730/token.json" },
      { address: deployment.nft.address as `0x${string}`, path: "/erc7730/nft.json" },
    ],
    thirdParties: [{ host: "127.0.0.1:8545", purpose: "Ethereum JSON-RPC used by the dApp (local fork)", receivesAddress: true }],
    tools,
  });
  writeFileSync(join(RELEASE_DIR, "pramaan-manifest.json"), release.bytes);
  const envelope = await signStatementWithKey(releaseStatement(release.sha256, { tag: "v1.0.0", app: "Kosh Vault" }), key.privateKeyPkcs8Pem);
  writeFileSync(join(RELEASE_DIR, "pramaan-manifest.dsse.json"), JSON.stringify(envelope, null, 2));
  if (existsSync(join(STATE_DIR, "prove", "evidence"))) {
    for (const f of findings) {
      const p = join(STATE_DIR, "prove", "evidence", `${f.id}.json`);
      if (existsSync(p)) writeFileSync(join(RELEASE_DIR, `${f.id}.evidence.json`), readFileSync(p));
    }
  }
  log(`  manifest sha256 ${release.sha256}\n  pointer ${release.pointer}\n  cid ${release.cid}`);

  let ipfs: unknown = null;
  if (args.has("--ipfs") || process.env.IPFS_API_URL) {
    try {
      ipfs = await publishToIpfs(release.bytes, { kuboApi: process.env.IPFS_API_URL ?? "http://127.0.0.1:5001", pinataJwt: process.env.PINATA_JWT, gateways: [process.env.IPFS_GATEWAY_URL ?? "http://127.0.0.1:8080"] });
      log(`  IPFS: ${JSON.stringify(ipfs)}`);
    } catch (err) {
      log(`  IPFS publication failed: ${(err as Error).message}`);
    }
  }

  log(`queueing the pointer in PramaanTimelock (proposer key), then waiting the ${DELAY}s delay`);
  const q = await queuePointer(ctx, proposer, timelock, release.pointer);
  await waitSeconds(ctx, DELAY + 1, (m) => log(`  ${m}`));
  const executeTx = await executeOp(ctx, user, timelock, q.id);
  log(`  executed by an unprivileged account: ${executeTx}`);
  state.release = { tag: "v1.0.0", sha256: release.sha256, pointer: release.pointer, cid: release.cid, opId: q.id.toString(), queueTx: q.txHash, executeTx, ipfs, files: release.manifest.files.length };
  writeFileSync(join(STATE_DIR, "state.json"), JSON.stringify(state, null, 2));
  writeFileSync(join(RELEASE_DIR, "manifest.pretty.json"), JSON.stringify(JSON.parse(canonicalize(release.manifest)), null, 2));

  log("starting the demo hosts (site, lookalike, admin switch, simulated tracker)");
  startChild(process.execPath, [join(REPO_ROOT, "apps", "demo-dapp", "server", "serve.mjs"), "--release", RELEASE_DIR], "hosts");
  await new Promise((r) => setTimeout(r, 1500));
  const check = await verifySiteRelease({ origin: ORIGIN, chains: { 31337: { chainId: 31337, rpcUrls: [RPC], universalResolver: ens.universalResolver, minAgreement: 1 } }, ipfsGateways: [] });
  log(`independent verification of ${ORIGIN}: ${check.status.toUpperCase()}`);
  for (const c of check.checks) log(`  ${c.status.padEnd(4)} ${c.id.padEnd(10)} ${c.detail}`);

  console.log(`
────────────────────────────────────────────────────────────────────────────
 Pramaan local demo is running (Ctrl+C to stop)
   dApp (genuine)      ${ORIGIN}
   lookalike origin    http://127.0.0.1:5181
   tamper switch       POST http://127.0.0.1:5189/mode?set=tampered   (…set=genuine to restore)
   tracker log         http://127.0.0.1:5190/log
   chain               ${RPC}  (chain id 31337, fork of Sepolia)
   ENS name            ${ensName}   resolver ${resolver}   timelock ${timelock}
   extension           pnpm build:extension, then load apps/extension/dist unpacked
   MetaMask            add network ${RPC} / 31337, import the demo user key from
                       .pramaan/demo/keys.json (LOCAL FORK ONLY)
   state               .pramaan/demo/state.json
────────────────────────────────────────────────────────────────────────────`);
}

main().catch((err: Error) => {
  console.error(`demo:up failed: ${err.message}`);
  shutdown();
  process.exit(1);
});

#!/usr/bin/env -S npx tsx
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Command } from "commander";
import {
  DeploymentRecord,
  generateReleaseKey,
  parseManifestBytes,
  releaseStatement,
  sha256Hex,
  signStatementWithKey,
  type FindingEntry,
  type ThirdPartyEntry,
} from "@pramaan/manifest/node";
import { analyzeRequest, isGuardedMethod } from "@pramaan/decoder";
import { buildSandboxImage, dockerStatus, renderBundleReport, scanBundle } from "@pramaan/engine";
import {
  assembleRelease,
  cancelOp,
  checkEnsv2,
  connect,
  deployDemoContracts,
  deployResolver,
  deployTimelock,
  executeOp,
  grantRecordRole,
  loadEnsv2Config,
  nameStatus,
  negativeWriteTest,
  publishToIpfs,
  queuePointer,
  readTimelock,
  REPO_ROOT,
  registerName,
  setNameResolver,
  signerFromKey,
  DEMO_APP_IDS,
  DEMO_ORIGINS,
  DEFAULT_TIMELOCK_DELAY_SECONDS,
  deployIdentities,
  deploymentPathFor,
  freshLocalSigner,
  loadIdentityConfig,
  readIdentityDeployment,
  readRevocations,
  revokeRelease,
  runDoctor,
  type AppIdentityInput,
  type DoctorReport,
  renderRecordPage,
} from "@pramaan/release";
import { publicSpkiFromPrivatePem, signerRecordForSpki } from "@pramaan/manifest/node";
import { checkSite, readPramaanRecords, verifySiteRelease, type ObservedResource } from "@pramaan/verifier-core";
import { runProve } from "./prove.js";

// Local secrets live in <repo>/.env (gitignored; template: .env.example). Variables already set in the shell win.
const envFile = join(REPO_ROOT, ".env");
if (existsSync(envFile)) {
  const loaded = new Set(Object.keys(process.env));
  const before = { ...process.env };
  process.loadEnvFile(envFile);
  for (const [k, v] of Object.entries(process.env)) if (!loaded.has(k) && v === "") delete process.env[k]; // blank template lines = unset
  for (const k of loaded) process.env[k] = before[k];
}

const program = new Command().name("pramaan").description("Proven before you ship. Verified before you sign.").version("0.1.0");
const log = (m: string) => console.log(m);
const env = (name: string) => process.env[name];
const rpcFrom = (opt?: string) => {
  const url = opt ?? env("SEPOLIA_RPC_URL_A") ?? env("RPC_URL");
  if (!url) throw new Error("no RPC URL: pass --rpc or set SEPOLIA_RPC_URL_A");
  return url;
};

program
  .command("prove")
  .description("Find candidates (Slither, Aderyn), reproduce them with Foundry exploit tests in the sandbox, optionally fix and re-prove")
  .argument("<dir>", "Foundry project (or a git repository with --vulnerable-ref)")
  .option("--config <file>", "pramaan.json (defaults to <dir>/pramaan.json)")
  .option("--out <dir>", "output directory", ".pramaan/prove")
  .option("--fix", "propose a deterministic fix for each reproduced finding and re-prove it")
  .option("--ai", "allow Claude to fill template slots / draft fixes when heuristics cannot (needs ANTHROPIC_API_KEY)")
  .option("--vulnerable-ref <ref>", "git ref to analyse")
  .option("--fixed-ref <ref>", "git ref holding the developer's fix")
  .option("--fixed-dir <dir>", "directory holding the developer's fix")
  .option("--repo-label <label>", "repository label for the report (e.g. https://github.com/org/repo)")
  .action(async (dir: string, o) => {
    const r = await runProve({
      repoDir: dir,
      repoLabel: o.repoLabel,
      configPath: o.config,
      outDir: o.out,
      fix: o.fix,
      ai: o.ai,
      vulnerableRef: o.vulnerableRef,
      fixedRef: o.fixedRef,
      fixedDir: o.fixedDir,
      onProgress: (e) => e.status !== "info" && log(`[${e.step}] ${e.status}: ${e.message}`),
    });
    log("");
    for (const f of r.report.findings) {
      const fx = r.fixes[f.id];
      log(`${f.id.padEnd(7)} ${f.status.padEnd(15)} ${f.candidate.contract}.${f.candidate.function ?? "-"}  (${f.candidate.sources.map((s) => s.detector).join(", ")})${fx ? `  fix: ${fx.verification.verified ? "VERIFIED" : "not verified"} – ${fx.verification.detail}` : ""}${f.pairs.map((p) => `  vs ${p.fixedContract}: ${p.verified ? "blocked" : p.outcome.kind}`).join("")}`);
    }
    log(`\nreport: ${join(r.outDir, "report.md")}`);
  });

const sandbox = program.command("sandbox").description("Manage the analysis sandbox image");
sandbox.command("build").action(async () => {
  const ok = await buildSandboxImage(REPO_ROOT, undefined, log);
  if (!ok) throw new Error("docker build failed");
});
sandbox.command("status").action(async () => log(JSON.stringify(await dockerStatus(), null, 2)));

program
  .command("keygen")
  .description("Create an ECDSA P-256 release key for self-hosted signing; prints the pramaan.signer ENS record value")
  .option("--out <file>", "private key PEM output", ".pramaan/release-key.pem")
  .action(async (o) => {
    const key = await generateReleaseKey();
    mkdirSync(dirname(resolve(o.out)), { recursive: true });
    writeFileSync(resolve(o.out), key.privateKeyPkcs8Pem, { mode: 0o600 });
    log(`private key: ${resolve(o.out)} (keep it secret; never commit it)`);
    log(`key id:      ${key.keyId}`);
    log(`ENS record   pramaan.signer = ${key.signerRecord}`);
  });

program
  .command("scan")
  .description("Scan a built frontend for shipped secrets and for trackers that could receive the wallet address (build-time leak check)")
  .requiredOption("--site <dir>", "built site directory (the one `pramaan manifest` hashes)")
  .option("--declared <host...>", "third-party hosts the app declares (same as --third-party in `manifest`)")
  .option("--own <host...>", "the app's own hosts, e.g. vault.example")
  .option("--json <file>", "also write the full result as JSON")
  .action((o) => {
    const r = scanBundle(resolve(o.site), { declaredHosts: o.declared, ownHosts: o.own });
    log(renderBundleReport(r));
    if (o.json) {
      mkdirSync(dirname(resolve(o.json)), { recursive: true });
      writeFileSync(resolve(o.json), JSON.stringify(r, null, 2));
    }
    if (!r.ok) process.exitCode = 1;
  });

program
  .command("record-page")
  .description("Render a static, self-contained public record page (HTML, no scripts) for a release manifest; pin it on IPFS or host it anywhere")
  .requiredOption("--manifest <file>", "the canonical manifest, e.g. .pramaan/release/pramaan-manifest.json")
  .option("--signature <file>", "the DSSE envelope that signs it (shown on the page)")
  .option("--manifest-href <url>", "where the raw manifest can be fetched, linked from the page")
  .option("--out <file>", "output HTML file", ".pramaan/release/record.html")
  .action((o) => {
    const manifestPath = resolve(o.manifest);
    const html = renderRecordPage(readFileSync(manifestPath), {
      signatureEnvelope: o.signature ? readFileSync(resolve(o.signature), "utf8") : null,
      manifestHref: o.manifestHref,
    });
    mkdirSync(dirname(resolve(o.out)), { recursive: true });
    writeFileSync(resolve(o.out), html);
    log(`record page written to ${resolve(o.out)} (${html.length} bytes); it states the manifest sha256 and tells readers to check it against ENS`);
  });

program
  .command("manifest")
  .description("Build the canonical release manifest (files, deployed code hashes, proven findings, descriptors)")
  .requiredOption("--site <dir>", "built site directory")
  .requiredOption("--deployment <file>", "deployments/<chainId>.json")
  .requiredOption("--ens <name>", "the app's ENS name")
  .requiredOption("--domain <origin>", "origin the site is served from, e.g. https://vault.example")
  .requiredOption("--tag <tag>", "release tag, e.g. v1.0.0")
  .option("--name <name>", "app name", "dApp")
  .option("--repo <url>", "https://github.com/<owner>/<repo> (or local:<label>)", "local:project")
  .option("--commit <sha>", "git commit (40 or 64 hex)")
  .option("--workflow <path>", "CI workflow that built the release")
  .option("--findings <file>", "findings.json written by `pramaan prove`")
  .option("--descriptor <address=path...>", "ERC-7730 descriptor served by the site")
  .option("--third-party <host|purpose|receivesAddress...>", "declared third party, e.g. api.example.com|prices|false")
  .option("--rpc <url>", "RPC used to re-read deployed code")
  .option("--sourcify", "record Sourcify verification status")
  .option("--out <dir>", "output directory", ".pramaan/release")
  .action(async (o) => {
    const ctx = await connect(rpcFrom(o.rpc));
    const deployment = DeploymentRecord.parse(JSON.parse(readFileSync(o.deployment, "utf8")));
    const findings = o.findings ? (JSON.parse(readFileSync(o.findings, "utf8")) as FindingEntry[]) : [];
    const thirdParties: ThirdPartyEntry[] = (o.thirdParty ?? []).map((s: string) => {
      const [host, purpose, receives] = s.split("|");
      return { host: host!, purpose: purpose ?? "unspecified", receivesAddress: receives === "true" };
    });
    const descriptors = (o.descriptor ?? []).map((s: string) => {
      const [address, path] = s.split("=");
      return { address: address as `0x${string}`, path: path! };
    });
    const release = await assembleRelease({
      siteDir: resolve(o.site),
      app: { name: o.name, ensName: o.ens, domain: o.domain },
      repo: o.repo,
      commit: o.commit ?? sha256Hex(readFileSync(o.deployment)),
      tag: o.tag,
      workflow: o.workflow ?? null,
      ctx,
      deployment,
      findings,
      descriptors,
      thirdParties,
      checkSourcify: o.sourcify,
    });
    mkdirSync(o.out, { recursive: true });
    writeFileSync(join(o.out, "pramaan-manifest.json"), release.bytes);
    log(`manifest: ${join(o.out, "pramaan-manifest.json")} (${release.manifest.files.length} files, ${release.manifest.contracts.length} contracts)`);
    log(`sha256:   ${release.sha256}`);
    log(`pointer:  ${release.pointer}`);
    log(`cid:      ${release.cid}`);
  });

program
  .command("sign")
  .description("Sign a manifest with the release key (DSSE, in-toto statement); GitHub CI uses actions/attest instead")
  .requiredOption("--manifest <file>")
  .requiredOption("--key <pem>")
  .option("--out <file>")
  .action(async (o) => {
    const bytes = readFileSync(o.manifest);
    const parsed = parseManifestBytes(bytes);
    if (!parsed.ok) throw new Error(parsed.reason);
    const env2 = await signStatementWithKey(releaseStatement(parsed.sha256, { tag: parsed.manifest.tag, repo: parsed.manifest.repo, commit: parsed.manifest.commit }), readFileSync(o.key, "utf8"));
    const out = o.out ?? join(dirname(o.manifest), "pramaan-manifest.dsse.json");
    writeFileSync(out, JSON.stringify(env2, null, 2));
    log(`signature: ${out} (key ${env2.signatures[0]?.keyid})`);
  });

const publish = program.command("publish").description("Publish a release");
publish
  .command("ipfs")
  .requiredOption("--manifest <file>")
  .option("--kubo <url>", "Kubo RPC API", env("IPFS_API_URL"))
  .option("--gateway <url...>", "gateways to verify retrieval through", [env("IPFS_GATEWAY_URL") ?? "http://127.0.0.1:8080"])
  .action(async (o) => {
    const r = await publishToIpfs(readFileSync(o.manifest), { kuboApi: o.kubo, pinataJwt: env("PINATA_JWT"), gateways: o.gateway });
    log(JSON.stringify(r, null, 2));
  });
publish
  .command("queue")
  .description("Queue the manifest's pointer in PramaanTimelock (PROPOSER_PRIVATE_KEY)")
  .requiredOption("--manifest <file>")
  .requiredOption("--timelock <address>")
  .option("--rpc <url>")
  .action(async (o) => {
    const ctx = await connect(rpcFrom(o.rpc));
    const parsed = parseManifestBytes(readFileSync(o.manifest));
    if (!parsed.ok) throw new Error(parsed.reason);
    const pointer = `pramaan:v1:${parsed.manifest.tag}:${parsed.sha256}`;
    const q = await queuePointer(ctx, signerFromKey(ctx, env("PROPOSER_PRIVATE_KEY"), "PROPOSER_PRIVATE_KEY"), o.timelock, pointer);
    log(`queued #${q.id} ${pointer}\neta ${new Date(Number(q.eta) * 1000).toISOString()}  tx ${q.txHash}`);
  });

const ens = program.command("ens").description("ENSv2 setup and status (Sepolia or a local fork)");
ens.command("check").option("--rpc <url>").action(async (o) => {
  const ctx = await connect(rpcFrom(o.rpc));
  for (const c of await checkEnsv2(ctx, loadEnsv2Config())) log(`${c.codeBytes > 0 ? "ok " : "MISSING"} ${c.name.padEnd(26)} ${c.address} (${c.codeBytes} bytes)`);
});
ens
  .command("status")
  .requiredOption("--name <ensName>")
  .option("--rpc <url...>", "one or more RPCs (two must agree)")
  .option("--timelock <address>")
  .action(async (o) => {
    const urls: string[] = o.rpc ?? [env("SEPOLIA_RPC_URL_A"), env("SEPOLIA_RPC_URL_B")].filter(Boolean);
    const ctx = await connect(urls[0]!);
    const ensCfg = loadEnsv2Config();
    log(JSON.stringify(await nameStatus(ctx, ensCfg, o.name), null, 2));
    log(JSON.stringify(await readPramaanRecords({ chainId: ctx.chain.id, rpcUrls: urls, universalResolver: ensCfg.universalResolver }, o.name), null, 2));
    if (o.timelock) log(JSON.stringify(await readTimelock(ctx, o.timelock), (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  });
ens
  .command("setup")
  .description("Deploy the name's resolver (owner records in initialize), the timelock, grant ROLE_SET_TEXT on pramaan.record only, and register or point the name")
  .requiredOption("--name <ensName>")
  .requiredOption("--domain <origin>")
  .option("--repo <url>", "https://github.com/<owner>/<repo> (GitHub attestation mode)")
  .option("--signer <record>", "p256-spki:… (release-key mode)")
  .option("--delay <seconds>", "timelock delay", env("TIMELOCK_DELAY_SECONDS") ?? "300")
  .option("--register", "register the name first (commit-reveal, MockUSDC); otherwise it must already be owned")
  .option("--rpc <url>")
  .action(async (o) => {
    const ctx = await connect(rpcFrom(o.rpc));
    const ensCfg = loadEnsv2Config();
    const owner = signerFromKey(ctx, env("OWNER_PRIVATE_KEY"), "OWNER_PRIVATE_KEY");
    const proposer = signerFromKey(ctx, env("PROPOSER_PRIVATE_KEY"), "PROPOSER_PRIVATE_KEY");
    const attestation = o.repo ? "github" : "key";
    const { resolver, txHash } = await deployResolver(ctx, owner, ensCfg, o.name, { domain: o.domain, repo: o.repo, signer: o.signer, attestation });
    log(`resolver ${resolver} (tx ${txHash})`);
    const { timelock } = await deployTimelock(ctx, owner, { resolver, ensName: o.name, delaySeconds: Number(o.delay), proposer: proposer.account.address, guardian: owner.account.address });
    log(`timelock ${timelock}`);
    log(`grant    ${await grantRecordRole(ctx, owner, resolver, timelock)}`);
    if (o.register) log(`register ${JSON.stringify((await registerName(ctx, owner, ensCfg, o.name, resolver, log)).txHashes)}`);
    else log(`resolver ${await setNameResolver(ctx, owner, ensCfg, o.name, resolver)}`);
    log(`\nexport PRAMAAN_RESOLVER=${resolver}\nexport PRAMAAN_TIMELOCK=${timelock}`);
  });
ens.command("execute").requiredOption("--timelock <address>").requiredOption("--id <n>").option("--rpc <url>").action(async (o) => {
  const ctx = await connect(rpcFrom(o.rpc));
  const key = env("EXECUTOR_PRIVATE_KEY") ?? env("PROPOSER_PRIVATE_KEY");
  log(`executed: ${await executeOp(ctx, signerFromKey(ctx, key, "EXECUTOR_PRIVATE_KEY"), o.timelock, BigInt(o.id))}`);
});
ens.command("cancel").requiredOption("--timelock <address>").requiredOption("--id <n>").option("--rpc <url>").action(async (o) => {
  const ctx = await connect(rpcFrom(o.rpc));
  log(`cancelled: ${await cancelOp(ctx, signerFromKey(ctx, env("OWNER_PRIVATE_KEY"), "OWNER_PRIVATE_KEY"), o.timelock, BigInt(o.id))}`);
});
ens
  .command("negative-test")
  .description("Show the CI proposer key cannot write records directly (add --broadcast to mine the reverting txs)")
  .requiredOption("--name <ensName>")
  .requiredOption("--resolver <address>")
  .option("--broadcast")
  .option("--rpc <url>")
  .action(async (o) => {
    const ctx = await connect(rpcFrom(o.rpc));
    for (const r of await negativeWriteTest(ctx, signerFromKey(ctx, env("PROPOSER_PRIVATE_KEY"), "PROPOSER_PRIVATE_KEY"), o.resolver, o.name, o.broadcast)) {
      log(`${r.reverted ? "REVERTED" : "SUCCEEDED (!)"}  ${r.attempt}  ${r.detail}${r.txHash ? `  tx ${r.txHash}` : ""}`);
    }
  });

function printDoctor(r: DoctorReport): void {
  const mark = { ok: "ok  ", fail: "FAIL", warn: "warn", info: "info" } as const;
  log(`Pramaan doctor: ${r.network}\n`);
  for (const c of r.checks) {
    log(`[${mark[c.status]}] ${c.title}: ${c.detail}`);
    if (c.action && c.status !== "ok") log(`       → ${c.action}`);
  }
  const todo = r.checks.filter((c) => c.status === "fail");
  log(`\n${r.ready ? "READY" : `NOT READY: ${todo.length} required item(s) above marked FAIL`}`);
}

program
  .command("doctor")
  .description("Readiness checklist for a Sepolia (or local fork) deployment: RPCs, ENSv2 code, balances, parent name, credentials")
  .option("--network <network>", "sepolia | local", "sepolia")
  .option("--parent <label>", "parent name label (default PRAMAAN_PARENT_LABEL)")
  .option("--apps <n>", "number of app identities to budget for", "3")
  .option("--rpc <url>", "local RPC (with --network local)")
  .option("--json", "machine-readable output")
  .action(async (o) => {
    if (o.network !== "sepolia" && o.network !== "local") throw new Error("--network must be sepolia or local");
    const report = await runDoctor({ network: o.network, parentLabel: o.parent, appCount: Number(o.apps), localRpcUrl: o.rpc });
    if (o.json) log(JSON.stringify(report, null, 2));
    else printDoctor(report);
    process.exitCode = report.ready ? 0 : 1;
  });

const collect = (v: string, acc: string[]) => [...acc, v];
const pairs = (list: string[], what: string): Record<string, string> =>
  Object.fromEntries(
    list.map((s) => {
      const i = s.indexOf("=");
      if (i <= 0) throw new Error(`${what} must look like <app>=<value>, got "${s}"`);
      return [s.slice(0, i), s.slice(i + 1)];
    }),
  );

program
  .command("deploy")
  .argument("<what>", "demo | identities")
  .description("demo: deploy the demo dApp contracts. identities: <parent>.eth + one ENSv2 subname, resolver and timelock per app")
  .option("--rpc <url>")
  .option("--network <network>", "identities: sepolia | local", "sepolia")
  .option("--parent <label>", "identities: parent .eth label (default PRAMAAN_PARENT_LABEL)")
  .option("--apps <ids>", "identities: comma-separated app ids", DEMO_APP_IDS.join(","))
  .option("--domain <app=origin>", "identities: origin per app (repeatable); defaults to the local demo origins", collect, [] as string[])
  .option("--signer-record <record>", "identities: p256-spki:… for every app (default PRAMAAN_SIGNER_RECORD or --release-key)")
  .option("--release-key <pem>", "identities: derive the signer record from this P-256 private key PEM", ".pramaan/release-key.pem")
  .option("--delay <seconds>", "identities: timelock delay", String(env("TIMELOCK_DELAY_SECONDS") ?? DEFAULT_TIMELOCK_DELAY_SECONDS))
  .option("--out <file>", "identities: output (merged into, never overwritten)")
  .option("--broadcast-negative", "identities: also mine the reverting negative-test transactions (costs a little Sepolia ETH)")
  .option("--yes", "identities: actually send transactions on Sepolia (without it: doctor + plan only)")
  .action(async (what: string, o) => {
    if (what === "demo") {
      const ctx = await connect(rpcFrom(o.rpc));
      const record = await deployDemoContracts(ctx, signerFromKey(ctx, env("OWNER_PRIVATE_KEY"), "OWNER_PRIVATE_KEY"), log);
      const out = join(REPO_ROOT, "contracts", "deployments", `${record.chainId}.json`);
      mkdirSync(dirname(out), { recursive: true });
      // Merge: the same file carries the ENS identities under "ens".
      const previous = existsSync(out) ? (JSON.parse(readFileSync(out, "utf8")) as Record<string, unknown>) : {};
      writeFileSync(out, JSON.stringify({ ...previous, ...record }, null, 2));
      log(`deployment: ${out}`);
      return;
    }
    if (what !== "identities") throw new Error(`unknown deploy target "${what}" (demo | identities)`);
    if (o.network !== "sepolia" && o.network !== "local") throw new Error("--network must be sepolia or local");
    const parentLabel: string | undefined = o.parent ?? env("PRAMAAN_PARENT_LABEL");
    if (!parentLabel) throw new Error("pass --parent <label>");
    const appIds = String(o.apps).split(",").map((s) => s.trim()).filter(Boolean);
    const domains = pairs(o.domain, "--domain");
    let signerRecord: string | undefined = o.signerRecord ?? env("PRAMAAN_SIGNER_RECORD");
    if (!signerRecord && existsSync(resolve(o.releaseKey))) signerRecord = signerRecordForSpki(await publicSpkiFromPrivatePem(readFileSync(resolve(o.releaseKey), "utf8")));
    if (!signerRecord) throw new Error("no release signer: pass --signer-record p256-spki:… or create one with `pnpm pramaan keygen`");
    const apps: AppIdentityInput[] = appIds.map((id) => ({
      id,
      label: id,
      domain: domains[id] ?? (DEMO_ORIGINS as Record<string, string>)[id] ?? (() => { throw new Error(`no --domain ${id}=<origin>`); })(),
      attestation: "key",
      signerSpki: signerRecord,
    }));

    const doctor = await runDoctor({ network: o.network, parentLabel, appCount: apps.length, localRpcUrl: o.rpc });
    printDoctor(doctor);
    if (!doctor.ready) {
      process.exitCode = 1;
      return;
    }
    const ctx = await connect(o.network === "local" ? (o.rpc ?? env("LOCAL_RPC_URL") ?? "http://127.0.0.1:8545") : doctor.rpcUrls[0]!);
    if (o.network === "sepolia" && ctx.chain.id !== 11155111) throw new Error(`connected to chain ${ctx.chain.id}, expected Sepolia`);
    if (o.network === "local" && !ctx.local) throw new Error("--network local needs a local anvil fork");
    const keyed = (name: string) => (env(name) ? signerFromKey(ctx, env(name), name) : null);
    const owner = keyed("OWNER_PRIVATE_KEY") ?? (ctx.local ? await freshLocalSigner(ctx, "owner") : null);
    const proposer = keyed("PROPOSER_PRIVATE_KEY") ?? (ctx.local ? await freshLocalSigner(ctx, "proposer", 1n) : null);
    const guardian = keyed("GUARDIAN_PRIVATE_KEY") ?? (ctx.local ? await freshLocalSigner(ctx, "guardian", 1n) : null);
    if (!owner || !proposer || !guardian) throw new Error("OWNER_PRIVATE_KEY, PROPOSER_PRIVATE_KEY and GUARDIAN_PRIVATE_KEY are required on Sepolia");
    log(`\nplan: ${parentLabel}.eth → ${apps.map((a) => `${a.label}.${parentLabel}.eth (${a.domain})`).join(", ")}`);
    log(`owner ${owner.account.address} · proposer ${proposer.account.address} · guardian ${guardian.account.address} · delay ${o.delay}s`);
    if (o.network === "sepolia" && !o.yes) {
      log("\ndry run: nothing was sent. Re-run with --yes to deploy on Sepolia.");
      return;
    }
    const outPath = o.out ? resolve(o.out) : o.network === "sepolia" ? deploymentPathFor(ctx.chain.id) : join(REPO_ROOT, ".pramaan", "rehearsal", `${ctx.chain.id}.json`);
    const file = await deployIdentities(ctx, {
      outPath,
      network: o.network === "sepolia" ? "sepolia" : "anvil-fork",
      ens: loadIdentityConfig(),
      owner,
      proposer,
      guardian,
      parentLabel,
      apps,
      timelockDelaySeconds: Number(o.delay),
      broadcastNegativeTests: o.network === "local" || Boolean(o.broadcastNegative),
      log: (m) => log(`  ${m}`),
    });
    const r = file.identities;
    log(`\n${r.parent} (token ${r.parentTokenId}) subregistry ${r.subregistry}`);
    for (const a of Object.values(r.apps)) log(`  ${a.ensName}\n    resolver ${a.resolver}\n    timelock ${a.timelock}`);
    log(`negative tests: ${r.negativeTests.filter((t) => t.ok).length}/${r.negativeTests.length} as expected`);
    for (const [k, v] of Object.entries(file.links)) log(`  ${k}: ${v}`);
    log(`written: ${outPath}`);
  });

ens
  .command("revoke")
  .description("Guardian: add a manifest sha256 to pramaan.revoked (immediate; GUARDIAN_PRIVATE_KEY)")
  .requiredOption("--name <ensName>")
  .requiredOption("--sha256 <digest>", "manifest sha256 (64 hex)")
  .option("--resolver <address>", "the name's resolver (default: from contracts/deployments/<chainId>.json)")
  .option("--rpc <url>")
  .action(async (o) => {
    const ctx = await connect(rpcFrom(o.rpc));
    const resolver = o.resolver ?? Object.values(readIdentityDeployment(deploymentPathFor(ctx.chain.id))?.identities.apps ?? {}).find((a) => a.ensName === o.name)?.resolver;
    if (!resolver) throw new Error("pass --resolver <address>");
    const r = await revokeRelease(ctx, signerFromKey(ctx, env("GUARDIAN_PRIVATE_KEY"), "GUARDIAN_PRIVATE_KEY"), { resolver, ensName: o.name, manifestSha256: o.sha256 });
    log(r.txHash ? `revoked (tx ${r.txHash}); pramaan.revoked now lists ${r.revoked.length}` : "already revoked");
  });
ens
  .command("revocations")
  .requiredOption("--name <ensName>")
  .requiredOption("--resolver <address>")
  .option("--rpc <url>")
  .action(async (o) => {
    const ctx = await connect(rpcFrom(o.rpc));
    for (const d of await readRevocations(ctx, o.resolver, o.name)) log(d);
  });

program
  .command("verify")
  .description("Independently verify a site's Pramaan release and its served files (same checks as the extension)")
  .argument("<url>")
  .option("--chain <chainId=url,url...>", "RPCs per chain", (v: string, acc: string[]) => [...acc, v], [] as string[])
  .action(async (url: string, o) => {
    const chains: Record<number, { chainId: number; rpcUrls: string[]; universalResolver?: `0x${string}`; minAgreement?: number }> = {};
    const defaults = [`11155111=${[env("SEPOLIA_RPC_URL_A"), env("SEPOLIA_RPC_URL_B")].filter(Boolean).join(",") || "https://sepolia.gateway.tenderly.co,https://rpc.sepolia.ethpandaops.io"}`, "31337=http://127.0.0.1:8545"];
    for (const spec of [...defaults, ...o.chain]) {
      const [id, list] = spec.split("=");
      const urls = list!.split(",").filter(Boolean);
      chains[Number(id)] = { chainId: Number(id), rpcUrls: urls, universalResolver: loadEnsv2Config().universalResolver, minAgreement: Number(id) === 31337 ? 1 : Math.min(2, urls.length) };
    }
    const origin = new URL(url).origin;
    const release = await verifySiteRelease({ origin, chains, ipfsGateways: [env("IPFS_GATEWAY_URL") ?? "http://127.0.0.1:8080", "https://ipfs.io"] });
    for (const c of release.checks) log(`${c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : c.status === "warn" ? "!" : "-"} ${c.id.padEnd(10)} ${c.detail}`);
    log(`release: ${release.status.toUpperCase()}`);
    if (release.manifest) {
      const observed: ObservedResource[] = [];
      for (const f of release.manifest.files.filter((x) => x.path.endsWith(".html") || x.path.endsWith(".js") || x.path.endsWith(".css"))) {
        const res = await fetch(new URL(f.path, origin), { cache: "no-store" });
        const bytes = new Uint8Array(await res.arrayBuffer());
        observed.push({ url: new URL(f.path, origin).href, type: f.path.endsWith(".js") ? "script" : f.path.endsWith(".css") ? "stylesheet" : "main_frame", sha256: res.ok ? sha256Hex(bytes) : null });
      }
      const site = checkSite(release.manifest, origin, observed);
      for (const r of site.resources.filter((x) => x.status !== "match")) log(`  ${r.status} ${r.path ?? r.url}`);
      log(`files: ${site.status} (${site.severity}) – ${site.summary}`);
    }
  });

program
  .command("decode")
  .description("Explain a wallet request deterministically in English, Hindi and Marathi")
  .requiredOption("--method <method>", "eth_sendTransaction | eth_signTypedData_v4 | personal_sign | eth_sign | wallet_sendCalls")
  .requiredOption("--params <json>", "JSON array of the request params")
  .option("--chain <id>", "chain id", "11155111")
  .action(async (o) => {
    if (!isGuardedMethod(o.method)) throw new Error(`unsupported method ${o.method}`);
    const r = await analyzeRequest(o.method, JSON.parse(o.params) as unknown[], { chainId: Number(o.chain) });
    for (const lang of ["en", "hi", "mr"] as const) {
      const e = r.explanations[lang];
      log(`[${lang}] ${e.headline}`);
      for (const k of e.risks) log(`      ${k.level.toUpperCase()}: ${k.text}`);
    }
    log(`level: ${r.assessment.level}`);
  });

program.parseAsync().catch((err: Error) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});


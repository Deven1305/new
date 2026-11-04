// Builds the three demo dApps for one deployment.
//
//   node scripts/build.mjs [--state <DemoStateV2 json>] [--only <vaultlab|mirroryield|permitmarket>] [--out <dir>] [--apps-root <dir>] [--no-fixtures]
//
// Per app: injects the deployment as VITE_PRAMAAN_APP (JSON, includes the contract addresses from the state), builds
// apps/demos/<appId> with Vite into <out>/dist/<appId> (or the app's `distDir` from the state when --out is absent),
// then writes /.well-known/pramaan.json (the untrusted WellKnownHint) and the ERC-7730 descriptors. VaultLab also gets
// the PROVE outputs as /.well-known/pramaan/findings.json and /.well-known/pramaan/evidence/<sha256>.json.
// PermitMarket's attack fixture is built separately into <out>/dist-fixtures/permitmarket (never into the production dist).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { APP_IDS, DEMOS_ROOT, REPO_ROOT, defaultStatePath, loadState, outputDirs, repoPath } from "./common.mjs";
import { descriptorsFor } from "./descriptors.mjs";
import { backupDirFor } from "./tamper.mjs";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** The JSON string injected as VITE_PRAMAAN_APP for one app. */
export function appConfigJson(state, appId) {
  const app = state.apps[appId];
  return JSON.stringify({
    appId,
    name: app.name,
    chainId: state.network.chainId,
    chainName: state.network.chainName,
    rpcUrl: state.network.rpcUrl,
    explorer: state.network.explorer ?? null,
    ensName: app.ensName,
    origin: app.origin,
    contracts: app.contracts,
  });
}

/** Builds with the app's OWN vite config (configFile) when given; outDir/base/env are forced from here. */
async function viteBuild({ root, outDir, base, configFile, env }) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const cwd = process.cwd();
  process.chdir(root); // app configs may name rollup inputs relative to the app folder
  try {
    await build({
      root,
      configFile: configFile ?? false,
      envDir: false,
      logLevel: "warn",
      ...(base ? { base } : {}),
      build: { outDir, emptyOutDir: true, modulePreload: { polyfill: false }, sourcemap: false, reportCompressedSize: false },
    });
  } finally {
    process.chdir(cwd);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

/** PROVE outputs for VaultLab: findings.json plus one evidence file per finding, named by the evidence sha256. */
function writeProveOutputs(state, distDir) {
  if (!state.prove || !Array.isArray(state.prove.findings) || state.prove.findings.length === 0) return 0;
  const proveDir = state.prove.reportJson ? dirname(repoPath(state.prove.reportJson)) : join(REPO_ROOT, ".pramaan", "demo", "prove");
  const published = [];
  for (const f of state.prove.findings) {
    published.push({
      id: f.id,
      title: f.title,
      class: f.class,
      severity: f.severity,
      status: f.status,
      exploitTestSha256: f.exploitTestSha256,
      evidenceSha256: f.evidenceSha256,
    });
    if (!f.evidenceSha256) continue;
    const src = join(proveDir, "evidence", `${f.id}.json`);
    if (!existsSync(src)) throw new Error(`finding ${f.id}: evidence file ${src} is missing (re-run PROVE)`);
    const bytes = readFileSync(src);
    if (sha256(bytes) !== f.evidenceSha256) throw new Error(`finding ${f.id}: ${src} does not hash to the recorded evidenceSha256 ${f.evidenceSha256}`);
    const dest = join(distDir, ".well-known", "pramaan", "evidence", `${f.evidenceSha256}.json`);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, bytes);
  }
  writeJson(join(distDir, ".well-known", "pramaan", "findings.json"), published);
  return published.length;
}

export async function buildApp(state, appId, { out, fixtures = true, appsRoot = DEMOS_ROOT } = {}) {
  const app = state.apps[appId];
  const dirs = outputDirs(state, appId, out);
  const config = appConfigJson(state, appId);
  const root = join(resolve(appsRoot), appId);
  if (!existsSync(join(root, "index.html"))) throw new Error(`${root}/index.html is missing`);

  // Production bundle. VITE_TRACKER_URL is explicitly unset so that a tracker URL in the shell can never reach it.
  await viteBuild({ root, outDir: dirs.dist, configFile: existsSync(join(root, "vite.config.ts")) ? join(root, "vite.config.ts") : undefined, env: { VITE_PRAMAAN_APP: config, VITE_TRACKER_URL: undefined } });

  // Release metadata served by the site. The hint is untrusted: the extension re-derives everything from ENS.
  writeJson(join(dirs.dist, ".well-known", "pramaan.json"), { pramaan: 1, ensName: app.ensName, chainId: state.network.chainId });
  for (const [file, descriptor] of Object.entries(descriptorsFor(appId, app, state.network.chainId))) writeJson(join(dirs.dist, "erc7730", file), descriptor);
  let findings = 0;
  if (appId === "vaultlab") findings = writeProveOutputs(state, dirs.dist);

  // A rebuilt site is a clean site: drop any backup of a previous tamper.
  rmSync(backupDirFor(dirs.dist), { recursive: true, force: true });

  let fixtureDir = null;
  const fixtureConfig = join(root, "vite.fixture.config.ts");
  if (appId === "permitmarket" && fixtures && existsSync(fixtureConfig) && existsSync(join(root, "fixtures", "leak.html"))) {
    const tracker = `${state.hosts?.trackerUrl ?? "http://127.0.0.1:5190"}/collect`;
    await viteBuild({ root, outDir: dirs.fixtures, base: "/__fixtures/", configFile: fixtureConfig, env: { VITE_PRAMAAN_APP: config, VITE_TRACKER_URL: tracker } });
    // The input lives in fixtures/, so Vite emits fixtures/leak.html; the server maps /__fixtures/ to this directory's root.
    const nested = join(dirs.fixtures, "fixtures", "leak.html");
    if (existsSync(nested)) {
      renameSync(nested, join(dirs.fixtures, "leak.html"));
      rmSync(join(dirs.fixtures, "fixtures"), { recursive: true, force: true });
    }
    fixtureDir = dirs.fixtures;
  }
  return { appId, dist: dirs.dist, fixtures: fixtureDir, findings };
}

export async function buildAll(statePath, { only, out, fixtures = true, appsRoot } = {}) {
  const state = loadState(statePath);
  if (only && !APP_IDS.includes(only)) throw new Error(`--only must be one of ${APP_IDS.join(", ")}`);
  const results = [];
  for (const id of only ? [only] : APP_IDS) {
    const r = await buildApp(state, id, { out, fixtures, appsRoot });
    results.push(r);
    console.log(`built ${id}: ${r.dist}${r.fixtures ? ` (+ fixture ${r.fixtures})` : ""}${id === "vaultlab" ? `, ${r.findings} published finding(s)` : ""}`);
  }
  return results;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const opt = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const statePath = resolve(opt("state") ?? defaultStatePath());
  buildAll(statePath, { only: opt("only"), out: opt("out"), appsRoot: opt("apps-root"), fixtures: !argv.includes("--no-fixtures") }).catch((err) => {
    console.error(`demo build failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}

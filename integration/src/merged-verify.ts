// The full merged pre-sign check against a LIVE Pramaan-published site:
//   app row       <- Pramaan: signed release (ENS, timelock, signature) + served-file hashes
//   contract row  <- Pramaan: deployed bytecode / proxy implementation vs the release
//   action row    <- Pramaan: what the call does
//   recipient row <- HexFence: lookalike rule against the approved payees
// all folded into one verdict by @hexfence/core.
//
//   pnpm merged:verify http://localhost:5182 [--chain 31337=http://127.0.0.1:8545] [--to 0x… --value 0.01 --payee 0x…]
// Needs a running demo (pnpm merged:up) for the local chain, or a real ENS RPC for Sepolia.
import { getAddress, isAddress, parseEther, type Address } from "viem";
import { combine, type CheckRow, type Level } from "../../packages/core/src/index.js";
import { sha256Hex } from "../../pramaan/packages/manifest/src/hash.js";
import { checkSite, compareContract, inspectAgreed, verifySiteRelease, type ObservedResource } from "../../pramaan/packages/verifier-core/src/index.js";
import { loadEnsv2Config } from "../../pramaan/packages/release/src/index.js";
import { checkTx } from "./merged-check.js";

const arg = (name: string, def?: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const url = process.argv[2];
if (!url || url.startsWith("--")) { console.error("usage: merged:verify <site-url> [--chain 31337=rpc] [--to 0x… --value 0.01 --payee 0x…]"); process.exit(2); }

const chainSpec = arg("chain", "31337=http://127.0.0.1:8545")!;
const [chainIdText, rpcList] = chainSpec.split("=");
const chainId = Number(chainIdText);
const rpcUrls = rpcList!.split(",");
const cfg = { chainId, rpcUrls, universalResolver: loadEnsv2Config().universalResolver, minAgreement: chainId === 31337 ? 1 : Math.min(2, rpcUrls.length) };

const rows: CheckRow[] = [];
const lvl = (s: "green" | "amber" | "red"): Level => s;

const origin = new URL(url).origin;
const release = await verifySiteRelease({ origin, chains: { [chainId]: cfg } });
for (const c of release.checks) console.log(`  ${c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : c.status === "warn" ? "!" : "-"} ${c.id.padEnd(10)} ${c.detail}`);
console.log(`release: ${release.status.toUpperCase()}${release.reason ? ` (${release.reason})` : ""}`);

const releaseLevel: Record<string, Level> = { verified: "green", missing: "grey", unverifiable: "grey", mismatch: "red", "invalid-signature": "red", revoked: "red" };
rows.push({ kind: "app", level: releaseLevel[release.status] ?? "grey", code: `RELEASE_${release.status.toUpperCase().replace(/-/g, "_")}`, params: { origin, ens: release.ensName ?? "" } });

if (release.manifest) {
  const observed: ObservedResource[] = [];
  for (const f of release.manifest.files.filter((x) => /\.(html|js|css)$/.test(x.path))) {
    const res = await fetch(new URL(f.path, origin), { cache: "no-store" });
    const bytes = new Uint8Array(await res.arrayBuffer());
    observed.push({ url: new URL(f.path, origin).href, type: f.path.endsWith(".js") ? "script" : f.path.endsWith(".css") ? "stylesheet" : "main_frame", sha256: res.ok ? sha256Hex(bytes) : null });
  }
  const site = checkSite(release.manifest, origin, observed);
  console.log(`files: ${site.status} (${site.severity}) - ${site.summary}`);
  rows.push({ kind: "app", level: lvl(site.severity), code: `SITE_FILES_${site.status.toUpperCase().replace(/-/g, "_")}`, params: { summary: site.summary } });

  // contract row: every contract the release lists must still match what is deployed
  let worst: Level = "green"; let checked = 0; const notes: string[] = [];
  for (const c of release.manifest.contracts.filter((x) => x.chainId === chainId)) {
    const ins = await inspectAgreed(cfg, c.address as Address);
    checked++;
    if (ins.status !== "ok") { worst = "grey"; notes.push(`${c.label}: could not read`); continue; }
    const r = compareContract(release.manifest, chainId, ins.inspection);
    if (r.status !== "verified") { worst = "red"; notes.push(`${c.label}: ${r.status}`); }
  }
  rows.push({ kind: "contract", level: checked === 0 ? "grey" : worst, code: checked === 0 ? "NO_CONTRACTS_ON_THIS_CHAIN" : worst === "green" ? "CONTRACTS_MATCH_RELEASE" : "CONTRACT_NOT_AS_RELEASED", params: { checked: String(checked), notes: notes.join("; ") } });
}

// optional payment on top of the page checks
const to = arg("to"); const payee = arg("payee");
if (to && isAddress(to)) {
  const payees = payee && isAddress(payee) ? [getAddress(payee)] : [];
  const { result, text } = await checkTx({ to: getAddress(to), value: parseEther(arg("value", "0")!) }, payees);
  rows.push(...result.rows);
  console.log(`payment: ${text}`);
}

const out = combine(rows);
console.log("\nrows:");
for (const r of out.rows) console.log(`  ${r.kind.padEnd(9)} ${r.level.toUpperCase().padEnd(5)} ${r.code}${r.params.notes ? `  [${r.params.notes}]` : ""}`);
console.log(`\nVERDICT: ${out.overall.toUpperCase()}  ->  ${out.hold}`);
process.exit(out.overall === "green" ? 0 : 1);

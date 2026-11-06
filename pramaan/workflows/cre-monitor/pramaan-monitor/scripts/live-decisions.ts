/**
 * Runs the workflow's REAL read-and-decide code (collectObservation + decide + signed ingest payload) against a live
 * chain, without the CRE runtime. This is NOT `cre workflow simulate` (that needs `cre login`); it proves the decision
 * logic against the running demo fork and can post the signed result to the Pramaan server.
 *
 *   bun run scripts/live-decisions.ts [--config config.demo.json] [--post] [--out ../../../docs/evidence/x.json]
 *
 * --post sends the HMAC-signed payload to <ingestUrl>/v1/ingest/cre; the secret comes from PRAMAAN_INGEST_SECRET.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { decide } from "../src/decide";
import { inspectManifestBytes } from "../src/manifest";
import { collectObservation, type ChainPort } from "../src/reads";
import { buildIngestPayload, INGEST_PATH, SIGNATURE_HEADER, signedRequest } from "../src/sign";
import { configSchema, type Address, type Hex } from "../src/types";
import type { RawLog } from "../src/abi";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const flag = (n: string) => process.argv.includes(`--${n}`);

const config = configSchema.parse(JSON.parse(readFileSync(resolve(arg("config") ?? "config.demo.json"), "utf8")));
const rpcUrl = process.env["CRE_DEMO_RPC"] ?? "http://127.0.0.1:8545";

/** The workflow's chain surface is synchronous (CRE style), so each call runs a tiny Node child that does the fetch. */
function syncFetch(url: string, init: { method: string; body?: string }): { status: number; body: Buffer } {
  const script = `const [url,method,body]=process.argv.slice(1);fetch(url,{method,headers:{"content-type":"application/json"},body:body||undefined,signal:AbortSignal.timeout(10000)}).then(async r=>{const b=Buffer.from(await r.arrayBuffer());process.stdout.write(JSON.stringify({status:r.status,body:b.toString("base64")}))}).catch(e=>{process.stdout.write(JSON.stringify({status:0,body:Buffer.from(String(e)).toString("base64")}))})`;
  const r = spawnSync(process.execPath, ["-e", script, url, init.method, init.body ?? ""], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const out = JSON.parse(r.stdout) as { status: number; body: string };
  return { status: out.status, body: Buffer.from(out.body, "base64") };
}

function rpc(method: string, params: unknown[]): unknown {
  const res = syncFetch(rpcUrl, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = JSON.parse(res.body.toString("utf8")) as { result?: unknown; error?: { message: string } };
  if (res.status !== 200 || j.error) throw new Error(`${method}: ${j.error?.message ?? `HTTP ${res.status}`}`);
  return j.result;
}

const port: ChainPort = {
  header() {
    const b = rpc("eth_getBlockByNumber", ["latest", false]) as { number: string; timestamp: string };
    return { number: BigInt(b.number), timestamp: BigInt(b.timestamp) };
  },
  call(to: Address, data: Hex) {
    return rpc("eth_call", [{ to, data }, "latest"]) as Hex;
  },
  logs(addresses: Address[], topic0: Hex[], from: bigint, to: bigint): RawLog[] {
    const logs = rpc("eth_getLogs", [{ address: addresses, topics: [topic0], fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }]) as { address: Address; topics: Hex[]; data: Hex; blockNumber: string; logIndex: string }[];
    return logs.map((l) => ({ address: l.address, topics: l.topics, data: l.data, blockNumber: Number(l.blockNumber), logIndex: Number(l.logIndex) }));
  },
};

const app = config.apps[0]!;
const observation = collectObservation(config, app, port, (url) => {
  const r = syncFetch(url, { method: "GET" });
  return inspectManifestBytes(r.status, new Uint8Array(r.body));
});
const decision = decide(observation);
console.log(`[live-decisions] ${app.app}: ${decision.decision} (${decision.severity}) - ${decision.summary}`);

const result: Record<string, unknown> = {
  runner: "live-decision-harness (the workflow's own collectObservation/decide against a live fork; NOT cre workflow simulate)",
  at: new Date().toISOString(),
  chainId: config.chainId,
  app: app.app,
  ensName: app.ensName,
  decision: decision.decision,
  severity: decision.severity,
  summary: decision.summary,
  findings: decision.findings,
};

if (flag("post")) {
  const secret = process.env["PRAMAAN_INGEST_SECRET"];
  if (!secret) throw new Error("--post needs PRAMAAN_INGEST_SECRET");
  if (!config.ingestUrl) throw new Error("--post needs ingestUrl in the config");
  if (decision.decision === "OK") {
    result["ingest"] = { attempted: false, reason: "decision is OK; the workflow only reports non-OK decisions" };
  } else {
    const payload = buildIngestPayload({ workflow: config.workflowName, observedAt: new Date(), chainId: config.chainId, app: app.app, ensName: app.ensName, decision });
    const { body, signature } = signedRequest(secret, payload);
    const res = fetch(`${config.ingestUrl.replace(/\/$/, "")}${INGEST_PATH}`, { method: "POST", headers: { "content-type": "application/json", [SIGNATURE_HEADER]: signature }, body });
    const r = await res;
    result["ingest"] = { attempted: true, status: r.status, response: (await r.text()).slice(0, 400) };
    console.log(`[live-decisions] ingest -> HTTP ${r.status}`);
  }
}

const out = arg("out");
if (out) writeFileSync(resolve(out), JSON.stringify(result, null, 2) + "\n");
else console.log(JSON.stringify(result, null, 2));

import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, parseAbi, toHex } from "viem";
import { createApp } from "../src/app.js";
import { createApiToken } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { resolveDeps } from "../src/context.js";
import { openDb } from "../src/db.js";
import { assessLog, pollAllMonitors } from "../src/monitor.js";

const TIMELOCK = "0x1111111111111111111111111111111111111111";
const RESOLVER = "0x2222222222222222222222222222222222222222";
const PROXY = "0x3333333333333333333333333333333333333333";
const IMPL = "0x4444444444444444444444444444444444444444";
const TX1 = "0x" + "a1".repeat(32);
const TX2 = "0x" + "b2".repeat(32);

const timelockAbi = parseAbi(["event Queued(uint256 indexed id, string value, uint64 eta, address indexed proposer)"]);
const proxyAbi = parseAbi(["event Upgraded(address indexed implementation)"]);
const resolverAbi = parseAbi(["event TextUpdated(uint256 indexed recordId, string indexed keyHash, string key, string value)"]);

/** A tiny JSON-RPC node: chain 11155111, head 100, and the logs/transactions the test registers. */
function fakeRpc(logs: Record<string, unknown[]>, txTo: Record<string, string>) {
  const calls: string[] = [];
  const fetchFn = (async (_url: unknown, init?: { body?: unknown }) => {
    const req = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown[] };
    calls.push(req.method);
    const answer = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, result }), { headers: { "content-type": "application/json" } });
    if (req.method === "eth_chainId") return answer("0xaa36a7");
    if (req.method === "eth_blockNumber") return answer("0x64");
    if (req.method === "eth_getLogs") {
      const filter = req.params[0] as { address: string };
      return answer(logs[filter.address.toLowerCase()] ?? []);
    }
    if (req.method === "eth_getBlockByNumber") return answer({ number: "0x5a", hash: "0x" + "cc".repeat(32), timestamp: "0x6700e000", transactions: [], parentHash: "0x" + "00".repeat(32), nonce: "0x0", sha3Uncles: "0x" + "00".repeat(32), logsBloom: "0x" + "00".repeat(256), transactionsRoot: "0x" + "00".repeat(32), stateRoot: "0x" + "00".repeat(32), receiptsRoot: "0x" + "00".repeat(32), miner: "0x" + "00".repeat(20), difficulty: "0x0", totalDifficulty: "0x0", extraData: "0x", size: "0x1", gasLimit: "0x1", gasUsed: "0x0", uncles: [] });
    if (req.method === "eth_getTransactionByHash") {
      const hash = String(req.params[0]);
      return answer({ hash, to: txTo[hash] ?? null, from: "0x" + "dd".repeat(20), nonce: "0x0", blockHash: "0x" + "cc".repeat(32), blockNumber: "0x5a", transactionIndex: "0x0", value: "0x0", gas: "0x1", gasPrice: "0x1", input: "0x", type: "0x0", v: "0x1b", r: "0x1", s: "0x1" });
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: "no" } }));
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

const baseLog = (address: string, tx: string, topics: readonly unknown[], data: string, logIndex = 0) => ({
  address, topics, data, blockNumber: "0x5a", transactionHash: tx, transactionIndex: "0x0", blockHash: "0x" + "cc".repeat(32), logIndex: toHex(logIndex), removed: false,
});

describe("assessLog", () => {
  it("treats a pramaan.record change that skipped the timelock as critical", () => {
    const direct = assessLog("resolver", "TextUpdated", { key: "pramaan.record", value: "x" }, { label: "r", txTo: RESOLVER as `0x${string}`, timelocks: [TIMELOCK as `0x${string}`] });
    expect(direct.assessment).toBe("critical");
    expect(direct.alert?.kind).toBe("record-bypassed-timelock");
    const viaLock = assessLog("resolver", "TextUpdated", { key: "pramaan.record", value: "x" }, { label: "r", txTo: TIMELOCK as `0x${string}`, timelocks: [TIMELOCK as `0x${string}`] });
    expect(viaLock.assessment).toBe("info");
    expect(viaLock.alert).toBeUndefined();
  });

  it("flags queued releases as warnings with an ETA and proxy upgrades as critical", () => {
    const q = assessLog("timelock", "Queued", { eta: 1_700_000_000n }, { label: "t", txTo: null, timelocks: [] });
    expect(q.assessment).toBe("warning");
    expect(q.alert?.eta?.getTime()).toBe(1_700_000_000_000);
    expect(assessLog("proxy", "Upgraded", { implementation: IMPL }, { label: "p", txTo: null, timelocks: [] }).assessment).toBe("critical");
  });
});

describe("monitor routes and poller", () => {
  it("creates monitors, stores events once, raises alerts once and masks the RPC URL", async () => {
    const db = await openDb({ memory: true });
    const cfg = loadConfig({ DATA_DIR: ".pramaan/test-monitors", RATE_LIMIT_MAX: "10000", ALLOW_PRIVATE_NETWORK: "1" });
    const queued = baseLog(TIMELOCK, TX1, encodeEventTopics({ abi: timelockAbi, eventName: "Queued", args: { id: 1n, proposer: "0x5555555555555555555555555555555555555555" } }), encodeAbiParameters([{ type: "string" }, { type: "uint64" }], ["pramaan:v1:v1:" + "ab".repeat(32), 1_800_000_000n]));
    const upgraded = baseLog(PROXY, TX2, encodeEventTopics({ abi: proxyAbi, eventName: "Upgraded", args: { implementation: IMPL } }), "0x");
    const bypass = baseLog(RESOLVER, "0x" + "c3".repeat(32), encodeEventTopics({ abi: resolverAbi, eventName: "TextUpdated", args: { recordId: 7n, keyHash: "pramaan.record" } }), encodeAbiParameters([{ type: "string" }, { type: "string" }], ["pramaan.record", "pramaan:v1:evil:" + "00".repeat(32)]), 1);
    const rpc = fakeRpc(
      { [TIMELOCK]: [queued], [PROXY]: [upgraded], [RESOLVER]: [bypass] },
      { ["0x" + "c3".repeat(32)]: "0x6666666666666666666666666666666666666666" },
    );
    const app = await createApp({ db, cfg, skipBootstrap: true, deps: { fetch: rpc.fetchFn } });
    try {
      const userId = (await db.one<{ id: string }>("INSERT INTO users (display_name, is_admin) VALUES ('admin', true) RETURNING id"))!.id;
      const { token } = await createApiToken(db, userId, "test", null);
      const headers = { authorization: `Bearer ${token}` };
      const project = (await app.inject({ method: "POST", url: "/v1/projects", headers, payload: { name: "Monitored" } })).json();

      const body = (kind: string, address: string, label: string) => ({ kind, chainId: 11155111, address, label, rpcUrl: "http://rpc.test.invalid/secret-key", fromBlock: 1 });
      const bad = await app.inject({ method: "POST", url: `/v1/projects/${project.id}/monitors`, headers, payload: { ...body("nope", TIMELOCK, "x") } });
      expect(bad.statusCode).toBe(400);

      for (const [kind, address, label] of [["timelock", TIMELOCK, "Release timelock"], ["proxy", PROXY, "Vault proxy"], ["resolver", RESOLVER, "App resolver"]] as const) {
        const res = await app.inject({ method: "POST", url: `/v1/projects/${project.id}/monitors`, headers, payload: body(kind, address, label) });
        expect(res.statusCode, res.body).toBe(201);
        expect(res.json().rpcUrl).toBe("http://rpc.test.invalid"); // path (may hold an API key) is never returned
        expect(res.json().status).toBe("active");
      }
      const dup = await app.inject({ method: "POST", url: `/v1/projects/${project.id}/monitors`, headers, payload: body("timelock", TIMELOCK, "again") });
      expect(dup.statusCode).toBe(409);

      const events = (await app.inject({ method: "GET", url: `/v1/projects/${project.id}/events`, headers })).json() as { eventName: string; assessment: string }[];
      expect(events.map((e) => e.eventName).sort()).toEqual(["Queued", "TextUpdated", "Upgraded"]);
      const alerts = (await app.inject({ method: "GET", url: `/v1/projects/${project.id}/alerts`, headers })).json() as { kind: string; severity: string; source: string }[];
      expect(alerts.map((a) => a.kind).sort()).toEqual(["proxy-upgraded", "record-bypassed-timelock", "release-queued"]);
      expect(alerts.every((a) => a.source === "monitor")).toBe(true);

      // Polling again (even re-scanning the same range) cannot create a second event or alert.
      await db.query("UPDATE monitors SET last_block = 0");
      expect(await pollAllMonitors({ cfg, db, deps: resolveDeps({ fetch: rpc.fetchFn }), log: app.log })).toBe(0);
      expect(((await app.inject({ method: "GET", url: `/v1/projects/${project.id}/events`, headers })).json() as unknown[]).length).toBe(3);
      expect(((await app.inject({ method: "GET", url: `/v1/projects/${project.id}/alerts`, headers })).json() as unknown[]).length).toBe(3);

      const list = (await app.inject({ method: "GET", url: `/v1/projects/${project.id}/monitors`, headers })).json() as { id: string; lastBlock: number }[];
      expect(list).toHaveLength(3);
      expect(list.every((m) => m.lastBlock === 100 - cfg.MONITOR_CONFIRMATIONS)).toBe(true);
      const del = await app.inject({ method: "DELETE", url: `/v1/projects/${project.id}/monitors/${list[0]!.id}`, headers });
      expect(del.statusCode).toBe(200);
    } finally {
      await app.close();
      await db.close();
    }
  });

  it("records a wrong-chain RPC on the monitor instead of trusting it", async () => {
    const db = await openDb({ memory: true });
    const cfg = loadConfig({ DATA_DIR: ".pramaan/test-monitors-chain", RATE_LIMIT_MAX: "10000", ALLOW_PRIVATE_NETWORK: "1" });
    const rpc = fakeRpc({}, {});
    const app = await createApp({ db, cfg, skipBootstrap: true, deps: { fetch: rpc.fetchFn } });
    try {
      const userId = (await db.one<{ id: string }>("INSERT INTO users (display_name, is_admin) VALUES ('admin', true) RETURNING id"))!.id;
      const { token } = await createApiToken(db, userId, "test", null);
      const headers = { authorization: `Bearer ${token}` };
      const project = (await app.inject({ method: "POST", url: "/v1/projects", headers, payload: { name: "Wrong chain" } })).json();
      const res = await app.inject({ method: "POST", url: `/v1/projects/${project.id}/monitors`, headers, payload: { kind: "proxy", chainId: 1, address: PROXY, label: "p", rpcUrl: "http://rpc.test.invalid" } });
      expect(res.statusCode).toBe(201);
      expect(res.json().status).toBe("error");
      expect(res.json().lastError).toMatch(/chain 11155111/);
    } finally {
      await app.close();
      await db.close();
    }
  });
});

import { createPublicClient, getAddress, http, isAddressEqual, parseAbi, type Address, type Log, type PublicClient } from "viem";
import type { Ctx } from "./context.js";
import { raiseAlert, type AlertSeverity } from "./alerts.js";

export const MONITOR_KINDS = ["timelock", "resolver", "registry", "proxy", "upgrade-timelock"] as const;
export type MonitorKind = (typeof MONITOR_KINDS)[number];
type Assessment = "critical" | "warning" | "info" | "ok";

/** The events each kind of monitored contract is watched for. Signatures match contracts/src and packages/release/src/abis.ts. */
const KIND_ABI = {
  timelock: parseAbi([
    "event Queued(uint256 indexed id, string value, uint64 eta, address indexed proposer)",
    "event Executed(uint256 indexed id, string value, address indexed executor)",
    "event Cancelled(uint256 indexed id, address indexed guardian)",
    "event ProposerChanged(address indexed previousProposer, address indexed newProposer)",
  ]),
  resolver: parseAbi(["event TextUpdated(uint256 indexed recordId, string indexed keyHash, string key, string value)"]),
  registry: parseAbi([
    "event ResolverUpdated(uint256 indexed tokenId, address indexed resolver, address indexed sender)",
    "event SubregistryUpdated(uint256 indexed tokenId, address indexed subregistry, address indexed sender)",
  ]),
  proxy: parseAbi(["event Upgraded(address indexed implementation)"]),
  "upgrade-timelock": parseAbi([
    "event CallScheduled(bytes32 indexed id, uint256 indexed index, address target, uint256 value, bytes data, bytes32 predecessor, uint256 delay)",
    "event CallExecuted(bytes32 indexed id, uint256 indexed index, address target, uint256 value, bytes data)",
    "event Cancelled(bytes32 indexed id)",
  ]),
} as const;

export interface MonitorRow {
  id: string;
  project_id: string;
  kind: MonitorKind;
  chain_id: number;
  address: string;
  rpc_url: string;
  label: string;
  config: Record<string, unknown> | string;
  last_block: number | string | null;
}

export interface Assessed {
  eventName: string;
  assessment: Assessment;
  detail: string;
  data: Record<string, unknown>;
  alert?: { severity: AlertSeverity; kind: string; title: string; eta?: Date | null };
}

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

/**
 * Turns one decoded log into an assessment. `timelocks` are the addresses the project says are its release timelock;
 * a `pramaan.record` change that did not come through one of them bypassed the delay and is critical.
 */
export function assessLog(kind: MonitorKind, name: string, args: Record<string, unknown>, ctxInfo: { label: string; txTo: Address | null; timelocks: Address[] }): Assessed {
  const data = JSON.parse(json(args)) as Record<string, unknown>;
  const where = ctxInfo.label;
  if (kind === "timelock") {
    if (name === "Queued") {
      const eta = new Date(Number(args["eta"]) * 1000);
      return { eventName: name, assessment: "warning", data, detail: `A new release pointer was queued in ${where}; it can be executed after ${eta.toISOString()} and can be cancelled until then.`, alert: { severity: "warning", kind: "release-queued", title: `Release queued in ${where}`, eta } };
    }
    if (name === "Cancelled") return { eventName: name, assessment: "info", data, detail: `A queued release in ${where} was cancelled.` };
    if (name === "Executed") return { eventName: name, assessment: "info", data, detail: `A queued release in ${where} was executed and is now the active pointer.` };
    return { eventName: name, assessment: "warning", data, detail: `The proposer of ${where} changed.`, alert: { severity: "warning", kind: "proposer-changed", title: `Proposer changed in ${where}` } };
  }
  if (kind === "resolver") {
    const key = String(args["key"] ?? "");
    if (key === "pramaan.record") {
      const viaTimelock = ctxInfo.txTo !== null && ctxInfo.timelocks.some((t) => isAddressEqual(t, ctxInfo.txTo!));
      return viaTimelock
        ? { eventName: name, assessment: "info", data, detail: `pramaan.record changed through the timelock (${where}).` }
        : { eventName: name, assessment: "critical", data, detail: `pramaan.record changed in ${where} WITHOUT going through the timelock.`, alert: { severity: "critical", kind: "record-bypassed-timelock", title: `Release record changed outside the timelock (${where})` } };
    }
    if (key === "pramaan.revoked") return { eventName: name, assessment: "warning", data, detail: `The revocation list changed in ${where}.`, alert: { severity: "warning", kind: "revocation-changed", title: `Revocation list changed (${where})` } };
    if (key.startsWith("pramaan.")) return { eventName: name, assessment: "warning", data, detail: `${key} changed in ${where}.`, alert: { severity: "warning", kind: "record-key-changed", title: `${key} changed (${where})` } };
    return { eventName: name, assessment: "info", data, detail: `Unrelated text record "${key.slice(0, 60)}" changed.` };
  }
  if (kind === "registry") {
    return { eventName: name, assessment: "critical", data, detail: `${name === "ResolverUpdated" ? "The resolver" : "The subregistry"} of a name in ${where} was replaced.`, alert: { severity: "critical", kind: "registry-changed", title: `${name} in ${where}` } };
  }
  if (kind === "proxy") {
    return { eventName: name, assessment: "critical", data, detail: `The implementation behind ${where} was upgraded to ${String(args["implementation"])}. Check it against the audited release.`, alert: { severity: "critical", kind: "proxy-upgraded", title: `Proxy upgraded (${where})` } };
  }
  // upgrade-timelock
  if (name === "CallScheduled") {
    const eta = new Date(Date.now() + Number(args["delay"]) * 1000);
    return { eventName: name, assessment: "warning", data, detail: `An operation was scheduled on ${where} (delay ${String(args["delay"])} s, target ${String(args["target"])}).`, alert: { severity: "warning", kind: "upgrade-scheduled", title: `Upgrade scheduled on ${where}`, eta } };
  }
  if (name === "CallExecuted") return { eventName: name, assessment: "critical", data, detail: `A scheduled operation on ${where} was executed (target ${String(args["target"])}).`, alert: { severity: "critical", kind: "upgrade-executed", title: `Upgrade executed on ${where}` } };
  return { eventName: name, assessment: "info", data, detail: `A scheduled operation on ${where} was cancelled.` };
}

type LogWithArgs = Log & { eventName?: string; args?: Record<string, unknown> };

/** Polls one monitor once. Returns the number of NEW events stored. Errors are recorded on the row, never thrown. */
export async function pollMonitor(ctx: Ctx, m: MonitorRow, client?: PublicClient): Promise<number> {
  const { db, cfg, deps } = ctx;
  try {
    const rpc =
      client ??
      (createPublicClient({ transport: http(m.rpc_url, { fetchFn: deps.fetch, timeout: 10_000, retryCount: 1 }) }) as PublicClient);
    const chain = await rpc.getChainId();
    if (chain !== m.chain_id) throw new Error(`RPC reports chain ${chain}, monitor is for chain ${m.chain_id}`);
    const head = Number(await rpc.getBlockNumber());
    const safeHead = head - cfg.MONITOR_CONFIRMATIONS;
    let from = m.last_block === null ? Math.max(0, safeHead - cfg.MONITOR_LOOKBACK_BLOCKS) : Number(m.last_block) + 1;
    if (safeHead < from) {
      await db.query("UPDATE monitors SET last_checked_at = $2, last_error = NULL, status = 'active' WHERE id = $1", [m.id, deps.now()]);
      return 0;
    }
    const address = getAddress(m.address);
    const timelocks = (
      await db.query<{ address: string }>("SELECT address FROM monitors WHERE project_id = $1 AND kind = 'timelock'", [m.project_id])
    ).map((r) => getAddress(r.address));
    const projectTimelock = await db.one<{ timelock_address: string | null }>("SELECT timelock_address FROM projects WHERE id = $1", [m.project_id]);
    if (projectTimelock?.timelock_address) timelocks.push(getAddress(projectTimelock.timelock_address));
    let stored = 0;
    let to = from - 1;
    for (let chunk = 0; chunk < cfg.MONITOR_MAX_CHUNKS && to < safeHead; chunk++) {
      const start = to + 1;
      to = Math.min(safeHead, start + cfg.MONITOR_MAX_RANGE - 1);
      const logs = (await rpc.getLogs({ address, events: KIND_ABI[m.kind] as never, fromBlock: BigInt(start), toBlock: BigInt(to), strict: true })) as unknown as LogWithArgs[];
      for (const log of logs) {
        if (!log.eventName || log.transactionHash === null || log.logIndex === null || log.blockNumber === null) continue;
        const tx = m.kind === "resolver" ? await rpc.getTransaction({ hash: log.transactionHash }).catch(() => null) : null;
        const block = await rpc.getBlock({ blockNumber: log.blockNumber }).catch(() => null);
        const a = assessLog(m.kind, log.eventName, (log.args ?? {}) as Record<string, unknown>, { label: m.label, txTo: tx?.to ?? null, timelocks });
        const row = await db.one<{ id: string }>(
          `INSERT INTO monitor_events (monitor_id, project_id, chain_id, block_number, block_time, tx_hash, log_index, address, event_name, data, assessment, detail)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (monitor_id, chain_id, tx_hash, log_index) DO NOTHING RETURNING id`,
          [m.id, m.project_id, m.chain_id, log.blockNumber.toString(), block ? new Date(Number(block.timestamp) * 1000) : null, log.transactionHash, log.logIndex, address, a.eventName, json(a.data), a.assessment, a.detail],
        );
        if (!row) continue; // already seen: a re-poll never creates a second event or alert
        stored++;
        if (a.alert) {
          await raiseAlert(ctx, {
            projectId: m.project_id,
            monitorEventId: row.id,
            source: "monitor",
            severity: a.alert.severity,
            kind: a.alert.kind,
            title: a.alert.title,
            body: `${a.detail}\nTransaction ${log.transactionHash} (block ${log.blockNumber}).`,
            data: { txHash: log.transactionHash, block: log.blockNumber.toString(), address, event: a.eventName },
            eta: a.alert.eta ?? null,
            key: `monitor:${m.id}:${log.transactionHash}:${log.logIndex}`,
          });
        }
      }
    }
    await db.query("UPDATE monitors SET last_block = $2, last_checked_at = $3, last_error = NULL, status = 'active' WHERE id = $1", [m.id, to, deps.now()]);
    return stored;
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).split("\n")[0]!.slice(0, 300);
    await db.query("UPDATE monitors SET last_checked_at = $2, last_error = $3, status = 'error' WHERE id = $1", [m.id, deps.now(), message]);
    ctx.log.warn({ monitor: m.id, error: message }, "monitor poll failed");
    return 0;
  }
}

/** One pass over every active (or recovering) monitor. */
export async function pollAllMonitors(ctx: Ctx): Promise<number> {
  const rows = await ctx.db.query<MonitorRow>("SELECT id, project_id, kind, chain_id, address, rpc_url, label, config, last_block FROM monitors WHERE status IN ('active','error')");
  let total = 0;
  for (const m of rows) total += await pollMonitor(ctx, m);
  return total;
}

/** Starts the interval poller. Passes never overlap; stop() waits for the pass in flight. */
export function startMonitorPoller(ctx: Ctx): { stop: () => Promise<void> } {
  let stopped = false;
  let running: Promise<unknown> = Promise.resolve();
  const timer = setInterval(() => {
    running = running.then(() => (stopped ? undefined : pollAllMonitors(ctx).catch((e) => ctx.log.warn({ error: String(e) }, "monitor pass failed"))));
  }, ctx.cfg.MONITOR_INTERVAL_MS);
  timer.unref();
  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}

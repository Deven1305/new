import { decodeFunctionResult, encodeFunctionData, getAddress } from "viem";
import {
  CALL_SCHEDULED_TOPIC,
  controllerAbi,
  decodeCallScheduled,
  decodeEnsV1TextResult,
  decodeResolveTextResult,
  decodeUpgraded,
  encodeEnsV1Text,
  encodeResolveText,
  OP_STATES,
  pendingEta,
  pramaanTimelockAbi,
  toScheduledUpgrade,
  UPGRADED_TOPIC,
  type RawLog,
} from "./abi";
import type { Address, AppConfig, Config, Hex, LiveImplementation, ManifestObservation, Observation, ScheduledUpgrade, TimelockOp } from "./types";
import { parsePointer } from "./pointer";

/**
 * The only chain surface the monitor needs. The SDK adapter (sdk-chain.ts) implements it with EVMClient; unit tests and
 * the fork harness implement it with fakes. Every method is one CRE EVM read and throws on failure.
 */
export interface ChainPort {
  /** Head block (number + timestamp). */
  header(): { number: bigint; timestamp: bigint };
  call(to: Address, data: Hex): Hex;
  /** Logs of `addresses` whose topic0 is in `topic0`, in [from, to] (inclusive). */
  logs(addresses: Address[], topic0: Hex[], from: bigint, to: bigint): RawLog[];
}

export class BudgetExceeded extends Error {}

/** Counts reads against the CRE quota (PerWorkflow.ChainRead.CallLimit) and refuses to exceed it. */
export class BudgetedChain implements ChainPort {
  used = 0;
  constructor(
    private readonly inner: ChainPort,
    readonly max: number,
  ) {}
  get remaining(): number {
    return this.max - this.used;
  }
  private take(): void {
    if (this.used >= this.max) throw new BudgetExceeded(`EVM read budget of ${this.max} calls exhausted`);
    this.used++;
  }
  header() {
    this.take();
    return this.inner.header();
  }
  call(to: Address, data: Hex) {
    this.take();
    return this.inner.call(to, data);
  }
  logs(addresses: Address[], topic0: Hex[], from: bigint, to: bigint) {
    this.take();
    return this.inner.logs(addresses, topic0, from, to);
  }
}

export type ManifestFetcher = (url: string) => ManifestObservation;

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split("\n")[0]?.slice(0, 160) ?? "error";

/**
 * Reads everything `decide` needs for ONE app. Never throws: every failed read becomes a stable `gaps` string, which
 * `decide` turns into UNKNOWN (never OK).
 *
 * EVM read budget per app (default 15): head 1 + text 2 + timelock (count, lastExecuted, <=3 ops) 5 + getTimestamp <=3
 * + log windows (what is left, <= maxLogWindows). Apps without proxies/upgrade-timelock skip the log scan entirely.
 */
export function collectObservation(config: Config, app: AppConfig, port: ChainPort, fetchManifest: ManifestFetcher): Observation {
  const chain = new BudgetedChain(port, config.limits.evmCalls);
  const gaps: string[] = [];
  const text = (key: string): string | null => {
    try {
      const callData =
        app.resolverMode === "ensv1"
          ? encodeEnsV1Text(app.ensName, key)
          : encodeResolveText(app.ensName, key);
      const out = chain.call(app.resolver as Address, callData);
      return app.resolverMode === "ensv1"
        ? decodeEnsV1TextResult(out)
        : decodeResolveTextResult(out);
    } catch (e) {
      gaps.push(`${key} could not be read from the resolver`);
      void e;
      return null;
    }
  };

  // -- head block (chain time is the only clock used for ETAs) --
  let headBlock = 0n;
  let now = 0;
  try {
    const h = chain.header();
    headBlock = h.number;
    now = Number(h.timestamp);
  } catch (e) {
    gaps.push("chain head could not be read");
    void e;
  }

  const record = text("pramaan.record");
  const revokedRaw = text("pramaan.revoked");

  // -- PramaanTimelock: newest queued operations that can still execute --
  let timelock: Observation["timelock"] = null;
  if (app.timelock) {
    try {
      const count = Number(readUint(chain, app.timelock as Address, pramaanTimelockAbi, "operationCount"));
      const lastExecutedId = Number(readUint(chain, app.timelock as Address, pramaanTimelockAbi, "lastExecutedId"));
      const ops: TimelockOp[] = [];
      for (let id = count; id > lastExecutedId && ops.length < config.limits.maxPendingOps; id--) {
        const data = encodeFunctionData({ abi: pramaanTimelockAbi, functionName: "getOperation", args: [BigInt(id)] });
        const [value, eta, state] = decodeFunctionResult({ abi: pramaanTimelockAbi, functionName: "getOperation", data: chain.call(app.timelock as Address, data) });
        ops.push({ id: String(id), value, eta: Number(eta), state: OP_STATES[state] ?? "None" });
      }
      // Queued operations above the inspected window cannot be seen: say so instead of reporting OK.
      if (count - lastExecutedId > config.limits.maxPendingOps) gaps.push("more queued release pointers than the inspection window");
      timelock = { operationCount: count, lastExecutedId, ops };
    } catch (e) {
      gaps.push("PramaanTimelock operations could not be read");
      void e;
    }
  }

  // -- logs: ERC-1967 Upgraded on the proxies, CallScheduled on the upgrade timelock --
  const proxies = app.proxies.map((p) => ({ label: p.label, address: getAddress(p.address) as Address }));
  const implementations: LiveImplementation[] = proxies.map((p) => ({ proxy: p.address, label: p.label, current: null, block: null }));
  const scheduled: { call: NonNullable<ReturnType<typeof decodeCallScheduled>>; block: number }[] = [];
  let logsComplete = true;
  const needLogs = proxies.length > 0 || app.upgradeTimelock !== null;
  if (needLogs && now > 0) {
    const addresses = [...proxies.map((p) => p.address), ...(app.upgradeTimelock ? [getAddress(app.upgradeTimelock) as Address] : [])];
    const reserveForTimestamps = app.upgradeTimelock ? config.limits.maxPendingOps : 0;
    const allowedWindows = Math.max(0, Math.min(config.limits.maxLogWindows, chain.remaining - reserveForTimestamps));
    const from = app.logsFromBlock === null ? null : BigInt(app.logsFromBlock);
    let to = headBlock;
    let windows = 0;
    const seen: RawLog[] = [];
    try {
      while (windows < allowedWindows && (from === null || to >= from)) {
        const lo = to - BigInt(config.limits.windowBlocks) + 1n;
        const start = from !== null && lo < from ? from : lo < 0n ? 0n : lo;
        seen.push(...chain.logs(addresses, [UPGRADED_TOPIC, CALL_SCHEDULED_TOPIC], start, to));
        windows++;
        to = start - 1n;
        if (start === 0n) break;
      }
      // Complete only if the scan walked all the way down to the first block that can matter.
      logsComplete = from !== null && to < from;
    } catch (e) {
      logsComplete = false;
      gaps.push("event logs could not be read");
      void e;
    }
    if (!logsComplete && !gaps.includes("event logs could not be read")) {
      gaps.push(
        from === null
          ? "no logsFromBlock configured: event history cannot be proven complete"
          : "event history is longer than the CRE log-query budget (100 blocks per read)",
      );
    }
    for (const log of seen) {
      const up = decodeUpgraded(log);
      const impl = implementations.find((i) => i.proxy.toLowerCase() === log.address.toLowerCase());
      if (up && impl && (impl.block === null || log.blockNumber > impl.block)) {
        impl.current = up;
        impl.block = log.blockNumber;
      }
      const cs = decodeCallScheduled(log);
      if (cs && app.upgradeTimelock && log.address.toLowerCase() === app.upgradeTimelock.toLowerCase()) scheduled.push({ call: cs, block: log.blockNumber });
    }
  } else if (needLogs) {
    logsComplete = false;
  }

  // -- which scheduled operations are still pending (getTimestamp > 1) --
  const scheduledUpgrades: ScheduledUpgrade[] = [];
  if (app.upgradeTimelock) {
    const newest = scheduled.sort((a, b) => b.block - a.block).slice(0, config.limits.maxPendingOps);
    if (scheduled.length > newest.length) gaps.push("more scheduled upgrades than the inspection window");
    for (const s of newest) {
      try {
        const data = encodeFunctionData({ abi: controllerAbi, functionName: "getTimestamp", args: [s.call.id] });
        const ts = decodeFunctionResult({ abi: controllerAbi, functionName: "getTimestamp", data: chain.call(app.upgradeTimelock as Address, data) });
        const eta = pendingEta(ts);
        if (eta !== null) scheduledUpgrades.push(toScheduledUpgrade(s.call, eta, s.block));
      } catch (e) {
        gaps.push("scheduled upgrade state could not be read");
        void e;
      }
    }
  }

  // -- the manifest the ACTIVE pointer commits to --
  let manifest: ManifestObservation | null = null;
  const pointer = parsePointer(record);
  if (pointer.ok) {
    try {
      manifest = fetchManifest(app.manifestUrlTemplate.replace("{sha256}", pointer.sha256));
    } catch (e) {
      manifest = { status: 0, sha256: "", size: 0, facts: null, error: errMsg(e) };
    }
  }

  return {
    app: app.app,
    ensName: app.ensName,
    chainId: config.chainId,
    now,
    headBlock: Number(headBlock),
    record,
    revokedRaw,
    timelock,
    scheduledUpgrades,
    implementations,
    logsComplete,
    manifest,
    gaps,
  };
}

function readUint(chain: ChainPort, to: Address, abi: typeof pramaanTimelockAbi, fn: "operationCount" | "lastExecutedId"): bigint {
  return decodeFunctionResult({ abi, functionName: fn, data: chain.call(to, encodeFunctionData({ abi, functionName: fn })) });
}

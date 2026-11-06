import { AnonRpcWorker } from "@anon-rpc/browser-extension-harness";
import type { ChainConfig } from "@pramaan/verifier-core";
import type { Settings } from "../shared/settings.js";
import { describeRpc, type ReadPath, type ReadRecord } from "../shared/rpc-log.js";

/**
 * Verification reads (chain id, ENS via the Universal Resolver, eth_getCode, eth_getStorageAt, eth_call) go through
 * Anon-RPC by default on chains where it is enabled (Sepolia: the Nox specifier
 * 0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A lives there, per ethereum/anon-rpc adopters.json5). The hash-pinned Nox
 * client runs in the harness's sandboxed iframe inside the offscreen document. If Anon-RPC is unavailable, reads fall
 * back to direct RPC (unless the user disabled fallback) and every read is recorded with the path it took, for the
 * Privacy panel. A local chain cannot be reached through a mixnet and is labelled "direct (local chain)".
 * Nothing here talks to a Pramaan server.
 */
export type ReadSink = (r: ReadRecord) => void;

export interface AnonStatus {
  state: "off" | "booting" | "ready" | "failed";
  detail: string;
}

interface AnonState {
  worker: AnonRpcWorker;
  ready: Promise<boolean>;
  error: string | null;
  ok: boolean;
}
let anon: AnonState | null = null;
let anonFailedAt = 0;
let lastAnonError: string | null = null;
const RETRY_MS = 5 * 60_000;
const ANON_READ_TIMEOUT_MS = 25_000;

export function anonStatus(): AnonStatus {
  if (anon?.ok) return { state: "ready", detail: "Nox mixnet worker booted (hash-pinned bundle verified by the harness)" };
  if (anon) return { state: "booting", detail: "starting the Nox worker" };
  if (lastAnonError) return { state: "failed", detail: lastAnonError };
  return { state: "off", detail: "not started" };
}

const isLocalUrl = (url: string) => {
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  } catch {
    return false;
  }
};

async function directRpc(url: string, method: string, params: unknown): Promise<unknown> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? [] }) });
  const body = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

function bootAnon(settings: Settings): AnonState | null {
  if (anon) return anon;
  if (Date.now() - anonFailedAt < RETRY_MS) return null;
  // The bootstrap read of the specifier is NOT anonymous: this provider sees our IP and that we read the specifier.
  const bootstrap = settings.chains["11155111"]?.rpcUrls[0] ?? "https://sepolia.gateway.tenderly.co";
  let worker: AnonRpcWorker;
  try {
    worker = new AnonRpcWorker({
      address: settings.anonRpcSpecifier,
      preExisting: { rpcProvider: { request: ({ method, params }: { method: string; params?: unknown }) => directRpc(bootstrap, method, params) } },
    });
  } catch (err) {
    lastAnonError = `Anon-RPC could not start: ${(err as Error).message}`;
    anonFailedAt = Date.now();
    return null;
  }
  const state: AnonState = { worker, ready: Promise.resolve(false), error: null, ok: false };
  state.ready = Promise.race([worker.ready.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), settings.anonRpcBootTimeoutMs))]).then(
    (ok) => {
      if (!ok) state.error = `Anon-RPC did not boot within ${Math.round(settings.anonRpcBootTimeoutMs / 1000)} s`;
      return ok;
    },
    (err: Error) => {
      state.error = `Anon-RPC failed: ${err.message}`;
      return false;
    },
  );
  void state.ready.then((ok) => {
    state.ok = ok;
    if (!ok) {
      lastAnonError = state.error;
      anonFailedAt = Date.now();
      if (anon === state) anon = null;
      try {
        worker.close();
      } catch {
        // already gone
      }
    } else lastAnonError = null;
  });
  anon = state;
  return state;
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_r, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000} s`)), ms))]);
}

/** A fetch that records every JSON-RPC read with the path it actually took. */
export function recordingFetch(opts: { path: ReadPath; anonFetch?: typeof fetch; allowFallback: boolean; fallbackNote?: string | null; sink?: ReadSink }): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { method, what } = describeRpc(init?.body);
    const endpoint = (() => {
      try {
        return new URL(url).host;
      } catch {
        return url;
      }
    })();
    const started = Date.now();
    const log = (path: ReadPath, ok: boolean, note: string | null) =>
      opts.sink?.({ method, what, endpoint, path, note, ok, ms: Date.now() - started, at: new Date(started).toISOString() });
    if (opts.anonFetch) {
      try {
        const res = await withTimeout(opts.anonFetch(url, init), ANON_READ_TIMEOUT_MS, "Anon-RPC read");
        log("anon-rpc", res.ok, null);
        return res;
      } catch (err) {
        if (!opts.allowFallback) {
          log("anon-rpc", false, `failed: ${(err as Error).message}; fallback to direct RPC is disabled`);
          throw err;
        }
        try {
          const res = await fetch(url, init);
          log("direct-fallback", res.ok, `Anon-RPC read failed: ${(err as Error).message}`);
          return res;
        } catch (e2) {
          log("direct-fallback", false, `Anon-RPC and direct both failed: ${(e2 as Error).message}`);
          throw e2;
        }
      }
    }
    if (opts.path === "direct-fallback" && !opts.allowFallback) {
      log("direct-fallback", false, `${opts.fallbackNote ?? "Anon-RPC unavailable"}; fallback to direct RPC is disabled`);
      throw new TypeError("Anon-RPC unavailable and direct fallback disabled");
    }
    try {
      const res = await fetch(url, init);
      log(opts.path, res.ok, opts.fallbackNote ?? null);
      return res;
    } catch (err) {
      log(opts.path, false, (err as Error).message);
      throw err;
    }
  }) as typeof fetch;
}

/** An RPC that answers for another chain could serve that chain's state: such endpoints are dropped. */
async function endpointChainId(url: string, fetchFn: typeof fetch): Promise<number | null> {
  try {
    const res = await fetchFn(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
    const body = (await res.json()) as { result?: string };
    return typeof body.result === "string" ? Number(BigInt(body.result)) : null;
  } catch {
    return null;
  }
}

export async function chainConfig(chainId: number, settings: Settings, sink?: ReadSink): Promise<ChainConfig | null> {
  const s = settings.chains[String(chainId)];
  if (!s || s.rpcUrls.length === 0) return null;
  const local = !!s.local || s.rpcUrls.every(isLocalUrl);
  let fetchFn: typeof fetch;
  let transportLabel: string;
  if (local) {
    fetchFn = recordingFetch({ path: "direct-local", allowFallback: true, sink });
    transportLabel = "direct (local chain)";
  } else if (s.anonRpc) {
    const a = bootAnon(settings);
    const ok = a ? await a.ready : false;
    if (ok && a) {
      fetchFn = recordingFetch({ path: "anon-rpc", anonFetch: ((i: RequestInfo | URL, init?: RequestInit) => a.worker.fetch(i as string, init)) as typeof fetch, allowFallback: settings.anonRpcFallback, sink });
      transportLabel = "Anon-RPC (Nox mixnet)";
    } else {
      const note = (a?.error ?? lastAnonError) || "Anon-RPC unavailable";
      fetchFn = recordingFetch({ path: "direct-fallback", allowFallback: settings.anonRpcFallback, fallbackNote: note, sink });
      transportLabel = settings.anonRpcFallback ? `direct (fallback: ${note})` : `none (${note}; fallback disabled)`;
    }
  } else {
    fetchFn = recordingFetch({ path: "direct", allowFallback: true, sink });
    transportLabel = "direct RPC";
  }
  const ids = await Promise.all(s.rpcUrls.map((u) => endpointChainId(u, fetchFn)));
  const rpcUrls = s.rpcUrls.filter((_u, i) => ids[i] === null || ids[i] === chainId);
  const wrong = s.rpcUrls.filter((_u, i) => ids[i] !== null && ids[i] !== chainId);
  if (wrong.length) transportLabel += `; ignored ${wrong.length} endpoint(s) serving another chain`;
  if (rpcUrls.length === 0) return null;
  return {
    chainId,
    name: s.label,
    rpcUrls,
    universalResolver: s.universalResolver,
    minAgreement: local ? 1 : Math.min(2, rpcUrls.length),
    transportLabel,
    timeoutMs: local ? 15_000 : 40_000,
    fetchFn,
  };
}

export async function allChains(settings: Settings, only?: number, sink?: ReadSink): Promise<Record<number, ChainConfig>> {
  const out: Record<number, ChainConfig> = {};
  for (const id of Object.keys(settings.chains)) {
    if (only !== undefined && Number(id) !== only) continue;
    const cfg = await chainConfig(Number(id), settings, sink);
    if (cfg) out[Number(id)] = cfg;
  }
  return out;
}

/** HTTP fetches made for verification (hint, manifest, signature, descriptors), recorded for the Privacy panel. */
export function recordingHttpFetch(sink?: ReadSink): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const started = Date.now();
    let host = url;
    try {
      host = new URL(url).host;
    } catch {
      // keep raw
    }
    const what = /pramaan\.json$/.test(url) ? "release hint" : /dsse|sigstore/.test(url) ? "release signature" : /\/ipfs\//.test(url) ? "manifest from IPFS gateway" : /manifest/.test(url) ? "release manifest" : "descriptor / file";
    try {
      const res = await fetch(url, init);
      sink?.({ method: "GET", what: `${what}: ${url.slice(0, 120)}`, endpoint: host, path: isLocalUrl(url) ? "direct-local" : "direct", note: null, ok: res.ok, ms: Date.now() - started, at: new Date(started).toISOString() });
      return res;
    } catch (err) {
      sink?.({ method: "GET", what: `${what}: ${url.slice(0, 120)}`, endpoint: host, path: isLocalUrl(url) ? "direct-local" : "direct", note: (err as Error).message, ok: false, ms: Date.now() - started, at: new Date(started).toISOString() });
      throw err;
    }
  }) as typeof fetch;
}

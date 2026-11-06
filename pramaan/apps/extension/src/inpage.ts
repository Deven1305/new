/**
 * Runs in the page's MAIN world at document_start, before any page script. It pauses wallet requests that move value
 * or sign something, asks the extension, and only forwards to the wallet on "continue". Everything else passes
 * straight through.
 *
 * LIMITATION (documented): this is advisory, not enforcement. A malicious page can keep its own reference to the
 * wallet provider or talk to the wallet some other way. The enforcement point for signing is the wallet itself.
 */
import type { ContentToInpage, InpageToContent } from "./shared/messages.js";

(() => {
  const GUARDED = new Set([
    "eth_sendTransaction",
    "eth_signTransaction",
    "eth_signTypedData_v4",
    "eth_signTypedData_v3",
    "eth_signTypedData",
    "personal_sign",
    "eth_sign",
    "wallet_sendCalls",
  ]);
  const ACCOUNT_METHODS = new Set(["eth_requestAccounts", "eth_accounts"]);
  // Capture built-ins before page code can replace them.
  const defineProperty = Object.defineProperty;
  const getDescriptor = Object.getOwnPropertyDescriptor;
  const addListener = window.addEventListener.bind(window);
  const stringify = JSON.stringify;
  const parse = JSON.parse;
  const randomValues = crypto.getRandomValues.bind(crypto);
  const PromiseCtor = Promise;
  const setTimer = setTimeout;

  type Provider = { request: (args: { method: string; params?: unknown }) => Promise<unknown>; [k: string]: unknown };
  let port: MessagePort | null = null;
  const queue: InpageToContent[] = [];
  const waiting = new Map<string, (d: ContentToInpage) => void>();

  addListener(
    "message",
    (event: MessageEvent) => {
      if (port || event.source !== window || (event.data as { __pramaan?: string })?.__pramaan !== "init" || !event.ports?.[0]) return;
      event.stopImmediatePropagation();
      port = event.ports[0];
      port.onmessage = (e: MessageEvent<ContentToInpage>) => {
        const msg = e.data;
        if (msg?.type !== "decision") return;
        const resolve = waiting.get(msg.id);
        if (resolve) {
          waiting.delete(msg.id);
          resolve(msg);
        }
      };
      for (const m of queue.splice(0)) port.postMessage(m);
    },
    true,
  );

  const post = (msg: InpageToContent) => (port ? port.postMessage(msg) : queue.push(msg));

  function newId(): string {
    const b = randomValues(new Uint8Array(12));
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  }

  function jsonSafe(value: unknown): unknown[] {
    try {
      const v = parse(stringify(value, (_k, x) => (typeof x === "bigint" ? `0x${x.toString(16)}` : x)));
      return Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
    } catch {
      return [];
    }
  }

  function rejection(reason: string): Error {
    const err = new Error(`Pramaan: ${reason}`) as Error & { code: number };
    err.code = 4001; // EIP-1193 "User Rejected Request"
    return err;
  }

  const originals = new WeakMap<object, Provider["request"]>();
  const wrapped = new WeakSet<object>();
  const guardedFns = new WeakSet<object>();
  const known = new Set<Provider>();
  const names = new WeakMap<object, string | null>();

  async function ask(method: string, params: unknown, provider: object, walletName: string | null): Promise<void> {
    let chainId: string | null = null;
    try {
      chainId = String(await originals.get(provider)!({ method: "eth_chainId" }));
    } catch {
      chainId = null;
    }
    const id = newId();
    const decision = await new PromiseCtor<ContentToInpage>((resolve) => {
      waiting.set(id, resolve);
      post({ type: "request", id, method, params: jsonSafe(params), chainId, walletName });
      // Fail closed if the extension side never answers.
      setTimer(() => {
        if (waiting.delete(id)) resolve({ type: "decision", id, decision: "reject", reason: port ? "no decision within 10 minutes" : "Pramaan is not ready on this page" });
      }, port ? 600_000 : 5_000);
    });
    if (decision.decision !== "continue") throw rejection(decision.reason || "request rejected");
  }

  function wrap(candidate: unknown, walletName: string | null): void {
    const provider = candidate as Provider | null;
    if (!provider || typeof provider !== "object" || typeof provider.request !== "function") return;
    // Already guarded, unless the wallet replaced `request` since: then the new function is wrapped too.
    if (guardedFns.has(provider.request)) return;
    known.add(provider);
    names.set(provider, walletName);
    const original = provider.request.bind(provider);
    originals.set(provider, original);
    const guarded = async function (args: { method: string; params?: unknown }) {
      const method = args?.method;
      if (typeof method === "string" && GUARDED.has(method)) await ask(method, args.params, provider, walletName);
      const result = await original(args);
      if (typeof method === "string" && ACCOUNT_METHODS.has(method) && Array.isArray(result)) {
        post({ type: "accounts", accounts: result.filter((a): a is string => typeof a === "string") });
      }
      return result;
    };
    guardedFns.add(guarded);
    try {
      defineProperty(provider, "request", { value: guarded, configurable: true, writable: true });
    } catch {
      try {
        (provider as { request: unknown }).request = guarded;
      } catch {
        // handled below
      }
    }
    if (provider.request !== guarded) {
      // Frozen or proxied provider: Pramaan cannot pause its requests. Reported in the popup, never hidden.
      post({ type: "unguarded", walletName: walletName ?? "wallet", reason: "the provider object is frozen or refuses changes" });
    }
    for (const legacy of ["send", "sendAsync"] as const) {
      const fn = provider[legacy];
      if (typeof fn !== "function") continue;
      const bound = (fn as (...a: unknown[]) => unknown).bind(provider);
      const replacement = function (payload: unknown, callback?: unknown) {
        const p = payload as { method?: string; params?: unknown } | string;
        const method = typeof p === "string" ? p : p?.method;
        if (typeof method !== "string" || !GUARDED.has(method)) return bound(payload, callback);
        const params = typeof p === "string" ? callback : p.params;
        const run = ask(method, params, provider, walletName).then(() => bound(payload, callback));
        if (legacy === "sendAsync" && typeof callback === "function") {
          run.catch((err: Error) => (callback as (e: Error, r?: unknown) => void)(err));
          return undefined;
        }
        return run;
      };
      try {
        defineProperty(provider, legacy, { value: replacement, configurable: true, writable: true });
      } catch {
        // ignore
      }
    }
    try {
      (provider.on as ((e: string, cb: (a: unknown) => void) => void) | undefined)?.call(provider, "accountsChanged", (accounts: unknown) => {
        if (Array.isArray(accounts)) post({ type: "accounts", accounts: accounts.filter((a): a is string => typeof a === "string") });
      });
    } catch {
      // ignore
    }
    wrapped.add(provider);
  }

  function wrapInjected(): void {
    const eth = (window as unknown as { ethereum?: Provider & { providers?: Provider[]; isMetaMask?: boolean } }).ethereum;
    if (!eth) return;
    wrap(eth, eth.isMetaMask ? "MetaMask" : "window.ethereum");
    for (const p of eth.providers ?? []) wrap(p, "window.ethereum.providers");
  }

  wrapInjected();
  // A wallet that assigns window.ethereum later is wrapped on assignment.
  try {
    const desc = getDescriptor(window, "ethereum");
    if (!desc || desc.configurable) {
      let current = (window as unknown as { ethereum?: unknown }).ethereum;
      defineProperty(window, "ethereum", {
        configurable: true,
        enumerable: true,
        get: () => current,
        set: (value: unknown) => {
          current = value;
          wrap(value, "window.ethereum");
        },
      });
    }
  } catch {
    // The page or a wallet locked the property; wrapping on events below still applies.
  }
  // A wallet that (re)defines window.ethereum with Object.defineProperty / Reflect.defineProperty replaces our
  // accessor: the defined value (or the getter's result) is wrapped as it is installed.
  const wrapDescriptor = (desc: PropertyDescriptor | undefined): PropertyDescriptor | undefined => {
    if (!desc) return desc;
    if ("value" in desc) wrap(desc.value, "window.ethereum");
    if (typeof desc.get === "function") {
      const get = desc.get;
      return { ...desc, get(this: unknown) {
        const v = get.call(this);
        wrap(v, "window.ethereum");
        return v;
      } };
    }
    return desc;
  };
  try {
    const realDefine = Object.defineProperty;
    const patched = function <T>(o: T, p: PropertyKey, d: PropertyDescriptor & ThisType<unknown>): T {
      return realDefine(o, p, o === (window as unknown) && p === "ethereum" ? (wrapDescriptor(d) ?? d) : d);
    };
    defineProperty(Object, "defineProperty", { value: patched, configurable: true, writable: true });
    const realReflect = Reflect.defineProperty;
    defineProperty(Reflect, "defineProperty", {
      value: (o: object, p: PropertyKey, d: PropertyDescriptor) => realReflect(o, p, o === (window as unknown) && p === "ethereum" ? (wrapDescriptor(d) ?? d) : d),
      configurable: true,
      writable: true,
    });
  } catch {
    // locked down by the page; the periodic re-check below still applies
  }
  // Belt and braces: re-check window.ethereum and every provider seen so far (wallets that swap `request` later).
  let ticks = 0;
  const recheck = () => {
    wrapInjected();
    for (const p of known) if (!guardedFns.has(p.request)) wrap(p, names.get(p) ?? "wallet");
    ticks += 1;
    setTimer(recheck, ticks < 40 ? 250 : 3_000);
  };
  setTimer(recheck, 250);
  addListener("ethereum#initialized", wrapInjected);
  addListener("DOMContentLoaded", wrapInjected);
  addListener("load", wrapInjected);
  // EIP-6963 multi-wallet discovery: wrap each announced provider before the page receives it.
  addListener(
    "eip6963:announceProvider",
    (event: Event) => {
      const detail = (event as CustomEvent<{ info?: { name?: string }; provider?: unknown }>).detail;
      if (detail?.provider) wrap(detail.provider, detail.info?.name ?? "EIP-6963 wallet");
    },
    true,
  );
})();

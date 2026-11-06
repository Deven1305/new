import type { VerifiedDescriptor } from "@pramaan/decoder";
import type { ObservedResource, PinStore, ReleaseVerification, SiteCheck } from "@pramaan/verifier-core";
import type { LeakRecord, PendingView } from "../shared/messages.js";
import type { ReadRecord } from "../shared/rpc-log.js";

/**
 * Per-tab state. It survives the MV3 service worker being stopped: it is mirrored to storage.session and re-hydrated
 * when the worker starts. Everything that must not bleed between sites is keyed by exact origin (scheme+host+port):
 * TOFU pins, the release cache, blocked hosts and strict mode — so http://localhost:5180, :5182 and :5184 stay apart.
 */
export interface TabState {
  tabId: number;
  origin: string | null;
  url: string | null;
  status: "idle" | "checking" | "done";
  release: ReleaseVerification | null;
  site: SiteCheck | null;
  resources: Record<string, ObservedResource>;
  descriptors: VerifiedDescriptor[];
  leaks: Record<string, LeakRecord>;
  accounts: string[];
  blocked: string[];
  strict: boolean;
  transport: string;
  reads: ReadRecord[];
  unguarded: { walletName: string; reason: string }[];
  updatedAt: string;
}

const tabs = new Map<number, TabState>();
const inflight = new Map<number, Promise<void>>();
const writes = new Map<number, ReturnType<typeof setTimeout>>();
const MAX_READS = 300;

function blank(tabId: number): TabState {
  return {
    tabId,
    origin: null,
    url: null,
    status: "idle",
    release: null,
    site: null,
    resources: {},
    descriptors: [],
    leaks: {},
    accounts: [],
    blocked: [],
    strict: false,
    transport: "not needed",
    reads: [],
    unguarded: [],
    updatedAt: new Date().toISOString(),
  };
}

let hydrated: Promise<void> | null = null;
/**
 * Loads every persisted tab into memory (webRequest listeners need synchronous access) and fails closed on requests
 * that were pending when the previous worker died: they are marked interrupted (the page already got a rejection
 * when its port closed). Returns the tabs whose verification was cut off, so the caller can re-run it.
 */
export function hydrate(): Promise<void> {
  hydrated ??= (async () => {
    const all = await chrome.storage.session.get(null);
    for (const [k, v] of Object.entries(all)) {
      if (k.startsWith("tab:") && v && typeof v === "object") {
        const t = { ...blank((v as TabState).tabId), ...(v as TabState) };
        if (!tabs.has(t.tabId)) tabs.set(t.tabId, t);
      }
      if (k.startsWith("pending:") && v && typeof v === "object" && (v as PendingView).state !== "interrupted") {
        await chrome.storage.session.set({ [k]: { ...(v as PendingView), state: "interrupted", blocked: true } });
      }
    }
  })().catch(() => undefined);
  return hydrated;
}

/** Tabs whose verification was still running when the worker stopped. */
export function interruptedTabs(): TabState[] {
  return [...tabs.values()].filter((t) => t.status === "checking" && !inflight.has(t.tabId));
}

/** Synchronous access for webRequest listeners (they cannot await). */
export function peekTab(tabId: number): TabState | undefined {
  return tabs.get(tabId);
}

export async function getTab(tabId: number): Promise<TabState> {
  await hydrate();
  const live = tabs.get(tabId);
  if (live) return live;
  const tab = blank(tabId);
  tabs.set(tabId, tab);
  return tab;
}

/** A navigation: fresh state for the new origin, with that origin's own saved privacy choices. */
export async function resetTab(tabId: number, url: string): Promise<TabState> {
  await hydrate();
  const prev = tabs.get(tabId);
  const tab = blank(tabId);
  try {
    tab.origin = new URL(url).origin;
  } catch {
    tab.origin = null;
  }
  tab.url = url;
  if (tab.origin) {
    const prefs = await originPrefs(tab.origin);
    tab.blocked = prefs.blocked;
    tab.strict = prefs.strict;
  }
  if (prev && prev.origin === tab.origin) tab.accounts = prev.accounts;
  tabs.set(tabId, tab);
  persist(tab);
  return tab;
}

export function addRead(tab: TabState, r: ReadRecord): void {
  tab.reads.push(r);
  if (tab.reads.length > MAX_READS) tab.reads.splice(0, tab.reads.length - MAX_READS);
  persist(tab);
}

export function persist(tab: TabState): void {
  // Only the tab object that is current for this tab id may be written. A navigation replaces the object (resetTab);
  // delayed work still holding the old one (hashing a leftover file, a finished read) must not overwrite the new
  // record with stale state, and a closed tab must not be written back after forgetTab removed it.
  if (tabs.get(tab.tabId) !== tab) return;
  tab.updatedAt = new Date().toISOString();
  clearTimeout(writes.get(tab.tabId));
  writes.set(
    tab.tabId,
    setTimeout(() => {
      if (tabs.get(tab.tabId) !== tab) return;
      void chrome.storage.session.set({ [`tab:${tab.tabId}`]: tab }).catch(() => undefined);
    }, 150),
  );
}

export function forgetTab(tabId: number): void {
  tabs.delete(tabId);
  inflight.delete(tabId);
  void chrome.storage.session.remove(`tab:${tabId}`);
}

export function setInflight(tabId: number, p: Promise<void>): void {
  inflight.set(tabId, p);
  void p.finally(() => {
    if (inflight.get(tabId) === p) inflight.delete(tabId);
  });
}

export function inflightFor(tabId: number): Promise<void> | undefined {
  return inflight.get(tabId);
}

/** Waits (bounded) for a running verification. Returns false when it did not finish in time. */
export async function awaitVerification(tabId: number, timeoutMs: number): Promise<boolean> {
  const p = inflight.get(tabId);
  if (!p) return true;
  return Promise.race([p.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), timeoutMs))]);
}

// --- per-origin stores (storage.local) ----------------------------------------------------------------------------

interface OriginPrefs {
  blocked: string[];
  strict: boolean;
}

export async function originPrefs(origin: string): Promise<OriginPrefs> {
  const all = ((await chrome.storage.local.get("originPrefs"))["originPrefs"] ?? {}) as Record<string, OriginPrefs>;
  return { blocked: [...(all[origin]?.blocked ?? [])], strict: !!all[origin]?.strict };
}

export async function saveOriginPrefs(origin: string, prefs: OriginPrefs): Promise<void> {
  const all = ((await chrome.storage.local.get("originPrefs"))["originPrefs"] ?? {}) as Record<string, OriginPrefs>;
  all[origin] = prefs;
  await chrome.storage.local.set({ originPrefs: all });
}

/** First-seen origin → ENS name bindings (TOFU), keyed by exact origin, per browser profile. */
export const chromePins: PinStore = {
  async get(origin) {
    const pins = ((await chrome.storage.local.get("pins"))["pins"] ?? {}) as Record<string, string>;
    return pins[origin] ?? null;
  },
  async set(origin, ensName) {
    const pins = ((await chrome.storage.local.get("pins"))["pins"] ?? {}) as Record<string, string>;
    pins[origin] = ensName;
    await chrome.storage.local.set({ pins });
  },
};

/** Short-lived release cache, keyed by exact origin. "Verify again" bypasses it. */
const RELEASE_TTL_MS = 60_000;
export async function cachedRelease(origin: string): Promise<ReleaseVerification | null> {
  const key = `release:${origin}`;
  const hit = (await chrome.storage.session.get(key))[key] as { at: number; release: ReleaseVerification } | undefined;
  return hit && Date.now() - hit.at < RELEASE_TTL_MS && hit.release.origin === origin ? hit.release : null;
}
export async function cacheRelease(origin: string, release: ReleaseVerification): Promise<void> {
  await chrome.storage.session.set({ [`release:${origin}`]: { at: Date.now(), release } });
}

/** Every wallet address seen in this browser session (any site): a tracker may already know it from elsewhere. */
export async function knownAccounts(): Promise<string[]> {
  return ((await chrome.storage.session.get("accounts"))["accounts"] ?? []) as string[];
}
export async function rememberAccounts(accounts: string[]): Promise<string[]> {
  const merged = [...new Set([...(await knownAccounts()), ...accounts])];
  await chrome.storage.session.set({ accounts: merged });
  return merged;
}

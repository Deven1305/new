import type { ContentToBackground, GuardRequest, PageToBackground, TabView } from "../shared/messages.js";
import { decide, handleGuard, onWindowRemoved } from "./guard.js";
import { blockHost, clearTabRules, forgetRecent, onBeforeRequest, onBeforeSendHeaders, rescanRecent, setSessionAccounts, setStrict, syncTabRules, unblockHost } from "./privacy.js";
import { forgetTab, getTab, hydrate, interruptedTabs, knownAccounts, peekTab, persist, rememberAccounts, resetTab, type TabState } from "./state.js";
import { anonStatus } from "./transport.js";
import { recomputeSite, tabColor, tabSiteRow, updateBadge, verifyTab } from "./verify.js";

function onTabChange(tab: TabState): void {
  void updateBadge(tab);
}

// Worker start (first install, or a restart after Chrome stopped it): restore state, fail closed on interrupted
// requests (done in hydrate), re-run verifications that were cut off.
void hydrate().then(async () => {
  setSessionAccounts(await knownAccounts());
  for (const t of interruptedTabs()) void verifyTab(t);
});

const tabQueues = new Map<number, Promise<unknown>>();
/** Runs `fn` after every earlier job for the same tab has finished (a failed job never blocks the next one). */
function inTabOrder<T>(tabId: number, fn: () => Promise<T>): Promise<T> {
  const run = (tabQueues.get(tabId) ?? Promise.resolve()).catch(() => undefined).then(fn);
  tabQueues.set(tabId, run);
  const clear = () => {
    if (tabQueues.get(tabId) === run) tabQueues.delete(tabId);
  };
  run.then(clear, clear);
  return run;
}

const isAddressList =(a: unknown): a is string[] => Array.isArray(a) && a.every((x) => typeof x === "string");

chrome.runtime.onMessage.addListener((msg: ContentToBackground | PageToBackground, sender, sendResponse) => {
  const fromTab = sender.tab?.id;
  const fromExtensionPage = !!sender.url && sender.url.startsWith(chrome.runtime.getURL(""));
  void (async () => {
    if (sender.id !== chrome.runtime.id) return sendResponse({ error: "not allowed" });
    if (fromTab !== undefined && !fromExtensionPage) {
      // --- content scripts: only these four messages, about their own tab ---
      // Handled strictly in arrival order per tab: "page" resets the tab's state asynchronously, and a "resources"
      // message handled before that reset finished would be thrown away with the old state (site check stuck amber).
      return inTabOrder(fromTab, async () => {
      if (msg.type === "page" && typeof msg.url === "string") {
        const tab = await resetTab(fromTab, msg.url);
        forgetRecent(fromTab);
        await syncTabRules(tab).catch(() => undefined);
        void verifyTab(tab);
        return sendResponse({ ok: true });
      }
      const tab = await getTab(fromTab);
      if (msg.type === "resources" && Array.isArray(msg.items)) {
        for (const r of msg.items.slice(0, 500)) {
          if (typeof r?.url !== "string") continue;
          const prev = tab.resources[r.url];
          if (!prev || (prev.sha256 === null && r.sha256 !== null)) tab.resources[r.url] = r;
        }
        recomputeSite(tab);
        persist(tab);
        onTabChange(tab);
      } else if (msg.type === "accounts" && isAddressList(msg.accounts)) {
        const fresh = msg.accounts.map((a) => a.toLowerCase()).filter((a) => /^0x[0-9a-f]{40}$/.test(a));
        tab.accounts = [...new Set([...tab.accounts, ...fresh])];
        setSessionAccounts(await rememberAccounts(fresh));
        rescanRecent(tab, onTabChange);
        persist(tab);
      } else if (msg.type === "unguarded" && typeof msg.walletName === "string") {
        if (!tab.unguarded.some((u) => u.walletName === msg.walletName)) tab.unguarded.push({ walletName: msg.walletName.slice(0, 60), reason: String(msg.reason).slice(0, 200) });
        persist(tab);
      }
      return sendResponse({ ok: true });
      });
    }
    if (!fromExtensionPage) return sendResponse({ error: "not allowed" });
    // --- extension pages (popup, review window, options) ---
    switch (msg.type) {
      case "tab-view":
        return sendResponse(await view(msg.tabId));
      case "reverify": {
        const tab = await getTab(msg.tabId);
        await verifyTab(tab, { force: true });
        return sendResponse(await view(msg.tabId));
      }
      case "block-host":
        await blockHost(await getTab(msg.tabId), msg.host);
        onTabChange(await getTab(msg.tabId));
        return sendResponse(await view(msg.tabId));
      case "unblock-host":
        await unblockHost(await getTab(msg.tabId), msg.host);
        return sendResponse(await view(msg.tabId));
      case "set-strict":
        await setStrict(await getTab(msg.tabId), msg.strict);
        return sendResponse(await view(msg.tabId));
      case "pending":
        return sendResponse((await chrome.storage.session.get(`pending:${msg.id}`))[`pending:${msg.id}`] ?? null);
      case "decide":
        return sendResponse({ ok: decide(msg.id, msg.decision, msg.override === true) });
      default:
        return sendResponse(null);
    }
  })();
  return true;
});

async function view(tabId: number): Promise<TabView> {
  const tab = await getTab(tabId);
  const r = tab.release;
  const m = r?.status === "verified" ? r.manifest : null;
  return {
    tabId,
    origin: tab.origin,
    status: tab.status === "checking" ? "checking" : (r?.status ?? "idle"),
    reason: (r as { reason?: string | null } | null)?.reason ?? null,
    color: (await tabColor(tab)) ?? "amber",
    siteRow: r ? await tabSiteRow(tab) : null,
    ensName: r?.ensName ?? null,
    tag: r?.pointer?.tag ?? null,
    signer: r?.signature?.status === "valid" ? r.signature.signer : null,
    signatureMode: r?.signature?.mode ?? null,
    manifestSha256: r?.manifestSha256 ?? null,
    manifestSource: r?.manifestSource ?? null,
    checks: r?.checks ?? [],
    site: tab.site ? { status: tab.site.status, severity: tab.site.severity, summary: tab.site.summary, resources: tab.site.resources } : null,
    contracts: m?.contracts.map((c) => ({ label: c.label, address: c.address, chainId: c.chainId, proxy: c.proxy?.type ?? null })) ?? [],
    thirdParties: m?.thirdParties ?? [],
    findings: m?.findings.map((f) => ({ id: f.id, title: f.title ?? f.class, status: f.status, severity: f.severity })) ?? [],
    pending: (r?.pending ?? []).map((p) => ({ tag: p.pointer?.tag ?? null, eta: new Date(p.eta * 1000).toISOString(), ready: p.ready })),
    leaks: Object.values(tab.leaks),
    blockedHosts: tab.blocked,
    strict: tab.strict,
    transport: tab.transport,
    anon: anonStatus(),
    reads: tab.reads,
    unguarded: tab.unguarded,
    singleSource: !!r?.singleSource,
    updatedAt: tab.updatedAt,
  };
}

// --- wallet guard ---------------------------------------------------------------------------------------------------

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "pramaan-guard" || port.sender?.id !== chrome.runtime.id) return;
  let started = false;
  port.onMessage.addListener((msg: GuardRequest) => {
    if (msg?.type === "guard" && !started) {
      started = true;
      void handleGuard(port, msg);
    }
  });
});
chrome.windows.onRemoved.addListener(onWindowRemoved);

// --- network observation (non-blocking) -----------------------------------------------------------------------------

chrome.webRequest.onBeforeRequest.addListener(
  (d) => {
    if (d.tabId < 0) return undefined;
    // A top-level navigation: apply the destination origin's saved blocks before the page's requests start.
    if (d.type === "main_frame") {
      void inTabOrder(d.tabId, async () => {
        const tab = await getTab(d.tabId);
        let origin: string | null = null;
        try {
          origin = new URL(d.url).origin;
        } catch {
          origin = null;
        }
        if (origin && origin !== tab.origin) {
          const next = await resetTab(d.tabId, d.url);
          await syncTabRules(next).catch(() => undefined);
        }
      });
      return undefined;
    }
    const tab = peekTab(d.tabId);
    if (tab && (d.type === "script" || d.type === "stylesheet" || d.type === "sub_frame")) {
      const url = d.url.split("#")[0]!;
      if (tab.origin && !tab.resources[url]) {
        tab.resources[url] = { url, type: d.type as "script" | "stylesheet" | "sub_frame", sha256: null };
        recomputeSite(tab);
        persist(tab);
        setTimeout(() => void hashLeftover(tab, url), 2_500);
      }
    }
    onBeforeRequest(d, onTabChange);
    return undefined;
  },
  { urls: ["<all_urls>"] },
  ["requestBody"],
);

chrome.webRequest.onBeforeSendHeaders.addListener(
  (d) => {
    onBeforeSendHeaders(d, onTabChange);
    return undefined;
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders", "extraHeaders"],
);

/** Same-origin files the content script has not hashed yet are fetched here after a short grace period. */
async function hashLeftover(tab: TabState, url: string): Promise<void> {
  const r = tab.resources[url];
  if (!r || r.sha256 !== null || !tab.origin || new URL(url).origin !== tab.origin) return;
  try {
    const res = await fetch(url, { cache: "no-store", credentials: "omit" });
    if (!res.ok) return;
    const digest = await crypto.subtle.digest("SHA-256", await res.arrayBuffer());
    r.sha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    recomputeSite(tab);
    persist(tab);
    onTabChange(tab);
  } catch {
    // stays pending (amber)
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  forgetTab(tabId);
  forgetRecent(tabId);
  void clearTabRules(tabId);
});

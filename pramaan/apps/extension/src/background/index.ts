import type { ContentToBackground, GuardRequest, PageToBackground, TabView } from "../shared/messages.js";
import { decide, handleGuard, onWindowRemoved } from "./guard.js";
import { blockOrigin, clearTabRules, onBeforeRequest, onBeforeSendHeaders, setStrict, unblockOrigin } from "./privacy.js";
import { forgetTab, getTab, persist, resetTab, type TabState } from "./state.js";
import { recomputeSite, tabColor, updateBadge, verifyTab } from "./verify.js";

function onTabChange(tab: TabState): void {
  void updateBadge(tab);
}

// --- content scripts ------------------------------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg: ContentToBackground | PageToBackground, sender, sendResponse) => {
  const fromTab = sender.tab?.id;
  void (async () => {
    if (fromTab !== undefined && sender.id === chrome.runtime.id && msg.type === "page") {
      const tab = resetTab(fromTab, msg.url);
      void verifyTab(tab);
      sendResponse({ ok: true });
      return;
    }
    if (fromTab !== undefined && msg.type === "resources") {
      const tab = await getTab(fromTab);
      for (const r of msg.items) {
        const prev = tab.resources[r.url];
        if (!prev || (prev.sha256 === null && r.sha256 !== null)) tab.resources[r.url] = r;
      }
      recomputeSite(tab);
      persist(tab);
      onTabChange(tab);
      sendResponse({ ok: true });
      return;
    }
    if (fromTab !== undefined && msg.type === "accounts") {
      const tab = await getTab(fromTab);
      tab.accounts = [...new Set([...tab.accounts, ...msg.accounts.map((a) => a.toLowerCase())])].filter((a) => /^0x[0-9a-f]{40}$/.test(a));
      persist(tab);
      sendResponse({ ok: true });
      return;
    }
    // --- extension pages (popup, verdict window, options) ---
    if (sender.tab && sender.url && !sender.url.startsWith(chrome.runtime.getURL(""))) {
      sendResponse({ error: "not allowed" });
      return;
    }
    switch (msg.type) {
      case "tab-view":
        sendResponse(await view(msg.tabId));
        return;
      case "reverify": {
        const tab = await getTab(msg.tabId);
        await verifyTab(tab);
        sendResponse(await view(msg.tabId));
        return;
      }
      case "block-host":
        await blockOrigin(await getTab(msg.tabId), msg.origin);
        onTabChange(await getTab(msg.tabId));
        sendResponse(await view(msg.tabId));
        return;
      case "unblock-host":
        await unblockOrigin(await getTab(msg.tabId), msg.origin);
        sendResponse(await view(msg.tabId));
        return;
      case "set-strict":
        await setStrict(await getTab(msg.tabId), msg.strict);
        sendResponse(await view(msg.tabId));
        return;
      case "pending":
        sendResponse((await chrome.storage.session.get(`pending:${msg.id}`))[`pending:${msg.id}`] ?? null);
        return;
      case "decide":
        sendResponse({ ok: decide(msg.id, msg.decision) });
        return;
      default:
        sendResponse(null);
    }
  })();
  return true;
});

async function view(tabId: number): Promise<TabView> {
  const tab = await getTab(tabId);
  const r = tab.release;
  const m = r?.manifest ?? null;
  const color = (await tabColor(tab)) ?? "amber";
  return {
    tabId,
    origin: tab.origin,
    status: tab.status === "checking" ? "checking" : r?.status ?? "idle",
    color,
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
    leaks: Object.values(tab.leaks),
    blockedHosts: tab.blocked,
    strict: tab.strict,
    transport: tab.transport,
    singleSource: !!r?.singleSource,
    updatedAt: tab.updatedAt,
  };
}

// --- wallet guard ---------------------------------------------------------------------------------------------------

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "pramaan-guard" || port.sender?.id !== chrome.runtime.id) return;
  port.onMessage.addListener((msg: GuardRequest) => {
    if (msg?.type === "guard") void handleGuard(port, msg);
  });
});
chrome.windows.onRemoved.addListener(onWindowRemoved);

// --- network observation (non-blocking) -----------------------------------------------------------------------------

chrome.webRequest.onBeforeRequest.addListener(
  (d) => {
    if (d.tabId >= 0 && (d.type === "script" || d.type === "stylesheet" || d.type === "sub_frame")) {
      void getTab(d.tabId).then((tab) => {
        if (tab.origin && !tab.resources[d.url.split("#")[0]!]) {
          tab.resources[d.url.split("#")[0]!] = { url: d.url.split("#")[0]!, type: d.type as "script" | "stylesheet" | "sub_frame", sha256: null };
          recomputeSite(tab);
          persist(tab);
          // Same-origin files the content script has not hashed yet are fetched here after a short grace period.
          setTimeout(() => void hashLeftover(tab, d.url.split("#")[0]!), 2_500);
        }
      });
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
  void clearTabRules(tabId);
});

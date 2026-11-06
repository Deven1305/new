/**
 * Isolated-world content script (document_start). Two jobs:
 *  1. relay guarded wallet requests from the MAIN-world script to the service worker over a private MessagePort;
 *  2. inventory what the page actually loaded and hash every same-origin document and script it can re-read from the
 *     page's own HTTP cache (`cache: "force-cache"`), so the service worker can compare them with the release.
 *
 * LIMITATION (documented): Chrome MV3 cannot read response bodies, so this re-fetches. A server that serves different
 * bytes to the re-fetch than to the original load (targeted cloaking), with caching disabled, is not detected.
 */
import type { ObservedResource, ResourceType } from "@pramaan/verifier-core";
import type { ContentToBackground, ContentToInpage, GuardRequest, InpageToContent } from "./shared/messages.js";

const channel = new MessageChannel();
const inpage = channel.port1;
window.postMessage({ __pramaan: "init" }, "*", [channel.port2]);

const send = (msg: ContentToBackground) => chrome.runtime.sendMessage(msg).catch(() => undefined);

inpage.onmessage = (event: MessageEvent<InpageToContent>) => {
  const msg = event.data;
  if (msg?.type === "accounts") {
    send({ type: "accounts", accounts: msg.accounts });
    return;
  }
  if (msg?.type === "unguarded") {
    send({ type: "unguarded", walletName: msg.walletName, reason: msg.reason });
    return;
  }
  if (msg?.type !== "request") return;
  const rejectNow = (reason: string) => inpage.postMessage({ type: "decision", id: msg.id, decision: "reject", reason } satisfies ContentToInpage);
  let port: chrome.runtime.Port;
  try {
    port = chrome.runtime.connect({ name: "pramaan-guard" });
  } catch {
    // The extension was updated or reloaded: this page's script is orphaned. Fail closed.
    rejectNow("Pramaan was restarted; reload the page to sign");
    return;
  }
  let answered = false;
  // A message every 20 s keeps the MV3 service worker alive while the user reads the review window.
  const keepalive = setInterval(() => {
    try {
      port.postMessage({ type: "keepalive" });
    } catch {
      clearInterval(keepalive);
    }
  }, 20_000);
  port.onMessage.addListener((m: ContentToInpage) => {
    if (m.type === "decision" && m.id === msg.id) {
      answered = true;
      clearInterval(keepalive);
      inpage.postMessage(m);
      port.disconnect();
    }
  });
  port.onDisconnect.addListener(() => {
    clearInterval(keepalive);
    // Service worker stopped or restarted mid-request: never silently allowed.
    if (!answered) rejectNow("Pramaan could not complete the review (it restarted), so the request was rejected");
  });
  const req: GuardRequest = { type: "guard", id: msg.id, method: msg.method, params: msg.params, chainId: msg.chainId, walletName: msg.walletName };
  try {
    port.postMessage(req);
  } catch {
    clearInterval(keepalive);
    rejectNow("Pramaan was restarted; reload the page to sign");
  }
};

send({ type: "page", url: location.href });

// --- resource inventory ---------------------------------------------------------------------------------------------

const seen = new Map<string, ResourceType>();
let batch: ObservedResource[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let documentText: string | null = null;

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Text(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

async function hashUrl(url: string, keepText = false): Promise<string | null> {
  try {
    const res = await fetch(url, { cache: "force-cache", credentials: "same-origin" });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (keepText) documentText = new TextDecoder().decode(buf);
    return hex(await crypto.subtle.digest("SHA-256", buf));
  } catch {
    return null;
  }
}

function flushSoon(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const items = batch;
    batch = [];
    if (items.length) send({ type: "resources", items });
  }, 250);
}

async function observe(rawUrl: string, type: ResourceType): Promise<void> {
  let url: string;
  try {
    url = new URL(rawUrl, location.href).href.split("#")[0]!;
  } catch {
    return;
  }
  if (seen.has(url)) return;
  seen.set(url, type);
  const sameOrigin = new URL(url).origin === location.origin;
  const sha256 = sameOrigin ? await hashUrl(url, type === "main_frame") : null;
  batch.push({ url, type, sha256 });
  flushSoon();
}

function scanDom(): void {
  document.querySelectorAll<HTMLScriptElement>("script[src]").forEach((s) => void observe(s.src, "script"));
  document.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"][href], link[rel="preload"][as="script"][href]').forEach((l) => void observe(l.href, "script"));
  document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]').forEach((l) => void observe(l.href, "stylesheet"));
  document.querySelectorAll<HTMLIFrameElement>("iframe[src]").forEach((f) => void observe(f.src, "sub_frame"));
}

async function scanInline(nodes: Iterable<HTMLScriptElement>): Promise<void> {
  for (const s of nodes) {
    if (s.src || !s.textContent?.trim()) continue;
    const type = (s.type || "text/javascript").toLowerCase();
    if (type.includes("json") || type === "importmap" || type.includes("template")) continue;
    // Inline scripts present in the verified HTML are covered by the document hash.
    if (documentText?.includes(s.textContent)) continue;
    const digest = await sha256Text(s.textContent);
    if (seen.has(`inline:${digest}`)) continue;
    seen.set(`inline:${digest}`, "inline_script");
    batch.push({ url: `inline:${digest}`, type: "inline_script", sha256: digest });
    flushSoon();
  }
}

void observe(location.href, "main_frame");

new MutationObserver((mutations) => {
  const added: HTMLScriptElement[] = [];
  for (const m of mutations) {
    for (const n of m.addedNodes) {
      if (n instanceof HTMLScriptElement) {
        if (n.src) void observe(n.src, "script");
        else added.push(n);
      } else if (n instanceof HTMLLinkElement && n.rel === "stylesheet" && n.href) void observe(n.href, "stylesheet");
      else if (n instanceof HTMLLinkElement && n.rel === "modulepreload" && n.href) void observe(n.href, "script");
      else if (n instanceof HTMLIFrameElement && n.src) void observe(n.src, "sub_frame");
    }
  }
  if (added.length && document.readyState !== "loading") void scanInline(added);
}).observe(document, { childList: true, subtree: true });

try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries() as PerformanceResourceTiming[]) {
      if (e.initiatorType === "script" || e.initiatorType === "link") {
        const type: ResourceType = /\.css(\?|$)/.test(e.name) ? "stylesheet" : /\.m?js(\?|$)/.test(e.name) ? "script" : "other";
        if (type !== "other") void observe(e.name, type);
      }
    }
  }).observe({ type: "resource", buffered: true });
} catch {
  // PerformanceObserver unavailable
}

document.addEventListener("DOMContentLoaded", () => {
  scanDom();
});
window.addEventListener("load", () => {
  scanDom();
  setTimeout(() => void scanInline(Array.from(document.scripts)), 300);
});

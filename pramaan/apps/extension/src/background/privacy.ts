import type { ObservedLeak } from "@pramaan/verifier-core";
import type { LeakRecord } from "../shared/messages.js";
import { channelOf, hostOf, matchBody, matchHeaders, matchUrl, originOf, type LeakMatch, type RequestBody } from "../shared/leaks.js";
import { peekTab, persist, saveOriginPrefs, type TabState } from "./state.js";

/** Accounts known in this session (any tab), cached for the synchronous webRequest listeners. */
let sessionAccounts: string[] = [];
export function setSessionAccounts(a: string[]): void {
  sessionAccounts = a;
}
const accountsFor = (tab: TabState) => [...new Set([...tab.accounts, ...sessionAccounts])];

/** Leaks as the verdict layer sees them (one per destination host). */
export function leakList(tab: TabState): ObservedLeak[] {
  return Object.values(tab.leaks).map((l) => ({ host: l.host, declared: l.declared, purpose: l.purpose, blocked: l.blocked }));
}

function declaration(tab: TabState, host: string): { declared: boolean; purpose: string | null } {
  const entry = tab.release?.status === "verified" ? tab.release.manifest?.thirdParties.find((t) => t.host === host) : undefined;
  // A third party declared as NOT receiving the address that receives it anyway is treated as undeclared.
  if (!entry || !entry.receivesAddress) return { declared: false, purpose: entry?.purpose ?? null };
  return { declared: true, purpose: entry.purpose };
}

function isThirdParty(tab: TabState, url: string): boolean {
  const o = originOf(url);
  return !!o && !!tab.origin && o !== tab.origin && /^(https?|wss?):/.test(o);
}

function record(tab: TabState, d: { url: string; method: string; type: string }, hit: LeakMatch, onChange: (t: TabState) => void): void {
  const host = hostOf(d.url);
  const origin = originOf(d.url);
  if (!host || !origin) return;
  const prev = tab.leaks[host];
  if (prev) prev.count += 1;
  else {
    const { declared, purpose } = declaration(tab, host);
    tab.leaks[host] = {
      host,
      origin,
      url: d.url.slice(0, 300),
      method: d.method,
      channel: channelOf(d.type, d.method),
      form: hit.form,
      where: hit.where,
      account: `${hit.account.slice(0, 6)}…${hit.account.slice(-4)}`,
      declared,
      purpose,
      blocked: tab.blocked.includes(host),
      count: 1,
      firstSeen: new Date().toISOString(),
    };
  }
  persist(tab);
  onChange(tab);
}

/** Third-party requests of the last 20 s, re-scanned when the page learns an address (connect and send in one tick). */
interface Recent {
  at: number;
  url: string;
  method: string;
  type: string;
  body: RequestBody;
  headers?: { name: string; value?: string }[];
}
const recent = new Map<number, Recent[]>();
const RECENT_MS = 20_000;

function scan(tab: TabState, r: Recent, accounts: string[], onChange: (t: TabState) => void): boolean {
  const hit = matchUrl(r.url, accounts) ?? matchBody(r.body, accounts) ?? matchHeaders(r.headers, accounts);
  if (hit) record(tab, r, hit, onChange);
  return !!hit;
}

export function onBeforeRequest(d: chrome.webRequest.OnBeforeRequestDetails, onChange: (tab: TabState) => void): void {
  if (d.tabId < 0) return;
  const tab = peekTab(d.tabId);
  if (!tab || !isThirdParty(tab, d.url)) return;
  const r: Recent = { at: Date.now(), url: d.url, method: d.method, type: d.type, body: d.requestBody as RequestBody };
  const list = (recent.get(d.tabId) ?? []).filter((x) => r.at - x.at < RECENT_MS);
  list.push(r);
  recent.set(d.tabId, list.slice(-50));
  const accounts = accountsFor(tab);
  if (accounts.length) scan(tab, r, accounts, onChange);
}

export function onBeforeSendHeaders(d: chrome.webRequest.OnBeforeSendHeadersDetails, onChange: (tab: TabState) => void): void {
  if (d.tabId < 0) return;
  const tab = peekTab(d.tabId);
  if (!tab || !isThirdParty(tab, d.url)) return;
  const accounts = accountsFor(tab);
  const r = (recent.get(d.tabId) ?? []).find((x) => x.url === d.url);
  if (r) r.headers = d.requestHeaders;
  if (!accounts.length) return;
  const hit = matchHeaders(d.requestHeaders, accounts);
  if (hit && !tab.leaks[hostOf(d.url) ?? ""]) record(tab, { url: d.url, method: d.method, type: d.type }, hit, onChange);
}

/** Called when the page reveals new accounts: re-check what was already sent in the last 20 s. */
export function rescanRecent(tab: TabState, onChange: (t: TabState) => void): void {
  const accounts = accountsFor(tab);
  const now = Date.now();
  for (const r of recent.get(tab.tabId) ?? []) if (now - r.at < RECENT_MS && !tab.leaks[hostOf(r.url) ?? ""]) scan(tab, r, accounts, onChange);
}

export function forgetRecent(tabId: number): void {
  recent.delete(tabId);
}

// --- blocking: declarativeNetRequest session rules scoped to this tab ------------------------------------------
// Persistent dynamic rules cannot be scoped to a tab or to an initiator PORT, so a block made on localhost:5184 would
// also apply on localhost:5180/5182. Instead the per-origin choice is saved in storage.local and re-applied as
// tab-scoped session rules whenever a tab navigates (main_frame request), before the page's own requests start.

const ALL_TYPES = Object.values(chrome.declarativeNetRequest.ResourceType) as chrome.declarativeNetRequest.ResourceType[];
const SCHEMES = ["http", "https", "ws", "wss"] as const;

export function ruleId(tabId: number, key: string): number {
  let h = 2166136261;
  for (const ch of `${tabId}|${key}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (Math.abs(h) % 900_000_000) + 1;
}

export function blockRules(tabId: number, host: string): chrome.declarativeNetRequest.Rule[] {
  return SCHEMES.map((scheme) => ({
    id: ruleId(tabId, `block-${scheme}:${host}`),
    priority: 3,
    action: { type: chrome.declarativeNetRequest.RuleActionType.BLOCK },
    condition: { urlFilter: `|${scheme}://${host}/`, tabIds: [tabId], resourceTypes: ALL_TYPES },
  }));
}

function strictRules(tab: TabState): chrome.declarativeNetRequest.Rule[] {
  const declared = tab.release?.status === "verified" ? (tab.release.manifest?.thirdParties.map((t) => t.host) ?? []) : [];
  return [
    {
      id: ruleId(tab.tabId, "strict"),
      priority: 1,
      action: { type: chrome.declarativeNetRequest.RuleActionType.BLOCK },
      condition: { domainType: chrome.declarativeNetRequest.DomainType.THIRD_PARTY, tabIds: [tab.tabId], resourceTypes: ALL_TYPES },
    },
    ...declared.flatMap((h) =>
      SCHEMES.map((scheme) => ({
        id: ruleId(tab.tabId, `allow-${scheme}:${h}`),
        priority: 2,
        action: { type: chrome.declarativeNetRequest.RuleActionType.ALLOW },
        condition: { urlFilter: `|${scheme}://${h}/`, tabIds: [tab.tabId], resourceTypes: ALL_TYPES },
      })),
    ),
  ];
}

/** Makes the tab's session rules exactly match the origin's saved choices. */
export async function syncTabRules(tab: TabState): Promise<void> {
  const existing = (await chrome.declarativeNetRequest.getSessionRules()).filter((r) => r.condition.tabIds?.includes(tab.tabId)).map((r) => r.id);
  const addRules = [...tab.blocked.flatMap((h) => blockRules(tab.tabId, h)), ...(tab.strict ? strictRules(tab) : [])];
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: existing, addRules });
}

async function savePrefs(tab: TabState): Promise<void> {
  if (tab.origin) await saveOriginPrefs(tab.origin, { blocked: tab.blocked, strict: tab.strict });
}

/** "Block this host": every request from pages of this origin to host (any scheme) is refused from now on. */
export async function blockHost(tab: TabState, host: string): Promise<void> {
  if (!tab.blocked.includes(host)) tab.blocked.push(host);
  const leak = tab.leaks[host];
  if (leak) leak.blocked = true;
  await savePrefs(tab);
  await syncTabRules(tab);
  persist(tab);
}

export async function unblockHost(tab: TabState, host: string): Promise<void> {
  tab.blocked = tab.blocked.filter((h) => h !== host);
  const leak = tab.leaks[host];
  if (leak) leak.blocked = false;
  await savePrefs(tab);
  await syncTabRules(tab);
  persist(tab);
}

/** Strict mode: block every third party except those the verified release declares. */
export async function setStrict(tab: TabState, strict: boolean): Promise<void> {
  tab.strict = strict;
  await savePrefs(tab);
  await syncTabRules(tab);
  persist(tab);
}

export async function clearTabRules(tabId: number): Promise<void> {
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  const ids = rules.filter((r) => r.condition.tabIds?.includes(tabId)).map((r) => r.id);
  if (ids.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids });
}

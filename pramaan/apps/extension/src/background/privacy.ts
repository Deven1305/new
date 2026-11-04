import type { ObservedLeak } from "@pramaan/verifier-core";
import type { LeakRecord } from "../shared/messages.js";
import { decodeBody, findAddress, hostOf, originOf } from "../shared/leaks.js";
import { peekTab, persist, type TabState } from "./state.js";

/** Leaks as the verdict layer sees them (one per destination). */
export function leakList(tab: TabState): ObservedLeak[] {
  return Object.values(tab.leaks).map((l) => ({ host: l.host, declared: l.declared, purpose: l.purpose, blocked: l.blocked }));
}

function declaration(tab: TabState, host: string): { declared: boolean; purpose: string | null } {
  const entry = tab.release?.manifest?.thirdParties.find((t) => t.host === host);
  // A third party declared as NOT receiving the address that receives it anyway is treated as undeclared.
  if (!entry || !entry.receivesAddress) return { declared: false, purpose: entry?.purpose ?? null };
  return { declared: true, purpose: entry.purpose };
}

function record(tab: TabState, url: string, method: string, channel: LeakRecord["channel"], form: string): void {
  const origin = originOf(url);
  const host = hostOf(url);
  if (!origin || !host) return;
  const prev = tab.leaks[origin];
  if (prev) {
    prev.count += 1;
    return;
  }
  const { declared, purpose } = declaration(tab, host);
  tab.leaks[origin] = { host, origin, url: url.slice(0, 300), method, channel, form, declared, purpose, blocked: tab.blocked.includes(origin), count: 1, firstSeen: new Date().toISOString() };
  persist(tab);
}

function isThirdParty(tab: TabState, url: string): boolean {
  const o = originOf(url);
  return !!o && !!tab.origin && o !== tab.origin && /^https?:/.test(o);
}

export function onBeforeRequest(d: chrome.webRequest.OnBeforeRequestDetails, onChange: (tab: TabState) => void): void {
  if (d.tabId < 0) return;
  const tab = peekTab(d.tabId);
  if (!tab || !tab.accounts.length || !isThirdParty(tab, d.url)) return;
  let url = d.url;
  try {
    url = decodeURIComponent(d.url);
  } catch {
    // keep raw
  }
  const inUrl = findAddress(url, tab.accounts);
  if (inUrl) {
    record(tab, d.url, d.method, "url", inUrl.form);
    onChange(tab);
    return;
  }
  const inBody = findAddress(decodeBody(d.requestBody), tab.accounts);
  if (inBody) {
    record(tab, d.url, d.method, "body", inBody.form);
    onChange(tab);
  }
}

export function onBeforeSendHeaders(d: chrome.webRequest.OnBeforeSendHeadersDetails, onChange: (tab: TabState) => void): void {
  if (d.tabId < 0) return;
  const tab = peekTab(d.tabId);
  if (!tab || !tab.accounts.length || !isThirdParty(tab, d.url)) return;
  const text = (d.requestHeaders ?? []).map((h) => `${h.name}: ${h.value ?? ""}`).join("\n");
  const hit = findAddress(text, tab.accounts);
  if (hit) {
    record(tab, d.url, d.method, "header", hit.form);
    onChange(tab);
  }
}

// --- blocking with declarativeNetRequest session rules -----------------------------------------------------------

const ALL_TYPES = Object.values(chrome.declarativeNetRequest.ResourceType) as chrome.declarativeNetRequest.ResourceType[];

function ruleId(tabId: number, key: string): number {
  let h = 2166136261;
  for (const ch of `${tabId}|${key}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (Math.abs(h) % 900_000_000) + 1;
}

/** Blocks one destination origin for this tab (the "Block" button next to an observed leak). */
export async function blockOrigin(tab: TabState, origin: string): Promise<void> {
  if (!tab.blocked.includes(origin)) tab.blocked.push(origin);
  const leak = tab.leaks[origin];
  if (leak) leak.blocked = true;
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [ruleId(tab.tabId, origin)],
    addRules: [
      {
        id: ruleId(tab.tabId, origin),
        priority: 3,
        action: { type: chrome.declarativeNetRequest.RuleActionType.BLOCK },
        condition: { urlFilter: `|${origin}/`, tabIds: [tab.tabId], resourceTypes: ALL_TYPES },
      },
    ],
  });
  persist(tab);
}

export async function unblockOrigin(tab: TabState, origin: string): Promise<void> {
  tab.blocked = tab.blocked.filter((o) => o !== origin);
  const leak = tab.leaks[origin];
  if (leak) leak.blocked = false;
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId(tab.tabId, origin)] });
  persist(tab);
}

/**
 * Strict mode: block every third-party request from this tab except the third parties the verified release declares
 * (allow rules win over the block rule by priority). Only offered when a release is verified.
 */
export async function setStrict(tab: TabState, strict: boolean): Promise<void> {
  tab.strict = strict;
  const declared = tab.release?.manifest?.thirdParties.map((t) => t.host) ?? [];
  const allowIds = declared.flatMap((h) => [ruleId(tab.tabId, `allow-http:${h}`), ruleId(tab.tabId, `allow-https:${h}`)]);
  const blockId = ruleId(tab.tabId, "strict");
  const removeRuleIds = [blockId, ...allowIds];
  if (!strict) {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds });
    persist(tab);
    return;
  }
  const addRules: chrome.declarativeNetRequest.Rule[] = [
    {
      id: blockId,
      priority: 1,
      action: { type: chrome.declarativeNetRequest.RuleActionType.BLOCK },
      condition: { domainType: chrome.declarativeNetRequest.DomainType.THIRD_PARTY, tabIds: [tab.tabId], resourceTypes: ALL_TYPES },
    },
    ...declared.flatMap((h) =>
      (["http", "https"] as const).map((scheme) => ({
        id: ruleId(tab.tabId, `allow-${scheme}:${h}`),
        priority: 2,
        action: { type: chrome.declarativeNetRequest.RuleActionType.ALLOW },
        condition: { urlFilter: `|${scheme}://${h}/`, tabIds: [tab.tabId], resourceTypes: ALL_TYPES },
      })),
    ),
  ];
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules });
  persist(tab);
}

export async function clearTabRules(tabId: number): Promise<void> {
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  const ids = rules.filter((r) => r.condition.tabIds?.includes(tabId)).map((r) => r.id);
  if (ids.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids });
}

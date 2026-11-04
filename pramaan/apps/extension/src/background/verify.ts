import { sha256Hex } from "@pramaan/manifest";
import type { VerifiedDescriptor } from "@pramaan/decoder";
import { checkSite, combine, fetchBytes, privacyRow, siteRow, verifySiteRelease, WELL_KNOWN_PATH_HINT } from "./verifier.js";
import { loadSettings } from "../shared/settings.js";
import { allChains } from "./transport.js";
import { chromePins, persist, setInflight, type TabState } from "./state.js";
import { leakList } from "./privacy.js";

const COLORS = { green: "#2f9e66", amber: "#d4a017", red: "#d93a3f" } as const;

export async function isLocalChain(chainId: number | null): Promise<boolean> {
  if (chainId === null) return false;
  return Boolean((await loadSettings()).chains[String(chainId)]?.local);
}

export async function tabColor(tab: TabState): Promise<"green" | "amber" | "red" | null> {
  if (!tab.origin || tab.status !== "done" || !tab.release) return null;
  if (tab.release.status === "missing") return null;
  const local = await isLocalChain(tab.release.chainId);
  return combine([siteRow(tab.release, tab.site, { acceptSingleSource: local }), privacyRow(leakList(tab))]).color;
}

export async function updateBadge(tab: TabState): Promise<void> {
  try {
    if (tab.status === "checking") {
      await chrome.action.setBadgeText({ tabId: tab.tabId, text: "…" });
      await chrome.action.setBadgeBackgroundColor({ tabId: tab.tabId, color: "#5b6684" });
      return;
    }
    const color = await tabColor(tab);
    await chrome.action.setBadgeText({ tabId: tab.tabId, text: color === "green" ? "✓" : color === "amber" ? "!" : color === "red" ? "✗" : "" });
    if (color) await chrome.action.setBadgeBackgroundColor({ tabId: tab.tabId, color: COLORS[color] });
  } catch {
    // tab closed
  }
}

export function recomputeSite(tab: TabState): void {
  const manifest = tab.release?.manifest;
  tab.site = manifest && tab.origin ? checkSite(manifest, tab.origin, Object.values(tab.resources)) : null;
}

async function loadDescriptors(tab: TabState): Promise<VerifiedDescriptor[]> {
  const manifest = tab.release?.manifest;
  if (!manifest || !tab.origin) return [];
  const out: VerifiedDescriptor[] = [];
  for (const d of manifest.descriptors) {
    try {
      const bytes = await fetchBytes(new URL(d.path, tab.origin).href, { maxBytes: 262_144, timeoutMs: 10_000 });
      // A descriptor is only used if it is the exact file the signed manifest pinned.
      if (sha256Hex(bytes) !== d.erc7730Sha256) continue;
      out.push({ chainId: d.chainId, address: d.address as `0x${string}`, descriptor: JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown> });
    } catch {
      // unavailable descriptors are simply not used
    }
  }
  return out;
}

/** Runs the full release check for the tab's origin. Nothing the site serves is trusted without its hash in ENS. */
export function verifyTab(tab: TabState): Promise<void> {
  const run = (async () => {
    if (!tab.origin || !/^https?:/.test(tab.origin)) {
      tab.status = "done";
      return;
    }
    const settings = await loadSettings();
    tab.status = "checking";
    persist(tab);
    void updateBadge(tab);
    let hint: unknown = null;
    try {
      hint = JSON.parse(new TextDecoder().decode(await fetchBytes(`${tab.origin}${WELL_KNOWN_PATH_HINT}`, { maxBytes: 16_384, timeoutMs: 8_000 })));
    } catch {
      hint = null;
    }
    const chainId = typeof (hint as { chainId?: unknown })?.chainId === "number" ? (hint as { chainId: number }).chainId : undefined;
    const chains = chainId !== undefined ? await allChains(settings, chainId) : {};
    tab.transport = chainId !== undefined ? chains[chainId]?.transportLabel ?? "no RPC configured for this chain" : "not needed";
    tab.release = await verifySiteRelease({
      origin: tab.origin,
      chains,
      pins: chromePins,
      ipfsGateways: settings.ipfsGateways,
      hint,
      fetchOptions: { timeoutMs: 15_000 },
    });
    tab.descriptors = tab.release.status === "verified" ? await loadDescriptors(tab) : [];
    recomputeSite(tab);
    tab.status = "done";
    persist(tab);
    await updateBadge(tab);
  })().catch((err: Error) => {
    tab.status = "done";
    tab.release = null;
    console.warn("Pramaan verification failed", err);
    persist(tab);
    void updateBadge(tab);
  });
  setInflight(tab.tabId, run);
  return run;
}

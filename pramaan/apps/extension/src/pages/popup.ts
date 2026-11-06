import type { Lang } from "@pramaan/decoder";
import type { TabView } from "../shared/messages.js";
import { MV3_BLIND_SPOTS } from "../shared/leaks.js";
import { OBSERVES, type ReadPath } from "../shared/rpc-log.js";
import { loadSettings, saveSettings } from "../shared/settings.js";
import { ui, verifyText } from "../shared/ui-i18n.js";
import { clear, h, short } from "./dom.js";

const root = document.getElementById("root")!;
const langSelect = document.getElementById("lang") as HTMLSelectElement;
let lang: Lang = "en";
let tabId = -1;
let view: TabView | null = null;

const MARK = { pass: "✓", fail: "✗", warn: "!", skip: "–" } as const;
const PATH_LABEL: Record<ReadPath, string> = { "anon-rpc": "Anon-RPC (Nox)", direct: "direct RPC", "direct-local": "direct (local chain)", "direct-fallback": "direct (fallback)" };

function statusColor(v: TabView): string {
  if (v.status === "checking" || v.status === "idle") return "neutral";
  if (v.status === "missing") return "amber";
  return v.siteRow?.color === "red" ? "red" : v.color;
}

function statusTitle(v: TabView): string {
  if (v.siteRow?.key === "verify.site.pending") return ui(lang, "popup.pending");
  return ui(lang, `popup.${v.status}`);
}

function privacyPanel(v: TabView): HTMLElement {
  const sec = h("section", {}, h("h2", {}, ui(lang, "popup.privacy")));
  sec.append(h("p", { class: "muted small" }, `${ui(lang, "popup.transport")}: ${v.transport}${v.singleSource ? " · single RPC" : ""} · ${ui(lang, "popup.anon")}: ${v.anon.state} (${v.anon.detail})`));
  const rpcReads = v.reads.filter((r) => r.method !== "GET");
  if (!v.reads.length) sec.append(h("p", { class: "muted small" }, ui(lang, "popup.noreads")));
  const paths = [...new Set(rpcReads.map((r) => r.path))];
  for (const p of paths) {
    const reads = rpcReads.filter((r) => r.path === p);
    sec.append(
      h(
        "details",
        {},
        h("summary", { class: "small" }, `${PATH_LABEL[p]}: ${reads.length} read(s) via ${[...new Set(reads.map((r) => r.endpoint))].join(", ")}`),
        h("ul", { class: "checks small privacy-reads" }, ...reads.map((r) => h("li", {}, h("span", { class: r.ok ? "mark-pass" : "mark-fail" }, r.method), h("span", {}, `${r.what}${r.note ? ` — ${r.note}` : ""} (${r.ms} ms)`)))),
        h("p", { class: "small" }, h("strong", {}, `${ui(lang, "popup.sees")}: `), OBSERVES[p].sees.join("; ")),
        h("p", { class: "small" }, h("strong", {}, `${ui(lang, "popup.notsees")}: `), OBSERVES[p].doesNotSee.join("; ")),
      ),
    );
  }
  const fetches = v.reads.filter((r) => r.method === "GET");
  if (fetches.length) {
    sec.append(h("details", {}, h("summary", { class: "small" }, `HTTP: ${fetches.length} file(s) from ${[...new Set(fetches.map((r) => r.endpoint))].join(", ")}`), h("ul", { class: "checks small" }, ...fetches.map((r) => h("li", {}, h("span", { class: r.ok ? "mark-pass" : "mark-fail" }, "•"), h("span", {}, r.what))))));
  }
  sec.append(h("p", { class: "muted small" }, "Pramaan sends nothing to a Pramaan server: these are the only requests it made to verify this page."));
  return sec;
}

function render(): void {
  clear(root);
  const v = view;
  if (!v || !v.origin) {
    root.append(h("p", { class: "muted" }, ui(lang, "popup.idle")));
    return;
  }
  const sub = [v.ensName, v.tag, v.signer].filter(Boolean).join(" · ") || v.origin;
  root.append(
    h(
      "div",
      { class: `status ${statusColor(v)}` },
      h("span", { class: "dot" }),
      h("div", {}, h("h1", {}, statusTitle(v)), h("p", {}, sub), v.siteRow ? h("p", {}, verifyText(lang, v.siteRow.key, v.siteRow.params)) : null, v.siteRow?.detail ? h("p", { class: "small" }, v.siteRow.detail) : null),
    ),
  );
  for (const u of v.unguarded) root.append(h("div", { class: "banner" }, `${ui(lang, "popup.unguarded")}: ${u.walletName} (${u.reason})`));
  if (v.checks.length) {
    root.append(h("section", {}, h("h2", {}, ui(lang, "popup.checks")), h("ul", { class: "checks" }, ...v.checks.map((c) => h("li", {}, h("span", { class: `mark-${c.status}` }, MARK[c.status]), h("span", {}, c.detail))))));
  }
  const issues = v.site?.resources.filter((r) => r.status !== "match" && r.status !== "ignored") ?? [];
  if (v.site) {
    root.append(
      h(
        "section",
        {},
        h("h2", {}, `${ui(lang, "popup.files")} (${v.site.resources.filter((r) => r.status === "match").length} ✓)`),
        issues.length
          ? h("ul", { class: "checks" }, ...issues.slice(0, 12).map((r) => h("li", {}, h("span", { class: r.status === "mismatch" || r.status === "unlisted" || r.status === "third-party-undeclared" ? "mark-fail" : "mark-warn" }, "•"), h("span", {}, `${r.status}: ${r.path ?? r.url}`))))
          : null,
      ),
    );
  }
  if (v.contracts.length) {
    root.append(h("section", {}, h("h2", {}, ui(lang, "popup.contracts")), h("dl", { class: "kv" }, ...v.contracts.flatMap((c) => [h("dt", {}, c.label), h("dd", {}, `${short(c.address)}${c.proxy ? ` (${c.proxy})` : ""} · chain ${c.chainId}`)]))));
  }
  if (v.findings.length) {
    root.append(h("section", {}, h("h2", {}, ui(lang, "popup.findings")), h("ul", { class: "checks" }, ...v.findings.map((f) => h("li", {}, h("span", { class: f.status === "fixed-verified" ? "mark-pass" : "mark-warn" }, "•"), h("span", {}, `${f.id} ${f.title}: ${f.status}`))))));
  }
  const leaks = h("section", {}, h("h2", {}, ui(lang, "popup.leaks")));
  if (!v.leaks.length) leaks.append(h("p", { class: "muted small" }, ui(lang, "popup.noleaks")));
  for (const l of v.leaks) {
    leaks.append(
      h(
        "div",
        { class: "leak", "data-host": l.host },
        h(
          "div",
          {},
          h("strong", {}, l.host),
          h("span", { class: `tag ${l.blocked ? "low" : l.declared ? "medium" : "high"}` }, l.blocked ? "blocked" : l.declared ? `declared: ${l.purpose ?? ""}` : "NOT declared in the release"),
          h("div", { class: "small" }, `${l.method} · ${l.channel} · ${l.where} · ${l.form} (${l.account}) ×${l.count}`),
        ),
        h("button", { class: "small", onclick: () => void act(l.blocked ? { type: "unblock-host", tabId, host: l.host } : { type: "block-host", tabId, host: l.host }) }, l.blocked ? ui(lang, "popup.unblock") : ui(lang, "popup.block")),
      ),
    );
  }
  if (v.status === "verified") {
    const box = h("input", { type: "checkbox", id: "strict" });
    box.checked = v.strict;
    box.addEventListener("change", () => void act({ type: "set-strict", tabId, strict: box.checked }));
    leaks.append(h("label", { class: "small", style: "display:flex;gap:6px;align-items:center;margin-top:8px" }, box, ui(lang, "popup.strict")));
  }
  leaks.append(h("details", {}, h("summary", { class: "small muted" }, ui(lang, "popup.blind")), h("ul", { class: "small" }, ...MV3_BLIND_SPOTS.map((s) => h("li", {}, s)))));
  root.append(leaks);
  root.append(privacyPanel(v));
}

async function act(msg: object): Promise<void> {
  view = (await chrome.runtime.sendMessage(msg)) as TabView;
  render();
}

langSelect.addEventListener("change", async () => {
  lang = langSelect.value as Lang;
  await saveSettings({ ...(await loadSettings()), language: lang });
  render();
});
document.getElementById("reverify")!.addEventListener("click", (e) => {
  e.preventDefault();
  void act({ type: "reverify", tabId });
});
document.getElementById("dashboard")!.addEventListener("click", async (e) => {
  e.preventDefault();
  await chrome.tabs.create({ url: (await loadSettings()).dashboardUrl });
});

void (async () => {
  lang = (await loadSettings()).language;
  langSelect.value = lang;
  const forced = Number(new URLSearchParams(location.search).get("tab") ?? "NaN");
  const [tab] = Number.isFinite(forced) ? [{ id: forced }] : await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? -1;
  view = tabId >= 0 ? ((await chrome.runtime.sendMessage({ type: "tab-view", tabId })) as TabView) : null;
  render();
  // Keep the popup current while verification finishes or leaks arrive.
  setInterval(async () => {
    if (tabId < 0) return;
    view = (await chrome.runtime.sendMessage({ type: "tab-view", tabId })) as TabView;
    render();
  }, 1500);
})();

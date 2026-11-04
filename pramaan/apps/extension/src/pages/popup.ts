import type { Lang } from "@pramaan/decoder";
import type { TabView } from "../shared/messages.js";
import { loadSettings, saveSettings } from "../shared/settings.js";
import { ui } from "../shared/ui-i18n.js";
import { clear, h, put, short } from "./dom.js";

const root = document.getElementById("root")!;
const langSelect = document.getElementById("lang") as HTMLSelectElement;
let lang: Lang = "en";
let tabId = -1;
let view: TabView | null = null;

const MARK = { pass: "✓", fail: "✗", warn: "!", skip: "–" } as const;

function statusColor(v: TabView): string {
  if (v.status === "checking" || v.status === "idle") return "neutral";
  if (v.status === "missing") return "amber";
  return v.color;
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
      h("div", {}, h("h1", {}, ui(lang, `popup.${v.status}`)), h("p", {}, sub), v.site ? h("p", {}, v.site.summary) : null),
    ),
  );
  if (v.checks.length) {
    root.append(
      h(
        "section",
        {},
        h("h2", {}, ui(lang, "popup.checks")),
        h("ul", { class: "checks" }, ...v.checks.map((c) => h("li", {}, h("span", { class: `mark-${c.status}` }, MARK[c.status]), h("span", {}, c.detail)))),
      ),
    );
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
    root.append(
      h("section", {}, h("h2", {}, ui(lang, "popup.contracts")), h("dl", { class: "kv" }, ...v.contracts.flatMap((c) => [h("dt", {}, c.label), h("dd", {}, `${short(c.address)}${c.proxy ? ` (${c.proxy})` : ""} · chain ${c.chainId}`)]))),
    );
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
        { class: "leak" },
        h("span", {}, h("span", { class: `dot ${l.blocked ? "green" : l.declared ? "amber" : "red"}`, style: "display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px" }), `${l.host}: ${l.form} in ${l.channel} (${l.declared ? "declared" : "NOT declared"}${l.blocked ? ", blocked" : ""}) ×${l.count}`),
        h("button", { class: "small", onclick: () => void act(l.blocked ? { type: "unblock-host", tabId, origin: l.origin } : { type: "block-host", tabId, origin: l.origin }) }, l.blocked ? ui(lang, "popup.unblock") : ui(lang, "popup.block")),
      ),
    );
  }
  if (v.status === "verified") {
    const box = h("input", { type: "checkbox", id: "strict" });
    box.checked = v.strict;
    box.addEventListener("change", () => void act({ type: "set-strict", tabId, strict: box.checked }));
    leaks.append(h("label", { class: "small", style: "display:flex;gap:6px;align-items:center;margin-top:8px" }, box, ui(lang, "popup.strict")));
  }
  root.append(leaks);
  root.append(h("p", { class: "muted small" }, `${ui(lang, "popup.transport")}: ${v.transport}${v.singleSource ? " · single RPC" : ""}`));
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
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? -1;
  view = tabId >= 0 ? ((await chrome.runtime.sendMessage({ type: "tab-view", tabId })) as TabView) : null;
  render();
  // Keep the popup current while verification finishes.
  const timer = setInterval(async () => {
    if (tabId < 0) return;
    view = (await chrome.runtime.sendMessage({ type: "tab-view", tabId })) as TabView;
    render();
    if (view.status !== "checking") clearInterval(timer);
  }, 1500);
})();

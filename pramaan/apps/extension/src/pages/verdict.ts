import type { Lang } from "@pramaan/decoder";
import type { PendingView } from "../shared/messages.js";
import { loadSettings, saveSettings } from "../shared/settings.js";
import { ui, verifyText } from "../shared/ui-i18n.js";
import { clear, h, put } from "./dom.js";

const id = new URLSearchParams(location.search).get("id") ?? "";
const root = document.getElementById("root")!;
const langSelect = document.getElementById("lang") as HTMLSelectElement;
const btnReject = document.getElementById("reject") as HTMLButtonElement;
const btnContinue = document.getElementById("continue") as HTMLButtonElement;
let pending: PendingView | null = null;
let lang: Lang = "en";
let showEnglish = false;

const ROW_LABEL: Record<string, string> = { site: "row.site", contract: "row.contract", action: "row.action", privacy: "row.privacy" };

function rowText(row: PendingView["rows"][number]): string {
  if (row.id === "action" && pending?.explanations) return pending.explanations[lang].headline;
  return verifyText(lang, row.key, row.params);
}

function render(): void {
  clear(root);
  document.documentElement.lang = lang;
  document.getElementById("title")!.textContent = ui(lang, "title.review");
  btnReject.textContent = ui(lang, "btn.reject");
  btnContinue.textContent = ui(lang, "btn.continue");
  if (!pending || !pending.explanations || pending.state !== "ready") {
    root.append(h("p", { class: "muted" }, "This request is no longer pending."));
    btnContinue.disabled = true;
    return;
  }
  const ex = pending.explanations[lang];
  const en = pending.explanations.en;
  btnContinue.disabled = pending.blocked;
  put(
    root,
    pending.blocked ? h("div", { class: "banner" }, ui(lang, "blocked")) : null,
    h("p", { class: "muted small" }, `${pending.origin} → ${pending.method}${pending.chainId ? ` (chain ${pending.chainId})` : ""}`),
    h("div", { class: "headline" }, ex.headline),
    lang !== "en" && showEnglish ? h("p", { class: "muted" }, `EN: ${en.headline}`) : null,
    ...ex.risks.map((r, i) =>
      h(
        "div",
        { class: `risk ${r.level}` },
        h("span", { class: `tag ${r.level}` }, ui(lang, `risk.${r.level}`)),
        r.text,
        lang !== "en" && showEnglish ? h("div", { class: "muted small" }, `EN: ${en.risks[i]?.text ?? ""}`) : null,
      ),
    ),
    ex.details.length ? h("section", {}, h("h2", {}, ui(lang, "decoded.details")), h("ul", { class: "checks" }, ...ex.details.map((d) => h("li", {}, h("span", {}, "·"), h("span", {}, d))))) : null,
    pending.descriptorIntent ? h("p", { class: "small muted" }, `${ui(lang, "descriptor")}: ${pending.descriptorIntent}`) : null,
    h(
      "section",
      {},
      ...pending.rows.map((row) =>
        h(
          "div",
          { class: `row ${row.color}` },
          h("span", { class: `dot ${row.color}` }),
          h("div", {}, h("strong", {}, ui(lang, ROW_LABEL[row.id] ?? row.id)), h("div", { class: "text" }, rowText(row)), row.detail && row.id !== "action" ? h("div", { class: "sub" }, row.detail) : null),
        ),
      ),
    ),
    lang !== "en" ? h("button", { class: "small", onclick: () => ((showEnglish = !showEnglish), render()) }, ui(lang, "btn.english")) : null,
    h("details", {}, h("summary", { class: "small muted" }, ui(lang, "decoded.raw")), h("pre", {}, pending.raw)),
    h("p", { class: "muted small" }, ui(lang, "never.safe")),
  );
}

async function decide(decision: "continue" | "reject"): Promise<void> {
  btnReject.disabled = true;
  btnContinue.disabled = true;
  await chrome.runtime.sendMessage({ type: "decide", id, decision });
  window.close();
}

btnReject.addEventListener("click", () => void decide("reject"));
btnContinue.addEventListener("click", () => {
  if (!pending?.blocked) void decide("continue");
});
langSelect.addEventListener("change", async () => {
  lang = langSelect.value as Lang;
  const s = await loadSettings();
  await saveSettings({ ...s, language: lang });
  render();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") void decide("reject");
});

void (async () => {
  lang = (await loadSettings()).language;
  langSelect.value = lang;
  pending = (await chrome.runtime.sendMessage({ type: "pending", id })) as PendingView | null;
  render();
})();

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
let overrideAck = false;

const ROW_LABEL: Record<string, string> = { site: "row.site", contract: "row.contract", action: "row.action", privacy: "row.privacy" };
const PATH_LABEL: Record<string, string> = { "anon-rpc": "Anon-RPC", direct: "direct", "direct-local": "direct (local chain)", "direct-fallback": "direct (fallback)" };

function rowText(row: PendingView["rows"][number]): string {
  if (row.id === "action" && pending?.explanations) return pending.explanations[lang].headline;
  return verifyText(lang, row.key, row.params);
}

function render(): void {
  clear(root);
  document.documentElement.lang = lang;
  document.getElementById("title")!.textContent = ui(lang, "title.review");
  btnReject.textContent = ui(lang, "btn.reject");
  if (!pending) {
    root.append(h("p", { class: "muted" }, ui(lang, "verdict.gone")));
    btnContinue.disabled = true;
    btnContinue.textContent = ui(lang, "btn.continue");
    return;
  }
  if (pending.state === "interrupted") {
    root.append(h("div", { class: "banner" }, ui(lang, "verdict.interrupted")));
    btnContinue.disabled = true;
    btnContinue.textContent = ui(lang, "btn.continue");
    return;
  }
  const ex = pending.explanations?.[lang] ?? null;
  const en = pending.explanations?.en ?? null;
  const checking = pending.state === "checking";
  btnContinue.textContent = pending.blocked ? ui(lang, "btn.override") : ui(lang, "btn.continue");
  btnContinue.classList.toggle("danger", pending.blocked);
  btnContinue.disabled = pending.blocked && !overrideAck;
  const ack = h("input", { type: "checkbox", id: "override-ack" });
  ack.checked = overrideAck;
  ack.addEventListener("change", () => {
    overrideAck = ack.checked;
    render();
  });
  put(
    root,
    checking ? h("div", { class: "banner amber" }, ui(lang, "verdict.checking")) : null,
    !checking && pending.blocked ? h("div", { class: "banner" }, ui(lang, "blocked")) : null,
    pending.blocked ? h("label", { class: "override small" }, ack, ui(lang, "verdict.override-ack")) : null,
    h("p", { class: "muted small" }, `${pending.origin} → ${pending.method}${pending.chainId ? ` (chain ${pending.chainId})` : ""}`),
    ex ? h("div", { class: "headline" }, ex.headline) : null,
    ex && lang !== "en" && showEnglish && en ? h("p", { class: "muted" }, `EN: ${en.headline}`) : null,
    ...(ex?.risks ?? []).map((r, i) =>
      h(
        "div",
        { class: `risk ${r.level}` },
        h("span", { class: `tag ${r.level}` }, ui(lang, `risk.${r.level}`)),
        r.text,
        lang !== "en" && showEnglish ? h("div", { class: "muted small" }, `EN: ${en?.risks[i]?.text ?? ""}`) : null,
      ),
    ),
    ex?.details.length ? h("section", {}, h("h2", {}, ui(lang, "decoded.details")), h("ul", { class: "checks" }, ...ex.details.map((d) => h("li", {}, h("span", {}, "·"), h("span", {}, d))))) : null,
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
    pending.reads.length
      ? h("details", {}, h("summary", { class: "small muted" }, `${ui(lang, "popup.transport")} (${pending.reads.length})`), h("ul", { class: "checks small" }, ...pending.reads.map((r) => h("li", {}, h("span", {}, PATH_LABEL[r.path] ?? r.path), h("span", {}, `${r.what} · ${r.endpoint}${r.note ? ` · ${r.note}` : ""}`)))))
      : null,
    lang !== "en" ? h("button", { class: "small", onclick: () => ((showEnglish = !showEnglish), render()) }, ui(lang, "btn.english")) : null,
    h("details", {}, h("summary", { class: "small muted" }, ui(lang, "decoded.raw")), h("pre", {}, pending.raw)),
    h("p", { class: "muted small" }, ui(lang, "never.safe")),
  );
}

async function decide(decision: "continue" | "reject"): Promise<void> {
  btnReject.disabled = true;
  btnContinue.disabled = true;
  await chrome.runtime.sendMessage({ type: "decide", id, decision, override: decision === "continue" && !!pending?.blocked && overrideAck });
  window.close();
}

btnReject.addEventListener("click", () => void decide("reject"));
btnContinue.addEventListener("click", () => {
  if (!pending || pending.state === "interrupted") return;
  if (pending.blocked && !overrideAck) return;
  void decide("continue");
});
langSelect.addEventListener("change", async () => {
  lang = langSelect.value as Lang;
  await saveSettings({ ...(await loadSettings()), language: lang });
  render();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") void decide("reject");
});
// Live updates: the background rewrites the pending entry when verification finishes (or Pramaan restarts).
chrome.storage.onChanged.addListener((changes, area) => {
  const c = changes[`pending:${id}`];
  if (area !== "session" || !c) return;
  pending = (c.newValue as PendingView | undefined) ?? null;
  render();
});

void (async () => {
  lang = (await loadSettings()).language;
  langSelect.value = lang;
  pending = (await chrome.runtime.sendMessage({ type: "pending", id })) as PendingView | null;
  render();
})();

import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from "../shared/settings.js";
import { clear, h } from "./dom.js";

const root = document.getElementById("root")!;

function urls(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//.test(s));
}

async function render(): Promise<void> {
  const s = await loadSettings();
  clear(root);
  const status = h("p", { class: "muted small" });
  const lang = h("select", {}, h("option", { value: "en" }, "English"), h("option", { value: "hi" }, "हिन्दी"), h("option", { value: "mr" }, "मराठी"));
  lang.value = s.language;
  const chainFields = Object.entries(s.chains).map(([id, c]) => {
    const area = h("textarea", { "data-chain": id });
    area.value = c.rpcUrls.join("\n");
    const anon = h("input", { type: "checkbox", "data-anon": id });
    anon.checked = c.anonRpc;
    return h(
      "div",
      { class: "field" },
      h("label", {}, `${c.label} (chain ${id}) RPC endpoints, one per line${c.local ? " (local development chain: one RPC is accepted)" : " (two independent providers must agree)"}`),
      area,
      h("label", { style: "display:flex;gap:6px;align-items:center" }, anon, "Route verification reads through Anon-RPC (Nox mixnet; Sepolia only today)"),
    );
  });
  const gateways = h("textarea", {});
  gateways.value = s.ipfsGateways.join("\n");
  const strict = h("input", { type: "checkbox" });
  strict.checked = s.strictPrivacy;
  const dashboard = h("input", { type: "url", value: s.dashboardUrl });
  const fallback = h("input", { type: "checkbox" });
  fallback.checked = s.anonRpcFallback;

  root.append(
    h("p", { class: "muted" }, "Pramaan reads ENS records and contract code directly from these RPC endpoints. It never sends your browsing to a Pramaan server."),
    h("div", { class: "field" }, h("label", {}, "Language"), lang),
    ...chainFields,
    h("div", { class: "field" }, h("label", {}, "IPFS gateways used to fetch release manifests (bytes are checked against the ENS pointer)"), gateways),
    h("label", { style: "display:flex;gap:6px;align-items:center;margin:10px 0" }, strict, "Block undeclared third parties on every site with a verified release"),
    h(
      "label",
      { style: "display:flex;gap:6px;align-items:center;margin:10px 0" },
      fallback,
      "If Anon-RPC is unavailable, read directly from the RPC (it then sees your IP; shown in the Privacy panel). Unticked: the check shows \"couldn't check\" instead.",
    ),
    h("div", { class: "field" }, h("label", {}, "Developer dashboard URL"), dashboard),
    h(
      "div",
      { style: "display:flex;gap:8px;margin-top:12px" },
      h(
        "button",
        {
          onclick: async () => {
            const next: Settings = { ...s, language: lang.value as Settings["language"], ipfsGateways: urls(gateways.value), strictPrivacy: strict.checked, anonRpcFallback: fallback.checked, dashboardUrl: dashboard.value };
            next.chains = { ...s.chains };
            for (const area of root.querySelectorAll<HTMLTextAreaElement>("textarea[data-chain]")) {
              const id = area.dataset["chain"]!;
              const anonBox = root.querySelector<HTMLInputElement>(`input[data-anon="${id}"]`);
              next.chains[id] = { ...s.chains[id]!, rpcUrls: urls(area.value), anonRpc: !!anonBox?.checked };
            }
            await saveSettings(next);
            status.textContent = "Saved.";
          },
        },
        "Save",
      ),
      h(
        "button",
        {
          onclick: async () => {
            await saveSettings(DEFAULT_SETTINGS);
            await render();
          },
        },
        "Restore defaults",
      ),
      h(
        "button",
        {
          onclick: async () => {
            await chrome.storage.local.remove("pins");
            status.textContent = "First-seen ENS bindings cleared.";
          },
        },
        "Reset first-seen site bindings",
      ),
    ),
    status,
  );
}

void render();

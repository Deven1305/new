import { getConfig, type Hex } from "../lib/config";
import { short } from "../lib/format";
import { el, copyButton } from "../ui";

export function render(root: HTMLElement): void {
  const container = el("section", { class: "section-contracts card" });
  root.appendChild(container);

  const cfg = getConfig();
  const explorer = cfg.explorer;

  const header = el("div", { class: "card-header" },
    el("h2", { class: "card-title" }, "Contract Addresses"),
    el("p", { class: "card-subtitle" }, "Verified smart contracts powering VaultLab on this network.")
  );
  container.appendChild(header);

  const list = el("div", { class: "contract-list" });

  function renderRow(label: string, addr: string | undefined | null) {
    const row = el("div", { class: "contract-row" });
    const nameCol = el("div", { class: "contract-name" }, label);

    const valCol = el("div", { class: "contract-val-group" });
    if (addr && addr.startsWith("0x")) {
      const hexAddr = addr as Hex;
      if (explorer) {
        const link = el("a", {
          href: `${explorer.replace(/\/$/, "")}/address/${hexAddr}`,
          target: "_blank",
          rel: "noreferrer",
          class: "mono contract-link",
          title: hexAddr,
        }, short(hexAddr));
        valCol.appendChild(link);
      } else {
        const span = el("span", { class: "mono contract-addr", title: hexAddr }, short(hexAddr));
        valCol.appendChild(span);
      }
      valCol.appendChild(copyButton(hexAddr, "Copy"));
    } else {
      valCol.appendChild(el("span", { class: "muted" }, "not configured"));
    }

    row.appendChild(nameCol);
    row.appendChild(valCol);
    list.appendChild(row);
  }

  renderRow("Vault (UUPS Proxy)", cfg.contracts["vault"]);
  renderRow(`${cfg.contracts["token"] ? "pUSD Token" : "Token"}`, cfg.contracts["token"]);
  renderRow("Upgrade Timelock", cfg.contracts["upgradeTimelock"]);

  container.appendChild(list);
}


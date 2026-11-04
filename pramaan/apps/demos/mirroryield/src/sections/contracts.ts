import { el, copyButton } from "../ui";
import { getConfig } from "../lib/config";
import { FARM, TOKEN } from "../state";

export function createContractsSection(): HTMLElement {
  const cfg = getConfig();
  const container = el("section", { class: "card contracts-card", "aria-labelledby": "contracts-heading" });

  const heading = el(
    "div",
    { class: "card-header" },
    el("h2", { id: "contracts-heading", class: "card-title" }, "Contract References"),
    el("p", { class: "card-subtitle" }, "Verified on-chain contracts powering MirrorYield.")
  );

  function makeRow(label: string, address: string): HTMLElement {
    const row = el("div", { class: "contract-row" });
    const info = el(
      "div",
      { class: "contract-info" },
      el("span", { class: "contract-label" }, label),
      el("code", { class: "contract-address mono", title: address }, address)
    );

    const actions = el("div", { class: "contract-actions" });
    actions.appendChild(copyButton(address, `Copy ${label} address`));

    if (cfg.explorer) {
      const url = `${cfg.explorer.replace(/\/$/, "")}/address/${address}`;
      actions.appendChild(
        el(
          "a",
          {
            href: url,
            target: "_blank",
            rel: "noreferrer",
            class: "btn-explorer",
            title: `View ${label} on block explorer`,
          },
          "Explorer ↗"
        )
      );
    }

    row.append(info, actions);
    return row;
  }

  const list = el(
    "div",
    { class: "contracts-list" },
    makeRow("Staking Farm", FARM),
    makeRow("pUSD Token", TOKEN)
  );

  const footer = el(
    "div",
    { class: "contracts-footer" },
    el("p", { class: "disclaimer" }, "Test network demo — no real funds.")
  );

  container.append(heading, list, footer);
  return container;
}

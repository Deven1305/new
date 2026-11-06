import { getConfig, type Hex } from "../lib/config";
import { fmt, short } from "../lib/format";
import { state, subscribe } from "../state";
import { el, copyButton } from "../ui";

export function render(root: HTMLElement): void {
  const container = el("section", { class: "section-overview" });
  root.appendChild(container);

  function update() {
    container.textContent = "";
    const cfg = getConfig();
    const upgradeTimelock = cfg.contracts["upgradeTimelock"];

    const isConnected = Boolean(state.session);
    const d = state.data;

    const cards = el("div", { class: "overview-grid" });

    // Total pUSD
    cards.appendChild(
      el("div", { class: "card metric-card" },
        el("div", { class: "metric-label" }, `Total ${state.symbol} deposited`),
        el("div", { class: "metric-value mono" }, `${fmt(d.totalTokenDeposits, state.decimals)} ${state.symbol}`)
      )
    );

    // Total ETH
    cards.appendChild(
      el("div", { class: "card metric-card" },
        el("div", { class: "metric-label" }, "Total ETH deposited"),
        el("div", { class: "metric-value mono" }, `${fmt(d.totalEthDeposits, 18)} ETH`)
      )
    );

    // Your pUSD
    cards.appendChild(
      el("div", { class: "card metric-card" },
        el("div", { class: "metric-label" }, `Your vault ${state.symbol}`),
        el("div", { class: "metric-value mono" },
          isConnected ? `${fmt(d.userTokenVault, state.decimals)} ${state.symbol}` : "—"
        )
      )
    );

    // Your ETH
    cards.appendChild(
      el("div", { class: "card metric-card" },
        el("div", { class: "metric-label" }, "Your vault ETH"),
        el("div", { class: "metric-value mono" },
          isConnected ? `${fmt(d.userEthVault, 18)} ETH` : "—"
        )
      )
    );

    // Vault version
    cards.appendChild(
      el("div", { class: "card metric-card" },
        el("div", { class: "metric-label" }, "Vault version"),
        el("div", { class: "metric-value mono" }, d.vaultVersion)
      )
    );

    // Upgrade authority
    const owner = d.vaultOwner;
    const isTimelocked =
      Boolean(owner && upgradeTimelock && owner.toLowerCase() === upgradeTimelock.toLowerCase());

    const authorityCard = el("div", { class: "card metric-card authority-card" },
      el("div", { class: "metric-label" }, "Upgrade authority"),
      owner
        ? el("div", { class: "authority-body" },
            el("div", { class: "authority-row" },
              el("span", { class: "mono", title: owner }, short(owner)),
              copyButton(owner, "Copy")
            ),
            isTimelocked
              ? el("div", { class: "authority-badge timelock-active" },
                  "Upgrades are timelocked: the owner is a TimelockController"
                )
              : null
          )
        : el("div", { class: "metric-value mono" }, "—")
    );
    cards.appendChild(authorityCard);

    container.appendChild(cards);
  }

  subscribe(update);
  update();
}


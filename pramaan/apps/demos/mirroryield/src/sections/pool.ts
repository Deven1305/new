import { el } from "../ui";
import { fmt, countdown } from "../lib/format";
import { state, subscribe } from "../state";

export function createPoolSection(): HTMLElement {
  const container = el("section", { class: "card pool-card", "aria-labelledby": "pool-heading" });

  const heading = el(
    "div",
    { class: "card-header" },
    el("div", { class: "pool-tag" }, "Active Staking Pool"),
    el("h2", { id: "pool-heading", class: "card-title" }, "pUSD Single-Asset Farm")
  );

  const aprBox = el("div", { class: "apr-box" });
  const metricsGrid = el("div", { class: "metrics-grid" });

  function render() {
    aprBox.replaceChildren();
    metricsGrid.replaceChildren();

    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    let aprDisplay = "—";

    if (state.totalStaked > 0n && state.periodFinish > nowSec && state.rewardRate > 0n) {
      // 31,536,000 seconds in a 365-day year
      const aprPct = Number((state.rewardRate * 31_536_000n * 10_000n) / state.totalStaked) / 100;
      aprDisplay = `${aprPct.toFixed(2)}%`;
    }

    aprBox.appendChild(
      el(
        "div",
        { class: "apr-content" },
        el("div", { class: "apr-label" }, "Current APR"),
        el("div", { class: "apr-value" }, aprDisplay),
        el("div", { class: "apr-caption" }, "variable, from the on-chain reward rate")
      )
    );

    const isPeriodEnded = nowSec >= state.periodFinish;
    const periodText = isPeriodEnded
      ? "Reward period ended"
      : `Reward period ends in ${countdown(state.periodFinish)}`;

    metricsGrid.appendChild(
      el(
        "div",
        { class: "metric-item" },
        el("span", { class: "metric-label" }, "Total Staked"),
        el(
          "span",
          { class: "metric-val mono" },
          `${fmt(state.totalStaked, state.tokenDecimals)} ${state.tokenSymbol}`
        )
      )
    );

    metricsGrid.appendChild(
      el(
        "div",
        { class: "metric-item" },
        el("span", { class: "metric-label" }, "Rewards Remaining"),
        el(
          "span",
          { class: "metric-val mono" },
          `${fmt(state.rewardsRemaining, state.tokenDecimals)} ${state.tokenSymbol}`
        )
      )
    );

    metricsGrid.appendChild(
      el(
        "div",
        { class: "metric-item" },
        el("span", { class: "metric-label" }, "Rewards Paid"),
        el(
          "span",
          { class: "metric-val mono" },
          `${fmt(state.totalRewardsPaid, state.tokenDecimals)} ${state.tokenSymbol}`
        )
      )
    );

    metricsGrid.appendChild(
      el(
        "div",
        { class: "metric-item" },
        el("span", { class: "metric-label" }, "Status"),
        el("span", { class: `metric-val ${isPeriodEnded ? "status-ended" : "status-active"}` }, periodText)
      )
    );
  }

  render();
  subscribe(render);

  // Update countdown display every second
  setInterval(() => {
    if (state.periodFinish > 0n) {
      render();
    }
  }, 1000);

  container.append(heading, aprBox, metricsGrid);
  return container;
}

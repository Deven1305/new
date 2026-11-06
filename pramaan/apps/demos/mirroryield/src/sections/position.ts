import { el } from "../ui";
import { fmt } from "../lib/format";
import { state, getSession, subscribe } from "../state";

export function createPositionSection(): HTMLElement {
  const container = el("section", { class: "card position-card", "aria-labelledby": "position-heading" });

  const heading = el(
    "div",
    { class: "card-header" },
    el("h2", { id: "position-heading", class: "card-title" }, "Your Position")
  );

  const content = el("div", { class: "position-content" });

  function render() {
    content.replaceChildren();
    const session = getSession();

    if (!session) {
      content.appendChild(
        el("div", { class: "not-connected-msg" }, "Connect your wallet to view your staking position and pending rewards.")
      );
      return;
    }

    const grid = el(
      "div",
      { class: "position-grid" },
      el(
        "div",
        { class: "position-box" },
        el("div", { class: "pos-label" }, "Your Staked"),
        el(
          "div",
          { class: "pos-val mono" },
          `${fmt(state.staked, state.tokenDecimals)} ${state.tokenSymbol}`
        )
      ),
      el(
        "div",
        { class: "position-box pos-rewards" },
        el("div", { class: "pos-label" }, "Pending Rewards"),
        el(
          "div",
          { class: "pos-val mono pos-highlight" },
          `${fmt(state.earned, state.tokenDecimals)} ${state.tokenSymbol}`
        ),
        el("div", { class: "pos-subtext" }, "Streams block-by-block")
      ),
      el(
        "div",
        { class: "position-box" },
        el("div", { class: "pos-label" }, "Wallet Balance"),
        el(
          "div",
          { class: "pos-val mono" },
          `${fmt(state.tokenBalance, state.tokenDecimals)} ${state.tokenSymbol}`
        )
      )
    );

    content.appendChild(grid);
  }

  render();
  subscribe(render);

  container.append(heading, content);
  return container;
}

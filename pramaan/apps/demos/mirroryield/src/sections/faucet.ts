import { el, statusLine, toast, txLinkNode } from "../ui";
import { countdown } from "../lib/format";
import { sendTx, type TxUi } from "../lib/tx";
import { tokenAbi } from "../abi";
import { TOKEN, state, getSession, refresh, subscribe } from "../state";

export function createFaucetSection(): HTMLElement {
  const container = el("section", { class: "card faucet-card", "aria-labelledby": "faucet-heading" });

  const heading = el(
    "div",
    { class: "card-header" },
    el("h2", { id: "faucet-heading", class: "card-title" }, "pUSD Testnet Faucet"),
    el(
      "p",
      { class: "card-subtitle" },
      `Claim 1,000 test ${state.tokenSymbol} once per hour for testing staking actions.`
    )
  );

  const status = statusLine();
  const txBox = el("div", { class: "tx-link-container" });

  const txUi: TxUi = {
    status(text, kind) {
      status.set(text, kind);
      if (kind === "error" || kind === "ok") {
        toast(text, kind);
      }
    },
    link(hash) {
      txBox.replaceChildren(txLinkNode(hash));
    },
  };

  const btnContainer = el("div", { class: "faucet-btn-container" });
  let isBusy = false;

  async function handleClaimFaucet() {
    const session = getSession();
    if (!session) return;
    isBusy = true;
    renderButton();
    try {
      const ok = await sendTx(
        `Claim 1,000 ${state.tokenSymbol}`,
        () =>
          session.wallet.writeContract({
            account: session.address,
            chain: null,
            address: TOKEN,
            abi: tokenAbi,
            functionName: "faucet",
            args: [],
          }),
        txUi
      );
      if (ok) {
        await refresh();
      }
    } finally {
      isBusy = false;
      renderButton();
    }
  }

  function renderButton() {
    btnContainer.replaceChildren();
    const session = getSession();

    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const nextAvailable = state.lastFaucetAt + state.faucetCooldown;
    const isCoolingDown = Boolean(session && state.lastFaucetAt > 0n && nextAvailable > nowSec);

    let btnText = `Get 1,000 ${state.tokenSymbol}`;
    let isDisabled = isBusy || !session;
    let title: string | undefined = undefined;

    if (!session) {
      title = "Connect your wallet first";
    } else if (isCoolingDown) {
      isDisabled = true;
      btnText = `Available in ${countdown(nextAvailable)}`;
      title = "The faucet can be used once per hour per address";
    }

    const btn = el(
      "button",
      {
        type: "button",
        class: "btn btn-primary",
        disabled: isDisabled,
        title,
        onClick: handleClaimFaucet,
      },
      btnText
    );

    btnContainer.appendChild(btn);
  }

  renderButton();
  subscribe(renderButton);

  // Live countdown update
  setInterval(() => {
    const session = getSession();
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    if (session && state.lastFaucetAt > 0n && state.lastFaucetAt + state.faucetCooldown > nowSec) {
      renderButton();
    }
  }, 1000);

  container.append(heading, btnContainer, status.node, txBox);
  return container;
}

import { contract, type Hex } from "../lib/config";
import { countdown } from "../lib/format";
import { sendTx, type TxUi } from "../lib/tx";
import { humanError } from "../lib/errors";
import { state, refresh, subscribe } from "../state";
import { el, toast, statusLine, txLinkNode } from "../ui";
import { tokenAbi } from "../abi";

let isBusy = false;

export function render(root: HTMLElement): void {
  const container = el("section", { class: "section-faucet card" });
  root.appendChild(container);

  const status = statusLine();
  let txContainer: HTMLElement | null = null;

  const txUi: TxUi = {
    status: (text, kind) => {
      status.set(text, kind);
      if (kind === "error") toast(text, "error");
    },
    link: (hash: Hex) => {
      if (txContainer) {
        txContainer.textContent = "Tx: ";
        txContainer.appendChild(txLinkNode(hash));
      }
    },
  };

  function update() {
    container.textContent = "";

    const isConnected = Boolean(state.session);
    const tokenAddr = contract("token");

    const header = el("div", { class: "card-header" },
      el("h2", { class: "card-title" }, "Testnet Faucet"),
      el("p", { class: "card-subtitle" }, `Claim 1,000 test ${state.symbol} once per hour to purchase passes on the marketplace.`)
    );
    container.appendChild(header);

    const nowSec = Math.floor(Date.now() / 1000);
    const cooldownSec = Number(state.data.faucetCooldown || 3600n);
    const lastFaucet = Number(state.data.userLastFaucetAt);
    const nextAvailable = lastFaucet + cooldownSec;
    const isCoolingDown = isConnected && lastFaucet > 0 && nextAvailable > nowSec;

    let buttonText = `Get 1,000 test ${state.symbol}`;
    let isDisabled = isBusy || !isConnected;
    let buttonTitle: string | undefined = undefined;

    if (!isConnected) {
      buttonTitle = "Connect your wallet first";
    } else if (isCoolingDown) {
      isDisabled = true;
      buttonText = `Available in ${countdown(nextAvailable)}`;
    }

    const faucetBtn = el("button", {
      type: "button",
      class: "btn-primary",
      disabled: isDisabled,
      title: buttonTitle,
      onClick: async () => {
        try {
          isBusy = true;
          update();
          const ok = await sendTx(
            `Claim 1,000 ${state.symbol}`,
            () =>
              state.session!.wallet.writeContract({
                account: state.session!.address,
                chain: null,
                address: tokenAddr,
                abi: tokenAbi,
                functionName: "faucet",
              }),
            txUi
          );
          if (ok) await refresh();
        } catch (e) {
          const msg = humanError(e);
          status.set(msg, "error");
          toast(msg, "error");
        } finally {
          isBusy = false;
          update();
        }
      },
    }, buttonText);

    const actionRow = el("div", { class: "faucet-actions" }, faucetBtn);
    container.appendChild(actionRow);

    txContainer = el("div", { class: "tx-container" });
    container.appendChild(txContainer);
    container.appendChild(status.node);
  }

  setInterval(() => {
    if (state.session && state.data.userLastFaucetAt > 0n) {
      const nowSec = Math.floor(Date.now() / 1000);
      const nextAvailable = Number(state.data.userLastFaucetAt + state.data.faucetCooldown);
      if (nextAvailable > nowSec) {
        update();
      }
    }
  }, 1000);

  subscribe(update);
  update();
}


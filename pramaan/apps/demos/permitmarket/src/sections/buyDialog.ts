import { maxUint256, parseSignature } from "viem";
import { contract, getConfig, type Hex } from "../lib/config";
import { fmt, short } from "../lib/format";
import { sendTx, type TxUi } from "../lib/tx";
import { humanError } from "../lib/errors";
import { state, refresh, type ActiveListing } from "../state";
import { passSvg } from "../art";
import { el, toast, statusLine, txLinkNode } from "../ui";
import { marketAbi, tokenAbi } from "../abi";

export function openBuyDialog(listing: ActiveListing): void {
  const existing = document.getElementById("buy-dialog-overlay");
  if (existing) existing.remove();

  const overlay = el("div", { id: "buy-dialog-overlay", class: "modal-overlay", role: "dialog", "aria-modal": "true" });
  const modal = el("div", { class: "modal-card buy-dialog-modal" });

  const header = el("div", { class: "modal-header" },
    el("h3", { class: "modal-title" }, `Purchase Pass #${listing.tokenId}`),
    el("button", {
      type: "button",
      class: "btn-close",
      "aria-label": "Close",
      onClick: () => overlay.remove(),
    }, "✕")
  );

  // Listing Summary
  const summary = el("div", { class: "buy-summary" },
    el("img", { src: passSvg(listing.tokenId), alt: `Pass #${listing.tokenId}`, class: "buy-art-img" }),
    el("div", { class: "buy-info" },
      el("div", { class: "buy-price-row" },
        el("span", { class: "muted" }, "Price:"),
        el("span", { class: "buy-price-val mono" }, `${fmt(listing.price, state.decimals)} ${state.symbol}`)
      ),
      el("div", { class: "buy-seller-row" },
        el("span", { class: "muted" }, "Seller:"),
        el("span", { class: "mono" }, short(listing.seller))
      )
    )
  );

  const optionsContainer = el("div", { class: "payment-options" });

  function closeDialog() {
    overlay.remove();
  }

  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      closeDialog();
      window.removeEventListener("keydown", onKeydown);
    }
  };
  window.addEventListener("keydown", onKeydown);

  function createTxUi(status: ReturnType<typeof statusLine>, txBox: HTMLElement): TxUi {
    return {
      status: (text, kind) => {
        status.set(text, kind);
        if (kind === "error") toast(text, "error");
      },
      link: (hash: Hex) => {
        txBox.textContent = "Tx: ";
        txBox.appendChild(txLinkNode(hash));
      },
    };
  }

  function renderOptions() {
    optionsContainer.textContent = "";

    const userAllowance = state.data.userAllowance;
    const price = listing.price;
    const session = state.session;
    const marketAddr = contract("marketplace");
    const tokenAddr = contract("token");

    // Option 1: Enable one-click buying (recommended)
    {
      const opt1 = el("div", { class: "pay-option card-opt-recommended" });
      const optTitle = el("h4", { class: "opt-title" }, "Enable one-click buying (recommended)");
      const optDesc = el("p", { class: "opt-desc muted" }, "Approve once to buy passes in a single transaction in future.");
      const status1 = statusLine();
      const txBox1 = el("div", { class: "tx-container" });
      const ui1 = createTxUi(status1, txBox1);

      const btnGroup = el("div", { class: "btn-group" });

      if (userAllowance < price) {
        const approveBtn = el("button", {
          type: "button",
          class: "btn-primary btn-full",
          onClick: async () => {
            approveBtn.disabled = true;
            try {
              const ok = await sendTx(
                "Enable one-click buying",
                () =>
                  session!.wallet.writeContract({
                    account: session!.address,
                    chain: null,
                    address: tokenAddr,
                    abi: tokenAbi,
                    functionName: "approve",
                    args: [marketAddr, maxUint256],
                  }),
                ui1
              );
              if (ok) {
                await refresh();
                renderOptions();
              }
            } catch (e) {
              const m = humanError(e);
              status1.set(m, "error");
              toast(m, "error");
            } finally {
              approveBtn.disabled = false;
            }
          },
        }, "1. Enable one-click buying (unlimited approval)");

        const buyDisabled = el("button", {
          type: "button",
          class: "btn-secondary btn-full",
          disabled: true,
          title: "Approve first",
        }, "2. Buy pass");

        btnGroup.appendChild(approveBtn);
        btnGroup.appendChild(buyDisabled);
      } else {
        const buyBtn = el("button", {
          type: "button",
          class: "btn-primary btn-full",
          onClick: async () => {
            buyBtn.disabled = true;
            try {
              const ok = await sendTx(
                "Buy pass",
                () =>
                  session!.wallet.writeContract({
                    account: session!.address,
                    chain: null,
                    address: marketAddr,
                    abi: marketAbi,
                    functionName: "buy",
                    args: [listing.id],
                  }),
                ui1
              );
              if (ok) {
                await refresh();
                closeDialog();
              }
            } catch (e) {
              const m = humanError(e);
              status1.set(m, "error");
              toast(m, "error");
            } finally {
              buyBtn.disabled = false;
            }
          },
        }, "Buy pass");
        btnGroup.appendChild(buyBtn);
      }

      opt1.appendChild(optTitle);
      opt1.appendChild(optDesc);
      opt1.appendChild(btnGroup);
      opt1.appendChild(txBox1);
      opt1.appendChild(status1.node);
      optionsContainer.appendChild(opt1);
    }

    // Option 2: Approve exact amount
    {
      const opt2 = el("div", { class: "pay-option card-opt-standard" });
      const optTitle = el("h4", { class: "opt-title" }, "Approve exact amount");
      const optDesc = el("p", { class: "opt-desc muted" }, `Approve exactly ${fmt(price, state.decimals)} ${state.symbol} for this transaction only.`);
      const status2 = statusLine();
      const txBox2 = el("div", { class: "tx-container" });
      const ui2 = createTxUi(status2, txBox2);

      const btnGroup = el("div", { class: "btn-group" });

      if (userAllowance < price) {
        const approveExactBtn = el("button", {
          type: "button",
          class: "btn-secondary btn-full",
          onClick: async () => {
            approveExactBtn.disabled = true;
            try {
              const ok = await sendTx(
                `Approve ${fmt(price, state.decimals)} ${state.symbol}`,
                () =>
                  session!.wallet.writeContract({
                    account: session!.address,
                    chain: null,
                    address: tokenAddr,
                    abi: tokenAbi,
                    functionName: "approve",
                    args: [marketAddr, price],
                  }),
                ui2
              );
              if (ok) {
                await refresh();
                renderOptions();
              }
            } catch (e) {
              const m = humanError(e);
              status2.set(m, "error");
              toast(m, "error");
            } finally {
              approveExactBtn.disabled = false;
            }
          },
        }, `1. Approve exact ${fmt(price, state.decimals)} ${state.symbol}`);

        const buyDisabled = el("button", {
          type: "button",
          class: "btn-secondary btn-full",
          disabled: true,
          title: "Approve first",
        }, "2. Buy pass");

        btnGroup.appendChild(approveExactBtn);
        btnGroup.appendChild(buyDisabled);
      } else {
        const buyBtn = el("button", {
          type: "button",
          class: "btn-primary btn-full",
          onClick: async () => {
            buyBtn.disabled = true;
            try {
              const ok = await sendTx(
                "Buy pass",
                () =>
                  session!.wallet.writeContract({
                    account: session!.address,
                    chain: null,
                    address: marketAddr,
                    abi: marketAbi,
                    functionName: "buy",
                    args: [listing.id],
                  }),
                ui2
              );
              if (ok) {
                await refresh();
                closeDialog();
              }
            } catch (e) {
              const m = humanError(e);
              status2.set(m, "error");
              toast(m, "error");
            } finally {
              buyBtn.disabled = false;
            }
          },
        }, "Buy pass");
        btnGroup.appendChild(buyBtn);
      }

      opt2.appendChild(optTitle);
      opt2.appendChild(optDesc);
      opt2.appendChild(btnGroup);
      opt2.appendChild(txBox2);
      opt2.appendChild(status2.node);
      optionsContainer.appendChild(opt2);
    }

    // Option 3: Pay with a signature (permit)
    {
      const opt3 = el("div", { class: "pay-option card-opt-standard" });
      const optTitle = el("h4", { class: "opt-title" }, "Pay with a signature (permit)");
      const optDesc = el("p", { class: "opt-desc muted" }, "Gasless EIP-2612 authorization: sign a permit message and execute purchase in one transaction.");
      const status3 = statusLine();
      const txBox3 = el("div", { class: "tx-container" });
      const ui3 = createTxUi(status3, txBox3);

      const permitBtn = el("button", {
        type: "button",
        class: "btn-primary btn-full",
        onClick: async () => {
          permitBtn.disabled = true;
          try {
            status3.set("Preparing permit signature…", "info");
            const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
            const client = session!.wallet;

            const name = state.data.tokenName || "Pramaan Demo USD";
            const nonce = state.data.userNonce;

            status3.set("Sign the permit request in your wallet…", "info");

            const signature = await client.signTypedData({
              account: session!.address,
              domain: {
                name,
                version: "1",
                chainId: getConfig().chainId,
                verifyingContract: tokenAddr,
              },
              types: {
                Permit: [
                  { name: "owner", type: "address" },
                  { name: "spender", type: "address" },
                  { name: "value", type: "uint256" },
                  { name: "nonce", type: "uint256" },
                  { name: "deadline", type: "uint256" },
                ],
              },
              primaryType: "Permit",
              message: {
                owner: session!.address,
                spender: marketAddr,
                value: price,
                nonce,
                deadline,
              },
            });

            const { v, r, s } = parseSignature(signature);

            const ok = await sendTx(
              "Buy with permit",
              () =>
                session!.wallet.writeContract({
                  chain: null,
                  address: marketAddr,
                  abi: marketAbi,
                  functionName: "buyWithPermit",
                  args: [listing.id, deadline, Number(v), r, s],
                  account: session!.address,
                }),
              ui3
            );

            if (ok) {
              await refresh();
              closeDialog();
            }
          } catch (e) {
            const m = humanError(e);
            status3.set(m, "error");
            toast(m, "error");
          } finally {
            permitBtn.disabled = false;
          }
        },
      }, "Sign & Buy with permit");

      opt3.appendChild(optTitle);
      opt3.appendChild(optDesc);
      opt3.appendChild(permitBtn);
      opt3.appendChild(txBox3);
      opt3.appendChild(status3.node);
      optionsContainer.appendChild(opt3);
    }
  }

  renderOptions();

  modal.appendChild(header);
  modal.appendChild(summary);
  modal.appendChild(optionsContainer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

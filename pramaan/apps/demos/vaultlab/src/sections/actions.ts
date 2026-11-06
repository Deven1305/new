import { formatUnits } from "viem";
import { contract, type Hex } from "../lib/config";
import { parseAmount, fmt } from "../lib/format";
import { sendTx, type TxUi } from "../lib/tx";
import { humanError } from "../lib/errors";
import { state, refresh, subscribe } from "../state";
import { el, toast, statusLine, txLinkNode } from "../ui";
import { vaultAbi, tokenAbi } from "../abi";

type Tab = "deposit" | "withdraw";
type Asset = "pUSD" | "ETH";

let activeTab: Tab = "deposit";
let activeAsset: Asset = "pUSD";
let amountInputVal = "";
let isBusy = false;

export function render(root: HTMLElement): void {
  const container = el("section", { class: "section-actions card" });
  root.appendChild(container);

  const status = statusLine();
  let txContainer: HTMLElement | null = null;

  function setBusy(busy: boolean) {
    isBusy = busy;
    update();
  }

  const txUi: TxUi = {
    status: (text, kind) => {
      status.set(text, kind);
      if (kind === "error") {
        toast(text, "error");
      }
    },
    link: (hash: Hex) => {
      if (txContainer) {
        txContainer.textContent = "Tx: ";
        txContainer.appendChild(txLinkNode(hash));
      }
    },
  };

  function getMaxAmount(): string {
    const d = state.data;
    if (activeTab === "deposit") {
      if (activeAsset === "pUSD") {
        return formatUnits(d.userTokenWallet, state.decimals);
      } else {
        const gasBuffer = 10000000000000000n; // 0.01 ETH
        const maxEth = d.userEthWallet > gasBuffer ? d.userEthWallet - gasBuffer : 0n;
        return formatUnits(maxEth, 18);
      }
    } else {
      if (activeAsset === "pUSD") {
        return formatUnits(d.userTokenVault, state.decimals);
      } else {
        return formatUnits(d.userEthVault, 18);
      }
    }
  }

  function update() {
    container.textContent = "";

    const isConnected = Boolean(state.session);
    const notConnectedTitle = "Connect your wallet first";

    // Header with Tabs
    const header = el("div", { class: "actions-header" });
    const tabGroup = el("div", { class: "tab-group", role: "tablist" },
      el("button", {
        type: "button",
        role: "tab",
        "aria-selected": activeTab === "deposit",
        class: `tab-btn ${activeTab === "deposit" ? "tab-active" : ""}`,
        disabled: isBusy,
        onClick: () => {
          activeTab = "deposit";
          status.clear();
          if (txContainer) txContainer.textContent = "";
          update();
        },
      }, "Deposit"),
      el("button", {
        type: "button",
        role: "tab",
        "aria-selected": activeTab === "withdraw",
        class: `tab-btn ${activeTab === "withdraw" ? "tab-active" : ""}`,
        disabled: isBusy,
        onClick: () => {
          activeTab = "withdraw";
          status.clear();
          if (txContainer) txContainer.textContent = "";
          update();
        },
      }, "Withdraw")
    );
    header.appendChild(tabGroup);

    // Asset Toggle
    const assetGroup = el("div", { class: "asset-group", role: "radiogroup", "aria-label": "Asset" },
      el("button", {
        type: "button",
        class: `asset-btn ${activeAsset === "pUSD" ? "asset-active" : ""}`,
        disabled: isBusy,
        onClick: () => {
          activeAsset = "pUSD";
          status.clear();
          if (txContainer) txContainer.textContent = "";
          update();
        },
      }, state.symbol),
      el("button", {
        type: "button",
        class: `asset-btn ${activeAsset === "ETH" ? "asset-active" : ""}`,
        disabled: isBusy,
        onClick: () => {
          activeAsset = "ETH";
          status.clear();
          if (txContainer) txContainer.textContent = "";
          update();
        },
      }, "ETH")
    );
    header.appendChild(assetGroup);
    container.appendChild(header);

    // Amount input field with Max button
    const formGroup = el("div", { class: "form-group" });
    const labelRow = el("div", { class: "label-row" });
    const label = el("label", { for: "action-amount-input" }, `${activeTab === "deposit" ? "Deposit" : "Withdraw"} amount`);
    
    // Balance info
    let balanceHint = "—";
    if (isConnected) {
      if (activeTab === "deposit") {
        balanceHint = activeAsset === "pUSD"
          ? `Wallet: ${fmt(state.data.userTokenWallet, state.decimals)} ${state.symbol}`
          : `Wallet: ${fmt(state.data.userEthWallet, 18)} ETH`;
      } else {
        balanceHint = activeAsset === "pUSD"
          ? `Vault: ${fmt(state.data.userTokenVault, state.decimals)} ${state.symbol}`
          : `Vault: ${fmt(state.data.userEthVault, 18)} ETH`;
      }
    }
    const balanceSpan = el("span", { class: "balance-hint mono" }, balanceHint);
    labelRow.appendChild(label);
    labelRow.appendChild(balanceSpan);
    formGroup.appendChild(labelRow);

    const inputRow = el("div", { class: "input-row" });
    const input = el("input", {
      id: "action-amount-input",
      type: "text",
      inputmode: "decimal",
      class: "amount-input mono",
      placeholder: "0.0",
      value: amountInputVal,
      disabled: isBusy,
      onInput: (e: Event) => {
        amountInputVal = (e.target as HTMLInputElement).value;
        renderButtons();
      },
    }) as HTMLInputElement;

    const maxBtn = el("button", {
      type: "button",
      class: "btn-max",
      disabled: isBusy || !isConnected,
      title: !isConnected ? notConnectedTitle : undefined,
      onClick: () => {
        amountInputVal = getMaxAmount();
        input.value = amountInputVal;
        renderButtons();
      },
    }, "Max");

    inputRow.appendChild(input);
    inputRow.appendChild(maxBtn);
    formGroup.appendChild(inputRow);
    container.appendChild(formGroup);

    // Buttons Container
    const buttonBox = el("div", { class: "button-box" });
    container.appendChild(buttonBox);

    // Tx Link container
    txContainer = el("div", { class: "tx-container" });
    container.appendChild(txContainer);

    // Status Line
    container.appendChild(status.node);

    function getParsedAmount(): bigint | null {
      const decimals = activeAsset === "pUSD" ? state.decimals : 18;
      try {
        return parseAmount(amountInputVal, decimals);
      } catch {
        return null;
      }
    }

    function renderButtons() {
      buttonBox.textContent = "";

      if (!isConnected) {
        const dummyBtn = el("button", {
          type: "button",
          class: "btn-primary btn-full",
          disabled: true,
          title: notConnectedTitle,
        }, activeTab === "deposit" ? "Deposit" : "Withdraw");
        buttonBox.appendChild(dummyBtn);
        return;
      }

      const decimals = activeAsset === "pUSD" ? state.decimals : 18;
      let parsedAmount: bigint;
      try {
        parsedAmount = parseAmount(amountInputVal || "0", decimals);
      } catch {
        parsedAmount = 0n;
      }

      const vaultAddr = contract("vault");
      const tokenAddr = contract("token");

      if (activeTab === "deposit") {
        if (activeAsset === "pUSD") {
          const needsApproval = parsedAmount > 0n && state.data.allowance < parsedAmount;

          if (needsApproval) {
            // Step 1: Approve exact amount
            const approveBtn = el("button", {
              type: "button",
              class: "btn-primary btn-full",
              disabled: isBusy || parsedAmount <= 0n,
              onClick: async () => {
                try {
                  const amt = parseAmount(amountInputVal, state.decimals);
                  setBusy(true);
                  const ok = await sendTx(
                    `Approve ${fmt(amt, state.decimals)} ${state.symbol}`,
                    () =>
                      state.session!.wallet.writeContract({
                        account: state.session!.address,
                        chain: null,
                        address: tokenAddr,
                        abi: tokenAbi,
                        functionName: "approve",
                        args: [vaultAddr, amt],
                      }),
                    txUi
                  );
                  if (ok) {
                    await refresh();
                  }
                } catch (e) {
                  const msg = humanError(e);
                  status.set(msg, "error");
                  toast(msg, "error");
                } finally {
                  setBusy(false);
                }
              },
            }, `1. Approve exactly ${amountInputVal ? amountInputVal.trim() : "N"} ${state.symbol}`);

            const depositDisabledBtn = el("button", {
              type: "button",
              class: "btn-secondary btn-full",
              disabled: true,
              title: "Approve the vault first",
            }, `2. Deposit ${state.symbol}`);

            buttonBox.appendChild(approveBtn);
            buttonBox.appendChild(depositDisabledBtn);
          } else {
            // Direct deposit
            const depositBtn = el("button", {
              type: "button",
              class: "btn-primary btn-full",
              disabled: isBusy || parsedAmount <= 0n,
              onClick: async () => {
                try {
                  const amt = parseAmount(amountInputVal, state.decimals);
                  setBusy(true);
                  const ok = await sendTx(
                    `Deposit ${fmt(amt, state.decimals)} ${state.symbol}`,
                    () =>
                      state.session!.wallet.writeContract({
                        account: state.session!.address,
                        chain: null,
                        address: vaultAddr,
                        abi: vaultAbi,
                        functionName: "depositToken",
                        args: [amt],
                      }),
                    txUi
                  );
                  if (ok) {
                    amountInputVal = "";
                    await refresh();
                  }
                } catch (e) {
                  const msg = humanError(e);
                  status.set(msg, "error");
                  toast(msg, "error");
                } finally {
                  setBusy(false);
                }
              },
            }, `Deposit ${state.symbol}`);
            buttonBox.appendChild(depositBtn);
          }
        } else {
          // Deposit ETH
          const depositEthBtn = el("button", {
            type: "button",
            class: "btn-primary btn-full",
            disabled: isBusy || parsedAmount <= 0n,
            onClick: async () => {
              try {
                const amt = parseAmount(amountInputVal, 18);
                setBusy(true);
                const ok = await sendTx(
                  `Deposit ${fmt(amt, 18)} ETH`,
                  () =>
                    state.session!.wallet.writeContract({
                      account: state.session!.address,
                      chain: null,
                      address: vaultAddr,
                      abi: vaultAbi,
                      functionName: "deposit",
                      value: amt,
                    }),
                  txUi
                );
                if (ok) {
                  amountInputVal = "";
                  await refresh();
                }
              } catch (e) {
                const msg = humanError(e);
                status.set(msg, "error");
                toast(msg, "error");
              } finally {
                setBusy(false);
              }
            },
          }, "Deposit ETH");
          buttonBox.appendChild(depositEthBtn);
        }
      } else {
        // Withdraw Tab
        if (activeAsset === "pUSD") {
          const withdrawBtn = el("button", {
            type: "button",
            class: "btn-primary btn-full",
            disabled: isBusy || parsedAmount <= 0n,
            onClick: async () => {
              try {
                const amt = parseAmount(amountInputVal, state.decimals);
                setBusy(true);
                const ok = await sendTx(
                  `Withdraw ${fmt(amt, state.decimals)} ${state.symbol}`,
                  () =>
                    state.session!.wallet.writeContract({
                      account: state.session!.address,
                      chain: null,
                      address: vaultAddr,
                      abi: vaultAbi,
                      functionName: "withdrawToken",
                      args: [amt],
                    }),
                  txUi
                );
                if (ok) {
                  amountInputVal = "";
                  await refresh();
                }
              } catch (e) {
                const msg = humanError(e);
                status.set(msg, "error");
                toast(msg, "error");
              } finally {
                setBusy(false);
              }
            },
          }, `Withdraw ${state.symbol}`);
          buttonBox.appendChild(withdrawBtn);
        } else {
          // Withdraw ETH
          const withdrawEthBtn = el("button", {
            type: "button",
            class: "btn-primary btn-full",
            disabled: isBusy || parsedAmount <= 0n,
            onClick: async () => {
              try {
                const amt = parseAmount(amountInputVal, 18);
                setBusy(true);
                const ok = await sendTx(
                  `Withdraw ${fmt(amt, 18)} ETH`,
                  () =>
                    state.session!.wallet.writeContract({
                      account: state.session!.address,
                      chain: null,
                      address: vaultAddr,
                      abi: vaultAbi,
                      functionName: "withdraw",
                      args: [amt],
                    }),
                  txUi
                );
                if (ok) {
                  amountInputVal = "";
                  await refresh();
                }
              } catch (e) {
                const msg = humanError(e);
                status.set(msg, "error");
                toast(msg, "error");
              } finally {
                setBusy(false);
              }
            },
          }, "Withdraw ETH");
          buttonBox.appendChild(withdrawEthBtn);
        }
      }
    }

    renderButtons();
  }

  subscribe(update);
  update();
}

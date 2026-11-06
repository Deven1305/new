import { contract, type Hex } from "../lib/config";
import { parseAmount, fmt } from "../lib/format";
import { sendTx, type TxUi } from "../lib/tx";
import { humanError } from "../lib/errors";
import { state, refresh, subscribe } from "../state";
import { passSvg } from "../art";
import { el, toast, statusLine, txLinkNode } from "../ui";
import { nftAbi, marketAbi } from "../abi";

export function render(root: HTMLElement): void {
  const container = el("section", { class: "section-my-items" });
  root.appendChild(container);

  const status = statusLine();
  const txContainer = el("div", { class: "tx-container" });

  const txUi: TxUi = {
    status: (text, kind) => {
      status.set(text, kind);
      if (kind === "error") toast(text, "error");
    },
    link: (hash: Hex) => {
      txContainer.textContent = "Tx: ";
      txContainer.appendChild(txLinkNode(hash));
    },
  };

  function update() {
    container.textContent = "";

    const header = el("div", { class: "section-header" },
      el("h2", { class: "section-title" }, "My Items"),
      el("p", { class: "section-subtitle muted" }, "Mint free collectible passes and list them on the marketplace.")
    );
    container.appendChild(header);

    if (!state.session) {
      const card = el("div", { class: "card empty-card" },
        el("p", { class: "muted" }, "Connect your wallet to view and manage your passes.")
      );
      container.appendChild(card);
      return;
    }

    const session = state.session;
    const nftAddr = contract("nft");
    const marketAddr = contract("marketplace");

    // Mint controls card
    const mintCard = el("div", { class: "card mint-card" });
    const mintInfo = el("div", { class: "mint-info" },
      el("div", { class: "mint-title" }, "Free Demo Pass Minter"),
      el("div", { class: "mint-count muted" },
        `Minted: ${state.data.userMintedCount} / ${state.data.maxPerAccount} max passes per account`
      )
    );

    const isMintLimitReached = state.data.userMintedCount >= state.data.maxPerAccount;
    const mintBtn = el("button", {
      type: "button",
      class: "btn-primary",
      disabled: isMintLimitReached,
      title: isMintLimitReached ? "You've minted the maximum of 5 passes" : undefined,
      onClick: async () => {
        mintBtn.disabled = true;
        try {
          const ok = await sendTx(
            "Mint Demo Pass",
            () =>
              session.wallet.writeContract({
                account: session.address,
                chain: null,
                address: nftAddr,
                abi: nftAbi,
                functionName: "mint",
              }),
            txUi
          );
          if (ok) await refresh();
        } catch (e) {
          const m = humanError(e);
          status.set(m, "error");
          toast(m, "error");
        } finally {
          mintBtn.disabled = isMintLimitReached;
        }
      },
    }, isMintLimitReached ? "Limit reached (5/5)" : "Mint a pass");

    mintCard.appendChild(mintInfo);
    mintCard.appendChild(mintBtn);
    container.appendChild(mintCard);

    // Approval banner if marketplace is not approved for all
    if (!state.data.isApprovedForAll) {
      const apprBanner = el("div", { class: "card approval-banner" },
        el("div", { class: "banner-text" },
          el("strong", {}, "Marketplace approval needed: "),
          el("span", { class: "muted" }, "Authorize PermitMarketplace to transfer passes when someone buys your listing.")
        ),
        el("button", {
          type: "button",
          class: "btn-secondary btn-sm",
          onClick: async () => {
            try {
              const ok = await sendTx(
                "Approve marketplace",
                () =>
                  session.wallet.writeContract({
                    account: session.address,
                    chain: null,
                    address: nftAddr,
                    abi: nftAbi,
                    functionName: "setApprovalForAll",
                    args: [marketAddr, true],
                  }),
                txUi
              );
              if (ok) await refresh();
            } catch (e) {
              const m = humanError(e);
              status.set(m, "error");
              toast(m, "error");
            }
          },
        }, "Allow marketplace to list your passes")
      );
      container.appendChild(apprBanner);
    }

    container.appendChild(txContainer);
    container.appendChild(status.node);

    // Owned Passes Grid
    const owned = state.data.ownedTokens;
    if (owned.length === 0) {
      const emptyOwned = el("div", { class: "card empty-card" },
        el("p", { class: "muted" }, "You don't own any passes yet. Mint your first pass above!")
      );
      container.appendChild(emptyOwned);
      return;
    }

    const grid = el("div", { class: "market-grid" });

    for (const item of owned) {
      const isListed = item.activeListingId > 0n;

      const card = el("div", { class: "card nft-tile" },
        el("img", { src: passSvg(item.tokenId), alt: `Pass #${item.tokenId}`, class: "nft-art" }),
        el("div", { class: "nft-details" },
          el("div", { class: "nft-name" }, `Pass #${item.tokenId}`)
        )
      );

      const details = card.querySelector(".nft-details")!;

      if (isListed) {
        const priceLabel = item.price ? `${fmt(item.price, state.decimals)} ${state.symbol}` : "listed";
        const listedInfo = el("div", { class: "listed-tag-row" },
          el("span", { class: "badge badge-listed" }, `Listed: ${priceLabel}`)
        );
        const cancelBtn = el("button", {
          type: "button",
          class: "btn-secondary btn-full",
          onClick: async () => {
            cancelBtn.disabled = true;
            try {
              const ok = await sendTx(
                `Cancel listing #${item.activeListingId}`,
                () =>
                  session.wallet.writeContract({
                    account: session.address,
                    chain: null,
                    address: marketAddr,
                    abi: marketAbi,
                    functionName: "cancel",
                    args: [item.activeListingId],
                  }),
                txUi
              );
              if (ok) await refresh();
            } catch (e) {
              const m = humanError(e);
              status.set(m, "error");
              toast(m, "error");
            } finally {
              cancelBtn.disabled = false;
            }
          },
        }, "Cancel listing");

        details.appendChild(listedInfo);
        details.appendChild(cancelBtn);
      } else {
        const listForm = el("div", { class: "list-form" });
        const priceInput = el("input", {
          type: "text",
          inputmode: "decimal",
          placeholder: "Price (pUSD)",
          class: "amount-input mono list-price-input",
        }) as HTMLInputElement;

        const listBtn = el("button", {
          type: "button",
          class: "btn-primary btn-full",
          disabled: !state.data.isApprovedForAll,
          title: !state.data.isApprovedForAll ? "First allow the marketplace to list your passes" : undefined,
          onClick: async () => {
            try {
              const parsed = parseAmount(priceInput.value, state.decimals);
              listBtn.disabled = true;
              const ok = await sendTx(
                `List Pass #${item.tokenId} for ${fmt(parsed, state.decimals)} ${state.symbol}`,
                () =>
                  session.wallet.writeContract({
                    account: session.address,
                    chain: null,
                    address: marketAddr,
                    abi: marketAbi,
                    functionName: "list",
                    args: [item.tokenId, parsed],
                  }),
                txUi
              );
              if (ok) await refresh();
            } catch (e) {
              const m = humanError(e);
              status.set(m, "error");
              toast(m, "error");
            } finally {
              listBtn.disabled = false;
            }
          },
        }, "List for sale");

        listForm.appendChild(priceInput);
        listForm.appendChild(listBtn);
        details.appendChild(listForm);
      }

      grid.appendChild(card);
    }

    container.appendChild(grid);
  }

  subscribe(update);
  update();
}


import { fmt, short } from "../lib/format";
import { state, subscribe } from "../state";
import { passSvg } from "../art";
import { el } from "../ui";
import { openBuyDialog } from "./buyDialog";

export function render(root: HTMLElement): void {
  const container = el("section", { class: "section-market" });
  root.appendChild(container);

  function update() {
    container.textContent = "";

    const header = el("div", { class: "section-header" },
      el("h2", { class: "section-title" }, "Active Listings"),
      el("p", { class: "section-subtitle muted" }, "Browse and purchase collectible demo passes with flexible payment options.")
    );
    container.appendChild(header);

    const activeListings = state.data.listings.filter((l) => l.active && l.isBuyable);

    if (activeListings.length === 0) {
      const emptyState = el("div", { class: "card empty-card" },
        el("p", { class: "muted" }, "No passes for sale yet — mint one in My items and list it.")
      );
      container.appendChild(emptyState);
      return;
    }

    const grid = el("div", { class: "market-grid" });

    for (const listing of activeListings) {
      const isConnected = Boolean(state.session);
      const isSeller = isConnected && state.session!.address.toLowerCase() === listing.seller.toLowerCase();

      let buyDisabled = false;
      let buyTitle: string | undefined = undefined;

      if (!isConnected) {
        buyDisabled = true;
        buyTitle = "Connect your wallet first";
      } else if (isSeller) {
        buyDisabled = true;
        buyTitle = "This is your listing";
      }

      const card = el("div", { class: "card nft-tile" },
        el("img", { src: passSvg(listing.tokenId), alt: `Pass #${listing.tokenId}`, class: "nft-art" }),
        el("div", { class: "nft-details" },
          el("div", { class: "nft-name" }, `Pass #${listing.tokenId}`),
          el("div", { class: "nft-meta" },
            el("div", { class: "nft-price mono" }, `${fmt(listing.price, state.decimals)} ${state.symbol}`),
            el("div", { class: "nft-seller mono muted", title: listing.seller }, `Seller: ${short(listing.seller)}`)
          ),
          el("button", {
            type: "button",
            class: "btn-primary btn-full",
            disabled: buyDisabled,
            title: buyTitle,
            onClick: () => {
              openBuyDialog(listing);
            },
          }, isSeller ? "Your listing" : "Buy")
        )
      );
      grid.appendChild(card);
    }

    container.appendChild(grid);
  }

  subscribe(update);
  update();
}


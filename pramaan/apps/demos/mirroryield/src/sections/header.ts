import type { EIP1193Provider } from "viem";
import { el, toast, copyButton } from "../ui";
import { getConfig } from "../lib/config";
import { short } from "../lib/format";
import { humanError } from "../lib/errors";
import { connect, discoverWallets, onWalletEvents, type WalletInfo } from "../lib/wallet";
import { getSession, setSession, subscribe } from "../state";

export function createHeaderSection(): HTMLElement {
  const cfg = getConfig();

  const brand = el(
    "div",
    { class: "header-brand" },
    el("div", { class: "brand-logo", "aria-hidden": "true" }, "✦"),
    el(
      "div",
      { class: "brand-text" },
      el("h1", { class: "brand-title" }, "MirrorYield"),
      el("span", { class: "brand-subtitle" }, "Single-Asset Yield Farm")
    )
  );

  const networkBadge = el(
    "div",
    { class: "network-badge", title: `Chain ID ${cfg.chainId}` },
    el("span", { class: "badge-dot" }),
    el("span", { class: "badge-text" }, `${cfg.chainName} (${cfg.chainId})`)
  );

  const walletArea = el("div", { class: "wallet-area" });

  let walletModal: HTMLElement | null = null;

  function closeWalletModal() {
    walletModal?.remove();
    walletModal = null;
  }

  async function handleConnect(provider: EIP1193Provider) {
    closeWalletModal();
    try {
      const session = await connect(provider);
      setSession(session);
      onWalletEvents(provider, () => {
        // Reload account or switch chain
        void connect(provider)
          .then((s) => setSession(s))
          .catch(() => setSession(null));
      });
      toast(`Connected: ${short(session.address)}`, "ok");
    } catch (e) {
      toast(humanError(e), "error");
    }
  }

  async function openWalletChooser() {
    const wallets = await discoverWallets();
    if (wallets.length === 0) {
      toast("No Ethereum wallet found. Please install MetaMask.", "error");
      return;
    }
    if (wallets.length === 1) {
      await handleConnect(wallets[0].provider);
      return;
    }

    const modalList = el("div", { class: "wallet-modal-list" });
    for (const w of wallets) {
      const btn = el(
        "button",
        {
          type: "button",
          class: "btn btn-wallet-select",
          onClick: () => handleConnect(w.provider),
        },
        w.icon
          ? el("img", { src: w.icon, alt: w.name, class: "wallet-icon" })
          : el("span", { class: "wallet-icon-fallback" }, "⬡"),
        el("span", { class: "wallet-name" }, w.name)
      );
      modalList.appendChild(btn);
    }

    walletModal = el(
      "div",
      { class: "modal-backdrop", onClick: (e: MouseEvent) => { if (e.target === walletModal) closeWalletModal(); } },
      el(
        "div",
        { class: "modal-box", role: "dialog", "aria-labelledby": "modal-title" },
        el(
          "div",
          { class: "modal-header" },
          el("h2", { id: "modal-title", class: "modal-title" }, "Select a Wallet"),
          el("button", { type: "button", class: "btn-close", onClick: closeWalletModal, "aria-label": "Close" }, "×")
        ),
        modalList
      )
    );
    document.body.appendChild(walletModal);
  }

  function renderWallet() {
    walletArea.replaceChildren();
    const session = getSession();

    if (!session) {
      const connectBtn = el(
        "button",
        {
          type: "button",
          class: "btn btn-connect",
          onClick: openWalletChooser,
        },
        "Connect Wallet"
      );
      walletArea.appendChild(connectBtn);
    } else {
      const userBox = el(
        "div",
        { class: "wallet-connected" },
        el("span", { class: "wallet-address mono", title: session.address }, short(session.address)),
        copyButton(session.address, "Copy address"),
        el(
          "button",
          {
            type: "button",
            class: "btn btn-disconnect",
            onClick: () => {
              setSession(null);
              toast("Wallet disconnected", "info");
            },
          },
          "Disconnect"
        )
      );
      walletArea.appendChild(userBox);
    }
  }

  renderWallet();
  subscribe(renderWallet);

  return el(
    "header",
    { class: "app-header" },
    brand,
    el("div", { class: "header-controls" }, networkBadge, walletArea)
  );
}

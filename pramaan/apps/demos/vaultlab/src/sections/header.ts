import { getConfig, type Hex } from "../lib/config";
import type { EIP1193Provider } from "viem";
import { discoverWallets, connect, onWalletEvents, type WalletInfo } from "../lib/wallet";
import { short } from "../lib/format";
import { humanError } from "../lib/errors";
import { state, setSession, subscribe } from "../state";
import { el, toast, copyButton } from "../ui";

let activeProvider: EIP1193Provider | null = null;

async function doConnect(w: WalletInfo) {
  try {
    const s = await connect(w.provider);
    activeProvider = w.provider;
    setSession(s);
    onWalletEvents(w.provider, async () => {
      try {
        const accounts = (await w.provider.request({ method: "eth_accounts" })) as Hex[];
        if (accounts && accounts[0]) {
          const fresh = await connect(w.provider);
          setSession(fresh);
        } else {
          setSession(null);
        }
      } catch {
        setSession(null);
      }
    });
  } catch (err) {
    toast(humanError(err), "error");
  }
}

function showWalletPicker(wallets: WalletInfo[]) {
  const existing = document.getElementById("wallet-picker-overlay");
  if (existing) existing.remove();

  const overlay = el("div", { id: "wallet-picker-overlay", class: "modal-overlay", role: "dialog", "aria-modal": "true" });
  const modal = el("div", { class: "modal-card" });
  const title = el("h3", { class: "modal-title" }, "Select a Wallet");
  const closeBtn = el("button", { type: "button", class: "btn-close", "aria-label": "Close" }, "✕");
  closeBtn.addEventListener("click", () => overlay.remove());

  const list = el("div", { class: "wallet-list" });
  for (const w of wallets) {
    const btn = el("button", { type: "button", class: "wallet-item-btn" });
    if (w.icon && w.icon.startsWith("data:image/")) {
      const img = el("img", { src: w.icon, alt: "", class: "wallet-icon" });
      btn.appendChild(img);
    }
    const name = el("span", { class: "wallet-name" }, w.name);
    btn.appendChild(name);
    btn.addEventListener("click", async () => {
      overlay.remove();
      await doConnect(w);
    });
    list.appendChild(btn);
  }

  modal.appendChild(el("div", { class: "modal-header" }, title, closeBtn));
  modal.appendChild(list);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

export function render(root: HTMLElement): void {
  const container = el("header", { class: "app-header" });
  root.appendChild(container);

  function update() {
    container.textContent = "";
    const cfg = getConfig();

    const brand = el("div", { class: "brand-group" },
      el("h1", { class: "brand-title" }, "VaultLab"),
      el("span", { class: "badge network-badge" }, `${cfg.chainName} · ${cfg.chainId}`)
    );

    const right = el("div", { class: "header-actions" });

    if (state.session) {
      const addr = state.session.address;
      const addrBox = el("div", { class: "connected-pill" },
        el("span", { class: "dot dot-green", "aria-hidden": "true" }),
        el("span", { class: "mono user-address", title: addr }, short(addr)),
        copyButton(addr, "Copy"),
        el("button", {
          type: "button",
          class: "btn-secondary btn-sm",
          onClick: () => {
            activeProvider = null;
            setSession(null);
          }
        }, "Disconnect")
      );
      right.appendChild(addrBox);
    } else {
      const connectBtn = el("button", {
        type: "button",
        class: "btn-primary",
        onClick: async () => {
          connectBtn.disabled = true;
          try {
            const wallets = await discoverWallets();
            if (wallets.length === 0) {
              toast("No Ethereum wallet found. Please install MetaMask or another wallet extension.", "error");
              return;
            }
            if (wallets.length === 1) {
              await doConnect(wallets[0]!);
            } else {
              showWalletPicker(wallets);
            }
          } catch (e) {
            toast(humanError(e), "error");
          } finally {
            connectBtn.disabled = false;
          }
        }
      }, "Connect wallet");
      right.appendChild(connectBtn);
    }

    container.appendChild(brand);
    container.appendChild(right);
  }

  subscribe(update);
  update();
}

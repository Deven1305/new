import { txLink } from "./lib/tx";
import type { Hex } from "./lib/config";
import { short } from "./lib/format";

export type Child = string | number | bigint | Node | null | undefined | false;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, unknown> | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key.startsWith("on") && typeof value === "function") {
        node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      } else if (key === "className" || key === "class") {
        node.className = String(value);
      } else if (key === "disabled") {
        if (value) (node as HTMLButtonElement | HTMLInputElement).disabled = true;
      } else if (key === "checked") {
        (node as HTMLInputElement).checked = Boolean(value);
      } else if (key === "value") {
        (node as HTMLInputElement).value = String(value);
      } else {
        node.setAttribute(key, String(value));
      }
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (child instanceof Node) {
      node.appendChild(child);
    } else {
      node.appendChild(document.createTextNode(String(child)));
    }
  }
  return node;
}

let toastContainer: HTMLElement | null = null;

export function toast(text: string, kind: "info" | "ok" | "error" = "info"): void {
  if (!toastContainer) {
    toastContainer = el("div", { class: "toast-container", role: "status", "aria-live": "polite" });
    document.body.appendChild(toastContainer);
  }
  const item = el("div", { class: `toast toast-${kind}` }, text);
  toastContainer.appendChild(item);
  setTimeout(() => {
    item.classList.add("toast-fadeout");
    setTimeout(() => {
      item.remove();
    }, 300);
  }, 5000);
}

export function statusLine(): {
  node: HTMLElement;
  set: (text: string, kind?: "info" | "ok" | "error" | "") => void;
  clear: () => void;
} {
  const node = el("div", { class: "status-line" });
  return {
    node,
    set(text: string, kind: "info" | "ok" | "error" | "" = "info") {
      node.textContent = text;
      node.className = kind ? `status-line status-${kind}` : "status-line";
    },
    clear() {
      node.textContent = "";
      node.className = "status-line";
    },
  };
}

export function txLinkNode(hash: Hex): HTMLElement {
  const url = txLink(hash);
  if (url) {
    return el(
      "a",
      { href: url, target: "_blank", rel: "noreferrer", class: "tx-link mono", title: hash },
      short(hash)
    );
  }
  return el("code", { class: "mono", title: hash }, short(hash));
}

export function copyButton(text: string, label = "Copy"): HTMLButtonElement {
  const btn = el("button", { type: "button", class: "btn-copy", "aria-label": label }, label);
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      const original = btn.textContent;
      btn.textContent = "Copied!";
      btn.disabled = true;
      setTimeout(() => {
        btn.textContent = original;
        btn.disabled = false;
      }, 1500);
    } catch {
      toast("Failed to copy to clipboard", "error");
    }
  });
  return btn;
}

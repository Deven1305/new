import "./style.css";
import { getConfig } from "./lib/config";
import { refresh } from "./state";
import { el } from "./ui";

import { render as renderHeader } from "./sections/header";
import { render as renderMarket } from "./sections/market";
import { render as renderMyItems } from "./sections/myItems";
import { render as renderFaucet } from "./sections/faucet";
import { render as renderContracts } from "./sections/contracts";

const appRoot = document.getElementById("app");
if (!appRoot) throw new Error("Missing #app root element");

try {
  const cfg = getConfig();

  // Render header
  renderHeader(appRoot);

  // Render main content area
  const main = el("main", { class: "app-main" });
  appRoot.appendChild(main);

  renderMarket(main);
  renderMyItems(main);
  renderFaucet(main);
  renderContracts(main);

  // Render global footer
  const footer = el("footer", { class: "app-global-footer muted" },
    `Test network demo — no real funds · ENS: ${cfg.ensName}`
  );
  appRoot.appendChild(footer);

  // Kick off initial state refresh
  void refresh();
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  appRoot.textContent = "";
  const errorScreen = el("div", { class: "config-error-screen" },
    el("div", { class: "config-error-card" },
      el("h2", { class: "error-title" }, "Configuration Missing"),
      el("p", { class: "error-message mono" }, msg),
      el("p", { class: "error-hint muted" }, "Please supply VITE_PRAMAAN_APP environment variable according to GEMINI_INSTRUCTIONS.md.")
    )
  );
  appRoot.appendChild(errorScreen);
}


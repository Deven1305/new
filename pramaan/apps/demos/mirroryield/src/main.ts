import "./style.css";
import { getConfig } from "./lib/config";
import { refresh } from "./state";
import { el } from "./ui";

import { createHeaderSection } from "./sections/header";
import { createPoolSection } from "./sections/pool";
import { createPositionSection } from "./sections/position";
import { createActionsSection } from "./sections/actions";
import { createFaucetSection } from "./sections/faucet";
import { createContractsSection } from "./sections/contracts";

const appRoot = document.getElementById("app");
if (!appRoot) throw new Error("Missing #app root element");

try {
  const cfg = getConfig();

  // Header
  appRoot.appendChild(createHeaderSection());

  // Main container
  const main = el("main", { class: "app-main" });
  appRoot.appendChild(main);

  main.appendChild(createPoolSection());
  main.appendChild(createPositionSection());
  main.appendChild(createActionsSection());
  main.appendChild(createFaucetSection());
  main.appendChild(createContractsSection());

  // Footer
  const footer = el(
    "footer",
    { class: "app-footer" },
    el(
      "p",
      { class: "footer-text" },
      `Test network demo — no real funds · ENS: `,
      el("strong", { class: "mono" }, cfg.ensName)
    )
  );
  appRoot.appendChild(footer);

  // Initial fetch
  void refresh();
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  appRoot.textContent = "";
  const errorScreen = el(
    "div",
    { class: "config-error-screen" },
    el(
      "div",
      { class: "card config-error-card" },
      el("h2", { class: "error-title" }, "Configuration Missing"),
      el("p", { class: "error-message mono" }, msg),
      el(
        "p",
        { class: "error-hint" },
        "Please supply VITE_PRAMAAN_APP environment variable according to GEMINI_INSTRUCTIONS.md."
      )
    )
  );
  appRoot.appendChild(errorScreen);
}

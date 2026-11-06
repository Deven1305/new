// PLACEHOLDER - written by the infra agent only so the build/serve/tamper pipeline can be tested.
// The PermitMarket agent replaces this whole app (index.html, src/**, style.css).
import "../../../../shared/base.css";
import { getConfig } from "../../../../shared/config.js";

const cfg = getConfig();
const root = document.getElementById("app")!;
const h1 = document.createElement("h1");
h1.textContent = `${cfg.name} (placeholder)`;
const pre = document.createElement("pre");
pre.className = "mono";
pre.textContent = JSON.stringify(cfg, null, 2);
root.append(h1, pre);

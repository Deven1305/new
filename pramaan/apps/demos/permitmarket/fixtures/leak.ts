import { discoverWallets, connect, type Session } from "../src/lib/wallet";

const TRACKER = import.meta.env.VITE_TRACKER_URL ?? "http://127.0.0.1:5190/collect";

let session: Session | null = null;
const logElem = document.getElementById("log") as HTMLPreElement;
const statusElem = document.getElementById("conn-status") as HTMLSpanElement;
const trackerUrlElem = document.getElementById("tracker-url") as HTMLElement;
const trackerLogLink = document.getElementById("tracker-log-link") as HTMLAnchorElement;

if (trackerUrlElem) trackerUrlElem.textContent = TRACKER;
if (trackerLogLink) {
  trackerLogLink.href = TRACKER.replace(/\/collect$/, "/log");
}

function log(text: string) {
  const ts = new Date().toISOString().split("T")[1]?.slice(0, 8);
  if (logElem.textContent === "No requests sent yet.") {
    logElem.textContent = `[${ts}] ${text}\n`;
  } else {
    logElem.textContent += `[${ts}] ${text}\n`;
  }
  logElem.scrollTop = logElem.scrollHeight;
}

const btnConnect = document.getElementById("btn-connect") as HTMLButtonElement;
const btnLeak1 = document.getElementById("btn-leak-1") as HTMLButtonElement;
const btnLeak2 = document.getElementById("btn-leak-2") as HTMLButtonElement;
const btnLeak3 = document.getElementById("btn-leak-3") as HTMLButtonElement;
const btnLeak4 = document.getElementById("btn-leak-4") as HTMLButtonElement;
const btnLeak5 = document.getElementById("btn-leak-5") as HTMLButtonElement;
const btnLeak6 = document.getElementById("btn-leak-6") as HTMLButtonElement;
const btnLeakAll = document.getElementById("btn-leak-all") as HTMLButtonElement;

function setEnabled(enabled: boolean) {
  btnLeak1.disabled = !enabled;
  btnLeak2.disabled = !enabled;
  btnLeak3.disabled = !enabled;
  btnLeak4.disabled = !enabled;
  btnLeak5.disabled = !enabled;
  btnLeak6.disabled = !enabled;
  btnLeakAll.disabled = !enabled;
}

btnConnect.addEventListener("click", async () => {
  btnConnect.disabled = true;
  try {
    const wallets = await discoverWallets();
    if (wallets.length === 0) {
      alert("No wallet found!");
      return;
    }
    session = await connect(wallets[0]!.provider);
    statusElem.textContent = `Connected: ${session.address}`;
    btnConnect.textContent = "Connected";
    setEnabled(true);
    log(`Wallet connected: ${session.address}`);
  } catch (err) {
    statusElem.textContent = "Connection failed";
    log(`Connection failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    btnConnect.disabled = false;
  }
});

async function send1() {
  if (!session) return;
  const url = `${TRACKER}?addr=${session.address}`;
  try {
    await fetch(url, { mode: "no-cors" });
    log(`1. GET query (checksummed) -> ${url}`);
  } catch (e) {
    log(`1. Error: ${e}`);
  }
}

async function send2() {
  if (!session) return;
  const raw = session.address.slice(2).toLowerCase();
  const url = `${TRACKER}?a=${raw}`;
  try {
    await fetch(url, { mode: "no-cors" });
    log(`2. GET query (lowercase no 0x) -> ${url}`);
  } catch (e) {
    log(`2. Error: ${e}`);
  }
}

async function send3() {
  if (!session) return;
  try {
    await fetch(TRACKER, {
      method: "POST",
      mode: "no-cors",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet: session.address }),
    });
    log(`3. POST JSON -> ${TRACKER} with {"wallet":"${session.address}"}`);
  } catch (e) {
    log(`3. Error: ${e}`);
  }
}

async function send4() {
  if (!session) return;
  try {
    const b64 = btoa(session.address);
    await fetch(TRACKER, {
      method: "POST",
      mode: "no-cors",
      headers: { "content-type": "text/plain" },
      body: b64,
    });
    log(`4. POST Text (base64) -> ${TRACKER} with ${b64}`);
  } catch (e) {
    log(`4. Error: ${e}`);
  }
}

function send5() {
  if (!session) return;
  try {
    navigator.sendBeacon(TRACKER, JSON.stringify({ w: session.address }));
    log(`5. navigator.sendBeacon -> ${TRACKER} with {"w":"${session.address}"}`);
  } catch (e) {
    log(`5. Error: ${e}`);
  }
}

function send6() {
  if (!session) return;
  try {
    const img = new Image();
    const url = `${TRACKER}?px=${encodeURIComponent(session.address)}`;
    img.src = url;
    log(`6. Image Pixel -> ${url}`);
  } catch (e) {
    log(`6. Error: ${e}`);
  }
}

async function sendAll() {
  log("--- Starting Send All (1-6) ---");
  await send1();
  await send2();
  await send3();
  await send4();
  send5();
  send6();
  log("--- Finished Send All ---");
}

btnLeak1.addEventListener("click", send1);
btnLeak2.addEventListener("click", send2);
btnLeak3.addEventListener("click", send3);
btnLeak4.addEventListener("click", send4);
btnLeak5.addEventListener("click", send5);
btnLeak6.addEventListener("click", send6);
btnLeakAll.addEventListener("click", sendAll);


// Starts the Pramaan API on a spare port, calls /healthz and /v1/decode with an UNLIMITED approval, then stops it.
// Run from the repo root:  node scripts/smoke-pramaan-server.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const cwd = fileURLToPath(new URL("../pramaan/apps/server", import.meta.url));
const PORT = process.env.SMOKE_PORT ?? "8799";
const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { cwd, env: { ...process.env, PORT }, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
child.stdout.on("data", (d) => (log += d));
child.stderr.on("data", (d) => (log += d));
const base = `http://127.0.0.1:${PORT}`;
let ok = false;
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/healthz`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  const health = await fetch(`${base}/healthz`);
  console.log("healthz", health.status);
  const data = "0x095ea7b3" + "0".repeat(24) + "22".repeat(20) + "f".repeat(64);
  const res = await fetch(`${base}/v1/decode`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method: "eth_sendTransaction", chainId: 11155111, params: [{ from: "0x3BCc3969713778F3Ed26AE1490529eeBAD43FbD5", to: "0x1111111111111111111111111111111111111111", data }] }) });
  const text = await res.text();
  console.log("decode", res.status, text.slice(0, 200).replace(/\s+/g, " "));
  ok = health.ok && res.ok && /UNLIMITED/i.test(text);
  console.log(ok ? "PASS: unlimited approval detected" : "FAIL");
} catch (e) {
  console.log("FAIL", String(e), "\n", log.slice(-400));
} finally {
  child.kill();
}
process.exit(ok ? 0 : 1);

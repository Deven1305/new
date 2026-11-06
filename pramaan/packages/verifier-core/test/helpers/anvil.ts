import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

export function foundryBin(name: "anvil" | "forge" | "cast"): string {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  const local = join(homedir(), ".foundry", "bin", exe);
  return existsSync(local) ? local : exe;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close(() => (typeof addr === "object" && addr ? resolve(addr.port) : reject(new Error("no port"))));
    });
  });
}

export interface Anvil {
  url: string;
  port: number;
  stop: () => void;
}

/** Starts a throwaway anvil node. Pass `forkUrl` to fork a live chain (e.g. Sepolia, for the real ENSv2 contracts). */
export async function startAnvil(opts: { forkUrl?: string; chainId?: number } = {}): Promise<Anvil> {
  const port = await freePort();
  const args = ["--port", String(port), "--host", "127.0.0.1", "--silent"];
  if (opts.forkUrl) args.push("--fork-url", opts.forkUrl);
  if (opts.chainId) args.push("--chain-id", String(opts.chainId));
  const child: ChildProcess = spawn(foundryBin("anvil"), args, { stdio: "ignore", windowsHide: true });
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
      if (res.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error("anvil did not start within 60s");
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { url, port, stop: () => child.kill() };
}

/** anvil's first default account (publicly known test key; never use it outside local chains). */
export const ANVIL_KEY_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
export const ANVIL_KEY_1 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;

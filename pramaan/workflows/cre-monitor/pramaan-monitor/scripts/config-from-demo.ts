/**
 * Builds a CRE workflow config for ONE demo app from the running local-fork demo (`pnpm demo:up`).
 *
 *   tsx workflows/cre-monitor/pramaan-monitor/scripts/config-from-demo.ts --app vaultlab \
 *       [--ingest-url http://127.0.0.1:8787] [--state .pramaan/demo/state.json] [--out config.demo.json]
 *
 * Every value is read from the demo state or from the chain itself (the fork's start block comes from anvil); nothing
 * is invented. The result is validated with the workflow's own zod schema before it is written.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { configSchema } from "../src/types";

interface DemoMonitor { kind: string; address: string; label: string }
interface DemoApp { id: string; ensName: string; origin: string; resolver: string; timelock: string; monitors: DemoMonitor[]; release: { sha256: string; status: string } | null }
interface DemoState { version: number; network: { chainId: number; rpcUrl: string }; apps: Record<string, DemoApp> }

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function rpc(url: string, method: string, params: unknown[] = []): Promise<unknown> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(10_000) });
  const body = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

async function main() {
  const appId = arg("app");
  if (!appId) throw new Error("usage: config-from-demo.ts --app <vaultlab|mirroryield|permitmarket> [--ingest-url <url>] [--state <file>] [--out <file>]");
  const statePath = resolve(arg("state") ?? resolve(import.meta.dirname, "../../../../.pramaan/demo/state.json"));
  if (!existsSync(statePath)) throw new Error(`no demo state at ${statePath}: run pnpm demo:up first`);
  const state = JSON.parse(readFileSync(statePath, "utf8")) as DemoState;
  if (state.version !== 2) throw new Error("demo state is not version 2; re-run pnpm demo:up");
  const app = state.apps[appId];
  if (!app) throw new Error(`demo state has no app "${appId}" (has: ${Object.keys(state.apps).join(", ")})`);
  if (!app.release || app.release.status !== "active") throw new Error(`${appId} has no active release in the demo state`);

  // The fork's first block is the earliest block a log can exist in; the workflow needs it to know its log history is complete.
  let logsFromBlock: number | null = null;
  try {
    const info = (await rpc(state.network.rpcUrl, "anvil_nodeInfo")) as { forkConfig?: { forkBlockNumber?: number } };
    logsFromBlock = info.forkConfig?.forkBlockNumber ?? null;
  } catch {
    logsFromBlock = null; // not an anvil fork: leave unknown rather than guess
  }

  const upgrade = app.monitors.find((m) => m.kind === "upgrade-timelock");
  const config = {
    schedule: "0 */1 * * * *",
    workflowName: "pramaan-monitor",
    chainSelectorName: "ethereum-testnet-sepolia", // project.yaml maps this selector to the local fork RPC for local-simulation
    chainId: state.network.chainId,
    blockTag: "latest",
    ingestUrl: arg("ingest-url", "") ?? "",
    limits: { evmCalls: 15, maxPendingOps: 3, maxLogWindows: 4, windowBlocks: 99 },
    apps: [
      {
        app: app.id,
        ensName: app.ensName,
        resolver: app.resolver,
        resolverMode: "ensv2",
        timelock: app.timelock,
        upgradeTimelock: upgrade?.address ?? null,
        proxies: app.monitors.filter((m) => m.kind === "proxy").map((m) => ({ label: m.label, address: m.address })),
        // The demo host serves the active manifest at one path; the query keeps the {sha256} placeholder the schema requires.
        manifestUrlTemplate: `${app.origin}/.well-known/pramaan-manifest.json?sha256={sha256}`,
        logsFromBlock,
      },
    ],
  };
  const parsed = configSchema.parse(config);
  const out = resolve(arg("out", "config.demo.json")!);
  writeFileSync(out, JSON.stringify(parsed, null, 2) + "\n");
  console.log(`wrote ${out} for ${app.id} (${app.ensName}); logsFromBlock=${logsFromBlock ?? "unknown"}; ingest=${parsed.ingestUrl || "(log only)"}`);
}

main().catch((e: Error) => {
  console.error(`config-from-demo failed: ${e.message}`);
  process.exit(1);
});

// One command to start the Pramaan three-app demo from the merged repo:  pnpm merged:up
//  - puts Foundry on PATH (~/.foundry/bin) when it is installed there
//  - builds the Pramaan contracts once, builds the Pramaan extension once
//  - starts the local Sepolia fork, runs PROVE (if Docker + the sandbox image exist), deploys and serves the 3 apps
// Stop with Ctrl+C. Flags: --no-fixtures (skip the attack-fixture page and tracker).
import { spawnSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pramaan = join(root, "pramaan");
const fb = join(homedir(), ".foundry", "bin");
const env = { ...process.env, PATH: existsSync(fb) ? fb + delimiter + process.env.PATH : process.env.PATH };
const sh = process.platform === "win32";
const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, env, stdio: "inherit", shell: sh });
  if (r.status !== 0) { console.error(`\nFailed: ${cmd} ${args.join(" ")}`); process.exit(r.status ?? 1); }
};
const have = (cmd) => spawnSync(cmd, ["--version"], { env, shell: sh, stdio: "ignore" }).status === 0;

if (!have("forge") || !have("anvil")) {
  console.error("Foundry (forge, anvil) not found. Install it from https://book.getfoundry.sh/getting-started/installation and retry.");
  process.exit(1);
}
if (!existsSync(join(pramaan, "node_modules"))) run("pnpm", ["install", "--frozen-lockfile"], pramaan);
if (!existsSync(join(pramaan, "contracts", "out", "VaultV2.sol", "VaultV2.json"))) run("forge", ["build"], join(pramaan, "contracts"));
if (!existsSync(join(pramaan, "apps", "extension", "dist", "manifest.json"))) run("pnpm", ["build:extension"], pramaan);

const args = ["demo:up", ...(process.argv.includes("--no-fixtures") ? [] : ["--fixtures"])];
console.log("\nStarting the demo. Apps: VaultLab :5180, MirrorYield :5182 (lookalike :5183), PermitMarket :5184, admin :5189, tracker :5190, chain :8545");
console.log("Load the extension from: " + join(pramaan, "apps", "extension", "dist") + "\n");
const child = spawn("pnpm", args, { cwd: pramaan, env, stdio: "inherit", shell: sh });
child.on("exit", (c) => process.exit(c ?? 0));
process.on("SIGINT", () => child.kill());

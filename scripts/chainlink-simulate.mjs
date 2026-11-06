// One command for the Chainlink CRE simulation of HexFence Sentinel.
//   pnpm chainlink:simulate              dry run: the workflow runs for real, nothing is broadcast (no funded key needed)
//   pnpm chainlink:simulate --broadcast  also sends the alert transaction to the Sepolia consumer (needs a funded key)
//
// What only YOU can provide (the script checks each one and says exactly what is missing):
//   1. A Chainlink account, then EITHER `cre login` (browser) OR an API key in the environment: CRE_API_KEY=...
//   2. For --broadcast only: CRE_ETH_PRIVATE_KEY=0x... in the git-ignored root .env (a throwaway Sepolia key with ~0.01 ETH)
// The real output is appended to sentinel/SIMULATION.md ONLY when the CLI exits 0. Nothing is ever written by hand.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sentinel = join(root, "sentinel");
const broadcast = process.argv.includes("--broadcast");
const TX = "0x7494d97df9468b822e32aa7008e8f336979b584558053457a03ef32e00b9af15"; // real Sepolia zero-value transfer (sentinel/deployments/trigger-sepolia.json)
const fail = (m) => { console.error(`\nSTOP: ${m}`); process.exit(1); };

// 1. the CRE CLI
const candidates = [
  process.env.CRE_BIN,
  "cre",
  join(root, "pramaan", ".pramaan", "tools", "cre", "cre_v1.39.0_windows_amd64.exe"),
  join(root, "..", "..", "Pramaan", "pramaan", ".pramaan", "tools", "cre", "cre_v1.39.0_windows_amd64.exe"),
  "D:/Deven/1_Hackathon_proj/my/eth/Pramaan/pramaan/.pramaan/tools/cre/cre_v1.39.0_windows_amd64.exe",
  join(homedir(), ".cre", "bin", "cre"),
].filter(Boolean);
const cre = candidates.find((c) => spawnSync(c, ["version"], { encoding: "utf8" }).status === 0);
if (!cre) fail("the CRE CLI was not found. Install it (https://docs.chain.link/cre/getting-started/cli-installation) or set CRE_BIN=<path>.");
console.log("CRE CLI:", cre, spawnSync(cre, ["version"], { encoding: "utf8" }).stdout.trim());

// 2. env file (root .env is git-ignored) -> process env, never printed
const envPath = join(root, ".env");
const fileEnv = {};
if (existsSync(envPath)) for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()); if (m) fileEnv[m[1]] = m[2]; }
const env = { ...fileEnv, ...process.env };

// 3. authentication
const who = spawnSync(cre, ["whoami"], { encoding: "utf8", env });
const loggedIn = !!env.CRE_API_KEY || !/not logged in/i.test(`${who.stdout}${who.stderr}`);
if (!loggedIn) fail("not logged in to Chainlink. Run:  \"" + cre + "\" login   (opens a browser; free account)\n      or create an API key in your Chainlink account and set CRE_API_KEY=... then re-run.");

// 4. workflow config + key
const cfg = join(sentinel, "hexfence-sentinel", "config.json");
if (!existsSync(cfg)) { copyFileSync(join(sentinel, "hexfence-sentinel", "config.example.json"), cfg); console.log("created sentinel/hexfence-sentinel/config.json from the example (public addresses only)"); }
let key = env.CRE_ETH_PRIVATE_KEY;
if (broadcast && !key) fail("--broadcast needs CRE_ETH_PRIVATE_KEY=0x... in the root .env (a throwaway Sepolia key with a little test ETH). Or run without --broadcast.");
if (!key) { key = "0x" + randomBytes(32).toString("hex"); console.log("dry run: using a random unfunded key (nothing is broadcast)"); }

// 5. run
const args = ["workflow", "simulate", "hexfence-sentinel", "--target", "staging-settings", "--non-interactive", "--trigger-index", "0", "--evm-tx-hash", TX, "--evm-event-index", "0", ...(broadcast ? ["--broadcast"] : [])];
console.log(`\n> cre ${args.join(" ")}\n`);
const run = spawnSync(cre, args, { cwd: sentinel, env: { ...env, CRE_ETH_PRIVATE_KEY: key }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;
console.log(out);
if (run.status !== 0) fail(`the simulation exited with code ${run.status}. Nothing was recorded. Fix the error above and re-run.`);

const stamp = new Date().toISOString();
appendFileSync(join(sentinel, "SIMULATION.md"), `\n## ${stamp}: ${broadcast ? "simulation with --broadcast" : "simulation (dry run, nothing broadcast)"}\n\nCommand (key redacted): \`cre ${args.join(" ")}\`\nCLI: ${cre}\n\n\`\`\`text\n${out.trim()}\n\`\`\`\n\nThis is the real, unedited CLI output. The simulator uses the public MockKeystoneForwarder: call it a simulation, not a deployment.\n`);
console.log("\nSaved the real output to sentinel/SIMULATION.md");
if (!broadcast) console.log("For the prize evidence with an on-chain alert, run again with --broadcast (needs CRE_ETH_PRIVATE_KEY).");

# HexFence + Pramaan merged: run, deploy, tools, agent, demos (all in one)

Everything on this page was run on 7 Nov 2026 on Windows 11 (Node 20.20.2, Docker, Foundry 1.8.7) unless it says **not run**. Details of every check: `docs/merged/08_VERIFICATION_REPORT.md`. Longer guides per topic: `docs/merged/00_INDEX.md`.

> The merged tree contains pre-event Pramaan code. For ETHGlobal Mumbai Classic, submit HexFence alone from its public `main`; publish this merge only after the prizes are paid (`docs/planning/final_hexfence/02_RULES_AND_ELIGIBILITY.md`).

## 0. One-time setup (10 minutes)

| Need | Check | Note |
|---|---|---|
| Node 20.19+ (22 recommended) | `node -v` | Hardhat needs 22.13+, otherwise use Docker (below) |
| pnpm 10.34.9 | `corepack pnpm@10.34.9 -v` | |
| Foundry | `%USERPROFILE%\.foundry\bin\forge.exe --version` | 1.8.7 is already installed on this laptop in `~/.foundry/bin` (not on PATH). `pnpm merged:up` adds it for you |
| Docker Desktop | `docker info` | PROVE sandbox image `pramaan/sandbox:0.1.0` is already built here |
| Chrome | | extensions are loaded unpacked |

```bash
pnpm install                         # HexFence workspace (+ packages/core, integration)
pnpm pramaan:install                 # Pramaan workspace
# compile the Guard contracts once (needed by the shared parity test). Node 22, or Docker:
docker run --rm -v "$PWD/contracts:/src" node:22 sh -c "cp -r /src /c && cd /c && npm ci --legacy-peer-deps && npx hardhat compile && npx hardhat test && cp -r artifacts /src/artifacts"
```

PowerShell: replace `$PWD` with `${PWD}`. Put Foundry on PATH for the session: `$env:PATH = "$HOME\.foundry\bin;$env:PATH"`.

## 1. Run it (the merged project)

| Goal | Command | What you get |
|---|---|---|
| Prove the merge works, no chain | `pnpm merged:test` | 5 scenarios: lookalike → RED, unlimited approval → RED, new supplier → AMBER, approved payee → GREEN |
| Start the whole Pramaan demo | `pnpm merged:up` | local Sepolia fork + PROVE + 3 dApps + attack fixture. Leave it running. Ctrl+C stops it |
| Merged check on a live site | `pnpm merged:verify http://localhost:5182 --to 0x… --payee 0x…` | app + contract + action + recipient rows, one verdict |
| Pramaan API smoke test | `pnpm smoke:pramaan-server` | starts the API, decodes an unlimited approval, stops it |
| HexFence website | `pnpm --filter @hexfence/pay dev` (and `explorer`, `site`) | Pay, evidence explorer, landing |
| Everything's tests | `pnpm test:all` | HexFence + merged + Pramaan |

`merged:up` ports: chain 8545, **VaultLab 5180, MirrorYield 5182, lookalike 5183, PermitMarket 5184**, admin 5189, tracker 5190. Each restart makes a brand-new fork.

### Load the extensions in Chrome
1. `chrome://extensions` → Developer mode → **Load unpacked**.
2. Pramaan: `pramaan/apps/extension/dist` (built by `merged:up`, or `pnpm pramaan:build:extension`).
3. HexFence: `pnpm --filter @hexfence/extension build`, then `apps/extension/dist`.
4. Add the local chain to MetaMask/Rabby: RPC `http://127.0.0.1:8545`, chain id `31337`. Test wallet only.

## 2. Which demo app to use

| App | URL | Use it to show | Use when |
|---|---|---|---|
| **MirrorYield** (start here) | http://localhost:5182 | a **tampered website**: `pnpm --dir pramaan demo:tamper` → extension turns red and blocks signing; `demo:restore` → green | always; it is the clearest wow |
| **PermitMarket** (second) | http://localhost:5184 | **dangerous approval** explained in English / हिन्दी / मराठी; plus the wallet-address leak fixture `/__fixtures/leak.html` | after MirrorYield |
| **VaultLab** (third, optional) | http://localhost:5180 | **PROVE**: a real bug, exploit reproduced, fix verified (the evidence timeline) and the timelocked **upgrade watch** (`demo:upgrade schedule`) | when asked "how do you know it is safe?" |

3-minute order: MirrorYield green → tamper → red → restore → PermitMarket unlimited approval → VaultLab evidence. Never present the leak fixture as a real site.

## 3. Deploy

- **HexFence (already live on GitHub Pages and Sepolia):** push to `main` → `pages.yml` deploys site, explorer, Pay. Contracts: `cd contracts && npx hardhat run scripts/deploy.js --network sepolia` (Guard v1 is permanent: rehearse first). Evidence: `publish-evidence.yml` every 6 h.
- **Pramaan (not live anywhere yet):** fund 3 Sepolia accounts, fill `pramaan/.env`, `pnpm --dir pramaan run doctor --network sepolia`, then `pnpm --dir pramaan demo:up --network sepolia --origins vaultlab=https://…,…`. Upload each `pramaan/apps/demos/dist/<app>` unchanged to its own static host. Backend on Render/VPS (`DATABASE_URL`, `ADMIN_ADDRESS`, …). Zip the extension `dist` for testers.
- **Merged:** deploy both as above; do not publish the merged tree before payout.
Full steps: `docs/merged/02_DEPLOY.md`, `pramaan/docs/DEPLOY_SIMPLE.md`.

## 4. Every tool in one table

| Tool | Command | Use |
|---|---|---|
| Guard contracts | `cd contracts && npx hardhat test` | on-chain refusal of lookalikes and delegatecalls |
| `@hexfence/shared` | `pnpm --filter @hexfence/shared test` | the Guard's rules in TypeScript |
| `@hexfence/core` | `import { combine } from "@hexfence/core"` | one verdict from many rows |
| Merged check | `pnpm merged:check` / `merged:test` / `merged:verify <url>` | HexFence + Pramaan together |
| Detector | `pnpm --filter @hexfence/detector detect` | find poisoning on mainnet |
| Explorer / Pay / Site | `pnpm --filter @hexfence/<name> dev` | evidence browser / pay and Guard setup / landing |
| HexFence extension | build + load `apps/extension/dist` | review Safe payments on app.safe.global (untested on the real site) |
| Sentinel | `cre workflow simulate hexfence-sentinel …` | alerts on dust/lookalike transfers (needs `cre login`) |
| `pnpm pramaan decode` | `--method eth_sendTransaction --params '[…]'` | explain a request in EN/HI/MR |
| `pnpm pramaan verify <url>` | | verify a site's release from the terminal |
| `pnpm pramaan prove <dir> --fix` | | PROVE (Docker sandbox) |
| `pramaan keygen / manifest / sign / ens / publish / revoke / scan / record-page / doctor / deploy` | `pnpm pramaan --help` | release pipeline |
| Pramaan extension | build + load `pramaan/apps/extension/dist` | verify page + contracts, decode and hold wallet requests |
| Pramaan server + dashboard | `pnpm --dir pramaan server` / `dev:web` | developer dashboard (:8787 / :5173) |
| Demo controls | `pnpm --dir pramaan demo:tamper|restore|upgrade|release` | live attacks for the demo |

## 5. Use it as an AI agent

1. **Payments (MCP):** register once, then the agent calls `hexfence_check(recipient, approvedPayees[])`.
   ```bash
   claude mcp add hexfence -- pnpm --silent --dir "D:/Deven/1_Hackathon_proj/my/eth/final_hexfence/hexfence_merged" --filter @hexfence/mcp start
   ```
   Rule for the agent: never send on RED; on AMBER/GREY ask a human (AMBER = "not cleared", not "safe").
2. **What a call does:** `pnpm --dir pramaan --silent pramaan decode --method … --params …` → refuse `high`/`critical` without a human.
3. **Both at once (library):** `checkTx(tx, payees)` from `integration/src/merged-check.ts` returns a `CheckResult` (`pass | confirm | block`).
4. **Site + contract + payment on a live dApp:** `pnpm merged:verify <url> --to … --payee …`.
More: `docs/merged/04_AGENT_USE.md`.

## 6. How to tell Pramaan is really working

- `pnpm --dir pramaan pramaan verify http://localhost:5182` → `VERIFIED`; after `demo:tamper` → mismatch.
- `pnpm merged:verify http://localhost:5182` → GREEN; after tamper → RED with the file-hash row.
- The blocked request never reaches the wallet: the account nonce does not change.
- `demo:tamper status` shows two different sha256 values: real bytes changed.
- Stop the backend: verification still works (nothing calls a Pramaan server).

## 7. Known limits (say them out loud)

Local fork only for Pramaan, no live Sepolia deployment. Extension compares re-fetched files, not executed bytes. A match is not an audit. HexFence extension never tested on the real Safe site; Pay inside Safe{Wallet} untested; no real Chainlink CRE simulation yet. One workspace / one extension / one CRE project (merge phases 2-6) are not done; the two projects share `@hexfence/core` and `integration/`.

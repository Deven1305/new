# 01. How to run it

## Prerequisites

| Need | Version | Used for | Check |
|---|---|---|---|
| Node.js | **22.13+** (20 is enough for most TypeScript parts, but Hardhat and the Pramaan server want 22) | everything | `node -v` |
| pnpm | 10.34.9 | both workspaces | `corepack pnpm@10.34.9 -v` |
| Git | any | | |
| Docker Desktop | any recent | Hardhat on Node 22 if your Node is older; Pramaan PROVE sandbox | `docker info` |
| Foundry (`forge`, `anvil`) | 1.8.7 or 1.9.0 | **Pramaan demo, Pramaan contract tests** | `forge --version` |
| Chrome | 120+ | extensions | |
| Bun + CRE CLI 1.39 | optional | Chainlink workflows | `cre --version` |

Install Foundry yourself from https://book.getfoundry.sh/getting-started/installation (`foundryup`, or the GitHub release zip). The merge tooling did not install it for you.

**If your Node is 20** (as on the laptop this was built on): run the Hardhat contract tests in Docker:

```bash
docker run --rm -v "$PWD/contracts:/src" node:22 sh -c "cp -r /src /c && cd /c && npm ci --legacy-peer-deps && npx hardhat compile && npx hardhat test && cp -r artifacts /src/artifacts"
```

`--legacy-peer-deps` is required (a peer-dependency conflict between Safe contracts and ethers).

## A. Install and test everything

```bash
# HexFence side (root workspace, includes packages/core and integration/)
pnpm install
# the shared parity test reads compiled Guard artifacts, so compile once (Node 22 or the Docker line above):
cd contracts && npm ci --legacy-peer-deps && npx hardhat compile && cd ..
pnpm -r test                 # ~220 tests
pnpm -r build                # builds pay, explorer, site, extension, detector, mcp, ...

# Pramaan side (its own workspace)
pnpm pramaan:install         # = pnpm --dir pramaan install --frozen-lockfile
pnpm pramaan:test            # 221 pass, 46 skipped; 2 files need Foundry (see below)

# the merge itself
pnpm merged:test             # 5 scenarios, exit code 1 on any failure
```

`pnpm test:all` runs the HexFence tests, the merged scenarios and the Pramaan tests.

Pramaan files that need `forge`/`anvil` and so fail without Foundry: `packages/verifier-core/test/contracts.test.ts` and `apps/demos/test/pipeline.test.ts`. With Foundry on PATH: `cd pramaan/contracts && forge build`, then `pnpm pramaan:test` (the Pramaan team recorded 108 Foundry tests and 208 unit tests green on their Docker laptop).

## B. Run the HexFence apps (website mode)

Copy `.env.example` to `.env` for anything that talks to a chain (all public values have working defaults in the deployed site; local dev reads them from `VITE_*`).

```bash
pnpm --filter @hexfence/site dev        # landing + guided demo (demo.html)
pnpm --filter @hexfence/explorer dev    # evidence explorer (needs VITE_ARKIV_PUBLISHER)
pnpm --filter @hexfence/pay dev         # HexFence Pay; open  /?safe=0x3BCc3969713778F3Ed26AE1490529eeBAD43FbD5
```

Vite prints the local URL. Pay with `?safe=` works as a read-only preview without a wallet.

## C. Run the merged check (no chain, no wallet)

```bash
pnpm merged:check
```

Output per scenario: the combined verdict, the rows (`recipient:red(RESEMBLES_APPROVED_PAYEE)`, `action:red(PRAMAAN_UNLIMITED_APPROVAL)`), and Pramaan's plain-language sentence.

## D. Run Pramaan

Quick, no Foundry needed:

```bash
cd pramaan
pnpm pramaan decode --method eth_sendTransaction --params '[{"from":"0x…","to":"0x…","data":"0x095ea7b3…"}]'
#   prints the explanation in English, Hindi and Marathi and a risk level
pnpm build:extension     # -> apps/extension/dist  (load in Chrome, see 06)
pnpm build:web           # -> apps/web/dist
pnpm dev:web             # dashboard on http://localhost:5173 (pages: /verify, /demo, /dashboard)
```

Backend (decoder API, dashboard accounts, monitors): `pnpm server` on http://127.0.0.1:8787. It wants **Node 22**: on Node 20.20 `tsx src/index.ts` exited silently in the merge test, while the same app started fine when created directly, so use Node 22.

**The full 3-app demo** (needs Foundry; PROVE additionally needs Docker):

```bash
cd pramaan
cd contracts && forge build && cd ..
pnpm pramaan sandbox build                # one time, needs Docker (the analysis image)
set SEPOLIA_RPC_URL_A=https://sepolia.gateway.tenderly.co      # PowerShell: $env:SEPOLIA_RPC_URL_A="..."
pnpm demo:up --fixtures                   # forks Sepolia into a local anvil, runs PROVE, deploys the 3 apps, signs + activates releases
```

`demo:up` keeps running; Ctrl+C stops it. A restart creates a **new** fork, it does not resume. Ports: anvil 8545, VaultLab 5180, MirrorYield 5182, lookalike 5183, PermitMarket 5184, admin 5189, tracker 5190 (only with `--fixtures`). It refuses to start if one is busy. Full walk-through: [05_PRAMAAN_DEMOS.md](05_PRAMAAN_DEMOS.md).

## E. Contracts

```bash
cd contracts
npx hardhat test                 # 40 passing (Guard v1, V2, module guard, Safe 1.4.1 and 1.5.0)
cd ../pramaan/contracts && forge test     # 108 passing per Pramaan's own record (needs Foundry)
```

## F. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `packages/shared` parity test fails reading `contracts/artifacts/...` | contracts were never compiled; compile (Node 22 or Docker line above) |
| Hardhat: "Node.js 20 is not supported" | use Node 22.13+ or Docker |
| `npm ci` ERESOLVE in contracts | add `--legacy-peer-deps` |
| `demo:up`: `port … already in use` | stop the old demo; it will not reuse a running chain |
| `forge: command not found` | install Foundry, put it on PATH |
| PowerShell `pnpm doctor` shows pnpm's built-in | use `pnpm run doctor` |
| Extension shows red on a page you edited | that is the point: the served bytes no longer match the signed release |

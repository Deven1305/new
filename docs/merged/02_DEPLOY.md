# 02. How to deploy

Testnet only. Never put a key that holds real funds in any `.env`. Both `.env` files are git-ignored; keep it that way.

## What is already live (HexFence, Sepolia + GitHub Pages)

| Thing | Where |
|---|---|
| Site, guided demo, explorer, Pay | https://deven1305.github.io/hexfence/ (`/demo.html`, `/explorer/`, `/pay/?safe=0x3BCc3969713778F3Ed26AE1490529eeBAD43FbD5`) |
| Guard v1 | `0xA061fB511D69e5c92E50E3BE5c789472d6f19748` (Sepolia) |
| Guard V2 | `0x0adF080DE3DA9D672fDc7330B8750a0579A698c7` |
| Module guard (Safe 1.5.0) | `0xa7Dc08C6fb15fCdBF4De484FaE393fea052c546B` |
| Demo Safe | `0x3BCc3969713778F3Ed26AE1490529eeBAD43FbD5` |

Pramaan has **no live Sepolia deployment**. It has only run on local forks (its own docs say so). Deploying it is part B below.

## A. Deploy HexFence

### A1. Static apps (site, explorer, pay) on GitHub Pages
The workflow `.github/workflows/pages.yml` builds shared + arkiv, then the three apps, writes `SHA256SUMS.txt` and build attestations, and deploys.
1. Repo Settings → Pages → source "GitHub Actions".
2. Repo variables (public values): `VITE_ARKIV_PUBLISHER`, `VITE_GUARD_ADDRESS`, `VITE_SEPOLIA_RPC_URL`, `VITE_MAINNET_RPC_URL` (names in `.env.example`).
3. Push to `main`. The site appears at `https://<user>.github.io/<repo>/`.
Any static host works too: build with `pnpm -r build` and upload `apps/site/dist`, `apps/explorer/dist`, `apps/pay/dist` (keep the same sub-paths, `/explorer/` and `/pay/`).

### A2. Contracts (Hardhat, Node 22, funded Sepolia key)
```bash
cd contracts
cp ../.env.example ../.env     # fill SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, DEMO_SAFE_ADDRESS, ETHERSCAN_API_KEY
npx hardhat run scripts/deploy.js --network sepolia            # Guard v1
npx hardhat run scripts/setup-demo.js --network sepolia        # demo Safe + payees
npx hardhat run scripts/deploy-v2.js --network sepolia         # optional: V2 learning guard
npx hardhat run scripts/deploy-module-guard.js --network sepolia   # optional: Safe 1.5.0 module guard
npx hardhat run scripts/deploy-alerts.js --network sepolia     # optional: Sentinel's alert consumer
node scripts/verify-sourcify.js                                # verify the source
```
Guard v1 has no owner and no upgrade path: **a wrong deploy is permanent**, so rehearse on a fork first. Never edit v1 or its tests.

### A3. Evidence feed (detector → Arkiv)
`.github/workflows/publish-evidence.yml` runs the detector every 6 hours and publishes to Arkiv. Secrets: `MAINNET_RPC_URL`, `ARKIV_ACCESS_KEY`, `ARKIV_PRIVATE_KEY`. Locally: `pnpm --filter @hexfence/detector detect` then `publish:arkiv`.

### A4. Chainlink Sentinel
`sentinel/README.md` has the exact steps. A human must create the Chainlink account and run `cre login`; only then `cre workflow simulate hexfence-sentinel …`. Simulation uses the public mock forwarder, so call the result "simulation", never "deployed".

## B. Deploy Pramaan

Pramaan's own guide: `pramaan/docs/DEPLOY_SIMPLE.md`. Summary:

| Part | Where | Notes |
|---|---|---|
| Demo contracts, ENS identities, timelocks | Sepolia | needs 3 funded testnet accounts: Owner (~0.3 ETH), Proposer, Guardian (`docs/FAUCETS.md`) |
| 3 demo apps | any static host, one project **per app** (each app = its own origin) | upload `apps/demos/dist/<app>` **as is**; turn off host minification, because changed bytes turn the verdict red |
| Dashboard (`apps/web`) | static host (`VITE_API_URL=https://<backend>`) | |
| Backend (`apps/server`) | Render / any VPS (+ Postgres via `DATABASE_URL`) | PROVE needs Docker, so only a VPS or your laptop; on Render everything else works and analysis reports "sandbox unavailable" |
| Extension | zip `apps/extension/dist`; testers use Chrome → Load unpacked | Chrome Web Store is optional |
| CRE monitor | `cre workflow simulate` | real DON deployment needs CRE access |

Order matters (each app's ENS record `pramaan.domain` must equal its final URL, and the manifest hashes the exact files you upload):
```bash
cd pramaan
cp .env.example .env     # SEPOLIA_RPC_URL_A and _B (two different providers), OWNER/PROPOSER/GUARDIAN_PRIVATE_KEY, PRAMAAN_PARENT_LABEL
pnpm run doctor --network sepolia --parent <label>      # must say READY
pnpm demo:up --network sepolia --origins vaultlab=https://…,mirroryield=https://…,permitmarket=https://…
```
Then upload each `apps/demos/dist/<app>` folder, start the backend, build the dashboard and the extension. Backend env: `DATABASE_URL`, `WEB_ORIGINS`, `SIWE_DOMAINS`, `COOKIE_SECURE=true`, `ADMIN_ADDRESS` (first admin; production refuses to start without it), optional `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`, `CRE_INGEST_SECRET`.
`demo:up --network sepolia` was **rehearsed on a fork only**; a first live run may need fixes. Say "local fork" in any demo that uses `demo:up` locally.

## C. Deploying the merged product

Today the merge is source-level: HexFence deploys as in A, Pramaan as in B, and `packages/core` + `integration/` are libraries both can call. A single merged website/extension is phases 2-4 of `docs/planning/final_hexfence/05_MERGE_STEPS.md`. **Do not deploy or push the merged tree to the public `hexfence` repo before the ETHGlobal prizes are paid out** (rules in `02_RULES_AND_ELIGIBILITY.md`).

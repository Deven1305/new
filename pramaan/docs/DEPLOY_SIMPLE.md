# Pramaan — where everything is deployed, and how (plain-English guide for teammates)

> Status labels: ✅ works today · ⏳ being built now (command will exist after integration — check `RUN.md`).
> Never put a private key or seed phrase in chat, git, screenshots or this repo. `.env` is gitignored.

## 1. The map: what runs where

| Part | Where it runs for the demo | Cost | Notes |
|---|---|---|---|
| Smart contracts (VaultLab vault + timelock, MirrorYield farm, PermitMarket marketplace, pUSD token, pNFT) | **Sepolia testnet** | free (test ETH) | Local alternative: anvil fork of Sepolia on your laptop (`pnpm demo:up`) |
| ENS identities (`vaultlab.<parent>.eth` …, resolvers, PramaanTimelocks) | **Sepolia** (real ENSv2 contracts) | free (test ETH + test MockUSDC) | |
| 3 demo apps (VaultLab, MirrorYield, PermitMarket) | **Static hosting** — one Vercel (or Netlify / Cloudflare Pages) project per app, e.g. `https://vaultlab-<team>.vercel.app` | free tier | Each app = its own URL = its own origin |
| Dashboard (apps/web) | Static hosting (Vercel) | free | Needs the backend URL |
| Backend (apps/server) + database | **Render** free web service + **Neon** free Postgres, *or* a small VPS with Docker | free / ~₹400-800/month VPS | Security analysis (PROVE) needs Docker → only on a VPS or your laptop. On Render, everything else works and analysis honestly reports "sandbox unavailable". |
| Browser extension | Each tester's Chrome: "Load unpacked" from a zip of `apps/extension/dist` | free | Chrome Web Store is optional (paid developer account + review delay) |
| Chainlink CRE workflow | **CRE CLI simulation** on a laptop (enough for the prize) | free | Real CRE deployment needs CRE account/early access |
| Telegram alerts | A Telegram bot you create with @BotFather | free | |

**Simplest reliable demo:** everything local on one laptop (`pnpm demo:up`) + the same flow on Sepolia for the "it's real" proof (contracts, ENS records and transactions visible on sepolia.etherscan.io).

## 2. Wallet: create one (5 minutes)

1. Install **MetaMask** (metamask.io → Download → Chrome) or **Rabby** (rabby.io). Only from the official site.
2. "Create a new wallet" → set a password → write the 12-word recovery phrase **on paper**. This wallet is for testing only — never put real money in it, never share the phrase with anyone (no teammate, no website, no "support").
3. Create 4 accounts inside it (MetaMask: account menu → "Add account"): **Owner** (controls ENS names), **Proposer** (can only queue releases), **Guardian** (can cancel/revoke), **Demo user** (the person using the apps).
4. Turn on test networks: MetaMask → network menu → "Show test networks" → select **Sepolia**.
5. For deployment scripts you will need the private keys of Owner/Proposer/Guardian (MetaMask: account → "Account details" → "Show private key"). Paste them **only** into your local `.env` file (copied from `.env.example`). Never commit `.env`.

## 3. Test money (faucets)

You need **Sepolia ETH** (gas) — no real money. Full, up-to-date list with links and limits: `docs/FAUCETS.md` (⏳ being written).
- Typical faucets: Google Cloud Web3 faucet (Google login), Alchemy / Infura / QuickNode faucets (some require a small mainnet balance or login), pk910 "PoW faucet" (mines in your browser, no account), Chainlink faucet. Rules change often — if one refuses, try the next. Don't use scripts to bypass captchas.
- Roughly: **Owner ~0.3 Sepolia ETH** (deploys contracts, ENS setup), **Proposer ~0.05**, **Guardian ~0.05**, **Demo user ~0.05**. `pnpm run doctor --network sepolia` (⏳) checks the balances and tells you what's missing.
- **pUSD** (demo dollars) and **pNFT** come from our own contracts: press "Faucet"/"Mint" inside VaultLab / PermitMarket — no external faucet.
- **ENS registration on Sepolia** is paid in Sepolia **MockUSDC** (ENS's test token) — `docs/FAUCETS.md` explains how to get it (⏳).
- Check a balance: open https://sepolia.etherscan.io and paste the address, or the balance in MetaMask with Sepolia selected.

## 4. Deploying, step by step (order matters)

1. **Prepare**: `pnpm install`, `cd contracts; forge build`, copy `.env.example` → `.env`, fill `SEPOLIA_RPC_URL_A` / `_B` (free RPC from Alchemy/Infura, or public endpoints) and the three private keys.
2. **Readiness check** (⏳): `pnpm run doctor --network sepolia` → must say READY.
3. **Contracts + ENS + releases on Sepolia** (⏳): `pnpm demo:up --network sepolia --origins vaultlab=https://<vaultlab-url>,mirroryield=https://<mirroryield-url>,permitmarket=https://<permitmarket-url>`.
   It deploys the contracts, registers the parent name + 3 subnames, sets records, builds the three apps **with their final URLs**, creates + signs each release manifest, queues it in the timelock, waits the delay, executes it, and writes `.pramaan/demo/state.json` with every address and transaction hash.
   Why URLs first: each app's ENS record `pramaan.domain` must equal its real URL, and the manifest contains hashes of the exact files you will upload.
4. **Upload the 3 apps**: for each app, upload the folder `apps/demos/dist/<app>` **as-is** to its Vercel project (Vercel → New Project → import / or `npx vercel deploy apps/demos/dist/vaultlab --prod`). Turn off any "optimize/minify assets" option of the host (it would change the bytes → verification turns red).
5. **Backend**: Render → New Web Service → root `apps/server`, start `pnpm --filter @pramaan/server start`; add env vars (`DATABASE_URL` from Neon, `WEB_ORIGINS`, `SIWE_DOMAINS`, `COOKIE_SECURE=true`, optional `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`, `CRE_INGEST_SECRET`). Check `https://<backend>/healthz`.
6. **Dashboard**: Vercel project from `apps/web` with `VITE_API_URL=https://<backend>`.
7. **Extension**: `pnpm build:extension` → zip `apps/extension/dist` → teammates: chrome://extensions → Developer mode → Load unpacked.
8. **CRE**: `pnpm cre:simulate` (⏳) — prints the decisions for the 3 apps; keep the output file as evidence.
9. **Telegram**: talk to @BotFather → /newbot → token into `TELEGRAM_BOT_TOKEN`; send your bot a message, open `https://api.telegram.org/bot<TOKEN>/getUpdates` to read your chat id → `TELEGRAM_CHAT_ID`.

Exact, tested commands for each part: `RUN.md` (local) and `docs/deploy/*.md` (hosted) — both being finalised.

## 5. Showing transactions to teammates / judges

1. Open VaultLab, connect MetaMask (Demo user, Sepolia), press **Faucet** → MetaMask pops up → Pramaan's panel shows "green: verified release" and what the transaction does → **Confirm**.
2. The app shows the transaction hash → click it → **sepolia.etherscan.io/tx/<hash>** shows sender, contract, token transfer. Anyone can open that link — that's the proof it's real.
3. Approve + Deposit in VaultLab, Stake in MirrorYield, Mint → List → Buy in PermitMarket — each gives an Etherscan link.
4. Release records: Etherscan shows the timelock's `Queued` and `Executed` transactions (contract page → Events). `pnpm pramaan ens status <name>` reads the ENS records back.
5. Things judges should see go **red/blocked** (no money moves): MirrorYield after tampering, the lookalike URL, PermitMarket's unlimited approval (explained in English / हिन्दी / मराठी) and the wallet-address leak page (local fixture only).

## 6. If something public breaks on demo day

Run the identical flow locally: `pnpm demo:up` (anvil fork of Sepolia with the real ENSv2 contracts). Say clearly "this is a local fork". Recorded Sepolia evidence (Etherscan links in `.pramaan/demo/state.json`) can be shown as recorded.

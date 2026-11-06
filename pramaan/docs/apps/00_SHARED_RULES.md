# Shared rules for the three Pramaan demo apps (read before VAULTLAB.md / MIRRORYIELD.md / PERMITMARKET.md)

You are building ONE demo dApp that Pramaan protects. The point of the demo apps is to be **realistic targets**: Pramaan (browser extension + ENS release records + monitoring) verifies them. The apps themselves contain **no security logic** — they are ordinary dApps.

Repo: `D:\Deven\1_Hackathon_proj\my\eth\Pramaan\pramaan` · Windows 11, PowerShell 5.1 (no `&&`; use `; if ($?) {}`), Node 20.20.2, pnpm 10.34.9, Foundry 1.8.7 (`~/.foundry/bin`). **No git** in this repo — never `git init`/commit.

## Layout (fixed — other agents rely on it)

```
apps/demos/                      package @pramaan/demos (exists: viem 2.57.7, vite 7.3.7)
  shared/        wallet.ts  config.ts  tx.ts  format.ts  base.css      ← owned by the INFRA agent
  vaultlab/      index.html  src/main.ts  src/*.ts  src/style.css  public/   ← VaultLab agent
  mirroryield/  index.html  src/…                                     ← MirrorYield agent
  permitmarket/ index.html  src/…   fixtures/leak.html  fixtures/leak.ts   ← PermitMarket agent
  scripts/build.mjs   server/serve.mjs   test/                       ← INFRA agent
  dist/<appId>/  dist-fixtures/permitmarket/                        ← build output (gitignored)
```
App agents edit ONLY their own folder. Need something in `shared/`? Use what exists; if missing, implement it locally inside your app folder and say so in your report (don't edit shared/).

## Stack
Vanilla TypeScript + Vite + viem (no React — keeps bundles small; MirrorYield's tamper demo patches the built JS). Plain CSS with design tokens on `:root`, light + dark (`prefers-color-scheme`). Responsive (works at 360 px width). Accessible (labels, focus states, contrast).

## Shared module API (implemented by the infra agent in `apps/demos/shared/`)
```ts
// config.ts — values injected at build time by scripts/build.mjs via import.meta.env.VITE_PRAMAAN_APP (JSON string)
export interface AppConfig { appId: "vaultlab"|"mirroryield"|"permitmarket"; name: string; chainId: number; chainName: string;
  rpcUrl: string; explorer: string | null; ensName: string; origin: string; contracts: Record<string, `0x${string}`>; }
export function getConfig(): AppConfig;                 // throws a visible error if config missing
// wallet.ts — EIP-6963 discovery + EIP-1193 fallback
export function discoverWallets(): Promise<{ info: { name: string; icon: string; rdns: string }, provider: EIP1193Provider }[]>;
export function connect(provider): Promise<{ address: `0x${string}`, walletClient, publicClient }>;
export function ensureChain(provider, cfg: AppConfig): Promise<void>;   // wallet_switchEthereumChain / wallet_addEthereumChain
export function onAccountsChanged(cb), onChainChanged(cb);
// tx.ts
export function sendTx(opts: { label: string; request: () => Promise<`0x${string}`> }, ui: TxUi): Promise<TxReceipt>;  // pending → mined/failed, shows hash + explorer link
export function txLink(cfg, hash): string | null;          // null on local chain
// format.ts
export function fmtUnits(v: bigint, decimals: number, max = 4): string; export function shortAddr(a: string): string;
```
Contract ABIs: import from Foundry artifacts at build time is NOT possible in the browser — use viem `parseAbi([...])` with the exact function signatures from `contracts/src/demo/*.sol`.

## Contracts (already written — read the .sol files; don't change them unless your spec says so)
- `DemoToken.sol` → **pUSD** (6 decimals, ERC-20 + EIP-2612 permit, `faucet()` with cooldown → `FaucetCooldown(availableAt)`).
- `DemoNFT.sol` → **pNFT** (`mint()` with a per-address limit → `MintLimit()`).
- `VaultV2.sol` (fixed vault, UUPS proxy), `VulnerableVault.sol` (deliberately vulnerable), `VaultV3Unaudited.sol` (upgrade-alert demo).
- `MirrorYieldFarm.sol`, `PermitMarketplace.sol`.
Decode custom errors in the UI (viem `BaseError.walk` / `ContractFunctionRevertedError`) and show them in plain words.

## Rules (mandatory)
- **Every button does a real thing** (an on-chain read/write through the user's wallet or a real navigation). No mock data, no fake balances, no fake "Secure ✓" badges. If something can't load, show the real error.
- **No hardcoded addresses, chain ids, RPC URLs or ENS names** — everything from `getConfig()`.
- **No security verdicts in the app.** Never show "Verified by Pramaan" from the app itself — only the extension decides. (Showing *published evidence files* is fine in VaultLab, labelled as "published by the developer".)
- No private keys, no seed phrases, no analytics/trackers in production builds (only PermitMarket's separate fixture).
- Show every tx hash with an explorer link when `explorer` is set (Sepolia), plain hash on the local chain.
- Handle: no wallet installed, user rejects, wrong network (offer switch), insufficient balance/allowance, faucet cooldown, pending tx, reverted tx, account change.

## Test before reporting done
1. `pnpm --filter @pramaan/demos typecheck` clean.
2. Your app builds through the infra build (`node apps/demos/scripts/build.mjs --state <file> --only <appId>`); if the infra agent hasn't delivered build.mjs yet, run `vite build` on your folder with a hand-written `VITE_PRAMAAN_APP` JSON.
3. Real chain smoke test on **your own anvil** port (VaultLab 9110-9119, MirrorYield 9120-9129, PermitMarket 9130-9139): `anvil --port 91x0`, deploy the needed contracts with `forge create` or a small viem script (fresh keys are fine on plain anvil), serve your dist on a port in your range, and run the flows with Playwright (installed) using an injected test wallet (see `apps/extension/test/extension.e2e.ts` for the `context.exposeFunction` wallet pattern) — every flow in your spec must actually mine a tx.
4. Never use ports 8545, 8787, 5173-5190 (the live demo).

## Deployment (all three apps)
- **Local**: built by `pnpm build:demos`, served by `pnpm demo:serve` (origins: VaultLab http://localhost:5180, MirrorYield http://localhost:5182, lookalike http://127.0.0.1:5183, PermitMarket http://localhost:5184).
- **Hosted (Sepolia)**: `pnpm demo:up --network sepolia --origins …` builds each app with its final URL, then upload `apps/demos/dist/<appId>` unchanged to its own static-host project (Vercel/Netlify/Cloudflare Pages; disable asset optimisation; `no-store` cache header for `*.html` and `/.well-known/*`; SPA fallback not needed — multi-page static). The ENS record `pramaan.domain` must equal that URL exactly. See `docs/DEPLOY_SIMPLE.md`.

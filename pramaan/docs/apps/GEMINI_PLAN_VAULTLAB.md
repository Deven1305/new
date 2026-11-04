# GEMINI PLAN — VaultLab (do the steps in order; tick each one)

Read `docs/apps/GEMINI_INSTRUCTIONS.md` first, then `docs/apps/VAULTLAB.md` (what it is). Folder: `apps/demos/vaultlab/` only. Test chain port 9110, preview port 9111.

## Step 1 — create the files (empty for now)
```
apps/demos/vaultlab/index.html
apps/demos/vaultlab/vite.config.ts
apps/demos/vaultlab/tsconfig.json
apps/demos/vaultlab/src/vite-env.d.ts
apps/demos/vaultlab/src/main.ts
apps/demos/vaultlab/src/style.css
apps/demos/vaultlab/src/abi.ts
apps/demos/vaultlab/src/ui.ts
apps/demos/vaultlab/src/state.ts
apps/demos/vaultlab/src/lib/{config,wallet,tx,format,errors}.ts
apps/demos/vaultlab/src/sections/header.ts
apps/demos/vaultlab/src/sections/overview.ts
apps/demos/vaultlab/src/sections/actions.ts
apps/demos/vaultlab/src/sections/faucet.ts
apps/demos/vaultlab/src/sections/contracts.ts
apps/demos/vaultlab/src/sections/evidence.ts
apps/demos/vaultlab/test/config.local.json
apps/demos/vaultlab/test/smoke.md
```
Fill `lib/*`, `vite-env.d.ts`, `vite.config.ts`, `tsconfig.json`, `index.html` from GEMINI_INSTRUCTIONS sections 3–5. Title: "VaultLab — Pramaan demo vault".

## Step 2 — `src/abi.ts` (exact; from contracts/src/demo/VaultV2.sol and DemoToken.sol)
```ts
import { parseAbi } from "viem";
export const vaultAbi = parseAbi([
  "function version() view returns (string)",
  "function owner() view returns (address)",
  "function token() view returns (address)",
  "function totalEthDeposits() view returns (uint256)",
  "function totalTokenDeposits() view returns (uint256)",
  "function ethBalanceOf(address) view returns (uint256)",
  "function tokenBalanceOf(address) view returns (uint256)",
  "function deposit() payable",
  "function depositToken(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function withdrawToken(uint256 amount)",
  "error ZeroAmount()",
  "error InsufficientBalance(uint256 requested, uint256 available)",
  "error EthTransferFailed()",
]);
export const tokenAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function faucet()",
  "function lastFaucetAt(address) view returns (uint256)",
  "function FAUCET_AMOUNT() view returns (uint256)",
  "function FAUCET_COOLDOWN() view returns (uint256)",
  "error FaucetCooldown(uint256 availableAt)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
]);
```
Before writing, open `contracts/src/demo/VaultV2.sol` and confirm every line matches; fix any line that doesn't.
Add to `ERROR_TEXT` in `lib/errors.ts`: `InsufficientBalance: "You don't have that much in the vault."`, `EthTransferFailed: "The ETH transfer failed."`, `ERC20InsufficientBalance: "Your wallet doesn't have enough pUSD."`, `ERC20InsufficientAllowance: "Approve the vault for this amount first."`, `OwnableUnauthorizedAccount: "Only the vault owner (a timelock) can do that."`.
Config keys used: `contract("vault")`, `contract("token")`, `contract("upgradeTimelock")` (the last one is display-only; if it is missing, show "not configured").

## Step 3 — `src/state.ts`
A single object `state = { session: Session | null, decimals: 6, symbol: "pUSD", data: {...} }` and `refresh()` that reads with `publicClient().multicall` is NOT allowed (anvil has no multicall3) — use `Promise.all` of `readContract` calls: vault `version, owner, totalEthDeposits, totalTokenDeposits`, ETH balance of the vault (`getBalance`), token `decimals, symbol`; if connected also `tokenBalanceOf(user), ethBalanceOf(user)`, token `balanceOf(user), allowance(user, vault), lastFaucetAt(user)`, user ETH `getBalance`. After every successful tx and every 15 s: `refresh()` then re-render sections. Expose `subscribe(fn)`.

## Step 4 — `src/ui.ts`
`el(tag, attrs, ...children)` (uses `textContent` for strings), `escapeHtml(s)`, `toast(text, kind)` (bottom-right, auto-hide 5 s, `role="status"`), `statusLine()` returning `{node, set(text, kind)}`, `txLinkNode(hash)` (link from `txLink`, else monospace hash), `copyButton(text)`.

## Step 5 — sections (each exports `render(root: HTMLElement)` and re-renders on `subscribe`)
1. **header.ts** — logo text "VaultLab", network badge `chainName · id`, Connect button: `discoverWallets()`; if 1 wallet connect directly; if more, show a small picker (name + icon img with `src` only if it starts with `data:image/`). After connect show `short(address)` + copy + Disconnect (just clears `state.session`). Wrong chain → `ensureChain`. `onWalletEvents` → reconnect silently via `eth_accounts`.
2. **overview.ts** — cards: "Total pUSD deposited" (`totalTokenDeposits`), "Total ETH deposited", "Your vault pUSD", "Your vault ETH", "Vault version" (`version()`), "Upgrade authority" (owner address + text "Upgrades are timelocked: the owner is a TimelockController" — only if owner == `contracts.upgradeTimelock`, otherwise show just the owner address).
3. **actions.ts** — tabs Deposit | Withdraw, asset toggle pUSD | ETH, amount input + "Max" (deposit pUSD max = wallet pUSD; deposit ETH max = wallet ETH minus 0.01; withdraw max = vault balance). Validate with `parseAmount`. Deposit pUSD: if `allowance < amount` show button "1. Approve exactly N pUSD" → `approve(vault, amount)` (EXACT amount, never maxUint256) then "2. Deposit" → `depositToken(amount)`. Deposit ETH → `deposit()` with `value`. Withdraw → `withdrawToken(amount)` / `withdraw(amount)`. All through `sendTx`, disabled while busy or when not connected (title "Connect your wallet first").
4. **faucet.ts** — "Get 1,000 test pUSD" → `faucet()`. If `lastFaucetAt + FAUCET_COOLDOWN > now` disable the button and show "available in <countdown>".
5. **contracts.ts** — rows: Vault (proxy), pUSD token, Upgrade timelock; each with copy button; explorer address link only if `explorer` set (`${explorer}/address/${addr}`).
6. **evidence.ts** — title "Security evidence published by the developer". `fetch("/.well-known/pramaan/findings.json", {cache:"no-store"})`:
   - 404/failed → text "No security evidence is published with this release." (not an error toast).
   - success → array of `{id,title,class,severity,status,exploitTestSha256,evidenceSha256}`. For each, fetch `/.well-known/pramaan/evidence/<evidenceSha256>.json` (if evidenceSha256 not null). Render a card: id, title, severity chip, status chip, and a 5-step vertical timeline: (1) "Candidate found by static analysis", (2) "Exploit reproduced in a Foundry test" + `exploitTestSha256` first 12 chars, (3) "Fix proposed", (4) "Exploit re-run after fix: blocked" — mark ✔ only if the evidence JSON contains a fix verification with `verified === true` (search the JSON for a key named `fixVerification` / `verified`; if absent show "not part of this evidence"), (5) "Regression tests" with pass/fail counts if present. Unknown fields → show "—", never invent. Add "Download evidence JSON" link to the file. Footer: "Published by the developer and covered by the signed release manifest. Your Pramaan extension verifies it independently."
   - Validate the fetched JSON shape (arrays/strings) before use; render with `textContent` only.

## Step 6 — `src/main.ts`
Import `style.css`; call `getConfig()` inside try — on error render a full-page message with the error text and stop. Then render header, overview, actions, faucet, contracts, evidence into `#app` in that order inside `<main>`; footer: "Test network demo — no real funds · ENS: <ensName>".

## Step 7 — `src/style.css`
Tokens on `:root`: `--bg #0b1220, --panel #111a2e, --text #e6edf7, --muted #8a9bb8, --accent #19c3b3, --danger #ff5d6c, --ok #3ddc97, --radius 14px`; light theme override under `@media (prefers-color-scheme: light)`: bg #f5f8fc, panel #ffffff, text #0b1220. Numbers in `font-variant-numeric: tabular-nums`. Grid: 2 columns ≥ 900px, 1 column below. Visible focus ring `outline: 2px solid var(--accent)`.

## Step 8 — local chain test (run each line separately; from `contracts/`)
```powershell
cd D:\Deven\1_Hackathon_proj\my\eth\Pramaan\pramaan\contracts
$RPC = "http://127.0.0.1:9110"; $PK = "<anvil key #0>"; $OWNER = "<anvil address #0>"
& "$env:USERPROFILE\.foundry\bin\forge.exe" create src/demo/DemoToken.sol:DemoToken --rpc-url $RPC --private-key $PK --broadcast
& "$env:USERPROFILE\.foundry\bin\forge.exe" create src/demo/VaultV2.sol:VaultV2 --rpc-url $RPC --private-key $PK --broadcast
$INIT = & "$env:USERPROFILE\.foundry\bin\cast.exe" calldata "initialize(address,address)" $OWNER <TOKEN>
& "$env:USERPROFILE\.foundry\bin\forge.exe" create lib/openzeppelin-contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy --rpc-url $RPC --private-key $PK --broadcast --constructor-args <VAULTV2_IMPL> $INIT
```
(If `initialize` has different parameters in VaultV2.sol, use those.) `test/config.local.json`:
`{"appId":"vaultlab","name":"VaultLab","chainId":31337,"chainName":"Local test chain","rpcUrl":"http://127.0.0.1:9110","explorer":null,"ensName":"vaultlab.demo.eth","origin":"http://localhost:9111","contracts":{"vault":"<PROXY>","token":"<TOKEN>","upgradeTimelock":"<OWNER>"}}`
For the evidence card test: copy `.pramaan/demo/prove/` evidence if it exists into `apps/demos/vaultlab/public/.well-known/pramaan/` ONLY for the local test, then **delete that public folder afterwards** (the real build script writes it).

## Step 9 — checklist (all must be ✔ with tx hashes in test/smoke.md)
- [ ] Connect (MetaMask, anvil key #1), wrong-network switch works
- [ ] Faucet → pUSD balance +1000; second click shows cooldown
- [ ] Approve exact → allowance equals the amount (not unlimited)
- [ ] depositToken → "Your vault pUSD" and total update
- [ ] withdrawToken (partial) and withdraw too much → plain-words InsufficientBalance error
- [ ] ETH deposit + withdraw
- [ ] Reject in wallet → "You rejected the request in your wallet."
- [ ] Evidence card: with files → timeline; without → "No security evidence is published…"
- [ ] No hardcoded addresses in `src/` (search for `0x` + 40 hex) · typecheck clean · 360 px layout · light + dark
- [ ] `dist-local` and temporary `public/.well-known` deleted

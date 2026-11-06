# VaultLab — build spec (Demo 1: a real vulnerability, a real exploit, a verified fix)

Read `00_SHARED_RULES.md` first. You own ONLY `apps/demos/vaultlab/**`.

## Purpose in the demo
A developer's DeFi vault. Pramaan's PROVE engine found a real bug in the old vault (`VulnerableVault.withdrawAll()` has no access control → anyone drains it), reproduced it with a Foundry exploit test in a sandbox, generated the fix (`onlyOwner`), re-ran the exploit (now reverts with `OwnableUnauthorizedAccount`) and the regression suite. The **fixed** vault (`VaultV2` behind a UUPS proxy) is what this app uses and what the release lists. The app must look and feel like a real product: clean, trustworthy, "institutional DeFi" style (deep navy/teal, monospace numbers).

## Config contracts (from `getConfig().contracts`)
`vault` (VaultV2 proxy), `vaultImplementation`, `token` (pUSD), `upgradeTimelock` (OZ TimelockController that owns the vault). `VulnerableVault` and `VaultV3Unaudited` are **not** in this app's config — never call them.

## Contract calls (VaultV2 — check exact signatures in `contracts/src/demo/VaultV2.sol`)
- Reads: `version()`, `owner()`, `token()`, per-user token balance mapping/getter (read the source for its exact name), ETH balance, pUSD `balanceOf`, `allowance(user, vault)`, `decimals()`.
- Writes: `pUSD.faucet()`, `pUSD.approve(vault, exactAmount)` (exact amount only — this app is the "good" app), `vault.depositToken(amount)`, `vault.withdrawToken(amount)`, `vault.deposit()` (payable ETH), `vault.withdraw(amount)`.

## Screens / sections (single page)
1. **Header**: logo "VaultLab", network badge (chain name + id), wallet button (EIP-6963 picker if >1 wallet), connected address (short) + copy.
2. **Vault overview card**: TVL in pUSD and ETH (vault's token balance and ETH balance), your position, vault version string, owner address (show it is a TimelockController: "Upgrades are timelocked — owner is a TimelockController" with its address).
3. **Actions card** with tabs Deposit / Withdraw, asset switch pUSD | ETH: amount input with Max, validation (≤ balance, > 0), "Approve exact amount" step shown only when allowance < amount, then Deposit. Live tx status (pending → confirmed with link / failed with decoded reason).
4. **Faucet**: "Get 1,000 test pUSD" → `faucet()`; show cooldown error nicely.
5. **Contracts card**: vault proxy, implementation, pUSD, timelock — copy buttons, explorer links on Sepolia.
6. **Security evidence (published by the developer)** card: fetch `/.well-known/pramaan/findings.json` (written by the infra build from the PROVE run: array of `{id, title, class, severity, status, exploitTestSha256, evidenceSha256}`) and, per finding, `/.well-known/pramaan/evidence/<evidenceSha256>.json` (the engine's EvidenceV1 JSON: exploit result, fix verification, regression counts). Render a 5-step timeline per finding: *Candidate found → Exploit reproduced (Foundry test, sha256) → Fix proposed (onlyOwner) → Exploit re-run: blocked (revert reason) → Regression: N passed*. Fields come only from the JSON; if a file is missing say "no published evidence for this release". Footer note: "This evidence is published by the developer and covered by the signed release manifest. Your Pramaan extension verifies it independently." Download links for the JSON.
7. **Footer**: "Test network demo — no real funds", link to the ENS name (text only).

## What NOT to build
- No exploit button, no interaction with VulnerableVault or VaultV3Unaudited (the exploit runs in Pramaan's sandbox, not in the UI).
- No admin panel, no upgrade UI (upgrades are done by `pnpm demo:upgrade` in the CLI for the WATCH demo).
- No "verified ✓" badge of its own, no backend calls, no wallet-signature login, no unlimited approvals, no charts library.

## Done when
Typecheck clean; built via the infra build; on your anvil (ports 9110-9119) Playwright proves: faucet → approve exact → depositToken → balances update → withdrawToken → ETH deposit/withdraw; evidence card renders from a sample `findings.json` + evidence JSON copied from `.pramaan/demo/prove/` (if present) and shows "no published evidence" when absent. Report ≤ 250 words.

## Deployment
Local: `pnpm build:demos` + `pnpm demo:serve` → http://localhost:5180. Hosted: built with `--origins vaultlab=https://<url>` and uploaded from `apps/demos/dist/vaultlab` (see `00_SHARED_RULES.md` → Deployment). The evidence files live in the dist, so they are hashed into the release manifest — never edit them after the build.

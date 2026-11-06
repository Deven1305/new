# 05. Pramaan's three demo apps: which to use, what works, how to show Pramaan working

Source: `pramaan/apps/demos/` (specs in `pramaan/docs/apps/`). All three are **testnet-style demos that run on a local anvil fork of Sepolia**. They use one test token (pUSD). No real funds.

## Start them (needs Foundry; PROVE needs Docker)

```bash
cd pramaan
cd contracts && forge build && cd ..
pnpm pramaan sandbox build                 # once, Docker
pnpm demo:up --fixtures                    # runs PROVE, deploys, signs, activates; keep this terminal open
```

Then load the extension (`pnpm build:extension`, Chrome → Load unpacked → `pramaan/apps/extension/dist`) and use MetaMask or Rabby on the local chain (`http://127.0.0.1:8545`, chain id 31337). Make sure this chain shows up in the wallet as a custom network.

| App | URL | Story | Pramaan feature it proves |
|---|---|---|---|
| **VaultLab** | http://localhost:5180 | a vault with a real bug that PROVE found, exploited and fixed | **PROVE + PUBLISH**: the release carries a real finding (`PRM-3`, critical, fixed-verified); the app shows the 5-step evidence timeline |
| **MirrorYield** | http://localhost:5182 (genuine), http://127.0.0.1:5183 (lookalike) | honest contract, **tampered website** | **VERIFY**: edited JS turns the extension red, lookalike origin is "domain mismatch" |
| **PermitMarket** | http://localhost:5184, leak fixture `/__fixtures/leak.html` | dangerous permissions and a wallet-address leak | **Decode + privacy**: unlimited approval explained in EN/HI/MR, leak detected and blocked |

## Which to use for a demo

- **If you have 3 minutes: MirrorYield, then PermitMarket.** MirrorYield is the clearest "wow": the page looks identical, one click on `demo:tamper` and the wallet request is stopped. PermitMarket adds the multilingual explanation.
- **Add VaultLab** when the audience cares about "how was it proven safe": it is the only one that shows PROVE evidence (exploit reproduced, fix verified, regression count).
- Never show the fixture page as a real site. It is labelled `ATTACK FIXTURE` and only exists with `--fixtures`.

## Demo script (what to click, what to see)

1. **Verified (green).** Open MirrorYield. Extension popup: *Release verified*, rows Website / Contract / Action / Privacy green. Faucet → Approve exact → Stake. The wallet request is shown with a Pramaan review: spender is a contract **listed in the release**.
2. **Tamper.** In a second terminal: `pnpm demo:tamper`. Reload. Popup: *Mismatch*, red, listing the file whose hash changed. Try Stake: signing is **blocked** before the wallet sees it; the account nonce does not move. Real bytes on disk were changed (a farm address swapped for the attacker's).
3. **Restore.** `pnpm demo:restore`, reload: green again. (`pnpm demo:tamper status` shows original vs current sha256.)
4. **Lookalike.** Open http://127.0.0.1:5183: same files, different origin, so *domain mismatch*.
5. **Permissions.** PermitMarket → Buy → "Enable one-click buying" → the wallet asks for `approve(marketplace, 2^256-1)`. Pramaan: **UNLIMITED**, high risk, with a language switch (English / हिन्दी / मराठी). Reject it, then show "Approve exact amount" and "Sign permit" as the safe alternatives.
6. **Leak.** Open the fixture, Connect wallet, "send all": the popup lists the third party that received your address, says it was **not declared** in the release, and offers Block.
7. **Upgrade watch.** `pnpm demo:upgrade schedule` (VaultLab's TimelockController queues an upgrade to unaudited code): the popup shows *Update queued* with a countdown. `pnpm demo:upgrade execute --advance` advances the local clock and applies it; the contract row turns orange/red because the new implementation is not in the release.
8. **Malicious release change.** `pnpm demo:release queue-evil`, then as guardian `pnpm demo:release cancel --id N`.
9. **Backend off.** Stop the server (nothing on :8787): steps 1-3 still work. Verification never calls a Pramaan server.

## How to tell Pramaan is really working (and not just showing a badge)

| Check | What it proves |
|---|---|
| `pnpm pramaan verify http://localhost:5182` prints `VERIFIED`; after `demo:tamper` it prints a mismatch | the same checks as the extension, from outside the browser |
| the account **nonce** does not change after a blocked request | the wallet never saw the transaction |
| `pnpm demo:tamper status` shows two different sha256 values | the bytes really changed |
| `pnpm --filter @pramaan/extension exec playwright test -c playwright.config.ts test/v2.e2e.ts` with `PRAMAAN_EXPECT_BACKEND_OFF=1` | real Chromium, real extension, backend off: signed release, tamper, restore, pending, revoked all behave |
| `pramaan/docs/evidence/*.json` | recorded runs from the Pramaan team (browser E2E, Anon-RPC live on Sepolia, pending/revocation) |

## Honest limits (say these out loud)

- Runs on a local **fork**; there is no live Sepolia deployment.
- The extension compares *re-fetched* files, which can differ from what the browser executed, so it does not claim "loaded-byte integrity".
- Wallet interception works by wrapping the page's provider (EIP-6963 and `window.ethereum`); it is not universal wallet enforcement.
- A matching release is **not an audit** and not a guarantee of safety.
- Not run by the Pramaan team: `cre workflow simulate`, Telegram delivery, the GitHub Action/attestation, a manual MetaMask/Rabby run.
- Run in this merge on 7 Nov 2026 (Foundry 1.8.7, Docker, real PROVE): `demo:up --fixtures` brought up all three apps VERIFIED; PROVE reproduced 1 finding and verified its fix. See `08_VERIFICATION_REPORT.md` for the live results.

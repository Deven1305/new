# MirrorYield — build spec (Demo 2: honest contract, tampered website)

Read `00_SHARED_RULES.md` first. You own ONLY `apps/demos/mirroryield/**`.

## Purpose in the demo
A yield-farming dashboard on a **legitimate** contract (`MirrorYieldFarm`). The attack is on the **website**: an attacker who controls the CDN/CI swaps one address inside the built JavaScript so stakes/approvals go to the attacker. The contract is still fine — only Pramaan's extension notices, because the served JS no longer matches the hashes in the signed release (and the approval spender is not a listed contract). The tamper/restore itself is done by the infra agent's admin endpoint / `pnpm demo:tamper` by patching the built file on disk — **you must make that patch possible and robust**.
Style: modern "yield" look — dark violet/green gradient accents, APR big and bold, cards with soft glow; must still look trustworthy.

## Config contracts
`farm` (MirrorYieldFarm), `token` (pUSD = staking and reward token). (The infra build also knows an `attacker` address — NOT in your config.)

## Contract calls (`contracts/src/demo/MirrorYieldFarm.sol`)
- Reads: `stakingToken()`, `rewardToken()`, `totalSupply`/total staked and `balanceOf(user)` (check exact names in the source), `earned(user)`, `rewardRate()`, `periodFinish()`, `rewardsRemaining()`, `lastTimeRewardApplicable()`; pUSD `balanceOf`, `allowance(user, farm)`.
- Writes: `pUSD.faucet()`, `pUSD.approve(farm, exactAmount)`, `stake(amount)`, `unstake(amount)`, `claim()`, `exit()`.
- Errors to explain: `ZeroAmount`, `InsufficientStake`, `NothingToClaim`.

## Screens (single page)
1. Header: "MirrorYield", network badge, wallet button.
2. **Pool card**: "pUSD → pUSD single-asset pool"; APR computed from chain state: `APR = rewardRate * 31_536_000 / totalStaked * 100` (show "—" when totalStaked = 0 or period finished; label "variable, from on-chain reward rate"); total staked; rewards remaining; period ends (countdown from `periodFinish`).
3. **Your position**: staked, pending rewards (`earned`, refresh every 10 s and after each tx), wallet pUSD.
4. **Actions**: Stake (approve exact amount if needed → stake), Unstake, Claim, Exit — with tx status and decoded errors. Faucet button.
5. Contracts card (farm + token, copy, explorer links).
6. Footer: "Test network demo — no real funds".

## Tamper-ability requirement (critical — coordinate via your report)
- The farm address must reach the bundle as one contiguous string literal (it does if it comes from `getConfig()` → `import.meta.env.VITE_PRAMAAN_APP` JSON, which Vite inlines). Do NOT split/obfuscate/lower-case it, and use the address from config for **every** farm interaction (approve spender, stake target, reads) so a single replacement redirects all of them.
- Add a test (`apps/demos/test/mirroryield-tamper.test.ts` is owned by infra — instead put yours in `apps/demos/mirroryield/test/`) that builds the app with a known address and asserts the address appears exactly as a literal (checksummed form as given in config) in exactly one emitted JS asset. Report the asset name pattern and how the address appears so the infra agent's patcher matches it.
- The page must still work after the patch (it then talks to the attacker address) — that's the realism: the UI looks identical.

## What NOT to build
- No tamper button or "tampered mode" in the UI (tampering must be real bytes on disk, done by infra).
- No integrity checks, hashes or warnings in the app itself (that's Pramaan's job).
- No LP pairs, swaps, multiple pools, price oracles, charts library, backend calls, analytics.

## Done when
Typecheck clean; built via infra build; Playwright on your anvil (ports 9120-9129): deploy pUSD + farm, fund rewards (`fundRewards` as owner), faucet → approve exact → stake → wait/advance time (`evm_increaseTime` + mine) → earned > 0 → claim → unstake → exit; the literal-address test passes. Report ≤ 250 words incl. the exact literal form for the patcher.

## Deployment
Local: http://localhost:5182 (genuine) and http://127.0.0.1:5183 (same files on a lookalike origin → Pramaan shows domain mismatch). Tamper locally: `pnpm demo:tamper` → reload → extension red → `pnpm demo:restore` → green. Hosted: upload `apps/demos/dist/mirroryield` to its static project; to show tampering when hosted, deploy a patched build to the same project (simulated CDN compromise) and roll back to the original deployment afterwards (Vercel: "Promote to Production" on the previous deployment).

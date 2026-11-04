# GEMINI PLAN — MirrorYield (do the steps in order; tick each one)

Read `docs/apps/GEMINI_INSTRUCTIONS.md` first, then `docs/apps/MIRRORYIELD.md`. Folder: `apps/demos/mirroryield/` only. Test chain port 9120, preview 9121.

## Step 1 — create the files
```
apps/demos/mirroryield/index.html  vite.config.ts  tsconfig.json
apps/demos/mirroryield/src/vite-env.d.ts  main.ts  style.css  abi.ts  ui.ts  state.ts
apps/demos/mirroryield/src/lib/{config,wallet,tx,format,errors}.ts
apps/demos/mirroryield/src/sections/{header,pool,position,actions,faucet,contracts}.ts
apps/demos/mirroryield/test/config.local.json  test/smoke.md  test/literal-check.mjs
```
Copy lib/vite/tsconfig/index.html from GEMINI_INSTRUCTIONS (title "MirrorYield — stake pUSD, earn pUSD"). `ui.ts` = same helpers as the VaultLab plan step 4.

## Step 2 — `src/abi.ts` (confirm each line against contracts/src/demo/MirrorYieldFarm.sol)
```ts
import { parseAbi } from "viem";
export const farmAbi = parseAbi([
  "function stakingToken() view returns (address)",
  "function rewardToken() view returns (address)",
  "function rewardRate() view returns (uint256)",
  "function periodFinish() view returns (uint256)",
  "function totalStaked() view returns (uint256)",
  "function totalRewardsFunded() view returns (uint256)",
  "function totalRewardsPaid() view returns (uint256)",
  "function stakedOf(address) view returns (uint256)",
  "function earned(address) view returns (uint256)",
  "function rewardsRemaining() view returns (uint256)",
  "function stake(uint256 amount)",
  "function unstake(uint256 amount)",
  "function claim()",
  "function exit()",
  "error ZeroAmount()",
  "error InsufficientStake(uint256 requested, uint256 available)",
  "error NothingToClaim()",
]);
export const tokenAbi = /* identical to the VaultLab plan's tokenAbi */;
```
ERROR_TEXT additions: `InsufficientStake: "You can't unstake more than you have staked."`, `NothingToClaim: "You have no rewards to claim yet."`, plus the ERC20 ones from the VaultLab plan.
Config keys: `contract("farm")`, `contract("token")`.

## Step 3 — THE TAMPER RULE (most important part of this app)
The Pramaan demo later replaces the farm address inside the built JavaScript to simulate a hacked website. For that to work:
1. Read the farm address in exactly ONE place: `export const FARM = contract("farm");` in `src/state.ts`. Every read, every `approve` spender and every write uses `FARM`. Never `.toLowerCase()`, split, or rebuild it.
2. Do not store addresses anywhere else (no localStorage, no URL params).
3. The app must keep working when `FARM` is a different address (it will just show that address's state).
4. `test/literal-check.mjs` (plain Node script): reads every `.js` file in `apps/demos/mirroryield/dist-local/assets`, counts occurrences of the farm address string exactly as written in `test/config.local.json`; prints the file name and count; exits 1 unless the total count ≥ 1 and all occurrences are in ONE file. Run: `node apps/demos/mirroryield/test/literal-check.mjs`. Report the output (it tells the infra engineer how to patch).

## Step 4 — `src/state.ts`
`refresh()` with `Promise.all` of `readContract`: farm `rewardRate, periodFinish, totalStaked, rewardsRemaining, totalRewardsPaid`, token `decimals, symbol`; if connected: `stakedOf(user)`, `earned(user)`, token `balanceOf(user)`, `allowance(user, FARM)`, `lastFaucetAt(user)`. Poll every 10 s (pending rewards grow). `subscribe(fn)`.

## Step 5 — sections
1. **header.ts** — "MirrorYield" wordmark, network badge, wallet connect (same behaviour as VaultLab plan).
2. **pool.ts** — big APR number. Formula with bigint, then to number only for display:
   `if (totalStaked == 0n || now >= periodFinish) APR = "—"` else `aprPct = Number(rewardRate * 31_536_000n * 10_000n / totalStaked) / 100` → show `aprPct.toFixed(2) + "%"` with caption "variable, from the on-chain reward rate". Also: Total staked, Rewards remaining, Rewards paid so far, "Reward period ends in <countdown(periodFinish)>" or "Reward period ended".
3. **position.ts** — Your stake, Pending rewards (`earned`, refreshed every 10 s), Wallet pUSD.
4. **actions.ts** — Stake: amount + Max; if `allowance < amount` → "1. Approve exactly N pUSD" → `approve(FARM, amount)` → "2. Stake" → `stake(amount)`. Unstake: amount + Max (= stakedOf) → `unstake`. Claim → `claim()` (disabled with title when earned == 0). Exit → `exit()` (disabled when stakedOf == 0 and earned == 0). All via `sendTx`.
5. **faucet.ts** — same as VaultLab.
6. **contracts.ts** — Farm and pUSD rows with copy + explorer link (only when explorer set).

## Step 6 — main.ts + style.css
main as in VaultLab plan (pool, position, actions, faucet, contracts). Style: tokens `--bg #0d0a1a, --panel #171230, --text #efeaff, --muted #a59cc9, --accent #7c5cff, --accent2 #2de0a7`, light override (bg #f7f5ff, panel #fff, text #160f33); APR number 48px bold with a subtle gradient text (`background-clip:text`), cards with soft glow `box-shadow: 0 0 24px rgba(124,92,255,.15)`. No animations > 200 ms; respect `prefers-reduced-motion`.

## Step 7 — local chain test (from `contracts/`, each line separately)
```powershell
$RPC = "http://127.0.0.1:9120"; $PK = "<anvil key #0>"; $OWNER = "<anvil address #0>"
& "$env:USERPROFILE\.foundry\bin\forge.exe" create src/demo/DemoToken.sol:DemoToken --rpc-url $RPC --private-key $PK --broadcast
& "$env:USERPROFILE\.foundry\bin\forge.exe" create src/demo/MirrorYieldFarm.sol:MirrorYieldFarm --rpc-url $RPC --private-key $PK --broadcast --constructor-args <TOKEN> <TOKEN> $OWNER
& "$env:USERPROFILE\.foundry\bin\cast.exe" send <TOKEN> "approve(address,uint256)" <FARM> 100000000000 --rpc-url $RPC --private-key $PK
& "$env:USERPROFILE\.foundry\bin\cast.exe" send <FARM> "fundRewards(uint256,uint256)" 100000000000 2592000 --rpc-url $RPC --private-key $PK
```
(The deployer holds the 1,000,000 pUSD treasury; 100,000 pUSD over 30 days funds the pool. Check `fundRewards` parameters in the .sol and adjust.) Write `test/config.local.json` like the VaultLab one with `"appId":"mirroryield"`, `"contracts":{"farm":"<FARM>","token":"<TOKEN>"}`, origin `http://localhost:9121`. To see rewards grow fast: `cast rpc evm_increaseTime 3600 --rpc-url $RPC` then `cast rpc evm_mine --rpc-url $RPC`.

## Step 8 — checklist (tx hashes in test/smoke.md)
- [ ] Connect, faucet, approve exact, stake → position + total staked update, APR shows a number
- [ ] After evm_increaseTime: pending rewards > 0 → claim → wallet pUSD increases
- [ ] Unstake partial; unstake too much → plain-words InsufficientStake; claim with 0 → disabled/NothingToClaim text
- [ ] Exit returns stake + rewards
- [ ] `literal-check.mjs` passes and its output is in your report
- [ ] No tamper button, no hash/integrity code, no hardcoded addresses · typecheck clean · 360 px · light + dark
- [ ] `dist-local` deleted at the end (after running literal-check)

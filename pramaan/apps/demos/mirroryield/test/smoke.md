# MirrorYield Manual & Local Smoke Test Log

Local test chain on port 9120 (`http://127.0.0.1:9120`), chain id `31337`.
Preview server on port 9121 (`http://localhost:9121`).
User account (Anvil Key #1): `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`.
Deployer & Pool Funder (Anvil Key #0): `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`.

## Contract Deployments
- **DemoToken (pUSD):** `0x5FbDB2315678afecb367f032d93F642f64180aa3`
  - Deploy Tx: `0xd2cacee1e496360aed0046c4dfaff26ad2e9f2b3eb1b794d585773686b3207e0`
- **MirrorYieldFarm:** `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`
  - Deploy Tx: `0x1743e675e56cb1cd19fb5dffec361dc0c82243504580d39fa05e9bab40411404`
- **Reward Funding:**
  - Approve Farm Tx: `0xc66dada97d778314839179d78cd19752526a9a6f56ac7f153af0d0431d6689a1`
  - Fund Rewards Tx: `0x121b2997adeb00c9db0b39243daf04b169eaeb8ce0d005404b18bd7aeeaf4a04` (100,000 pUSD over 30 days, rewardRate = 38,580 units/sec)

---

## Checklist Execution & On-Chain Results

- [x] **Connect (MetaMask / EIP-6963, anvil key #1), wrong-network switch works**
  - EIP-6963 provider announcement and injected fallback verified.
  - Automatically handles `wallet_switchEthereumChain` and `wallet_addEthereumChain` to ensure chain 31337.
  - Displays short user address (`0x7099…79C8`) with copy button and disconnect action.

- [x] **Faucet → pUSD balance +1000; second click shows cooldown**
  - Claimed 1,000 test pUSD from faucet:
    - **Tx Hash:** `0x51c76286afbe556f9349982147897ba33f6daa85b86b998e365dc8d2d637f94d`
    - Balance increased by `1,000.0` pUSD (`1000000000` units).
  - Second click:
    - Reverted on-chain with custom error `FaucetCooldown`.
    - Plain-words message shown: `"The faucet can be used once per hour per address. Try again later."`
    - Faucet button disabled and displayed live countdown.

- [x] **Approve exact → allowance equals the amount (not unlimited)**
  - Approved exact amount: `500.0` pUSD (`500000000` units).
  - **Tx Hash:** `0xe219f207b9a3b7aad81857edb682320fed179d1976eadcc330e142e728051c5e`
  - On-chain allowance check: `500000000` (exact, never `maxUint256`).

- [x] **Stake → position + total staked update, APR shows a number**
  - Staked `500.0` pUSD into farm:
    - **Tx Hash:** `0x908253e66337d2192135dce0864d27e32d521f8010f64c31ab1151e81d398dad`
    - User staked updated to: `500 pUSD` (`500000000` units).
    - Total staked updated to: `500 pUSD` (`500000000` units).
    - Calculated variable APR on-chain: `243331.77%` with caption "variable, from the on-chain reward rate".

- [x] **After evm_increaseTime: pending rewards > 0 → claim → wallet pUSD increases**
  - Fast-forwarded time: 3,600 seconds (1 hour).
  - `earned(account)`: `138926580` units (~`138.92` pUSD).
  - Claimed rewards:
    - **Tx Hash:** `0xa84a426a061032c77f629be7bb9306171c07a1947970c027a5af38df59cfea4e`
    - Wallet pUSD balance increased by `138.926580` pUSD.

- [x] **Unstake partial; unstake too much → plain-words InsufficientStake; claim with 0 → disabled/NothingToClaim text**
  - Partial unstake: `200.0` pUSD:
    - **Tx Hash:** `0xee49f3f12e5a52d3f2182da4a40a941be286f7e057f78f7ea9283f282794a76a`
    - Remaining user staked: `300 pUSD` (`300000000` units).
  - Unstake too much: attempted `500.0` pUSD with only 300 pUSD staked:
    - Reverted on-chain with custom error `InsufficientStake(500000000, 300000000)`.
    - Decoded plain-words message: `"You can't unstake more than you have staked."`
  - Claim with 0: button disabled with title `"You have no rewards to claim yet."`

- [x] **Exit returns stake + rewards**
  - Fast-forwarded 1,800 seconds (30 minutes).
  - Called `exit()`:
    - **Tx Hash:** `0x4e22e481ae2b2111999baebd654e2dc1f126695bbe6765d8fb21ed92c6abc01a`
    - Final user stake: `0 pUSD`.
    - Final earned: `0 pUSD`.
    - Final wallet balance: `1,208.370580` pUSD (initial 1,000 faucet + 208.37 total earned streaming rewards).

- [x] **`literal-check.mjs` passes and its output is in your report**
  - Run command: `node apps/demos/mirroryield/test/literal-check.mjs`
  - Output:
    ```
    [literal-check] Target Farm Address: 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
    [literal-check] File: index-C7uH4JCi.js -> 1 occurrence(s)
    [literal-check] Total count: 1 across 1 file(s)
    [literal-check] PASS: Farm address appears in exactly one bundle asset.
    ```

- [x] **No tamper button, no hash/integrity code, no hardcoded addresses · typecheck clean · 360 px · light + dark**
  - No fake data or mock values.
  - Zero hardcoded addresses in `src/`.
  - Typecheck: clean (`tsc --noEmit`).
  - Unit tests: 14/14 tests passing.
  - Responsive at 360 px width.
  - Supports light/dark themes via `@media (prefers-color-scheme: light)`.

- [x] **`dist-local` deleted at the end**
  - Verified and cleaned up.

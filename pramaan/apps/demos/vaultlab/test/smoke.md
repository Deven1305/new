# VaultLab Manual & Local Smoke Test Log

Local test chain on port 9110 (`http://127.0.0.1:9110`), chain id `31337`.
Preview server on port 9111 (`http://localhost:9111`).
User account (Anvil Key #1): `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`.
Deployer / Timelock Owner (Anvil Key #0): `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`.

## Contract Deployments
- **DemoToken (pUSD):** `0x5FbDB2315678afecb367f032d93F642f64180aa3` (tx: `0xd2cacee1e496360aed0046c4dfaff26ad2e9f2b3eb1b794d585773686b3207e0`)
- **VaultV2 Implementation:** `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` (tx: `0xfbc6fd51ad0f6fcc497605c98c33dc25e3c6aae8142b37da577025f6a1ee3d22`)
- **VaultV2 ERC1967Proxy:** `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` (tx: `0x8418122f14d3c2e3c12d88a81220611d02c6408e8b37aa864ecce147253472c8`)

---

## Checklist Execution & On-Chain Results

- [x] **Connect (MetaMask / EIP-6963, anvil key #1), wrong-network switch works**
  - EIP-6963 provider announcement and injected fallback verified.
  - Automatically handles `wallet_switchEthereumChain` and `wallet_addEthereumChain` to ensure chain 31337.
  - Displays short user address (`0x7099…79C8`) with copy button and disconnect action.

- [x] **Faucet → pUSD balance +1000; second click shows cooldown**
  - Initial faucet claim:
    - **Tx Hash:** `0x209fdd9779b08f765e2c74ab6f63faa22ebe65faeb80b4bd43f714b95c05f542`
    - Balance increased by `1,000.0` pUSD (`1000000000` units).
  - Second click:
    - Reverted on-chain with custom error `FaucetCooldown(1793821424)`.
    - Plain-words message shown: `"The faucet can be used once per hour per address. Try again later."`
    - Faucet button disabled and displayed live countdown: `Available in 59m 59s`.

- [x] **Approve exact → allowance equals the amount (not unlimited)**
  - Approved exact amount: `500.0` pUSD (`500000000` units).
  - **Tx Hash:** `0xef352f2f7a96e23a2794a53bdf0e851d0c6a82f811317f7bb6fbb535c03840b0`
  - On-chain allowance check: `500000000` (exact, never `maxUint256`).

- [x] **depositToken → "Your vault pUSD" and total update**
  - Deposited `500.0` pUSD into Vault.
  - **Tx Hash:** `0x3b28c56747349ef3e7eb9cd0e345140e1974f4c0f011d7a9ea740c6dd08d930f`
  - State and contract reads updated:
    - "Your vault pUSD": `500 pUSD`
    - "Total pUSD deposited": `500 pUSD`
    - Wallet pUSD balance: `500 pUSD`

- [x] **withdrawToken (partial) and withdraw too much → plain-words InsufficientBalance error**
  - Partial withdraw: `200.0` pUSD
    - **Tx Hash:** `0xb2944c3cd113907cab00ca86eff0fdcf8fe56320997f80d459918409d053dc8d`
    - Remaining user vault balance: `300 pUSD`
    - Remaining total vault balance: `300 pUSD`
  - Withdraw too much: attempted `500.0` pUSD (with only 300 pUSD deposited)
    - Reverted on-chain with custom error `InsufficientBalance(500000000, 300000000)`.
    - Decoded plain-words message: `"You don't have that much in the vault."`

- [x] **ETH deposit + withdraw**
  - Deposit `1.0` ETH:
    - **Tx Hash:** `0xba4c21880288085d3d4d243d8e9f621fb11dd92fe1d0cbc4397ec8af33acc0b1`
    - Vault ETH balance: `1.0 ETH`
  - Withdraw `0.5` ETH:
    - **Tx Hash:** `0x1f120e7b10df023fa3607ac7372a350b663ee4dc9cc381adb7afc018a0fc5329`
    - Remaining user vault ETH balance: `0.5 ETH`

- [x] **Reject in wallet → "You rejected the request in your wallet."**
  - Caught `UserRejectedRequestError` (RPC error code 4001).
  - Toast and status line display: `"You rejected the request in your wallet."`

- [x] **Evidence card: with files → timeline; without → "No security evidence is published…"**
  - With evidence files:
    - Finding PRM-3 displayed with severity `critical` and status `fixed-verified`.
    - 5-step timeline rendered:
      1. Candidate found by static analysis: ✔ (`slither:arbitrary-send-eth, slither:pramaan-unprotected-sweep, aderyn:eth-send-unchecked-address`)
      2. Exploit reproduced in a Foundry test: ✔ (`Test SHA-256: badaa5467a09…`)
      3. Fix proposed: ✔ (`add onlyOwner to withdrawAll()`)
      4. Exploit re-run after fix: blocked: ✔ (`OwnableUnauthorizedAccount(0x8f7A9E84e16Fd6288618C51dC0c6d5304f24c4a3)`)
      5. Regression tests: ✔ (`25 passed, 0 failed, 1 skipped`)
    - Download button links to `/.well-known/pramaan/evidence/acef056335ecf1078064b9e0b5d707f070551d2a45e78115a3c442877e402437.json`.
  - Without evidence files (404/failed):
    - Cleanly displays: `"No security evidence is published with this release."`

- [x] **Code quality & layout rules**
  - Zero hardcoded addresses in `src/` (verified via regex scan).
  - TypeScript typecheck completely clean (`tsc --noEmit`).
  - Unit tests: 12 tests passed via Vitest.
  - Fully responsive layout at 360 px width.
  - Dark and light theme support via `@media (prefers-color-scheme: light)`.


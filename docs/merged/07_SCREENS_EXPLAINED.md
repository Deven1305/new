# 07. What each screen, page and colour means

## Colours everywhere

| Colour | Meaning | Rule |
|---|---|---|
| 🟢 GREEN | proven or approved | only when every check actually passed |
| 🟠 AMBER | not cleared: new, pending, or unsupported | HexFence: "new recipient, we will not block it". Pramaan: a change is queued, or the feature is unsupported |
| 🔴 RED | mismatch, lookalike, revoked, or dangerous | HexFence: Safe will refuse (if Guard active). Pramaan: signing is held |
| ⚪ GREY | could not check | **never** shown as green. Network failed, unsupported type, delegatecall |

Overall = worst row. Grey beats green.

## HexFence Pay (`apps/pay`)

Four numbered sections, top to bottom.
1. **Wallet**: choose a wallet (EIP-6963 list). "Connect a wallet to sign and send, or use the live preview below" means you can check without connecting.
2. **Safe**: enter/load the Safe. Shows version and threshold (e.g. "v1.4.1 · 1/2"), and whether the Guard is active ("Guard active" / not). The read route badge: **"Nox reads active"** = the Safe's payee list was read through the Nox mixnet (the address you check is not exposed to an RPC); **"Direct reads · not anonymous"** = normal RPC.
3. **Payment**: Recipient, amount, **Check payment**. The verdict card:
   - RED "Possible address poisoning." = the recipient shares the first 4 + last 4 characters with an approved payee but is a different address. Third sentence: "Your protected Safe will refuse this payment" (or "Guard is not active… nothing on-chain will stop this" if it is not).
   - RED "listed in public poisoning evidence" = exact address appears in Arkiv evidence (status always *suspected*).
   - AMBER "New recipient… HexFence will not block this payment. Check the full address with the recipient."
   - GREEN "Approved payee".
   - GREY "Cannot verify this transaction type. HexFence checks only ETH and ERC-20 transfers." or a delegatecall (the Guard refuses delegatecalls).
   An **Address X-Ray** puts two addresses side by side and highlights the differing characters (a lookalike differs in the middle only). Forcing a lookalike send requires typing the last 6 characters; the Guard then reverts on-chain and Pay shows the decoded revert `LookalikeOfApprovedPayee`.
   An ERC-7730 panel explains a call without changing the verdict.
4. **Setup**: enable the Guard on your Safe; add/remove **approved payees**. Setup is where the protection is created.
A language toggle switches English / हिन्दी (Hindi text is **not yet checked by a native speaker**).

## HexFence Explorer (`apps/explorer`)

Tabs: **Evidence** (table: Block, Pattern, Token, Lookalike, Status; "Showing N of N publisher records"), **Losses**, **Campaigns**, **Check my address**.
- *Evidence* = poisoning pairs found on Ethereum mainnet, read from Arkiv. Status is always **suspected**; **X-Ray** compares the two addresses; **Verify on Ethereum** re-checks both transactions on chain.
- *Losses* = a suspected payment that followed a planting, shown as a lead with a downloadable pack, **not** a confirmed loss.
- *Campaigns* = records grouped by the attack transaction.
- *Check my address* = compare an address against the evidence in your browser; it never leaves the device.
- "Publisher …" line = whose Arkiv records you are reading; extra publishers can be added.

## HexFence landing + guided demo (`apps/site`)

`index.html` is the pitch. `demo.html` ("Watch one lookalike payment fail") walks: the problem, the same-start-same-end addresses, the Safe and its Guard, "Before you sign: three verdicts", "At execution: the Guard decides", then "Do it yourself" (Check a payment, Inspect the evidence). Each status on it is read live.

## HexFence extension review window

Title **HexFence payment review**, shown before the wallet. Heading is the level (RED / AMBER / GREEN or **CANNOT VERIFY**), the sentences above, the recipient with X-Ray, and Reject / Continue. A RED requires typing the last 6 characters to continue (`mayContinue` policy).

## Pramaan extension

**Popup** (click the icon on a page):
- Status line: *Release verified* (green), *No Pramaan release* (grey, the site publishes none), *Mismatch* (red), *Invalid signature*, *Release revoked*, *Could not verify*, *Checking…*, *Update queued* (amber, with countdown).
- **Checks** rows: **Website** (file hashes vs the signed manifest), **Contract** (bytecode / proxy implementation vs the release), **Action** (what the current request does), **Privacy** (who received your address).
- **Files**: each file, match / changed / missing. **Contracts in this release**: names and addresses. **Security findings in this release**: PROVE results with their status (e.g. fixed-verified).
- **Address sharing observed on this page**: third parties that received your wallet address, whether they were *declared* in the release, with **Block / Unblock**. "No third party was seen receiving your address (observed, not proven)".
- **Privacy: how Pramaan read the chain**: every read, with its route (**Anon-RPC**, direct-fallback with the reason, or direct-local), what each provider *can* and *cannot* see. "What Pramaan cannot observe in Chrome (MV3)" lists honest blind spots. "A wallet on this page could not be guarded" appears when a wallet could not be wrapped.
- Buttons: *Verify again*, *Settings*, *Dashboard*. Language selector.

**Review window** ("Review before you sign"): shown when a page asks the wallet to sign.
- Headline in plain words (e.g. "Give 0x2222…2222 unlimited permission to spend your 0x1111…1111"), risk chips (Critical / High risk / Needs attention / Low risk / Info), Details, and **Raw request**.
- Rows Website / Contract / Action / Privacy as above.
- "Project's own description (ERC-7730)" is the developer's own description of the call, shown separately from Pramaan's decoding.
- **Reject** or **Continue to wallet**. If the check is red or unknown: "Signing is blocked because the website or contract does not match its published release"; you may tick *I understand Pramaan could not confirm this request… and I want to continue anyway* then **Continue anyway**.
- "Pramaan lists what it checked. It never certifies a dApp as safe."
- "Pramaan restarted while this request was waiting, so it was rejected" = Chrome stopped the worker; the request fails closed. Ask the site to send it again.

**Options page**: language, RPC endpoints per chain (two independent ones for a real chain, one for the local chain), the Anon-RPC route switch (Sepolia only), IPFS gateways for fetching release manifests (bytes are checked against the ENS pointer), strict blocking of undeclared third parties, the developer dashboard URL, Save and Restore defaults.

## Pramaan dashboard (`apps/web`, developers only)

| Page | Meaning |
|---|---|
| Landing | the pitch: "Proven before you ship. Verified before you sign." and which parts work *without* the backend vs those that need the dashboard |
| `/verify` | paste a wallet request, get the deterministic explanation and risk level |
| `/demo` | local demo guide / current status |
| `/signin` | wallet sign-in (SIWE) |
| `/dashboard` | your projects and stats (private) |
| `/projects/:id/analysis` | PROVE jobs and progress |
| `/projects/:id/findings` and `/findings/:id` | each finding: **candidate** (scanner only) → **reproduced** (exploit test passed) → **fixed-verified** (exploit now fails and project tests still pass). Evidence JSON with hashes |
| `/projects/:id/releases` and `/releases/:id` | release manifests, signature, timelock state (queued / executed / revoked) |
| `/projects/:id/monitoring` | watched ENS records and proxies, alerts |
| `/settings` | tokens, accounts |
Footer states: "Backend degraded" = the server is up but the worker or Docker is missing (reason shown); "unreachable" = the server cannot be reached.

## Pramaan demo apps

- **VaultLab**: header with network badge and wallet; **Vault overview** (TVL, your position, version, owner = a TimelockController, so upgrades are delayed); **Actions** (Deposit / Withdraw, pUSD or ETH, "Approve exact amount" only when needed); **Faucet** (1,000 test pUSD); **Contracts** card; **Security evidence** card = the developer-published PROVE timeline: *Candidate found → Exploit reproduced → Fix proposed → Exploit re-run: blocked → Regression: N passed*.
- **MirrorYield**: pool card (APR computed on chain), your position and pending rewards, Stake / Unstake / Claim / Exit, faucet. It has no integrity UI of its own; **all warnings come from the extension**.
- **PermitMarket**: market grid of NFTs, buy dialog with three payment options (*one-click unlimited approve* = the dangerous one, *approve exact amount*, *sign permit*), My items (mint, approve marketplace, list, cancel). The leak page is a separate fixture.

## Merged check output (`pnpm merged:check`)

```
PASS  ETH to lookalike L (address poisoning)
      -> RED / confirm   rows: recipient:red(RESEMBLES_APPROVED_PAYEE), action:green(PRAMAAN_NO_FINDING)
```
`PASS` = the scenario matched its expected result (not that the payment is safe). `RED / confirm` = overall level and what the client must do: `pass` go on, `confirm` stop and ask, `block` refuse. Each row is `kind:level(code)`. The `action` row is Pramaan's view of what the call *does*; the `recipient` row is HexFence's view of *who gets paid*.

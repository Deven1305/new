# 11. The single extension: HexFence (Pramaan inside)

One Chrome extension now does both jobs. It lives in `pramaan/apps/extension` and is built to `pramaan/apps/extension/dist`. The old standalone HexFence extension (`apps/extension`) is superseded: **load only the new one**, or two extensions will both intercept your wallet requests.

## What it checks before you sign

| Row in the review window | Question | Comes from |
|---|---|---|
| **Website** | Is this the real app? Files vs the signed release (ENS, timelock, signature) | Pramaan |
| **Contract** | Is this the real contract? Deployed code and proxy implementation vs the release | Pramaan |
| **Recipient** *(new)* | Is this the real recipient? A Safe payment to a lookalike of an approved payee is RED | HexFence |
| **Action** | What does this request do? (EN / हिन्दी / मराठी, deterministic, no AI) | Pramaan |
| **Privacy** | Who received my wallet address? | Pramaan |

The **Recipient row** appears only for a Safe payment (a `SafeTx` typed-data signature or an `execTransaction` call). It reads the Safe's approved payees from the HexFence Guard and uses the same first-4 / last-4 rule as the on-chain Guard (the code is HexFence's own `@hexfence/shared`, bundled in, so the two can't drift apart). A lookalike is red and **blocking** like every red row: signing is held, and continuing needs the explicit "I understand" confirmation. Approved payee = green, new recipient = amber ("check the full address"), delegatecall / unsupported call = grey, Guard not active = the row says nothing on-chain will stop it. Unknown is never green.

One verdict, one window, one set of settings. The shared verdict package (`@hexfence/core`) and the offline `merged:verify` command use the same rows.

## Install

```powershell
pnpm extension:package                 # builds, writes release\hexfence-extension-0.1.0.zip
```
Then Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → `pramaan\apps\extension\dist` (or unzip the zip and pick that folder). After a rebuild click the reload arrow on the extension card and reload the tabs.

Remove the older "HexFence interception spike" and any previous "Pramaan" card first.

## Settings (extension options)
- **HexFence Guard per chain**: one `chainId=0xGuard` per line. Default: `11155111=0xA061fB511D69e5c92E50E3BE5c789472d6f19748` (the live Sepolia Guard v1). The demo test adds `31337=<guard>` for the local chain.
- RPC endpoints per chain, Anon-RPC, strict privacy, language: unchanged from Pramaan.

## Tested (7 Nov 2026)
- `pnpm extension:test`: 15 unit tests (the decision logic, plus 7 for the Recipient row: lookalike red for ETH and ERC-20, approved green, new amber, Guard-inactive wording, delegatecall/unsupported grey, unreadable never green, non-Safe requests get no row).
- Decoder and verifier suites (130 tests) including the EN/HI/MR completeness check: the new messages exist in all three languages.
- Real Chromium, real extension, **real `HexFenceGuard` deployed on the demo chain**, a Safe with that Guard and one approved payee: lookalike → RED Recipient row and the page's request rejected with code 4001; approved payee → green; new supplier → amber; the row is shown in Hindi and Marathi (`pnpm --dir pramaan --filter @pramaan/extension exec playwright test -c playwright.config.ts unified.e2e.ts`; needs `pnpm merged:up` running and the Guard contracts compiled).
- Pramaan's own self-contained browser tests (stopped worker fails closed, EIP-6963 + replaced `window.ethereum`, leak blocking, no backend) still pass on the merged build.

## Not tested / honest limits
- Not tried on the real `app.safe.global` with MetaMask and a real Sepolia Safe (item A in `10_REMAINING_WORK_HOWTO.md`). The Safe request shapes are decoded by HexFence's own tested parser, but Safe's real page has never driven this build.
- The earlier full Pramaan browser suite (13 tests) was **not** re-run against your live demo after this change, because those tests tamper with and revoke releases on the running demo. Run it on a fresh `merged:up` when you are not demoing.
- Evidence from Arkiv ("listed in public poisoning evidence") is not wired into the merged extension yet; the lookalike rule is.
- UI: the review window and popup still carry Pramaan's styling and icons. Better branding assets are future work.
- Chrome Web Store: not published. Distribution today is the zip (Load unpacked).

## Distribution options (after you have tested locally)
1. **GitHub Release zip** (free, fastest): the `merged-ci.yml` workflow builds the zip on every PR and attaches it to a release when you push a tag `ext-v0.1.0`. Judges Load unpacked.
2. **Chrome Web Store** (one-time US$5 developer fee, review takes days): upload the same zip. Needs a privacy policy URL and store screenshots; the extension requests `<all_urls>`, which triggers a slower review.
3. **Microsoft Edge Add-ons**: free; Chromium MV3 works unchanged.
Nothing is pushed or published by this repo until you decide.

## Why GitHub Pages cannot host the three Pramaan demo apps
Each demo app must have its **own origin** (its ENS record binds one origin per app), but every GitHub Pages project site of one account shares `https://<user>.github.io`. They need three separate hosts (Vercel / Netlify / Cloudflare Pages projects, or custom domains). They also need a **public chain**: today they point to your local fork (`127.0.0.1:8545`), so a hosted copy would show a page that cannot read any contract until Pramaan is deployed on Sepolia (item C). The HexFence sites (site, explorer, Pay) have no such limit and already deploy to GitHub Pages.

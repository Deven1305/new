# 06. Using it as a Chrome extension or as a website

There are **two extensions** and **several websites** today. The merge keeps both extensions (one MV3 base is phase 4 of the merge plan). Use them for different jobs.

| | **Pramaan extension** | **HexFence extension** |
|---|---|---|
| Question it answers | Is this the real app and contract? What does this request do? | Is this Safe payment going to a lookalike? |
| Works on | any website that publishes a Pramaan release (`/.well-known/pramaan.json`); **demo apps** | `https://app.safe.global/` only |
| Intercepts | `eth_sendTransaction`, typed data, `personal_sign`, `eth_sign`, `wallet_sendCalls`; any wallet via EIP-6963 + `window.ethereum` | Safe `eth_signTypedData_v4` (a SafeTx) |
| Fails closed | yes: red, unknown after 30 s, stopped worker, unreachable chain all hold the request | shows GREY "cannot verify" rather than a pass |
| Proven | real Chromium E2E on the local-fork demo (Pramaan's record) | unit tests only. **Not tested on the real Safe site** (`apps/extension/TESTING.md` is a human go/no-go) |
| Build | `cd pramaan && pnpm build:extension` | `pnpm --filter @hexfence/extension build` |
| Load folder | `pramaan/apps/extension/dist` | `apps/extension/dist` |

## Install either one (Chrome)

1. Build it (command above). Both built successfully in this merge.
2. Chrome → `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → pick the `dist` folder (not `src`).
3. Reload tabs that were already open.
4. Pin the extension; click its icon for the popup.
5. Use a **test wallet** (MetaMask or Rabby) with test funds only.

### Pramaan extension: first use
1. Run the demo (`pnpm demo:up --fixtures`, see 05), add the local chain to your wallet (RPC `http://127.0.0.1:8545`, chain id 31337).
2. Open http://localhost:5182. The popup shows *Release verified* and the rows.
3. Settings (popup → Settings): language (English / हिन्दी / मराठी), strict mode "Block undeclared third parties on this site", RPC and Anon-RPC preferences.
4. On a Sepolia site the verification reads go through the EF Anon-RPC (Nox) by default and fall back to direct RPC; the popup's "Verification reads" lists each read and which path it used.

### HexFence extension: first use
1. Options page: Sepolia HTTPS RPC URL, HexFence Guard address, optional Arkiv publisher address.
2. Open a **new** `app.safe.global` tab with your demo Safe, start a payment, sign. A "HexFence payment review" window appears **before** MetaMask asks. With no options set it shows GREY ("Cannot verify this transaction type…"), never a pass.
3. Reject returns EIP-1193 code 4001 to the page.
4. Console filter `HexFence` should show `interception ready` and `provider wrapped`.
Follow `apps/extension/TESTING.md`. Until a person has done it, call it an unverified spike.

## As a website (no extension)

| Site | Use | Run locally | Live |
|---|---|---|---|
| **HexFence Pay** | check a payment against a Safe's approved payees; send it; set up the Guard | `pnpm --filter @hexfence/pay dev` → `/?safe=0x…` | https://deven1305.github.io/hexfence/pay/ |
| **Safe App** | the same Pay inside Safe{Wallet}: Apps → Add custom Safe App → paste the Pay URL | | **not tested inside the real Safe{Wallet}** |
| **Explorer** | the public evidence | `pnpm --filter @hexfence/explorer dev` | …/explorer/ |
| **Landing + guided demo** | story + live checks | `pnpm --filter @hexfence/site dev` | …/ and …/demo.html |
| **Pramaan dashboard** | developer side: projects, analysis, findings, releases, monitoring; `/verify` decoder; `/demo` guide | `cd pramaan && pnpm server` (Node 22) + `pnpm dev:web` → http://localhost:5173 | not deployed |
| **Release record page** | public static record of a manifest | `pnpm pramaan record-page` | |

The Pramaan dashboard is for **developers who publish releases**. Users never need it: the extension verifies without any Pramaan server.

## Which should I use?

- **Paying from a Safe**: HexFence Pay (website) + the on-chain Guard on that Safe. Add the HexFence extension if you use `app.safe.global` (after a human has tested it).
- **Using any dApp that publishes a Pramaan release**: the Pramaan extension.
- **Both**: install both; they intercept different things. A joint extension is future work, but `pnpm merged:check` shows the combined verdict they would produce.
- **A developer shipping a dApp**: Pramaan CLI + dashboard (PROVE, sign, publish), then Pramaan extension for users.

# 10. The "still not done" items: what each one means and exactly how to do it

Four things are not finished. For each: **why it is not done, who must do it, what you need, the exact steps, how you know it worked, how long it takes.** Items 1-3 need a *person* (a wallet, an account or funds), which is why nobody could finish them by script. Item 4 is engineering work.

Read the warning first: all of this is *post-submission / post-payout* work for ETHGlobal. HexFence alone is the submission; do not push this merged tree before prizes are paid (`docs/planning/final_hexfence/02_RULES_AND_ELIGIBILITY.md`).

---

## 1. HexFence extension on the real app.safe.global

**What it means.** The extension is built, its unit tests pass, and it loads in Chromium. But it works by intercepting the wallet request that Safe's real website makes. Nobody has confirmed that Safe's real page actually triggers the interception. Unit tests cannot prove that, because Safe may change its page at any time. Until a person sees it work, call it an *unverified spike*.

**Who / what you need (about 45-60 min).**
- Chrome + MetaMask with a **test-only** wallet that is an **owner of a Sepolia Safe**.
- A little Sepolia ETH (a few cents of gas): `pramaan/docs/FAUCETS.md` lists faucets (Google Cloud Web3, Alchemy, Chainlink, pk910 PoW).
- The existing demo Safe `0x3BCc3969713778F3Ed26AE1490529eeBAD43FbD5` is owned by Dhruv's wallet. Either have Dhruv do it, or make **your own** Safe (step 1).

**Steps.**
1. Create your own test Safe: https://app.safe.global → Create account → network **Sepolia** → add your MetaMask address as owner → threshold 1.
2. Turn on the Guard for it: open HexFence Pay (`pnpm --filter @hexfence/pay dev`, or https://deven1305.github.io/hexfence/pay/?safe=<your Safe>) → connect MetaMask → section **4. Setup** → enable the HexFence Guard (`0xA061fB511D69e5c92E50E3BE5c789472d6f19748`), then add an **approved payee**: `0x4E185e251Ac7fB83E9DE10723EAda46cadE74120` (called P). Sign the Safe transactions it asks for.
3. Build and load the extension: `pnpm --filter @hexfence/extension build`; `chrome://extensions` → Developer mode → Load unpacked → `apps/extension/dist`. Open **Extension options**: Sepolia HTTPS RPC `https://ethereum-sepolia-rpc.publicnode.com`, Guard `0xA061fB511D69e5c92E50E3BE5c789472d6f19748`, publisher `0x36141ba063390f0d91Af7a5a9dF8dc1d80D699ec`. Save, grant the host.
4. Open a **new** `https://app.safe.global` tab, connect MetaMask to your Safe. Open DevTools → Console, tick *Info*, filter `HexFence`, tick *Preserve log*. You should see `[HexFence] interception ready` and `[HexFence] provider wrapped`.
5. Capture test: New transaction → Send tokens → ETH, recipient the lookalike `0x4E185a3FC4B530244aB9ed0dE38167b403344120` (L), amount 0.0001 → Sign. **Before MetaMask asks anything**, a *HexFence payment review* window must appear, RED "resembles your approved payee", with Continue disabled until you type the last 6 characters (`344120`). Click **Reject**: the Safe page must show a cancel and MetaMask must **not** open. Console shows `caught … eth_signTypedData_v4 … SafeTx`.
6. Repeat with P (expect GREEN "Approved payee"), and a brand-new address (AMBER). Then Continue the lookalike deliberately and Execute: **the Guard must still revert it on chain** (Safe shows the failed simulation or the Etherscan tx shows `LookalikeOfApprovedPayee`).
7. Execution path: a payment that already has enough confirmations → **Execute** → the review must appear for `eth_sendTransaction` kind `execTransaction` before MetaMask.
8. Work through the remaining checks in `apps/extension/TESTING.md` (Step 2, items 1-11) as far as you can: missing options → GREY, wrong chain → GREY, two tabs, closing the window, etc.

**Done when.** `apps/extension/TESTING.md` "Human go/no-go" holds a dated entry by a named person: GO if both request shapes (typed-data sign and execute) were captured and Reject stopped forwarding; NO-GO otherwise, listing which path failed. Update README/JUDGE_READINESS limits accordingly. If it is NO-GO, the fix is in `apps/extension/src/interception.ts` (provider wrapping). Do **not** call it working based on the unit tests.

---

## 2. HexFence Pay inside Safe{Wallet} (Safe App mode)

**What it means.** Pay can also run *inside* the Safe website as a "Safe App". The code works against a local stand-in for the Safe parent page. Nobody has loaded it in the real Safe{Wallet}.

**Need (about 20 min).** The same Sepolia Safe + MetaMask as item 1. Pay must be hosted on **https** (the live GitHub Pages one works: `https://deven1305.github.io/hexfence/pay/`). The folder already contains `manifest.json` (name, description, icon), which Safe requires.

**Steps.**
1. https://app.safe.global → open your Sepolia Safe → left menu **Apps** → **My custom apps** → **Add custom Safe App**.
2. Paste `https://deven1305.github.io/hexfence/pay/` → Safe reads the manifest and shows "HexFence Pay" → tick the risk checkbox → **Add**.
3. Open the app. Pay should read the open Safe from Safe's SDK (no `?safe=` needed) and show its Guard status and payees.
4. Enter the lookalike L → **Check payment** → RED. Enter P → GREEN, amount 0.0001 → send: Pay hands it to Safe{Wallet} as a **proposal** (`txs.send`); sign and execute **inside Safe{Wallet}**.
5. Try L anyway: Safe{Wallet}'s own simulation or the chain refuses it.
6. Limits to record: Sepolia only; Guard setup is **not** in the Safe App (use standalone Pay); the forced-send path is standalone only.

**If it fails to load:** the browser console shows why. The usual causes are a missing/invalid `manifest.json`, a hosting setting that blocks CORS for it (GitHub Pages is fine), or an `X-Frame-Options`/CSP header that forbids embedding in Safe. Fix in `apps/pay/public/` or the host's headers.

**Done when.** A named person records in `apps/pay/SAFE_APP.md`: loaded in the real Safe{Wallet} on date X, verdicts matched, send created a proposal.

---

## 3. A real Chainlink CRE simulation (and Pramaan's CRE monitor)

**What it means.** CRE = Chainlink Runtime Environment, a runtime for off-chain workflows. HexFence's *Sentinel* workflow watches for dust/zero-value lookalike transfers to a protected Safe and writes an alert on chain. The workflow code compiles to WASM and its unit tests pass, but `cre workflow simulate` has never succeeded because it needs a **logged-in Chainlink account**, which is interactive. The Chainlink prize needs a *real* simulation output (a WASM build or a unit test does not count).

**Need (about 60 min).**
- A Chainlink account (free) and the **CRE CLI** (tested: 1.39.0) + **Bun** (>=1.2.21). Install per https://docs.chain.link/cre/getting-started/cli-installation .
- An **existing funded Sepolia test key** (a throwaway key, ~0.01 ETH) for `CRE_ETH_PRIVATE_KEY`. Never use a real-money key.
- Optional, for the Telegram part: a bot from @BotFather (`TELEGRAM_BOT_TOKEN_ALL`) and your chat id.

**UPDATE: one command now.** `pnpm chainlink:simulate` checks every prerequisite, runs the simulation and saves the real output to `sentinel/SIMULATION.md` only if the CLI succeeds. Authentication is the one thing it cannot do for you: either `cre login` (browser) or an API key from your Chainlink account in `CRE_API_KEY`. The CLI refuses to simulate without one (verified: "Authentication required: not logged in and no CRE_API_KEY set"). Without `--broadcast` it is a dry run that needs no funded key; add `--broadcast` for the on-chain alert.

**Steps (Sentinel).**
1. `cre login` (opens a browser; log in; it saves credentials locally). The CLI should report you as logged in (run `cre --help` for the account command in your version).
2. In `ROOT`: `pnpm install --frozen-lockfile`.
3. `Copy-Item sentinel\hexfence-sentinel\config.example.json sentinel\hexfence-sentinel\config.json` (public addresses already filled).
4. In `ROOT\.env` (git-ignored) add one line: `CRE_ETH_PRIVATE_KEY=<throwaway sepolia key>`. For Telegram also `TELEGRAM_BOT_TOKEN_ALL=<token>` and in `config.json` set `telegram.enabled=true` and your `chatId`.
5. Run (from `ROOT\sentinel`), using the real Sepolia trigger transaction already recorded in `sentinel/deployments/trigger-sepolia.json`:
   ```powershell
   cre workflow simulate hexfence-sentinel --target staging-settings --env ../.env --non-interactive --trigger-index 0 --evm-tx-hash 0x7494d97df9468b822e32aa7008e8f336979b584558053457a03ef32e00b9af15 --evm-event-index 0 --broadcast
   ```
6. Confirm: the CLI reports success, the write status and the receiver-execution status are both success, and a `PoisoningAttempt` event appears in the consumer `0x97F6f25D51DD52565FF30D22286392686A1ED80F` on Sepolia Etherscan for the demo Safe. (Telegram: the message arrives.)
7. Save the **actual** command, full output and the alert transaction hash in `sentinel/SIMULATION.md`. Then reload Pay for the demo Safe: the Radar banner shows the alert, labelled *simulation*.

**Rules.** Never hand-insert an alert, never call a unit test a simulation, and say "simulation", not "deployed": the simulator uses a public **mock** forwarder (`CHAINLINK.md` explains this).

**Pramaan's CRE monitor** (`pramaan/workflows/cre-monitor/pramaan-monitor`, release/timelock/upgrade watch): after the same `cre login`, run `bun test` in that folder (65 tests), generate the demo config from a running `pnpm merged:up` with `bun run scripts/config-from-demo.ts` (in that workflow folder; `scripts/live-decisions.ts` is the harness Pramaan used instead of a real simulation, and is explicitly NOT `cre workflow simulate`) and run `cre workflow simulate pramaan-monitor --non-interactive --trigger-index 0 --target local-simulation`. Read-only, no write key needed. Save the output next to `pramaan/docs/evidence/`.

**Done when.** `sentinel/SIMULATION.md` holds real output and a tx hash; the claim in README/CHAINLINK.md changes from "missing" to "simulated".

---

## 4. Pramaan on live Sepolia (not just a local fork)

**What it means.** Everything Pramaan did so far ran on a **local copy** of Sepolia (anvil fork). "Live" means the ENS names, the timelocks, the demo contracts and the three apps exist on the real Sepolia network and on the public internet, so anyone's extension can verify them.

**What is already built:** the ENS-identities step (`pramaan deploy identities`), rehearsed on a fork (21 setup txs, 72 permission checks all as expected). **What is not built:** `pnpm demo:up` has **no** `--network sepolia` mode (it is local-fork only; an older doc line claiming otherwise is wrong). That last piece is code, about half a day to a day:

| # | Step | Status |
|---|---|---|
| a | Three fresh test accounts (owner, proposer, guardian) funded: owner ~0.15-0.3 ETH, others ~0.03 | needs a person (faucets) |
| b | `pnpm run doctor --network sepolia --parent <label>` → READY | built |
| c | `pnpm pramaan keygen` (release signing key) | built |
| d | `pnpm pramaan deploy identities --network sepolia --parent <label> --yes --domain vaultlab=https://… --domain mirroryield=https://… --domain permitmarket=https://…` | built (rehearsed on a fork) |
| e | Deploy the **demo contracts** (pUSD, vault + timelock, farm, marketplace) to Sepolia | **not built**: `demo-up.ts` does it only on the fork (`deployDemoSuite`); the CLI `deploy demo` is an older subset |
| f | Write a Sepolia `DemoStateV2` file (addresses, ENS names, URLs) so `build:demos` can bake the final URLs into each app | **not built** |
| g | `pnpm build:demos -- --state <that file>`, then host each `apps/demos/dist/<app>` on its own static site (Vercel/Netlify/Pages), unchanged | built; hosting is manual |
| h | Per app: `pramaan manifest` → `pramaan sign` → `pramaan publish queue` (proposer) → wait the timelock delay → `pramaan ens execute` | built, run by hand per app |
| i | `pramaan verify https://<app-url> --chain 11155111=<rpcA>,<rpcB>` → VERIFIED | built |
| j | Extension: in its settings use two independent Sepolia RPCs; open the live app → green | built |

**Funding the accounts (a):** follow `pramaan/docs/FAUCETS.md`. The MockUSDC the ENS registration needs is minted automatically by `deploy identities`. Keys go only in `pramaan/.env` (git-ignored). Generate the three keys fresh; never reuse a wallet that holds real money.

**UPDATE (7 Nov, later): steps e and f are now built** as `pnpm --dir pramaan demo:sepolia` and tested end to end on a separate local fork (`demo:rehearse`). Follow `12_GO_LIVE_SEPOLIA.md`; only funding the keys and creating the three hosts remain. The text below is the original plan, kept for the record.

**The engineering task (e + f), what to build:** add a `--network sepolia` branch to `pramaan/apps/cli/src/demo-up.ts` that (1) skips the anvil fork, (2) calls the same `deployDemoSuite` with the real Sepolia signer, (3) writes the Sepolia state file, (4) runs `deployIdentities` for the three apps with the real `--origins`, (5) runs PROVE, builds the apps, signs and queues the releases, then (6) waits the delay and executes. Test it **on the fork first** (the existing rehearsal), then flip to Sepolia. I can implement this when you ask; I did not, because it needs funded keys to prove it and the rules say not to push before payout.

**Done when.** `pnpm --dir pramaan pramaan verify https://<live-url> --chain 11155111=<A>,<B>` prints `release: VERIFIED` from a machine that is not yours, and Etherscan shows the timelock `Queued` / `Executed` events.

---

## 5. Full merge: one workspace, one extension, one CRE project

**What it means.** Today both projects live in one repo but are separate products: Pramaan is its own pnpm workspace in `pramaan/`, there are two Chrome extensions and two CRE workflows. Joined so far: `@hexfence/core` (one verdict model) and `integration/` (`merged:check`, `merged:verify`). The full merge is `docs/planning/final_hexfence/05_MERGE_STEPS.md` phases 2-6. **Do it only after the prizes are paid.**

| Phase | Work | How | Size |
|---|---|---|---|
| 2 One workspace | move Pramaan packages into the root workspace, rename `@pramaan/*` → `@hexfence/*` | one package per PR: a `git mv` commit, then a rename commit + lockfile refresh; order manifest → decoder → verifier → release → prove → cli → extension → console → demos → CRE; keep tests at their baseline counts (HexFence ~280, Pramaan 259) | 1 week |
| 3 One verdict | replace the ad-hoc rows in `integration/` with a real `@hexfence/core` adapter set: Pramaan `siteRow/contractRow/actionRow/privacyRow` → rows; golden tests per mapping row; property tests (grey never green, worst wins) | `merged:verify` already does app + contract rows; formalise and freeze `docs/INTERFACES.md` for core | 3-4 days |
| 4 One extension | keep Pramaan's MV3 extension as the base (interception, fail-closed hold, leak guard, Anon-RPC); port HexFence's Safe pieces as a module (SafeTx parsing through `@hexfence/shared`, the Guard payee read, VerdictCard); delete the old HexFence extension after the end-to-end tests pass | needs the item-1 result first | 1-2 weeks |
| 5 Data | rename ENS keys `pramaan.*` → `hexfence.*` (safe: only ever written on local forks), Arkiv `hexfence.release.v1`, evidence snapshot | | 1 week |
| 6 One CRE project | `workflows/cre/` with `sentinel` + `monitor`, one alert format; real simulations for both (item 3) | needs item 3 | 3-4 days |

**Safe way to start (after payout):** work in a fresh clone on a branch, import with history (as done here), keep one package per PR, never force-push `main`, run both test suites after every step, and roll back by reverting the single import merge commit.

---

## Suggested order

1. Items 1 and 2 together (one Safe, one MetaMask, ~1.5 h) → a person-verified extension and Safe App.
2. Item 3 (`cre login`, ~1 h) → real simulation, strengthens the Chainlink claim.
3. Item 4 only if you want Pramaan publicly verifiable: fund keys, then ask for the `demo-up --network sepolia` implementation.
4. Item 5 after payout.

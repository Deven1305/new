# HexFence

**A Safe Guard that refuses lookalike payments (deny by resemblance), with open address-poisoning evidence on Arkiv.** ETHGlobal Mumbai 2026.

**Start here:** [live site](https://deven1305.github.io/hexfence/). **Working on the code?** Read [docs/TEAM_HANDOFF.md](docs/TEAM_HANDOFF.md).

**Judge-facing status:** [requirements and gaps](docs/JUDGE_READINESS.md), [submission text](docs/SUBMISSION.md), [3:00 demo and Q&A](docs/DEMO.md), [Chainlink CRE](CHAINLINK.md). These distinguish deployed code and real observations from human-blocked demonstrations. The v1 demo remains available.

HexFence detects address poisoning, publishes the evidence openly on Arkiv, warns you locally before you sign, and makes a protected Safe refuse to pay a lookalike of an approved supplier, even one nobody has ever reported, while new suppliers still work.

## Architecture
```
Ethereum mainnet USDT/USDC logs
        │
   apps/detector ── evidence.jsonl
        │ publish (idempotent, 30-day expiry)
        ▼
 Arkiv Rabdi testnet: hexfence.poisoning.v1 ──► apps/explorer (data views, local search, Verify on Ethereum)
        │ bulk read
        ▼
   apps/pay: bulk payees (v1) or recorded recipients (V2) → local verdict → sign
        │ Safe transaction
        ▼
   Safe → HexFenceGuard v1 or separate HexFenceGuardV2 (opt-in learning)

Sepolia Transfer log → Sentinel source/WASM [CRE login/run pending]
        → HexFenceAlerts [deployed simulation consumer] → Pay Radar bulk read
```
- **`contracts/`:** `HexFenceGuard`, a Safe transaction guard with no owner and no upgrade path. A recipient that shares a fingerprint (first 4 + last 4 hex characters) with an approved payee, but is a different address, reverts with `LookalikeOfApprovedPayee`. Anyone else still goes through. The Guard reads nothing off-chain.
- **`packages/shared/`:** fingerprint, Safe payment decoder, verdict logic and evidence schema, with a parity test against the real Guard on 411 transactions.
- **Auto-Fence V2:** a separate non-upgradeable Guard with opt-in learning after successful recognized Safe execution, one holder per fingerprint, `forget`/`approve` correction and an ETH-with-calldata check. Real Safe 1.4.1 tests and 414 V2 parity vectors are in [contracts](contracts/README_V2.md). V1 code and its 14 tests are unchanged.
- **Sentinel / Radar:** CRE source and WASM build, an on-chain consumer and a Pay bulk reader. **A successful CRE simulation and Telegram delivery are still missing.** The consumer trusts the public mock forwarder; banners say simulation/advisory. See [CHAINLINK.md](CHAINLINK.md).
- **`packages/arkiv/`:** the Arkiv schema, bulk readers and idempotent writer.
- **`packages/check/` and `packages/mcp/`:** an offline check SDK (verdict plus an evidence Bloom filter) and an MCP stdio server with one tool, `hexfence_check`, so an AI agent can compare a recipient with its approved payees before it signs. Both are offline: they read no chain data.
- **Module guard:** `HexFenceModuleGuard` applies V2's checks to Safe 1.5.0 module transactions. It is deployed, but no live Safe uses it and no live module payment has run.
- **`apps/site/`:** the static landing page, deployed with the two apps.
- **`apps/explorer/`:** Evidence, Losses (A4 Rescue), Campaigns (B2) and Check my address tabs. It can read extra publishers (C3), but none exist yet, so the live explorer reads one.
- **`apps/pay/`:** HexFence Pay, with the ERC-7730 explain panel (B6) and a Safe App mode (B8, not yet tried by a person inside Safe{Wallet}).
- **`apps/extension/`:** a Chrome extension that reviews Safe payments on `app.safe.global`. Its interception has not yet been tested on the real site; see Limits.
- **Real evidence and the synthetic test are separate.** Mainnet records are always status "suspected". The synthetic Sepolia L only ever gets "resembles your approved payee".

## What's new vs reused
**Built at this event, as recorded in the repo:** the detector, Arkiv schema/publisher, explorer, Pay, landing page, extension, shared decoder/verdicts, separate Guard V2, Sentinel/consumer and Radar. The team must confirm event provenance and meaningful human contributions before submitting; see [AI usage](docs/AI_USAGE.md).

**Reused:**
- the AI-generated reference `HexFenceGuard` and tests were imported within the event; [their record](contracts/README.md) dates generation after kickoff. AI review is not human sign-off;
- Safe 1.4.1 contracts, Safe Protocol Kit, `@arkiv-network/sdk`, viem, zod, Hardhat, Vite, vitest.

This build's distinction is an account-level resemblance rule plus open suspected-pattern data and local comparisons. It is not a claim that MetaMask or Safe{Wallet} lack warnings, nor that every other evidence feed is closed. New fingerprints pass the Guard; unsupported call semantics and first-use mistakes remain limits.

## What is on main, and what is not shown live

Full table with evidence: [docs/JUDGE_READINESS.md](docs/JUDGE_READINESS.md#every-feature-on-main-and-what-it-does-not-prove). Not built: B3 (batch protection) was cut; C2 and C4 were scrapped; B1 needs approval to spend tGLM.

## Auto-Fence and Sentinel status

| Component | Actual state |
|---|---|
| V2 Guard | [0x0adF080DE3DA9D672fDc7330B8750a0579A698c7](https://sepolia.etherscan.io/address/0x0adF080DE3DA9D672fDc7330B8750a0579A698c7), Sourcify exact creation/runtime match 58609655 |
| Module Guard (Safe 1.5.0) | [0xa7Dc08C6fb15fCdBF4De484FaE393fea052c546B](https://sepolia.etherscan.io/address/0xa7Dc08C6fb15fCdBF4De484FaE393fea052c546B), Sourcify exact creation/runtime match 58620524. Reads V2's list. No live Safe uses it yet |
| New isolated V2 Safe | [0x5142C7E9DE82726CaCb847c5469D460508738214](https://sepolia.etherscan.io/address/0x5142C7E9DE82726CaCb847c5469D460508738214), 1-of-1 Safe 1.4.1, learning enabled, empty list and zero balance at setup |
| V2 recovery drill | [Removal](https://sepolia.etherscan.io/tx/0x267d7fb1721c2c2c909ace707aeb77d7da75bd13b0e9bf638e6d381277dfd500) and [restoration](https://sepolia.etherscan.io/tx/0xa7a4afc8a75465d612c4615ec5acdd582d773dd18ed48898f0643d11142b330b) succeeded by script; positive-value live P/L remains human-run |
| Alerts consumer | [0x97F6f25D51DD52565FF30D22286392686A1ED80F](https://sepolia.etherscan.io/address/0x97F6f25D51DD52565FF30D22286392686A1ED80F), simulation mode, Sourcify exact match 58607325 |
| CRE input | [Real zero-value Sepolia USDC demonstration log](https://sepolia.etherscan.io/tx/0x7494d97df9468b822e32aa7008e8f336979b584558053457a03ef32e00b9af15), event index 0; no tokens moved |
| Pay | [Read-only V2 preview](https://deven1305.github.io/hexfence/pay/?safe=0x5142C7E9DE82726CaCb847c5469D460508738214), [wiring/limits](apps/pay/UPGRADE.md); actual consumer read returned no alerts in four browser layouts |
| Still missing | Successful CRE CLI run/report, Telegram notification, funded Sepolia V2 P/L demonstration, human wallet/Guard/Hindi review and uploaded final video |

Use [V2 run/setup steps](contracts/README_V2.md) and the [exact human CRE steps](CHAINLINK.md#exact-human-steps-left). V2 timestamps mean successful recognized execution, not independently established token movement: zero-value or false-returning token-shaped calls can be learned. No on-chain loss-recovery service is claimed.

## Guard: deploy on Sepolia (test funds only)

The Guard is a Hardhat project in [contracts/](contracts/), tested against the real Safe 1.4.1 contracts.

```bash
cd contracts
npm install --legacy-peer-deps   # safe-contracts declares an old ethers peer; this is expected
npx hardhat test                 # 32 at the upgrade checkpoint: 14 v1 + 14 V2 + 4 Alerts
```

1. Put a **testnet-only** key and a Sepolia RPC in the repo-root `.env` (git-ignored; names in [.env.example](.env.example)):
   ```
   SEPOLIA_RPC_URL=https://...
   DEPLOYER_PRIVATE_KEY=0x...
   ```
   Fund the deployer with a little Sepolia ETH.
2. Deploy. The script refuses to run on any chain other than Sepolia (11155111) and checks the Guard interface after deploying:
   ```bash
   cd contracts
   npx hardhat run scripts/deploy.js --network sepolia
   ```
3. To automate the isolated demo setup instead, run from `contracts/`:
   ```bash
   node scripts/setup-demo.js
   ```
   It reads `SEPOLIA_RPC_URL` and `DEPLOYER_PRIVATE_KEY` from the root `.env`, refuses
   every chain ID except 11155111, deploys the unchanged Guard and creates a 1-of-1
   Safe **1.4.1** through Safe's canonical Sepolia factory. It tops the Safe up to
   0.002 test ETH, executes `setGuard` and `approvePayee(P)`, then removes the Guard
   with `setGuard(0)` and re-enables it. Each is a separate real Safe transaction.
   **The deployer key is the Safe's only owner. The Pay wallet must use that same
   testnet-only key.** The owner EOA sends Safe's prevalidated owner signature (`v=1`); no transaction
   service or browser wallet is involved. Output contains only public addresses,
   transaction hashes and `VERSION()`, as Markdown rows for the PROGRESS table.

   To reuse a deployment, put `VITE_GUARD_ADDRESS` and `DEMO_SAFE_ADDRESS` in the
   root `.env` before rerunning. Supplied contracts are checked, deployments are
   skipped, existing payee approval is retained and funding only tops up a deficit.
   A deterministic owner-based salt also reuses the Safe without a supplied address.
   Without `VITE_GUARD_ADDRESS`, a new Guard is deployed; reuse the printed address
   on subsequent runs. A Safe with a different active Guard is refused. The removal
   drill intentionally runs again and costs gas on each run. Keep the printed hashes.
   Do not run the separate deploy command first unless reusing its Guard address.

   Local regression test (chain ID 11155111, real Safe release contracts, no `.env`):
   ```bash
   npx hardhat test --config scripts/setup-demo.hardhat.js scripts/setup-demo.test.js
   ```
   API references: [Safe signatures](https://docs.safe.global/advanced/smart-account-signatures),
   [canonical deployments](https://github.com/safe-global/safe-deployments).

4. For the **human Safe{Wallet} UI drill**, use an **isolated 1-of-1 demo Safe** holding test ETH only. Check the Safe's `VERSION()` (1.4.1 is what the tests use). Then in **Apps → Transaction Builder**, send **one call per transaction**. A batch uses a MultiSend delegatecall, and the Guard refuses delegatecalls. The script does not replace this human UI check.
   1. To the Safe: `setGuard(<guard address>)`. It reverts with `GS300` if the interface check fails.
   2. To the Guard: `approvePayee(<P>)`.
   3. **Removal drill:** to the Safe, `setGuard(0x0000000000000000000000000000000000000000)`, which must succeed. Then re-enable with step 1.

| Item | Value |
|---|---|
| HexFenceGuard (Sepolia) | `0xA061fB511D69e5c92E50E3BE5c789472d6f19748` |
| Demo Safe + `VERSION()` | `0x3BCc3969713778F3Ed26AE1490529eeBAD43FbD5` · `1.4.1` |
| `setGuard` / `approvePayee(P)` | `0x2de356a6c196cb3f2040e3b8d4170ebe0cbc1b2684b0c05e26344756db6278e9` / `0x13baea5038b830810e1a9f68fbed3ae1069f981af4810cbd43c50f7b0d7d1af2` |
| Removal drill `setGuard(0)` / re-enable | `0x5edf08eb6489d78c13f0748283e43bab8c015c851d0d40e86b030dd6794ad8e0` / `0xd1c7db48a18647713c34384afc51b116888546dd837359eecad0938a5ebe9743` |
| L payment (reverted) / B payment / P payment | `0xa43b0eeef7253281a741deca144e5ddf0c465da9cc6f48d54673a9aa9c0f6d8f` / `0x2455ca8f1ce612149f15e80325f372202bffeb0258f808bd84acfb1f904de5ca` / `0xea209e9e3c5a9eed080e95dd0ca752b79686400da820ea67b87f98552d2992df` |

Decoded revert and Guard source: [reverted L payment](https://eth-sepolia.blockscout.com/tx/0xa43b0eeef7253281a741deca144e5ddf0c465da9cc6f48d54673a9aa9c0f6d8f) and [Guard source](https://eth-sepolia.blockscout.com/address/0xA061fB511D69e5c92E50E3BE5c789472d6f19748) on Sepolia Blockscout. The Guard source is also verified on [Etherscan](https://sepolia.etherscan.io/address/0xA061fB511D69e5c92E50E3BE5c789472d6f19748#code).

### Synthetic demo pair (not a real attack)
`node contracts/scripts/make-lookalike-pair.js` finds two keys whose addresses share a fingerprint (a birthday search, usually 1–2 minutes). We use this ready-made pair **as recipients only**:
- fingerprint `0x4e184120`
- **P** (approved payee) `0x4E185e251Ac7fB83E9DE10723EAda46cadE74120`
- **L** (lookalike) `0x4E185a3FC4B530244aB9ed0dE38167b403344120`

## Run steps
Needs Node 22 and pnpm (`corepack enable`, or prefix commands with `corepack pnpm@10.34.9`). Copy [.env.example](.env.example) to `.env` in the repo root. It lists every name, and `.env` is git-ignored. Use testnet keys only.

```bash
corepack pnpm@10.34.9 install --frozen-lockfile
cd contracts
npm install --legacy-peer-deps
npx hardhat test
cd ..
corepack pnpm@10.34.9 -r test
corepack pnpm@10.34.9 -r build
```

**Detector** (read-only on mainnet; needs `MAINNET_RPC_URL`, and the public `https://ethereum-rpc.publicnode.com` works):
```bash
pnpm --filter @hexfence/detector detect                         # latest 7,200 blocks → out/evidence.jsonl
pnpm --filter @hexfence/detector publish:arkiv --limit 25       # needs ARKIV_PRIVATE_KEY and tGLM; a re-run creates 0
```

**Explorer** (`VITE_ARKIV_PUBLISHER`; `VITE_MAINNET_RPC_URL` for Verify on Ethereum; optional `VITE_ARKIV_ACCESS_KEY`):
```bash
pnpm --filter @hexfence/explorer dev
pnpm --filter @hexfence/explorer build    # dist/ works from any path on static hosting
```

**HexFence Pay** (`VITE_GUARD_ADDRESS`, `VITE_SEPOLIA_RPC_URL`; a browser wallet on Sepolia for signing, sending and owner setup, while `?safe=0x…` without a wallet gives a read-only preview; optional `VITE_ARKIV_PUBLISHER` turns on the "listed in public evidence" signal, and without it the page says the signal is off):
```bash
pnpm --filter @hexfence/pay dev
pnpm --filter @hexfence/pay build
```

**Chrome extension** (load `apps/extension/dist` unpacked; steps in [apps/extension/TESTING.md](apps/extension/TESTING.md)):
```bash
pnpm --filter @hexfence/extension test
pnpm --filter @hexfence/extension build
```

**Scheduled publisher:** [.github/workflows/publish-evidence.yml](.github/workflows/publish-evidence.yml) runs every 6 hours once the `ARKIV_PRIVATE_KEY` repository secret exists. Setup and budget rules are in [docs/LIVE_EVIDENCE.md](docs/LIVE_EVIDENCE.md).

The `VITE_*` values end up in the public bundle, so never put a secret in one. Restrict an Arkiv access key to your origins at hub.arkiv.network.

## Arkiv publisher + query
Schema: [arkiv/schema.md](arkiv/schema.md) (Rabdi testnet, chain 7794095, `hexfence.poisoning.v1`, 30-day expiry). Also see [why-arkiv](arkiv/why-arkiv.md), [how we use it](arkiv/how-you-use-arkiv.md), [friction](arkiv/friction.md) and [reach](arkiv/reach.md).

- **Publisher wallet:** `0x36141ba063390f0d91Af7a5a9dF8dc1d80D699ec`

One public read-only query judges can run from the repo root, without a wallet or key:
```sh
corepack pnpm@10.34.9 --filter @hexfence/detector exec tsx ../../arkiv/query.ts
```

Fresh observation, 6 Nov 2026 at 09:47:52 UTC: **173 records, 173 unique IDs, 147 zero-value and 26 dust, all suspected**. [Recorded query result](docs/research/arkiv-snapshot-2026-11-06.json). This is a published subset of the historical 47,694-pair detector run, not comprehensive coverage or a user-adoption measure.

## Live links
- Landing page: https://deven1305.github.io/hexfence/
- Read-only Pay preview, no wallet needed: https://deven1305.github.io/hexfence/pay/?safe=0x3BCc3969713778F3Ed26AE1490529eeBAD43FbD5
- Explorer: https://deven1305.github.io/hexfence/explorer/
- HexFence Pay: https://deven1305.github.io/hexfence/pay/

## CROPS

Lead property: **Security**.

- **C:** The Guard has no owner and no upgrade path, and needs no HexFence service: it keeps refusing lookalikes if our site, detector, Arkiv records and Sentinel are gone. Anyone can run the detector and publish under their own wallet.
- **O:** MIT licence; the apps and contracts build from this repo with locked dependencies, and RPC endpoints are configurable. The optional CRE SDK is BUSL-1.1.
- **P:** Recipients are compared in the browser against bulk reads, with no per-recipient lookup and no trackers. Pay's Sepolia reads go through the Nox mixnet by default; the table below says what each service can still see.
- **S (lead):** Payees are approved only by Safe transactions and keys stay in the user's wallet (or git-ignored `.env` for scripts). The demo Safe holds test funds only; first use, owner authority, modules and unsupported calls are stated limits.

## Privacy and trust

| Party / dependency | What it receives or controls |
|---|---|
| GitHub Pages / another static host | IP and asset requests. The UI and fonts are self-hosted; there are no client analytics. A user can build/host the source elsewhere. |
| Arkiv RPC and selected publisher | Bulk schema/publisher/page queries and the reader's direct IP. The apps' searched/checked address stays local. The publisher controls its attributed records; attribution does not establish truth. |
| Sepolia/mainnet RPC | Contract addresses, Safe state and receipt requests; signed-call simulation includes transaction calldata. Direct reads reveal the client IP. Pay's active Nox route aims to unlink that IP; it does not hide public transaction content. |
| Anon-RPC specifier, resolver and Nox network | The bootstrap routing read and worker download are direct. The harness hash-checks the network worker and isolates it; the specifier/network remains a trust/dependency choice. No independent anonymity audit is claimed. |
| Wallet / Safe{Wallet} services / public chain | Signing/proposal/broadcast data and eventual public transactions. These paths are not anonymized by Pay's read route. |
| Optional Telegram / CRE runtime | When enabled: chat ID, public Safe/pair/transaction data and runtime access to the bot token. No notification has been demonstrated in this build. |
| Node/CI publisher | Testnet keys are in ignored `.env`; a CI publisher, if enabled, uses GitHub Secrets/Actions. No signing key is placed in a `VITE_*` variable or browser bundle. |

Pay waits for route selection before Safe/history/alert reads. Explicit **Skip: read directly (not anonymous)** or failed startup gives a labelled direct route; a later failure of an active Nox route is an error, not a silent fallback. Arkiv bulk reads remain direct. [Anon-RPC's documented model](https://ethereum.github.io/anon-rpc/) and [our routing code](apps/pay/src/anon.ts) explain the boundary.

## Limits
- Nox covers the configured Sepolia RPC read route only (see CROPS, P). Guard and payee reads through Nox worked on the hosted site. Nox start-up took 26–38 seconds in hosted browser runs and timed out at 60 seconds during a network outage; these are single observations, not benchmarks.
- The Chrome extension's interception on `app.safe.global` has not been tested with a real wallet, so its go/no-go is open.
- Pay's owner setup panel is unit-tested but has not been used with a real wallet.
- 173 records are published: 125 from one Ethereum attack block (26352743) and 48 taken one per equal slice of the roughly 24-hour scan, so they are a sample of the detector's 47,694 records, not all of them. The scheduled publisher has not run with a key.
- Module transactions bypass transaction guards. `HexFenceModuleGuard` covers Safe 1.5.0 modules, but no live Safe uses it and no live module payment has run.
- MultiSend is refused (it's a delegatecall).
- Only ETH, `transfer` and `transferFrom` are inspected; other calls are allowed and clients show "cannot verify".
- A 4+4 fingerprint doesn't catch weaker lookalikes.
- Evidence covers only Ethereum mainnet USDT and USDC, and every record is "suspected", not a finding about any person.
- Human-labelled detector precision is not established. The 30-row H9 file was AI-assigned and awaits independent human review; it is not a validated human precision result. No H9 labels were changed in this pass.
- V1 does not inspect ETH attached to unsupported calldata; V2 separately checks the ETH destination. V2 still has the recognized-call/EVM-success limits in [README_V2](contracts/README_V2.md).
- A first-use mistake can become a V2 holder. The deployed V2 Safe is unfunded; positive-value behavior is locally tested, not yet demonstrated by a funded Sepolia P/L run.
- Sentinel is not an always-on DON deployment, and no successful CLI simulation or Telegram receipt exists yet. The simulation consumer accepts the public mock forwarder, so its reports are advisory and not authenticated poisoning findings.
- Rescue (A4) shows one supported suspected follow-up payment; it is a lead, not a confirmed loss or cause. Campaign counts (B2) describe the published records only; the hourly chart is not an attack rate.
- The explorer can read several publishers (C3), but no second publisher with records exists and `pages.yml` does not pass `VITE_ARKIV_EXTRA_PUBLISHERS`, so the live explorer reads one publisher.
- Pay as a Safe App (B8) has not been tested by a person inside Safe{Wallet}.
- The ERC-7730 explain panel (B6) uses only descriptors you paste; an explained call still gets CANNOT VERIFY and the Guard does not check it.
- `@hexfence/check` and `@hexfence/mcp` (C1) compare addresses offline; they do not read the Safe or the evidence set from the chain.
- The live site reads Arkiv without an access key, through a rate-limited public endpoint; repeated loads can stall at "reading Arkiv…".
- Safe warns that a broken guard can lock a Safe: the demo Safe is isolated, holds test funds only, and the removal drill is tested.

## Licence
MIT, see [LICENSE](LICENSE).

## Check the client you are running

Successful Pages builds from `main` publish `SHA256SUMS.txt` and create GitHub build attestations. A downloaded Pay index matched the manifest from [main run 42196792847](https://github.com/Deven1305/hexfence/actions/runs/42196792847). After selecting a writable Sigstore cache, this machine successfully checked that historical Pay index with the expected workflow/ref/commit and hosted-runner policy. See [actual verification and limits](docs/ATTESTATIONS.md). For a new download, pin its expected source commit and verify each relevant file; the minimal command is:

```bash
gh attestation verify <file> -R Deven1305/hexfence
```

No live release record has been written to Arkiv.


## Rescue: suspected follow-up payments

The loss pass uses the same bulk Ethereum mainnet USDT/USDC logs as the poisoning detector. After a planting pattern is observed for a victim/lookalike pair, a later Transfer of at least one token to that lookalike, within 7,200 blocks, becomes a **suspected loss**. A record is an **investigative lead**. It does not establish intent, ownership, or causation. Amounts stay exact integer base units; USDT and USDC totals are shown separately, without a USD conversion.

```powershell
corepack pnpm@10.34.9 --filter @hexfence/detector detect:losses --window 25 --summary ../../apps/explorer/public/loss-run.json
# After an RPC failure, resume the SAME fixed range from the local bulk-log cache:
corepack pnpm@10.34.9 --filter @hexfence/detector detect:losses --window 25 --resume --summary ../../apps/explorer/public/loss-run.json
# Check transaction calldata, retaining supported payment shapes only:
corepack pnpm@10.34.9 --filter @hexfence/detector review:losses --summary ../../apps/explorer/public/loss-run.json
# Explicit Rabdi write, using only the existing testnet publisher key and balance:
corepack pnpm@10.34.9 --filter @hexfence/detector publish:losses --limit 5 --summary ../../apps/explorer/public/loss-run.json
```

`.env` supplies `MAINNET_RPC_URL`, `ARKIV_PRIVATE_KEY` and optional `ARKIV_ACCESS_KEY`. No browser key is required. Output/cache stays in ignored `apps/detector/out/`. The scan manifest is written only after the entire requested range completes; provisional counts are not final totals. `--resume` keeps the cached range, including its original end block. To scan a fresh latest range, omit `--resume`. Publication is idempotent by poisoning `evidenceId` plus `lossTx`, uses the 90-day `hexfence.loss.v1` schema and has a five-record CLI cap by default. A funding allowance stops writes with little remaining tGLM; it is not a fee estimate. A repeat run writes zero copies of already published records. Never transfer funds or use a faucet as part of these commands.

The explorer reads loss entities in bulk from its configured publisher. Its only address-specific exception is the user's **Read balance still at lookalike** click: one mainnet `balanceOf`, with no automatic retry or polling. Receipt checks use public transaction hashes. A balance is a current holding, not a claim that the same funds remain. The scan can retain up to 20 outgoing transfers, at most two hops; no exchange label or owner is guessed. Multi-token or multi-victim payments sharing an entity key are retained as separate payment cases in its context; their tokens are never added as one asset. An incident is capped at 100 cases to fit the bounded record. Repeats are payment ordinals within the scanned window, not a lifetime count. The scan starts without prior-window history, so patterns requiring an earlier reference outside that range are absent.

**Pack integrity:** the downloadable core Markdown is deterministic, normalized before hashing, and its SHA-256 must match `packHash` on Arkiv. No digest is embedded in its own input. Current balance and user-triggered receipt-check results are in a separate dated local supplement, so they cannot invalidate that published digest. A hash detects changed bytes; it does not prove a suspected incident. Review the pack before sending it. The browser never contacts an issuer, exchange or authority for you and includes no personal data.

Official references: [Arkiv column types](https://docs.arkiv.network/schemas/column-types/), [expiry](https://docs.arkiv.network/writing/expiration/), [batches](https://docs.arkiv.network/writing/batches/), [India's reporting helpline](https://www.pib.gov.in/Pressreleaseshare.aspx?PRID=1814120&lang=2&reg=48), [Tether contact](https://cs.tether.to/), and [Circle support](https://help.circle.com/).


The raw ≥1-token follow-up rule also matches automated contract movements: the first real run's largest candidates involved the PoolManager address in [Uniswap's official deployment list](https://developers.uniswap.org/docs/protocols/v4/deployments). The loss call-shape pass therefore fetches transactions by hash (never by recipient), retains explicit ERC-20 payments initiated by the recorded victim or encoded through `execTransaction`, and leaves unsupported calls unclassified. Only those supported payment shapes contribute to the loss headline or publisher input. Even a supported shape remains suspected and does not prove poisoning caused the payment. Raw candidate counts stay in the scan report separately. Five initial raw candidates were withdrawn from Arkiv before this feature was merged; the report records the retraction transaction.


## Campaigns and time (B2)

The Campaigns tab groups downloaded publisher records by attack transaction and counts distinct victims mentioned. These counts describe the downloaded, selected corpus, not every victim or attack on Ethereum. Expand a group to inspect its address comparisons.

**Why one hour has most records:** 125 of the 173 published records come from one attack block (26352743, two attack transactions), because the first publication took the most recent records. The other 48 are spread evenly over the scan. So the hourly chart is titled "Published records per UTC hour" and, when one hour holds most records, it says how many attack blocks fill it. It shows what was published, not how many attacks happened each hour.

**Read real block times** reads each distinct recorded attack block by number, validates the mainnet chain ID, caches timestamps for the page session, and assigns records to exact UTC hours. It does not infer dates from block height or interpolate timestamps. The read can be stopped and retried; an incomplete read does not render a complete hourly series. No recipient address is included in these requests. See [viem getBlock](https://viem.sh/docs/actions/public/getBlock).

The match-length chart compares observed full-address common prefix+suffix lengths with a stated model: the outer four hex digits at each end already match, and the remaining 32 digits are independent uniform hex digits, excluding identical addresses. For s extra matches below 31, the probability is `(s+1) * (15/16)^2 * (1/16)^s`; at s=31 the single mismatch is counted once. Expected counts are fractional and the ratio is computed from the downloaded corpus. This is not an estimate of attack prevalence, a confidence score, or proof of address ownership; selected publication, legitimate vanity addresses and correlated records affect the observed distribution.

The optional `hexfence.release.v1` publisher is a prototype, not a proved live integration. The B7 follow-up corrects the oversized manifest to tested `bytes` encoding with digest/size/path checks. No live publication has been performed; the inspected job skipped for a missing publisher secret. The publisher secret is also a human configuration step. Attestations establish build provenance, not an audit or protection against a compromised maintainer.


## Provenance: Pramaan (pre-event prototype)

`pramaan/` is the **Pramaan** prototype, imported with its full git history (original dates and authors kept). Its base commit `6d30220` is dated 5 Nov 2026 01:01 IST and the last pre-kickoff commit is `1f10464`, **before** ETHGlobal Mumbai hacking began (5 Nov 21:00 IST). It is pre-existing work, not event work. HexFence itself starts at `dc6e0c6` (6 Nov 01:19 IST). Merge plan: `docs/planning/final_hexfence/`.

# Pramaan (प्रमाण): the whole project explained simply

> **"Proven before you ship. Verified before you sign."**
> *Pramaan* means "proof" or "evidence". This file explains what we built, how each part works and why, in plain language.
> Status words used here: ✅ **done and tested** · 🟡 **done but not tested end to end yet** · ⏳ **still to do**.

---

## 1. The problem, in one story

Riya uses a DeFi website. Its smart contract was audited and is safe. But one night an attacker breaks into the website's hosting and changes **one line of JavaScript**, so that "Deposit" now sends her money to the attacker. Riya sees the same page, clicks the same button, and her wallet shows a confusing hex blob. She signs, and the money is gone.

Three things went wrong:
1. Nobody could prove the **website** was the one the developers built and tested.
2. Riya couldn't understand **what she was signing**: "unlimited approval to 0x7a3…" means nothing to most people, especially in a second language.
3. Nobody **noticed the change** in time.

Pramaan fixes all three. It links the developer's security proof to the exact website and contracts the user sees, then checks everything in the user's browser before they sign.

---

## 2. The four parts: PROVE → PUBLISH → VERIFY → WATCH

| Part | Who it helps | What it does, in one line |
|---|---|---|
| **PROVE** | Developer | Finds real bugs by actually exploiting them in a safe sandbox, then checks that the fix works. |
| **PUBLISH** | Developer | Creates a signed "release record" (a list of hashes of every website file and contract) and anchors it on ENS behind a timelock. |
| **VERIFY** | User | A browser extension checks the website, the contracts and the transaction against that record **before** you sign, and explains it in English, हिन्दी or मराठी. |
| **WATCH** | Everyone | A monitor and a Chainlink CRE workflow watch for release changes and proxy upgrades, and alert on Telegram before they take effect. |

---

## 3. PROVE: finding bugs with proof, not guesses ✅

**Where:** `packages/engine/`, `docker/sandbox/`, `tools/slither-plugin/`, CLI `pnpm pramaan prove`.

**The rule is "no proof, no finding."** Most scanners report hundreds of "possible issues" and most are false alarms. Pramaan only calls something a vulnerability when it has **reproduced** it.

How a run works:
1. **Static scanners** (Slither and Aderyn) list *candidates*, i.e. places that look suspicious.
2. For each candidate, Pramaan picks an **exploit template**: missing access control, reentrancy, or an unprotected initializer.
   - It fills the template in with the contract's real function names, either deterministically or optionally with the Claude AI (`claude-opus-5-5`).
   - The result is a real **Foundry test** that tries to steal funds.
3. The test runs inside a **locked-down Docker sandbox**:
   - no network (`--network none`) and a read-only filesystem;
   - no Linux capabilities, a memory/CPU/process limit and a 10-minute hard kill;
   - `foundry.toml` is rewritten so that FFI (running shell commands from tests) is off, and `.env` files are deleted.
   - So even a malicious repository can't escape or phone home.
4. **"Gates" check that the exploit really worked**, for example that the attacker's balance went up and, for reentrancy, that a re-entry actually happened. If the gates pass, the finding is **REPRODUCED**.
5. **Fix:** Pramaan proposes a patch (e.g. add `onlyOwner`), applies it to a copy, re-runs the same exploit (it must now **fail for the right reason**) and re-runs the project's own tests (they must still pass). The status becomes **FIXED-VERIFIED**.
   - Fixes are **never merged automatically**. A human reviews them, or they open as a pull request.
6. Everything is saved as **evidence JSON**: which tools ran, the exploit test's hash, the results, and the fix verification.

**Real result:** on our demo contracts it found `VulnerableVault.withdrawAll()` (anyone could drain the vault).
- It reproduced the drain and verified the fix (`OwnableUnauthorizedAccount` revert).
- 25 regression tests passed.
- 6/6 end-to-end sandbox tests passed, including a "malicious repository" test that tries FFI and network access and is blocked.

---

## 4. PUBLISH: a release record nobody can secretly change ✅

**Where:** `packages/manifest/`, `packages/release/`, `contracts/src/PramaanTimelock.sol`.

1. **Manifest.** A JSON file listing:
   - the SHA-256 hash of **every website file**;
   - every **contract address with its bytecode hash** (and, for upgradeable proxies, the implementation address);
   - the security **findings** and their evidence hashes;
   - the declared **third parties** the site talks to.
   
   It is written in a canonical form (RFC 8785), so the same content always gives the same hash.
2. **Signature.** The manifest is signed with a release key (P-256, in DSSE format). In CI it can instead be signed with a GitHub/Sigstore attestation. The public key is published in ENS, so anyone can check the signature.
3. **Storage.** The manifest is served next to the site and can optionally go on IPFS. Because it is found **by its hash**, any copy anywhere is fine: a fake copy wouldn't match.
4. **ENSv2 identity** (see section 7). The active release is one ENS text record, `pramaan.record = pramaan:v1:<tag>:<sha256>`.
5. **Timelock.** That record can only be changed through **PramaanTimelock**:
   - a release is *queued*, waits the delay (120 s in the demo), and then anyone can *execute* it;
   - so a change is visible **before** it takes effect;
   - an old release can't be re-activated (rollback protection), and an executed one can't be replayed;
   - a **guardian** can cancel a queued change, or **revoke** a release instantly.

**Least privilege** (who can do what):

| Key | Can do | Cannot do |
|---|---|---|
| Owner (cold wallet) | Own the ENS names and resolvers | — |
| Proposer (CI / release pipeline) | **Only queue** a release in the timelock | Write any ENS record directly. Tested: it reverts. |
| Timelock contract | Write **only** `pramaan.record` | Write any other record |
| Guardian | Cancel queued changes, write **only** `pramaan.revoked` | Publish a release |

Tested on a copy of real Sepolia: **72 of 72** permission checks behaved as expected.

---

## 5. VERIFY: the browser extension 🟡 (unit and browser tests pass; full three-app demo test pending)

**Where:** `apps/extension/` (Chrome Manifest V3), `packages/verifier-core/`, `packages/decoder/`.

When you open a protected dApp, the extension:
1. Reads the site's hint file `/.well-known/pramaan.json` to learn which ENS name it claims.
2. Reads the ENS records through **two RPC providers that must agree**. One lying provider gives "unknown", never green.
3. Checks that `pramaan.domain` equals the site you are actually on. A lookalike domain fails this.
4. Fetches the manifest **by hash** and checks its **signature** against the key in ENS.
5. Hashes the **files the page actually loaded** and compares them with the manifest. One changed byte turns it red.
6. Checks each **contract's bytecode hash** on-chain, including the proxy's current implementation.
7. Shows the result with four rows (Release · Site files · Contracts · Privacy):
   - 🟢 green = proven;
   - 🟠 amber = a change is pending (with a countdown), or a feature is unsupported;
   - 🔴 red = mismatch, revoked or wrong chain;
   - ⚪ grey = couldn't check.
   
   **Unknown is never shown as green.**

**Before you sign anything**, the extension intercepts the wallet request. It catches every wallet, via EIP-6963 and `window.ethereum`, even if a wallet replaces it later. Then:
- It **decodes it deterministically** (no AI guessing):
  - ERC-20 transfer, approve, and **unlimited approvals**;
  - NFT approve and `setApprovalForAll`;
  - ERC-1155;
  - Permit and Permit2 signatures;
  - SIWE login messages (flags a domain mismatch);
  - batched and multicall transactions, decoded recursively;
  - unknown functions are amber, never green.
- It checks the spender or recipient is a contract **listed in the release**.
- It explains the request in **English, हिन्दी and मराठी**. A test fails if any translation is missing.
- **Fail closed:** if verification is red, or still unknown after 30 s, signing is blocked. Continuing needs a ticked warning plus "Continue anyway". If Chrome restarts the extension mid-request, the request is rejected, not silently allowed.

**Privacy: wallet-address leak detection.**
- It watches what the page sends out and spots your wallet address in URLs, request bodies, beacons and image pixels, including lowercase, no-`0x`, base64 and URL-encoded forms.
- It shows *where* it went, and whether that host was **declared** in the release manifest.
- One click **blocks** that host for that site.

**Anon-RPC (Ethereum Foundation).** On Sepolia, the extension's verification reads go through the EF's Anon-RPC network (Nox) by default, falling back to direct RPC. A Privacy panel lists every read and what each provider could see. The local demo chain can't use Anon-RPC, and the panel honestly says "direct (local chain)".

**Tests:**
- decoder: 75/75;
- verifier: 53/53;
- extension unit tests: 8/8;
- Playwright browser tests: 4/4. These covered wallet interception, Hindi/Marathi warnings, a worker restart failing closed, leak detection and blocking, and no backend calls.

---

## 6. WATCH: monitoring and alerts 🟡 / ⏳

- **Upgrade timelock (✅).** VaultLab's upgradeable vault is owned by an OpenZeppelin **TimelockController** with a 120 s delay. An upgrade must first be **scheduled**, and that is publicly visible, so there is a real warning window. `pnpm demo:upgrade schedule|execute|status`.
- **Backend chain monitor (⏳ partly written).** It watches timelock, ENS record and proxy-upgrade events and creates alerts, e.g. "upgrade to an implementation **not in the release** is scheduled, executes in 2 min".
- **Chainlink CRE workflow (⏳ started).** The same check runs on Chainlink's decentralised runtime:
  - it reads the ENS pointer, revocations, pending timelock operations and upgrade events;
  - it fetches the manifest with node consensus and checks its hash;
  - it outputs a fixed decision: OK / PENDING / UNEXPECTED_IMPLEMENTATION / REVOKED / MISMATCH / UNKNOWN;
  - it sends an HMAC-signed alert.
- **Telegram (⏳).** Alerts are delivered via a bot when its token is configured. Without one it says "not configured" and never pretends.

---

## 7. ENSv2: hierarchical release identities ✅ (on a Sepolia fork)

**Where:** `packages/release/src/identity.ts`, `docs/ENS.md`.

- One parent name `<team>.eth` with **subnames**, one per app: `vaultlab.<team>.eth`, `mirroryield.<team>.eth` and `permitmarket.<team>.eth`.
  - They are made with ENS's official UserRegistry (created through the VerifiableFactory), which we verified on Sourcify.
- Each subname has its **own Permissioned Resolver** and its **own PramaanTimelock**.
- Records:

  | Record | Meaning |
  |---|---|
  | `pramaan.record` | Active release |
  | `pramaan.domain` | Allowed website |
  | `pramaan.signer` | Signing key |
  | `pramaan.attestation` | Signature policy |
  | `pramaan.timelock` | The app's timelock |
  | `pramaan.revoked` | Up to 16 revoked release hashes |

- Proven on a fork: the real ENS Universal Resolver returns the subnames' records, and the full cycle verified → pending (amber) → revoked (red) works.
- Real Sepolia: **not deployed yet**, because it needs funded wallets. `pnpm run doctor --network sepolia` checks readiness, and `pnpm pramaan deploy identities --network sepolia --parent <name> --yes` does the deployment.

---

## 8. The three demo apps 🟡 (infra done; apps being built from specs)

All three share the same Pramaan infrastructure, but each has its **own website origin, its own release manifest and its own ENS identity**.

| App | Local URL | What it demonstrates |
|---|---|---|
| **VaultLab**: DeFi vault | http://localhost:5180 | The PROVE story: the real bug, the exploit, the verified fix. The app uses the fixed vault and shows the published evidence. |
| **MirrorYield**: yield farm | http://localhost:5182 (lookalike http://127.0.0.1:5183) | An honest contract on a **tampered website**. `pnpm demo:tamper` really changes the built JavaScript on disk (the farm address becomes the attacker's), so the extension goes red. `pnpm demo:restore` brings back the exact original bytes and it goes green. |
| **PermitMarket**: NFT market | http://localhost:5184 | **Unlimited approval** ("Enable one-click buying") versus exact approve versus a permit signature. Plus a separate **leak test page** (only with `--fixtures`) that sends your address six ways to a test tracker at `127.0.0.1:5190`. |

- **Contracts:** 108 Foundry tests pass, including fuzz and reentrancy tests for the new MirrorYieldFarm and PermitMarketplace. A real bug was found and fixed in the marketplace's listing query.
- **Build and serve scripts:**
  - `pnpm build:demos` builds the apps;
  - `pnpm demo:serve` serves them;
  - an admin endpoint does tamper/restore.
  - 33 pipeline tests passed on a real local chain.
- **The apps' screens** are specified in `docs/apps/` (step-by-step plans for an AI coding agent) and are being built from them.

---

## 9. Backend and dashboard ⏳

- **Backend** (`apps/server`, Fastify + Postgres/PGlite). Partly written:
  - sign-in with Ethereum (SIWE), hashed sessions and API tokens, CSRF protection, roles;
  - a Postgres job queue (QUEUED → RUNNING → COMPLETED/FAILED/CANCELLED) that runs PROVE jobs in the sandbox;
  - findings and fixes, releases, the monitor, Telegram, and signed webhooks from CRE and GitHub.
  
  The API is defined in `docs/API_CONTRACT.md`.
- **Dashboard** (`apps/web`, React). Partly written: projects, live job progress, findings with the exploit test and fix diff, releases, verify/decode tools, monitoring. It uses only real backend data.
- **Important:** the extension **never needs the backend**. Verification works even if our servers are down. That is the "censorship-resistant" part of CROPS.

---

## 10. Sponsors (details in `docs/SPONSORS.md`)

- **ENS:** ENSv2 subnames, Permissioned Resolvers, scoped roles and timelocked records are the core of PUBLISH and VERIFY.
- **Ethereum Foundation:** Anon-RPC reads by default, plus CROPS: censorship-resistant, open source, private, secure. Submit to only one EF track.
- **Chainlink CRE:** the decentralised watchdog. Simulation is enough for the prize.

⚠ **Check eligibility before submitting:** ETHGlobal's Classic rules require all code to be written after kickoff (5 Nov 21:00). Confirm with the organisers which track the team is in.

---

## 11. Security choices, in short

- Untrusted code runs **only** in the sandbox. Commands use argument arrays, never shell strings. Paths and zip uploads are checked (no `../` escapes).
- No secrets in code or git: `.env` and `.pramaan/` are ignored, and keys are never printed.
- Every check has four honest outcomes: proven, mismatch, unknown, service failure. Grey is never shown as green.
- AI is optional and never decides a security verdict. Decoding and verification are deterministic code.
- We don't claim "100% secure". We claim "this exact release was tested like this, and here is the proof".

---

## 12. Folder map

```
contracts/            Solidity: PramaanTimelock, demo contracts, Foundry tests
packages/manifest     release manifest format, hashing, signing
packages/engine       PROVE: scanners + exploit templates + sandbox + fixes
packages/release      deploy, ENSv2 identities, timelock, manifest assembly, IPFS, Sepolia doctor
packages/verifier-core  the verification logic (used by the extension, CLI and backend)
packages/decoder      transaction decoding + risk + EN/HI/MR explanations
apps/extension        Chrome extension (VERIFY)
apps/demos            VaultLab, MirrorYield, PermitMarket + build/serve/tamper scripts
apps/cli              `pnpm pramaan …` commands and `demo:up`
apps/server           backend (in progress)
apps/web              dashboard (in progress)
workflows/cre-monitor Chainlink CRE workflow (in progress)
docker/sandbox        the network-less analysis sandbox image
docs/                 SPONSORS, DEPLOY_SIMPLE, ENS, FAUCETS, API_CONTRACT, apps/ specs
```

---

## 13. What's left (honest list)

1. ⏳ The real screens of the three demo apps, built from the `docs/apps/GEMINI_PLAN_*.md` plans.
2. ⏳ Rewrite `pnpm demo:up` to bring up all three apps with their ENS subnames and releases in one command, then run the full three-app browser test.
3. ⏳ Finish the backend, then the CRE workflow plus a real `cre workflow simulate`, then the dashboard.
4. ⏳ The final `RUN.md` and deploy guides with every command tested, a security review, and `AI_USAGE.md`.
5. ⏳ Public Sepolia deployment. This needs funded test wallets; see `docs/DEPLOY_SIMPLE.md` and `docs/FAUCETS.md`.

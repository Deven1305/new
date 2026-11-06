# Handoff: what is done, what is verified, and what still needs a person

Updated 2026-11-06 after the Docker-laptop pass. Compared against `Four_Ideas_Priority.pdf`, Priority 1 (Pramaan) only.
Evidence files are in `docs/evidence/`. "Verified" below means it was run in this session and the result was read.

## Verified on the Docker laptop (2026-11-06)

| Area | What ran | Result |
|---|---|---|
| Sandbox | `pnpm pramaan sandbox build` (Slither 0.11.6, Aderyn, Foundry, 8 solc versions; network disabled at run time) | image ready |
| PROVE e2e | `PRAMAAN_E2E=1 pnpm exec vitest run --project engine` | 7 sandbox tests pass (VulnerableVault sweep, onlyOwner fix, reentrancy, initializer takeover, oracle, malicious-repo containment, wall-clock kill) |
| PROVE CLI | `pnpm pramaan prove <dir> --fix` on `contracts`, `examples/reentrancy-bank`, `initializer-takeover`, `oracle-lending` | `contracts`: 1 reproduced of 52 candidates, fix VERIFIED; initializer + oracle: reproduced and fix VERIFIED; reentrancy-bank: reproduced, honest "no deterministic fix" (no ReentrancyGuard), fixed twin blocks it |
| Dashboard path | server + embedded worker + API calls: project → analysis job (`fix: true`) → events → findings → review | worked; `/readyz` reports Docker available. Driven through the HTTP API, **not** by clicking the web UI |
| Demo | `pnpm demo:up --fixtures` on a Sepolia fork, with PROVE | all three apps VERIFIED; the VaultLab manifest carries the real finding `PRM-3` (critical, fixed-verified) |
| Attacks | tamper → red / restore → green; lookalike origin → domain mismatch; proxy upgrade to unaudited code (`demo:upgrade`); malicious queued pointer (`demo:release queue-evil`, guardian `cancel`) | all observed |
| Browser E2E | Playwright, real Chromium, built extension, clean demo: `extension.e2e` 6/6, `v2.e2e` 3/3, `local.e2e` 4/4 | pass (see `browser-e2e-clean-run-2026-11-06.txt`) |
| Anon-RPC | `PRAMAAN_LIVE_ANON=1 ... test/anon.live.e2e.ts` | 18 Sepolia reads (chain ids + ENS records) through the Nox mixnet at ~2 s each, none fell back |
| Server monitors | `POST/DELETE /v1/projects/:id/monitors` + poller | 4 new tests; server suite 39/39 |
| Scans | `pramaan scan --site ... --declared 127.0.0.1:8545` | clean apps exit 0; the tracker fixture exits 1 |
| Record page | `pramaan record-page` | renders the live VaultLab release; 4 tests |
| CRE | `bun test` (65 pass), `cre workflow build` (WASM builds), `config-from-demo.ts`, `live-decisions.ts` against the live fork | OK / PENDING_UPGRADE / UNEXPECTED_IMPLEMENTATION / PENDING_RELEASE_CHANGE detected; signed posts accepted by `/v1/ingest/cre` (HTTP 200) and stored as alerts |
| Full suites | `pnpm typecheck`, `pnpm test:unit` (208 pass, 8 skipped = the Docker e2e), `forge test` (108 pass), web + extension builds | pass |

### Bugs found and fixed in this pass
- Extension: a content-script report could be processed before the tab's async reset finished and was lost (site check stuck amber). Now handled strictly in order per tab.
- Extension: a stale tab object could overwrite the current tab's stored record after a navigation (flaky E2E, wrong state after a service-worker restart). `persist()` now only writes the current object.
- Bundle scan did not see tracker endpoints given as IP:port, so the fixture was not flagged. Fixed (high severity when undeclared).
- The `v2` browser test could not pass reliably because releases are cached for 60 s; it now uses the extension's own re-check.
- `demo:up` never ran PROVE, so releases carried no findings. It does now (`--skip-prove` to skip).

## NOT done (needs you, or is not built)

| # | Item | Why | What you do |
|---|---|---|---|
| 1 | **Live Sepolia deployment** | The generated test keys hold 0 ETH. A faucet needs a human (login / captcha); nothing here automates that | Fund the three addresses printed by `pnpm run doctor --network sepolia`, then see below |
| 2 | **Hosted apps / contracts on Sepolia** (`demo:up --network sepolia`) | Not implemented: `demo:up` is local-fork only. Only the ENS identities have a live path | Needs a build, or deploy the demo contracts by hand and record them |
| 3 | `cre workflow simulate` + Telegram alert | `cre login` is interactive on your Chainlink account; no Telegram bot token | `cre login`; create a bot with @BotFather and set `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` |
| 4 | GitHub Action + Sigstore attestation | Needs a throwaway repo, `workflow` scope on the token and a pushed tag; never run | `gh auth refresh -s workflow`, then `docs/templates/pramaan-release.yml` |
| 5 | GitHub pull-request creation from a finding | Needs a throwaway repo you own and `GITHUB_TOKEN` | Set the token and try `POST /v1/fixes/:id/pull-request` |
| 6 | Web UI clicked through by a person | The API path was driven; the dashboard pages were only built | `pnpm server` + `pnpm dev:web` |
| 7 | Manual Chrome + MetaMask/Rabby run | Playwright uses an injected provider, not a real wallet | Load `apps/extension/dist`, repeat the attacks by hand |
| 8 | Uniswap v4 hook templates, 0G Private Computer | Stretch, not started | |
| 9 | IPFS pinning of the record page | Needs `PINATA_JWT` or a Kubo node | Set one, then pin `record.html` |
| 10 | Marathi review by a native speaker, 3-minute video | People | |
| 11 | ETHGlobal From Scratch eligibility of pre-event code | Unresolved; the git history shows pre-kickoff commits | Ask the organisers |

## Going live on Sepolia once funded

```powershell
pnpm run doctor --network sepolia --parent pramaan-mumbai26      # prints the 3 addresses and READY / what is missing
# fund owner ~0.15, proposer ~0.03, guardian ~0.03 test ETH (docs/FAUCETS.md); wait for READY
pnpm pramaan deploy identities --network sepolia --parent pramaan-mumbai26 --yes --broadcast-negative
```

`docs/evidence/sepolia-rehearsal-on-fork.md` records that this exact flow completes on a **fork** (21 setup transactions, 72
role-boundary transactions all as expected). That is a rehearsal, not a deployment. Keys live only in the gitignored `.env`.

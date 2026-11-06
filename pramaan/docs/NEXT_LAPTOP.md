# Handoff: what is done, what is missing, and what to run on the Docker laptop

Updated 2026-11-06. Compared against `Four_Ideas_Priority.pdf`, Priority 1 (Pramaan) only.

## Verified on the first laptop (no Docker)

- `pnpm typecheck` clean; `pnpm test:unit` 196 passed / 7 skipped (the 7 need Docker); `forge test` 108 passed.
- `pnpm --filter @pramaan/web build` and `pnpm --filter @pramaan/extension build` pass.
- Live server: project -> analysis job -> worker claims it -> fails honestly with "docker not found"; SSE stream and events work.
- `pnpm demo:up` on a local Sepolia fork (Tenderly gateway): all three apps verify; tamper -> red/mismatch; restore -> green.

## Added in this push

Server routes (jobs, uploads, findings, fixes, PR creation, releases, mirror, verify/site, GitHub webhook, Telegram test),
worker wiring + `engine_result` bug fix, `pramaan scan` (build-time secret/tracker scan), `docs/templates/pramaan-release.yml`,
`demo:up` host-readiness fix.

## Installing the release workflow

The GitHub token used on the first laptop lacks the `workflow` scope, so the workflow is stored as a template at
`docs/templates/pramaan-release.yml`. Install it with: `mkdir .github/workflows` then `cp docs/templates/pramaan-release.yml .github/workflows/`
(or run `gh auth refresh -s workflow` once and commit it). In an app repo it must live at `.github/workflows/pramaan-release.yml`.

## NOT done (needs the Docker laptop or more work)

| # | Item | Where it stands | Needs |
|---|------|-----------------|-------|
| 1 | **PROVE end to end** (Slither + Aderyn + Foundry exploit in the sandbox, fix, re-prove) | Code and 7 tests exist but were never run | Docker |
| 2 | Demo with a *real* proven finding (`demo:up` says "PROVE not run") | Releases carry 0 findings | Docker + step 1 |
| 3 | Browser E2E of the extension (Playwright) | Never run in this session | Chromium, `demo:up` running |
| 4 | **Chainlink CRE simulation** + Telegram alert from it | SDK adapter done; runner/HTTP/config generator missing | CRE CLI login |
| 5 | Live **Sepolia deployment** (contracts, ENSv2 names, timelock) | Only local fork tested | funded testnet keys, `.env` |
| 6 | GitHub Action run for real, Sigstore attestation verified by the extension | Workflow written, YAML valid, never executed | a test app repo + variables |
| 7 | Oracle-maths exploit template | Not written (should-ship in PDF) | engineering |
| 8 | Uniswap v4 hook module / 0G Private Computer | Not started (stretch) | engineering / workshop answers |
| 9 | Anon-RPC private mode | Partly wired in extension, untested live | Sepolia + Nox |
| 10 | Server active monitors (`POST /v1/projects/:id/monitors` still 501) | Not built; CRE workflow is the PDF's monitor | engineering |
| 11 | Record page on IPFS, Marathi review, README CROPS section, 3-min video | Not done | team |
| 12 | ETHGlobal "From Scratch" eligibility of pre-event code | Unresolved | organizers |

## Run on the other laptop (Docker installed)

```powershell
git pull origin main
pnpm install --frozen-lockfile
# Foundry 1.9.0 on PATH (or: cd contracts; forge build)
pnpm pramaan sandbox build            # builds the analysis image (Slither, Aderyn, Foundry)
pnpm pramaan doctor
pnpm test:unit                        # the 7 Docker tests should now run, not skip
pnpm exec vitest run --project engine packages/engine/test/e2e.sandbox.test.ts
pnpm pramaan prove examples/reentrancy-bank --fix
pnpm pramaan prove examples/initializer-takeover --fix
pnpm pramaan prove contracts --fix    # the Kosh vault demo
```

Expected: reproduced findings with `fix: VERIFIED`, report in `.pramaan/prove/report.md`.

Dashboard path (uses the new routes + worker):

```powershell
pnpm server            # http://127.0.0.1:8787, admin token in .pramaan/server/admin-token.txt
pnpm dev:web           # http://localhost:5173 ; create a project, run analysis on example "reentrancy-bank" with fix
```

Full demo + browser tests:

```powershell
$env:SEPOLIA_RPC_URL_A = "https://sepolia.gateway.tenderly.co"   # publicnode/1rpc/drpc did NOT work for anvil forks
pnpm demo:up                                                       # ~7 min
$env:PRAMAAN_EXPECT_BACKEND_OFF='1'; pnpm --filter @pramaan/extension exec playwright test -c playwright.config.ts test/v2.e2e.ts
```

Then: record results in `docs/IMPLEMENTATION_STATUS.md`, fix whatever fails (report failures honestly), and continue with
items 4-10 above in that order.

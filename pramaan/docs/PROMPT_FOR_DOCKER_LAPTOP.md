# Prompt to paste into Claude Code on the Docker laptop

Copy everything below the line into Claude Code, opened in the project folder on the laptop that has Docker.

---

You are continuing the Pramaan project (ETHGlobal Mumbai 2026, Priority 1). Read `docs/NEXT_LAPTOP.md`, `docs/IMPLEMENTATION_STATUS.md`, `RUN.md` and `docs/ENS.md` first. The design source is `Four_Ideas_Priority.pdf` (Pramaan section only).

Rules: report results honestly. If something fails, show the output and fix the cause; never mark something working that you did not run. Never commit secrets, `.env`, `.pramaan/`, keys or private keys. Do not push to any branch other than `main` without asking. Commit in small steps with clear messages. Ask before anything that costs money or touches mainnet.

## 0. Sync and prerequisites
1. `git pull origin main` (latest commit should include "Implement missing server routes, build-time leak scan..."). Create a note of `git log --oneline -5`.
2. Check: Node 20.19+/22, pnpm 10 (`npm i -g pnpm@10`), Docker running (`docker info`), Python 3, Foundry 1.9.0 (`forge --version`, `anvil --version`; Windows zip: https://github.com/foundry-rs/foundry/releases/tag/v1.9.0 into `.pramaan/tools` and add to PATH).
3. `pnpm install --frozen-lockfile`, then `cd contracts; forge build; cd ..`.
4. `pnpm typecheck` must pass.

## 1. Sandbox and PROVE (never run before; highest priority)
1. `pnpm pramaan sandbox build` then `pnpm pramaan sandbox status` and `pnpm pramaan doctor`. Fix image build problems if any (Slither, Aderyn, Foundry inside the image; network disabled at run time).
2. `pnpm test:unit` – the 7 Docker-gated tests must now RUN (not skip). Also run `pnpm exec vitest run --project engine packages/engine/test/e2e.sandbox.test.ts`.
3. Run the agent on each example and record results:
   - `pnpm pramaan prove examples/reentrancy-bank --fix`
   - `pnpm pramaan prove examples/initializer-takeover --fix`
   - `pnpm pramaan prove contracts --fix` (Kosh vault: missing access control on withdrawAll)
   Expected: finding status `reproduced`, then `fix: VERIFIED` (exploit fails after fix, project tests pass). Check `.pramaan/prove/report.md` and `findings.json`. Confirm "no proof, no finding": a candidate without a passing exploit must be dropped/marked.
4. Dashboard path through the new server routes: `pnpm server` (http://127.0.0.1:8787; admin token in `.pramaan/server/admin-token.txt`) and `pnpm dev:web` (http://localhost:5173). Create a project, run analysis with source example `reentrancy-bank` and `fix: true`, watch the live progress stream, open the finding, review it, and confirm the fix shows verified. Confirm `/readyz` reports docker available. If the worker fails, check `apps/server/src/worker.ts`.
5. Test the GitHub features only with a throwaway repo you own: set `GITHUB_TOKEN`, run analysis with a github source, and `POST /v1/fixes/:id/pull-request`; confirm a PR opens on a new `pramaan/fix-*` branch and is NOT merged.
6. Re-run `pnpm demo:up` WITH prove results feeding the release (see `apps/cli/src/prove.ts`, `docs/evidence/`) so the manifest carries real `findings[]` (class, severity, status, exploitTestSha256, evidenceSha256, fixCommit). Update the demo so the vault finding appears in the extension panel ("1 critical issue fixed, proof on record").

## 2. Full demo and browser tests
1. `set SEPOLIA_RPC_URL_A=https://sepolia.gateway.tenderly.co` (publicnode, 1rpc, drpc and rpc.sepolia.org failed for anvil forks), then `pnpm demo:up` (about 7 minutes; wait for "Local fork demo ready").
2. In a second terminal: `pnpm pramaan verify http://localhost:5180`, `:5182`, `:5183`. All VERIFIED. Then `curl -X POST "http://127.0.0.1:5189/tamper?app=mirroryield"` and verify `:5182` again – must show files mismatch (red); then `/restore` – green again. Also `pnpm demo:upgrade` (proxy upgrade to unaudited code) and `pnpm demo:restore`.
3. Browser E2E with Chromium: `pnpm --filter @pramaan/extension build`, then `$env:PRAMAAN_EXPECT_BACKEND_OFF='1'; pnpm --filter @pramaan/extension exec playwright test -c playwright.config.ts test/v2.e2e.ts` (run `npx playwright install chromium` first). Also run `test/extension.e2e.ts` and `test/local.e2e.ts` if they apply. Every PDF moment must be observed: green panel; unlimited approval explained in Hindi/Marathi/English with risk level; leak guard blocks an analytics request carrying the address (PermitMarket fixture); tampered JS -> red and signing blocked; swapped contract -> orange; pending/revoked release blocks.
4. Load the unpacked extension (`apps/extension/dist`) in Chrome manually with MetaMask or Rabby and repeat the three attacks by hand. Note anything that differs from the automated run.

## 3. Release pipeline
1. Copy `docs/templates/pramaan-release.yml` to `.github/workflows/pramaan-release.yml` (needs a GitHub login with `workflow` scope: `gh auth refresh -s workflow`). Commit it.
2. In a throwaway app repo (or this repo's demo build), set the repository variables listed at the top of the workflow, push a tag `v0.0.1`, and watch the run. Fix any step that fails (CLI checkout, `pramaan scan`, `pramaan manifest`, `actions/attest-build-provenance`, release asset upload). Verify the attestation: set the ENS records `pramaan.attestation = github:.github/workflows/pramaan-release.yml` and `pramaan.repo`, then confirm `pnpm pramaan verify <origin>` reports a valid Sigstore signature.
3. `pnpm pramaan scan --site apps/demos/dist/permitmarket --declared <hosts>` – confirm it flags the tracker fixture and passes the clean apps.

## 4. Chainlink CRE monitor
1. Install CRE CLI and Bun (see `workflows/cre-monitor/pramaan-monitor/README.md` and `docs/CRE_IMPLEMENTATION_BRIEF.md`, `docs/GEMINI_CRE_STATUS.md`). `cre login` (user must do this interactively – ask them).
2. `cd workflows/cre-monitor/pramaan-monitor; bun install; bun test`. Then finish the missing pieces: the runner/HTTP/config generator ("config-from-demo"), so `cre workflow simulate` works against the running demo (site hash, ENS record, timelock queue, EIP-1967 slot).
3. Simulate three cases: OK; tampered site; malicious queued record / proxy upgrade. Post the signed result to `POST /v1/ingest/cre` (HMAC with `CRE_INGEST_SECRET`) and confirm an alert row appears and a Telegram message arrives (create a bot via BotFather; set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`; use `POST /v1/projects/:id/alerts/test-telegram` first). Save the simulation log under `docs/evidence/`.

## 5. Live Sepolia (only if the user provides funded testnet keys)
Follow `docs/DEPLOY_SIMPLE.md` and `docs/FAUCETS.md`: `.env` from `.env.example`, `pnpm doctor --network sepolia`, `pnpm deploy:identities`, `pnpm demo:up --network sepolia ...` if supported. Record tx hashes and the negative test (CI key trying to change `addr` reverts) in `docs/evidence/`. Do NOT use real funds or mainnet.

## 6. Remaining engineering (in this order, each with tests)
1. Oracle-maths exploit template (unchecked oracle price/decimals) + Slither detector mapping + deterministic fixer + sample vulnerable contract in `examples/`.
2. Server `POST /v1/projects/:id/monitors` and an active poller (currently 501) – or explicitly document that CRE is the only monitor.
3. Anon-RPC private mode in the extension (`apps/extension/src/background/privacy.ts`, `transport.ts`); verify on Sepolia/Nox and show which calls go through it.
4. Public record page for a release (IPFS-hosted static page showing manifest, findings, contracts).
5. Stretch only if time: Uniswap v4 hook exploit templates; 0G Private Computer for the AI fallback explanation.
6. Docs: README CROPS section (S leads; C, O, P hold; works with our server off), partner checklist, prior-art list (Verifiable Web, WEBCAT), FEEDBACK.md if using Uniswap.

## 7. Finish
1. `pnpm typecheck`, `pnpm test:unit`, `cd contracts; forge test`, both builds. All must pass; list anything skipped and why.
2. Update `docs/IMPLEMENTATION_STATUS.md` and `docs/NEXT_LAPTOP.md` with exactly what was run, the results, and what remains. Save evidence files in `docs/evidence/`.
3. Commit and `git push origin main` (pull/rebase first so there are no conflicts). Summarise: done, verified, failed, not done.

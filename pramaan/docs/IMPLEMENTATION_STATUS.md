# Implementation status

Updated 2026-11-05. Work in progress on `codex/project-start`; no deployment or publication.

- `pnpm install --frozen-lockfile`: passed with pnpm 11.25.0; esbuild is the only allowed install script, consistent with existing pnpm 10 policy. Browser compatibility data pinned to 1.5.474 to satisfy the existing package-age policy.
- Initial `pnpm test:unit`: 140 passed, 1 failed, 19 skipped; one additional suite failed before execution because Forge was not found. The failure exposed stale byte offsets in the deterministic fixer; its targeted suite now passes 14/14 including a stale-source regression.
- Initial `pnpm typecheck`: failed on absent `DemoGuide`. After adding an explicitly provisional guide, extension typecheck exposed incompatible background/UI interfaces; integration is ongoing.
- `pnpm --filter @pramaan/extension build`: passes after wiring privacy observation to existing matchers; this build is not evidence of a working guard, and typecheck remains failing.
- Initial `pnpm build`: fails because demo builds require state that the existing `demo:up` does not generate in the required V2 format. Web build is being checked independently.
- Backend `src/index.ts` and `src/worker-main.ts` are absent. The API in `docs/API_CONTRACT.md` is a contract, not evidence that routes exist. Full local startup and end-to-end trust flow are not yet verified.
- No Foundry binaries were found on PATH or at the handoff's expected `~/.foundry/bin` location. Docker and CRE also not found on PATH. No live chain, sandbox reproduction, Sepolia deployment, or CRE simulation has been verified in this continuation.

## Historical continuation results (superseded by current checkpoint below)

- `pnpm typecheck`: passed across the workspace after fixing the malformed archive-path regex, missing Fastify cookie type augmentation, absent web page and extension interface mismatches.
- Selected isolated suites: 10 files, 143 tests passed (manifest, decoder, engine unit, verifier-core non-chain, server API). Command: `pnpm exec vitest run --project manifest --project decoder --project engine --project server --project cli --project verifier-core packages/verifier-core/test/site-and-verdict.test.ts packages/verifier-core/test/release.test.ts packages/verifier-core/test/release-states.test.ts packages/verifier-core/test/signature.test.ts packages/engine/test/unit.test.ts packages/manifest/test packages/decoder/test apps/server/test`.
- `pnpm --filter @pramaan/web build` and `pnpm --filter @pramaan/extension build`: passed independently. Extension typecheck passed; browser E2E not run. The bundle alone is not verification evidence.
- `pnpm server` and `pnpm dev:web --host 127.0.0.1` started on ports 8787 and 5173. Actual HTTP POST to `/v1/decode` for an unlimited approval returned `high` and `UNLIMITED_APPROVAL`; web root returned 200. The server intentionally reports 503 readiness and 501 for unimplemented routes.
- Guard now rejects on timeout, navigation during verification, missing release or incomplete site check. Its browser enforcement, release-to-wallet path, and recovery after tampering remain untested; no claim of universal wallet enforcement. Resource hashes are obtained by re-fetching, not necessarily the actual executed response bytes; this TOCTOU limitation prevents a strong claim of loaded-byte integrity.
- `demo:up` still uses removed `apps/demo-dapp` paths and writes old state while the three demos require DemoStateV2; no local ENS chain or full trust flow has been demonstrated. Existing CRE collector uses direct resolver text calls; ENSv2 Permissioned Resolver documentation specifies `resolve` and the SDK entrypoint/adapter are missing. WATCH is not a runnable workflow.
- AI contributed implementation, testing and documentation in this continuation; earlier contribution history has not been independently reconstructed.

## Event eligibility

This checkout contains pre-event project code (base commit `6d30220`); this continuation is existing-project development. The team is registered From Scratch. Eligibility for using this work is unresolved and requires organizer guidance; do not present it as newly created during the event. See [ETHGlobal rules](https://ethglobal.com/rules).

## Local chain test update

- Downloaded official Foundry v1.9.0 Windows x64 into ignored `.pramaan/tools`, verified the GitHub release asset SHA-256 `2b02444d46c9218fe2e6be66015265ce131fe6b7c384e33e630b00f9a0bff072`. This is a local test deviation from the repository's prior 1.8.7 environment, not a change to CI. Source: https://github.com/foundry-rs/foundry/releases/tag/v1.9.0 .
- With that directory on PATH, `pnpm test:contracts`: 108 passed, 0 failed, 1 ENS fork setup skipped. `pnpm test:unit`: 156 passed, 0 failed, 6 Docker sandbox tests skipped; this includes 13 verifier-core tests against a local anvil. `pnpm exec vitest run --project demos`: 32 passed, 1 skipped; its real-chain pipeline uses placeholder frontend fixtures and is not browser proof. `pnpm exec vitest run --project extension-unit`: 2 passed (pure privacy/policy tests).
- A V2 orchestration rewrite is in progress and being exercised on a Sepolia fork. The public RPC returned Sepolia chain ID; that alone does not establish ENS compatibility, independence or a completed release.

## Current checkpoint (supersedes historical baseline above)

- Two fresh local Sepolia-fork runs built all three real demo apps and independently verified their signed, timelocked release records. The second used a distinct guardian and wrote an ignored release key. A second startup while port 8545 was occupied correctly refused to use the existing chain. Startup currently recreates a fork and identities; it does not resume a prior chain. ENS is read from a single local fork RPC; this is not independent-provider agreement or live Sepolia deployment. PROVE was not run.
- With the decoder backend stopped, a new Chromium profile verified MirrorYield. A viem-backed test wallet sent an accepted approval and its local receipt succeeded. Tampered served JS matched the changed on-disk hash, was rejected before provider invocation, and account nonce remained unchanged; byte-identical restore resumed the path. Same run also held both approval and typed-data permit to an unlisted contract. Public-only details: `docs/evidence/local-fork-browser-fresh.json`. The browser uses re-fetches, so these checks do not establish which bytes were executed against an adversarial server.
- Browser command: `$env:PRAMAAN_EXPECT_BACKEND_OFF='1'; pnpm --filter @pramaan/extension exec playwright test -c playwright.config.ts test/v2.e2e.ts`. First two tests passed. A third pending/revocation test is explicitly skipped: initial queue transaction reverted with too little gas; retry timed out while anvil output filled an undrained process pipe. It is not verified. Queue may have been submitted before shutdown. Fork stopped, so no persistent chain effect.
- Final source adds quiet anvil output to prevent the suspected pipe blockage; CLI typecheck passed after that change, but a fresh end-to-end startup with this last adjustment has not run. The V2 test's pending/revocation case must be unskipped and investigated on a fresh fork. Extension build passed and first two browser cases passed after release context was wired; workspace-wide typecheck has not been repeated after the latest change.
- The current demo writes `keys.json` and `release-key.pem` in ignored `.pramaan/demo`; these are local-fork-only secrets and must never be committed. Generated manifest `commit` is a file-tree digest, not a Git source commit. Separate guardian verifies a role configuration, not operational key custody.
- Handoff hold requested by managing chat while alternative CLI is evaluated. All processes started here (fork, demo hosts, decoder backend, web) were stopped. No push, merge, live-chain deployment or publication.

## Gemini continuation, verified after quota reset (5 November2026)

Branch codex/gemini-work. d1cfc2f implements real SIWE/session/CSRF/scoped-token/project CRUD and private project-filtered statistics:9server tests pass, workspace typecheck passed before final auth hardening and server typecheck passed after it. Actual HTTP persisted restart/create/detail/patch and headless dashboard form/create/reload passed. Worker/jobs/findings/release/monitor routes remain incomplete; readiness503 is honest but frontend labels it unreachable incorrectly (queued for fix).

be8b4ab adds SDK1.23 CRE EVM adapter, ENSv2 profile reads, pinned block state and proper JSON/protobuf byte encoding:38Bun unit tests and typecheck pass. Direct codec reads matched all3local-fork resolvers. Runner/HTTP/config still next slice. CLI1.39.0 and Bun1.4.4 checksums verified; explicit SDK Javy setup succeeded. CLI login absent, so no CRE simulation is claimed.

Pending/revocation browser test is now enabled and passed alongside the other2V2 browser tests with backend off. Explicit local Anvil TestClient mining resolves queue/cancel/revocation receipt waits. Active digest remains current while future pointer queues; distinct guardian cancels; revoked state prevents provider invocation; exact restoration permits a new mined approval. Evidence docs/evidence/pending-revocation-browser.json. Historical skipped/timeout notes above are superseded by this run, not deleted. No Docker PROVE or public deployment claimed.

## Leftover pass (6 November 2026)

- Web footer: `/readyz` answering 503 with a readiness body now shows "Backend degraded" (worker/Docker reason), not "unreachable"; only transport failures stay offline. Web typecheck passes; no new web unit test was added.
- Production bootstrap: new `ADMIN_ADDRESS` makes that wallet the first admin (SIWE sign-in, no token minted or logged). Production without it now fails fast instead of minting an unretrievable token. 2 new tests; server typecheck and all 21 server tests pass.
- Still unfinished (large, not started here): jobs/findings backend routes, release queue/execute, GitHub webhook, active monitor poller, CRE `config-from-demo` generator and CRE simulation (needs CLI login), Docker PROVE run, Sepolia/mainnet deployment, ETHGlobal eligibility confirmation.

## Docker-laptop pass (6 November 2026)

Run on the Windows laptop with Docker, Foundry 1.8.7, Node 20.20.2, Bun 1.4.4 and CRE CLI 1.39.0 (checksum verified). Details, commands
and the list of what is still not done: [NEXT_LAPTOP.md](NEXT_LAPTOP.md); evidence files in [evidence/](evidence/).

- PROVE ran for real in the sandbox (7 e2e tests, 4 example projects). New: oracle-maths template (detector, exploit template, deterministic fixer, `examples/oracle-lending`).
- `demo:up` now runs PROVE and records the verified finding in the VaultLab release; `--fixtures` builds and serves the attack fixture and tracker.
- Browser: 13 Playwright tests pass on a clean demo. Two extension bugs fixed (tab-ordering race; stale tab object persisted).
- Server: monitors implemented (POST/DELETE + poller) and RPC URLs are returned as origin only; the server reads `.env` like the CLI.
- Bundle scan now flags undeclared IP-address endpoints (the tracker fixture fails the scan; the three apps pass).
- Anon-RPC measured live on Sepolia (18 reads via the Nox mixnet). Public record page (`pramaan record-page`) added.
- CRE: workflow builds and passes its 65 unit tests; a live-decision harness (explicitly NOT `cre workflow simulate`) ran four cases against the fork and the signed posts produced alerts.
- Sepolia: three fresh testnet keys were generated into the gitignored `.env`; they hold **0 ETH on the real chain**. The deployment flow was rehearsed on a fork only. No live deployment, no claim of one.
- Not run: `cre workflow simulate`, Telegram delivery, the GitHub Action/attestation, PR creation, manual MetaMask/Rabby run.

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

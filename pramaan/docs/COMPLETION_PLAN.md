# Pramaan functional completion plan

Updated 5 November 2026. Gemini CLI is the implementation worker on `codex/gemini-work`; Terra is stopped and its checkpoint remains on `codex/project-start`. The coordinator reviews completed chunks and commits verified changes. The team handles event eligibility. Latest verified results are in IMPLEMENTATION_STATUS.md and docs/evidence; the steps below also retain historical planning context.

## What the Claude attachment tells us

Read the complete attachment at `C:/Users/hp/.codex/attachments/79f58e2d-1f82-45bf-b850-7018881ea264/Pasted text.txt`. It contains eight historical task briefs. Four implementation/documentation workstreams are labelled Failed, and the research workstreams supply questions rather than their final answers. Treat claimed prior testing as historical context, not reproduced evidence. Old Windows paths, no-Git instructions, parallel folder ownership and machine-installed tooling are superseded by the current checkout and human branch/commit instructions.

| Historical stream | What exists in this checkout | Completion boundary |
| --- | --- | --- |
| CRE monitoring | Pure observation, hash, decision, signing helpers | Add project/workflow config, pinned SDK adapter, entrypoint, real CLI run and receipt |
| Backend | Database, auth, queue, worker, alert utilities; new incremental HTTP startup | Wire real authenticated project/job/finding/release/monitor routes; retain documented API shapes |
| Dashboard | Existing pages and API client; provisional demo guide | Connect to actual backend; every visible action works or explains why disabled |
| RUN/deployment docs | Partial older deployment notes | Write from actual tested commands and supported topology, not planned interfaces |
| Anon-RPC facts | Extension transport and harness integration | Demonstrate actual routed reads and visible fallback behavior |
| GitHub attestation facts | Signature policy and release workflow code | Successful provenance workflow/bundle verification remains distinct from release-key mode |
| CRE CLI facts | Old research questions | Verify current CLI help, authentication requirement and pinned SDK compatibility |
| Three demo apps | Contracts, app code, build/serve/tamper infrastructure | V2 orchestration is being repaired; repeat real transactions and browser protection tests |

Most failures cross an interface boundary. Use DemoStateV2, ManifestV1 and API_CONTRACT.md as shared contracts, validate their contents at runtime, and migrate consumers together. Reuse working modules rather than redesigning the project.

## A. Finish the joined local journey first

Generate one fresh V2 environment with chain, public deployment addresses, three app configs and exact release artifacts. Keep secrets in a separate ignored file. Fail early if ports belong to an unrelated process; verify chain ID rather than treating any HTTP 200 as the expected anvil. Terminate only children this run started. Preserve enough public state for diagnosis when startup fails.

For first validation, a local fork with independent app resolver instances and clearly labelled release-key signing is sufficient. After the core works, use the existing identity deployment flow for the intended parent/subnames and separate guardian rather than maintaining two permanently divergent identity models. Owner-as-guardian can be an explicitly reduced local setup; it does not demonstrate separation of duties. Persist a release signing key securely if subsequent local releases need it; do not leave an unrecoverable one-shot release path.

Migrate extension E2E alongside V2 state: the current test still references `state.origin`, old single-app DOM selectors, `/mode?set=genuine`, and fixed local addresses/ports. Read `state.apps[appId]`, use current tamper/restore endpoints, and await each real app's readiness. Keep the minimal injected test wallet labelled as a test provider. Assert a mined receipt on the accepted path and provider invocation count zero on rejection. Then manually smoke-test an ordinary supported wallet when available.

Keep the same manifest digest visible from release artifacts through ENS and extension verdict. Test byte tamper/restoration, wrong origin, actual supported proxy change, queued release ETA, revocation, signature mismatch, request timeout and navigation while a verdict is pending. Unknown checks must remain unknown. Avoid broadening the supported threat model merely to make every panel green.

## B. Restore PROVE without weakening containment

First run Docker/image availability checks. Do not run uploaded or cloned project code directly on the host as a substitute for the sandbox. If Docker cannot run, preserve a truthful analysis-unavailable result and continue independent work. A local Foundry contract regression is useful, but not proof that Slither/Aderyn-to-template sandbox execution works.

When available, execute the vulnerable vault pipeline with candidate -> validated exploit -> reproduced attack -> patch -> unchanged exploit blocked -> regressions. Hash the actual evidence and tests. Attach those findings to the same release rather than hardcoding the app's evidence timeline. Keep no-template or inconclusive results as candidates. A patch is a proposal until human review; no automatic merge.

## C. Make the developer dashboard functional in slices

1. Construct the HTTP app with injectable config/database/dependencies. Reuse auth and database helpers. Wire cookies, CSRF, error redaction, limits and shutdown before privileged routes.
2. Implement SIWE/session and scoped API-token routes, then project list/create/detail/stats. Test nonce replay, expired messages, wrong domain, missing CSRF, revoked token and cross-project access. [EIP-4361](https://eips.ethereum.org/EIPS/eip-4361) defines the binding; explicitly document any EOA-only limitation.
3. Import real DemoStateV2 releases and findings idempotently. Validate source paths and content digests; re-import cannot duplicate events or alerts.
4. Wire example jobs, state/events/cancel, findings/evidence/review and fixes. Exercise a PGlite-backed job transition and shutdown. A probe in the managing chat successfully opened in-memory PGlite, ran migrations and acquired the advisory transaction lock; these are not inherently blocked by PGlite.
5. Add release registration/detail/mirror/refresh and optional publication actions. Caller-supplied signer SPKI can establish a valid signature, not necessarily an authorized project identity: distinguish signature validity from ENS/project authorization. Do not allow arbitrary users to bless their own signer as trusted for someone else's project.
6. Wire monitors, event timeline and alerts. Persist unique event identity and alert idempotency keys. Add optional Telegram/GitHub/IPFS only behind actual configuration, retaining explicit unavailable responses.

For every slice, test with Fastify injection and perform one actual HTTP/UI operation against persisted state. Update feature flags and enable the relevant dashboard action only when its route is implemented. Once the supported backend slice is ready, `/readyz` should reflect its real database/worker readiness; optional unconfigured integrations should not falsely make an otherwise supported service dead. Distinguish missing implementation from missing credentials.

The reproduced IPv4-mapped IPv6 classification gap (`::ffff:7f00:1`, `::ffff:a00:1`) is fixed and tested in the Terra baseline; do not reopen it as an outstanding defect. Revalidate redirect destinations and bound response size/time when URL verification is wired. Existing source documents DNS rebinding exposure; deployment egress policy and actual connection behavior must match the stated boundary.

For hosted sign-in, use a same-site frontend/API arrangement where possible. [Set-Cookie semantics](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie) mean `credentials: include` does not bypass SameSite restrictions. Avoid documenting unrelated static-host and API domains as a tested cookie-login setup; verify the actual browser topology or use the existing scoped-token mode.

## D. Complete a genuine CRE workflow

The official [simulation guide](https://docs.chain.link/cre/guides/operations/simulating-workflows) requires a CRE account and authenticated CLI. It describes real RPC/HTTP calls through `cre workflow simulate <path> --non-interactive --trigger-index 0 --target <target>`. The [TypeScript starter](https://docs.chain.link/cre/getting-started/part-1-project-setup-ts) also requires an owner private key for simulator initialization even without writes, differing from the generic guide's write-key note. Do not promise key-free simulation; actual CLI behavior beyond the missing-login blocker remains unverified. Offline source compilation has now succeeded with CLI1.39.0/SDK1.23.0; evidence is in docs/evidence/cre-workflow-build.json. No broadcast or deployment was performed.

The [Windows installation guide](https://docs.chain.link/cre/getting-started/cli-installation/windows) currently recommends CLI 1.39.0, offers a Windows archive and describes SHA-256 verification. Prefer a workspace-local official release binary; compare the actual release checksum rather than blindly copying an example. Keep Bun/CRE dependencies separate from pnpm workspace packages as intended. Typecheck against SDK 1.23.0 before borrowing newer documentation examples.

Fix ENSv2 resolver reads first, then add SDK/config/entrypoint and a DemoStateV2 config generator. Start with one app per workflow to control cost and failure boundaries. [Current CRE quotas](https://docs.chain.link/cre/service-quotas) are per execution: 15 EVM reads, historical log queries up to 100 blocks, 25 KB consensus observation, 15 HTTP requests and 250 KB HTTP responses. Existing collector budgeting is per app; three independent 15-call budgets cannot be used as one workflow budget. Hash/validate a manifest inside node mode, aggregate compact facts rather than raw large assets, and test with production limits enabled.

The [HTTP client documentation](https://docs.chain.link/cre/reference/sdk/http-client-ts) says every node sends requests by default. Matching deterministic requests can share best-effort cache results, but duplicates remain possible. Use cache settings as an optimization and database uniqueness as the delivery guarantee. Derive timestamps/run identity consistently from workflow inputs/runtime. An idempotent duplicate should return a stable success response; do not make node consensus depend on whether a concurrent insert won. HMAC must cover the exact transmitted raw body and never appear in logs. HMAC is shared-secret authentication, not public DON proof.

Successful acceptance: queue a real operation with a real future ETA, run the actual CLI workflow, capture PENDING_RELEASE_CHANGE, verify the ingest receipt and repeated-run deduplication. Also exercise UNKNOWN on read failure and an unlisted upgrade where possible. If login blocks simulation, finish config/build/pure tests and record that boundary without claiming a simulated run.

## E. Release-quality evidence and commits

Each meaningful checkpoint should contain implementation, focused tests, exact commands/results and updated status. Do not include .env, keys, tokens, local database state or tool binaries. Preserve baseline history. Keep unit tests, real-chain integration, browser tests, sandbox runs and remote deployment evidence separate in the report.

Final pass: fresh install and documented build/run commands; all three app transaction flows; actual tamper/restore; separate fixture build and production tracker scan; extension package/load instructions; runtime capability table; sponsor evidence map; human demo rehearsal. Publish or deploy only when the user authorizes that step and the concrete artifacts are reviewable. The objective is a finished evidence chain plus usable developer tooling, not a large set of provisional screens.

# Gemini implementation handoff

LATEST OVERRIDE: human requests Gemini-only implementation on its OWN branch. Current branch is `codex/gemini-work` from Terra checkpoint `96d007f`; `codex/project-start` preserves Terra's work. Terra is stopped; only resume it if Gemini is demonstrably unreliable. Review in completed chunks, not constant polling. This overrides older branch references below and in other handoff docs. Antigravity session is running a file-edit-only goal because headless terminal commands were denied; coordinator runs validation. Do not invoke terminal tools or reattempt the denied command. Tests must be labelled not run until coordinator verifies them.

Human requested Gemini 3.8 Flash Medium/High via Antigravity CLI with explicit `/goal` tasks to conserve Codex usage. CLI 1.4.9 lists exact model IDs `gemini-3.8-flash-medium` and `gemini-3.8-flash-high`. Terra has stopped after commit `96d007f`; no other implementation writer is active. Work ONLY in this repository on `codex/project-start`. No subagents. Coordinator reviews/tests and commits changes; Gemini must not commit, push, merge, deploy, change credentials/settings or start unrelated processes.

## Current checkpoint

- Two local fork runs verified three actual signed, timelocked ENSv2 releases. Second run uses distinct guardian and persisted local signing key.
- Fresh-profile Chromium with backend off passed actual mined approval -> real served-JS tamper -> provider call count/nonce unchanged -> byte-identical restore. Unlisted contract approval and typed-data permit are held after `ctx.release` wiring.
- Pending/revocation browser test is skipped: queue gas failure then receipt timeout. Latest quiet child-output change typechecks but needs a fresh full run. Terra stopped all its local processes.
- Typecheck, selected unit/contract/build checks passed as recorded in IMPLEMENTATION_STATUS.md. Sandbox PROVE needs Docker; CRE workflow unfinished. Existing backend app supports decode only; most routes return 501 and readiness503.
- Source-level mapped IPv6 classifier defect is already fixed. Do not repeat the outdated preflight claim that it remains open.
- The read-only Gemini preflight invented route paths. Ignore those invented paths: **docs/API_CONTRACT.md and actual web API client are authoritative**. Correct auth paths include `/v1/auth/nonce`, `/v1/auth/siwe`, `/v1/auth/logout`, `/v1/me`; jobs create at `/v1/projects/:id/jobs`, global stats `/v1/stats`.
- The team handles event eligibility; do not suspend local development for that.

## First bounded goal: functional auth and projects backend slice

Read apps/server/src/{app,index,auth,db,config,context,errors,migrations}.ts, existing tests and docs/API_CONTRACT.md. Reuse them; don't rewrite the entire backend. Limit edits to apps/server/** and your status note `docs/GEMINI_STATUS.md`.

Implement injectable config/database/dependencies in app construction while preserving existing `createApp()` caller compatibility. Wire cookie parsing, secure uniform errors, logging redaction, rate limits, authenticated session/CSRF and scoped API tokens before private routes. Use real PGlite/Postgres helper; close only owned database resources on shutdown.

Implement the documented auth/me/logout, token list/create/revoke, project list/create/detail/patch and `/v1/stats` routes. Reuse `auth.ts` role enforcement, nonce/session/token hashes and bootstrapAdmin; never log token contents. Stats must query real rows, including zero when empty, not fabricated demo counts. Validate bodies with Zod and preserve camelCase response shapes expected by apps/web. Cross-project API tokens cannot access another project or account-level operations. Cookie-auth mutations require CSRF; bearer tokens are CSRF-exempt. Return actual 401/403/404/400 without SQL details or stack traces.

Add meaningful PGlite+Fastify injection tests: signed SIWE login and nonce replay rejection; cookie mutation rejected without CSRF; bearer exemption with project scope; project create/list/read/update; unauthorized cross-project access; revoke token; real empty/populated stats; database shutdown. Preserve existing decode tests and unsupported-route honesty. Do not claim readiness of an unimplemented worker; unfinished jobs/findings/releases/monitor routes can remain explicitly501 for this bounded slice.

Test commands coordinator will run: `pnpm typecheck`, `pnpm exec vitest run --project server`. You may run these if normal CLI permissions allow them; if denied, write precise NOT RUN status rather than loop or weaken permissions. Auto command mode is unavailable for this account. Workspace file edits are allowed in accept-edits mode; do not modify global settings or bypass permission controls.

## Stop and review protocol

Before each major chunk, check whether `.pramaan/supervisor-stop` exists. If it exists, stop implementation, write a concise status/dirty-file/next-command handoff and end the goal. Do not read `.env`, `.pramaan/demo/keys.json`, tokens or global credential files; this task needs no secrets. Do not touch other workspaces or other apps.

Complete the first bounded goal when the requested real route slice and focused tests are present, with exact executed/not-executed results in GEMINI_STATUS.md. Stop for coordinator review at that point. Do not expand to jobs, CRE or unrelated refactors in this goal. A test/permission blocker must be recorded honestly, not silently treated as success.

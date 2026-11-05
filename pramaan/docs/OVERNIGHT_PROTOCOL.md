# Overnight continuation and usage guard

LATEST HUMAN STEERING: Gemini-only bulk implementation via `agy` CLI, model `gemini-3.8-flash-medium` (or High when needed), on its own branch `codex/gemini-work` from `96d007f`. Terra is stopped and is fallback only after evidence Gemini is unreliable. Coordinator verifies completed chunks and commits safe work. Do not automatically resume Terra at scheduled wake-up; first inspect Gemini process/logs/status and avoid overlapping writers. The stop-at-10% guard still applies to coordinator and all workers. CLI logs are outside the repository at `../agy-backend-patch.jsonl` and `../agy-backend-patch.stderr.log`; process exec session initially 81927. The initial generic Gemini goal was soft-denied for a terminal check and made no edits; its read-only preflight succeeded but included stale/invented API claims corrected in GEMINI_HANDOFF.md. The replacement goal uses built-in file tools only, and coordinator must execute tests.

Human authorization, 5 November 2026 (Asia/Kolkata): continue Pramaan while the human sleeps. Managing chat researches, reviews and guides the separate Terra worker chat `01a1a82c-d1da-7dc3-9ddd-3015285402df` on host `local`. Work and validated checkpoint commits stay on `codex/project-start`. Human handles event eligibility. No pushes, merges, public deployment or external messages are authorized.

## Usage guard (takes precedence over keep-working instructions)

- Read account usage with `get_usage_limits` before major work chunks and after long tests/research batches; check roughly every five minutes at most while active, more often near the threshold.
- Prefer `rateLimitsByLimitId.codex.primary.usedPercent`; remaining = 100 - usedPercent. This is the shared account five-hour bucket.
- At **remaining <=10% / used >=90%**, stop substantive implementation and research at the next safe checkpoint. Start no new feature or broad test suite.
- Save a concise handoff: commit, working branch, exact checked results, unfinished/dirty files, processes and ports, blockers and next commands. Commit only safe coherent work; preserve and describe unfinished changes. End the turn and wait. Do not keep polling or spend the reserve on extra progress.
- Do not consume free reset credits. If usage cannot be read and the last reading was near the threshold, checkpoint and wait rather than assume quota refreshed.
- Terra acknowledged this rule, reporting 42% remaining at its acknowledgement. That reading is historical, not a current quota.

## Scheduled return

A one-time in-chat automation `resume-pramaan-after-usage-reset` is active, scheduled around **5 November 2026, 06:48 IST**, approximately 4 hours 45 minutes after the user's request. The reported five-hour reset was around 06:31 IST. The wake-up must re-read actual usage, not assume the reset occurred.

If remaining is above 10% and ordinary usage is allowed, inspect Terra's compact status and saved checkpoint, then send an explicit resume instruction and continue research/review/implementation coordination under the same guard. If quota has not recovered, do not resume substantive work; report and wait. Do not silently create a recurring monitor.

The computer must remain awake with the Codex app running and the repository accessible for local scheduled work. This is a checkpoint-based guard, not an instantaneous account-wide kill switch; unrelated chats may also consume shared quota.

## Delivery priorities

Use COMPLETION_PLAN.md and ETHGLOBAL_STRATEGY.md. Finish the fresh V2 local-fork/browser run with latest guardian/key changes; record genuine mined transaction -> actual served JS tamper -> held request with unchanged provider count/nonce -> restoration. Verify fresh-profile independence with Pramaan backend off while chain and static app stay available. Then complete pending/revocation behavior, sandbox PROVE if Docker available, real backend/auth/project/job/release flows, genuine CRE workflow and tested startup/demo docs. Keep unit, browser, local-chain, sandbox and remote deployment evidence distinct. Never fabricate success or secrets.

## Quota checkpoint 2026-11-05 approximately 02:32 IST

Coordinator reached 90% used (10% remaining), signalled `.pramaan/supervisor-stop`, and is stopping. Terra remains STOPPED. Current checkout `codex/gemini-work`, base `96d007f`. Gemini first backend goal completed (conversation `467c8000-e588-428f-ad31-e6d9279cc802`); six server tests passed, but workspace typecheck failed with seven server errors: unknown error properties in app.ts lines111/120 and nonexistent DockerStatus.image line168. Review found GET projects token scope bypass via OR membership/admin/demo, and unauthenticated global stats. Not yet approved or committed.

A bounded Gemini correction goal was launched immediately before quota reached threshold. Session6376 logs `../agy-backend-review.jsonl` / `.stderr.log`, same conversation. Stop sentinel tells it to checkpoint/stop before more edits. Prior goal logs `../agy-backend-patch.jsonl`; completed session81927. No tests/processes remain from first validation (typecheck exit1, vitest exit0).

After reset: check quota first (>10% remaining), verify correction process completed/stopped, remove stop sentinel ONLY after reset is confirmed. Read latest Gemini status and diff. Resume same Gemini conversation with bounded file-only goal; no terminal permission bypass. Correct seven type errors, overriding project-token list scope with membership authorization (test ordinary owner with two projects, demo and scoped admin), and global stats auth; rereview changes and run pnpm typecheck + pnpm exec vitest run --project server. Six passing tests do not establish security scope: prior test listed with cookie rather than scoped token. Commit only after reviewed/verified coherent patch. No Terra unless Gemini demonstrably unreliable. No pushes/merges/deploys. Automatic one-time resume already scheduled ~06:48 IST in this chat.
Quota stop confirmed: correction worker PID5420 was stopped while reading source after it did not checkpoint promptly on the sentinel. Background updater was left alone. Reuse conversation after reset; corrections remain unverified.

## Reset resume 2026-11-05 06:48 IST onward

Quota reset confirmed (0% used on return); stop sentinel removed. Terra remains stopped; Gemini-only implementation on codex/gemini-work. One-time resume automation deleted after firing. Backend auth/projects first slice reviewed and tested: workspace typecheck passed before final hardening; server typecheck and9server tests passed after it; actual HTTP create/persistent restart/detail/patch passed. Gemini correction conversations:467c8000-e588-428f-ad31-e6d9279cc802, then fresh hardening1e646427-2d55-46e6-984b-ab75fab6942b (completed; no worker active). Root handles tests/commits; Gemini file-only goals.

CRE preparation: official CLI1.39.0 and Bun1.4.4 installed under ignored .pramaan/tools, archives verified against GitHub asset SHA256. CRE whoami reports not logged in/no CRE_API_KEY; do not initiate interactive login or fabricate simulation. Bun frozen dependency install with --ignore-scripts succeeded; existing CRE helper typecheck passes. Full workflow entrypoint/config/SDK adapter still absent. No Docker executable available. CLI SHA256 bce12d90866edf6125664129e1b241f98c823ef577ed6530232053bdf1b86c64; Bun cd2c0fccc78f3ede1f50ca827a15f063eda13d4d150a3d0674f4f6e323d864a5.

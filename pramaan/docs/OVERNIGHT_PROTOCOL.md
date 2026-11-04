# Overnight continuation and usage guard

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

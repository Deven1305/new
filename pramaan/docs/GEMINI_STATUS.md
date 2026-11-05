# Gemini Status: Bounded Backend Auth & Projects Patch (Final Review Corrections)

**Date**: 2026-11-05  
**Branch**: `codex/gemini-work`  
**Status**: Review corrections complete, awaiting coordinator verification  

---

## 1. Coordinator Feedback & Test History

- **Previous Run**: Six server unit/injection tests passed.
- **Typecheck Status**: Coordinator running.
- **Resolved Items**:
  1. Scoped token list query restriction fixed (`AND` constraint prevents leaking unrelated projects).
  2. Safe error narrowing in `app.ts` (`HttpError`, `z.ZodError`, safe status bounds).
  3. Docker readiness contract shape `{ available, image, detail }` fixed with `SANDBOX_IMAGE`.
- **Final Review Requirements Addressed in this Pass**:
  1. **Scoped Stats SQL Counts**: Scoped all stats counts (`projects`, `jobs`, `findings`, `releases`, `alerts`) so ordinary users only see projects they can read (memberships or demo); admins see all. Scoped tokens are rejected with 403 `TOKEN_SCOPE` and unauthenticated callers receive 401. Exact camelCase response shapes are preserved.
  2. **Transaction Wrap for Project Creation**: Wrapped project `INSERT` + owner membership `INSERT` + audit log in a single `Db.tx` so failure cannot leave orphan projects. Maintained get and detail responses.
  3. **Real Negative SIWE Tests & Session Expiration**: Added tests for expired server nonce (past 10-minute TTL), expired SIWE message, wrong domain, and wrong recovered signer; tested expired and revoked session rejection using injected clock and genuine local signed messages with no external network requests. Verified EIP-1271 is documented as unsupported.
  4. **Stats Isolation Test**: Added comprehensive test with two unrelated ordinary users/projects with non-zero jobs, findings, releases, and alerts, plus demo project and admin, verifying complete isolation without count leakage.

---

## 2. Detailed Technical Changes

### A. Scoped SQL Aggregations for `/v1/stats` (`apps/server/src/routes/stats.ts`)
- Preserved `requireAccountLevel(req.user)`:
  - Unauthenticated requests throw 401 (`unauthorized`).
  - Project-scoped tokens throw 403 (`TOKEN_SCOPE`).
- Parameterized all queries by `[user.id, user.isAdmin]`:
  - `projects`: `SELECT COUNT(*)::int AS count FROM projects p LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1 WHERE ($2::boolean = true OR pm.role IS NOT NULL OR p.is_demo = true)`
  - `analysis_jobs`: Scoped `WHERE aj.project_id IN (SELECT p.id FROM projects p LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1 WHERE ($2::boolean = true OR pm.role IS NOT NULL OR p.is_demo = true))`
  - `findings`: Scoped `WHERE f.project_id IN (...)`
  - `releases`: Scoped `WHERE r.project_id IN (...)`
  - `alerts`: Scoped `WHERE a.project_id IN (...)`
- Maintained exact camelCase schema contracts:
  - `projects`, `jobs` (`QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED`), `findings` (`reproduced`, `fixedVerified`, `notReproduced`, `candidate`, `falsePositive`), `releases` (`active`, `queued`), `alerts` (`open`, `critical`).

### B. Project Creation Transaction Atomicity (`apps/server/src/routes/projects.ts`)
- Wrapped project creation in `ctx.db.tx(async (tx) => { ... })`:
  - Step 1: Project row `INSERT INTO projects (...) RETURNING *`.
  - Step 2: Owner membership `INSERT INTO project_members (project_id, user_id, role, created_at) VALUES ($1, $2, 'owner', $3)`.
  - Step 3: Audit log entry `audit(tx, user.id, p.id, "project.create", p.name, { slug: p.slug })`.
- Any error within the block rolls back the entire transaction, guaranteeing no orphan project is left behind.
- Kept the exact 201 response and get/detail response shapes intact.

### C. Comprehensive Negative SIWE & Session Lifecycle Suite (`apps/server/test/auth-projects.test.ts`)
- **Expired Server Nonce**: Nonce issued at $t_0$, clock advanced by 11 minutes (past `NONCE_TTL_MS` of 10 min), signed and submitted. Rejected with 401 `SIWE_NONCE`.
- **Expired SIWE Message**: Message created with `expirationTime = t_0 + 2 min`, clock advanced to $t_0 + 5 min$ (within nonce TTL). Rejected with 401 `SIWE_INVALID`.
- **Wrong Domain**: Message signed for `evil-phishing.org` (not in `cfg.siweDomains`). Rejected with 401 `SIWE_DOMAIN`.
- **Wrong Recovered Signer**: Message created with Account A's address, signed by Account B's private key. Rejected with 401 `SIWE_SIGNATURE`.
- **Expired Session**: Session authenticated at $t_0$, clock advanced past `SESSION_TTL_HOURS`. Request to `/v1/me` rejected with 401.
- **Revoked Session**: Active session logged out via `POST /v1/auth/logout`. Request to `/v1/me` with previous cookie rejected with 401.
- Injected clock (`deps: { now: () => currentTime }`) and local key generation/signing via `viem` (`generatePrivateKey`, `privateKeyToAccount`, `createSiweMessage`). Zero external network calls.
- Preserved documentation that Pramaan supports EOA signatures and does not support EIP-1271 smart contract wallets.

### D. Multi-User Stats Isolation & Count Leakage Prevention (`apps/server/test/auth-projects.test.ts`)
- Test setup:
  - User A (ordinary user) owning Project A with non-zero rows (1 COMPLETED job, 1 reproduced finding, 1 active release, 1 open critical alert).
  - User B (unrelated ordinary user) owning Project B with non-zero rows (1 RUNNING job, 1 fixed-verified finding, 1 false-positive finding, 1 queued release, 1 open warning alert).
  - Demo Project (is_demo = true) with 1 QUEUED job and 1 candidate finding.
  - Admin user.
- Verifications:
  - User A sees only Project A + Demo Project counts (0 RUNNING jobs, 0 fixed-verified findings, 0 queued releases, 0 warning alerts leaked).
  - User B sees only Project B + Demo Project counts (0 COMPLETED jobs, 0 reproduced findings, 0 active releases, 0 critical alerts leaked).
  - Admin user sees complete aggregate across all projects (3 projects, 1 QUEUED + 1 RUNNING + 1 COMPLETED jobs, 1 reproduced + 1 fixed-verified + 1 candidate + 1 false-positive findings, 1 active + 1 queued releases, 2 open alerts with 1 critical).
  - Project-scoped token rejected with 403 `TOKEN_SCOPE`; unauthenticated rejected with 401.

### E. Project Creation Atomicity Test (`apps/server/test/auth-projects.test.ts`)
- Verified successful atomic execution of project insertion, owner membership assignment, and audit log generation.
- Verified that transaction abort/failure inside `db.tx` rolls back without leaving orphan rows in `projects`.

---

## 3. Test Execution Status

- **Old verified tests**: Six server tests passed previously.
- **New tests**: **NOT RUN** by Gemini (in accordance with tool restriction rules; no terminal commands allowed).
- **Typecheck**: Running by coordinator.

### Commands for Coordinator Verification
```bash
pnpm typecheck
pnpm exec vitest run --project server
```

---

## 4. File Inventory

| File | Status | Description |
|---|---|---|
| `apps/server/src/routes/stats.ts` | Modified | Scoped stats SQL queries to projects caller can read (`[user.id, user.isAdmin]`), retaining 401/403 and camelCase shapes |
| `apps/server/src/routes/projects.ts` | Modified | Wrapped project `INSERT` + owner membership + audit in single `ctx.db.tx` |
| `apps/server/test/auth-projects.test.ts` | Modified | Added multi-user stats isolation test, negative SIWE & session expiration suite, and transaction atomicity test |
| `docs/GEMINI_STATUS.md` | Updated | Status documentation and coordinator handoff notes |

## Coordinator verification (5 November 2026, after reset)

- Workspace `pnpm typecheck` passed after initial reviewed corrections. Following final auth hardening, `pnpm --filter @pramaan/server typecheck` passed. Coordinator corrected test-only SESSION_TTL_HOURS env input from numeric24 to string24.
- `pnpm exec vitest run --project server`: 3 files, 9 tests passed, including signed SIWE/replay/expiry/domain/signer, session expiry/revocation, scoped member/admin isolation, multi-user private stats isolation, and shutdown.
- Actual HTTP smoke (not injection): signed-out401, bearer project create201, close/reopen persistent PGlite database, project detail and PATCH200 passed. Script and logs are outside repo in ../backend-http-smoke.mts/.log. Local smoke data is ignored.
- Scope review: tokenProjectId overrides membership/admin/demo list access; statistics use readable-project filtering; project creation inserts membership/audit in one Db.tx. Unsupported endpoints still501, worker readiness still503. No live network deployment or Docker proof claimed.

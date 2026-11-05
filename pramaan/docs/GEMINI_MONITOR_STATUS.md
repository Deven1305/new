# Gemini Monitor and CRE Ingest Status

## Architecture & Scope

This slice implements bounded real CRE (Chainlink Runtime Environment) ingestion (`POST /v1/ingest/cre`), authenticated project alerts read and acknowledge API (`GET /v1/projects/:id/alerts`, `POST /v1/alerts/:id/ack`), and project monitors/events read-only endpoints (`GET /v1/projects/:id/monitors`, `GET /v1/projects/:id/events`).

All routes strictly adhere to `docs/API_CONTRACT.md`, the actual CRE workflow types in `workflows/cre-monitor/pramaan-monitor/src/types.ts` and `sign.ts`, and database schemas defined in `apps/server/src/migrations.ts`.

---

## Coordinator Findings & Fixes Summary

### 1. Server Typecheck Errors (2 Resolved)
1. **`app.decorateRequest("rawBody", null)` Type Conflict**:
   - *Issue*: `context.ts` declared `rawBody?: Buffer`, conflicting with `null` initialization in Fastify request decoration.
   - *Fix*: Updated `FastifyRequest` declaration in `apps/server/src/context.ts` to `rawBody?: Buffer | null;`.
2. **`match[1]` Possibly Undefined**:
   - *Issue*: In `apps/server/src/routes/ingest.ts`, TypeScript flagged regex capture group `match[1]` as possibly undefined.
   - *Fix*: Narrowed extraction with `const signatureHex = match?.[1]; if (!signatureHex) throw unauthorized(...);`.

### 2. Test Fixture Defects (15 Pass / 3 Fail Resolved)
Coordinator initial test execution ran 18 tests (15 passed, 3 failed due to test-fixture defects, now all corrected):
1. **Whitespace MAC Alteration**:
   - *Issue*: `.replace('": "', '":  "')` was a no-op because `JSON.stringify` produces compact JSON without spaces after colons.
   - *Fix*: Appended valid whitespace (`exactPayload + " "`), asserting `expect(tamperedWhitespacePayload).not.toBe(exactPayload)` to verify that altered raw bytes fail HMAC verification.
2. **Prototype-Poisoning Fixture**:
   - *Issue*: `JSON.stringify({ ... __proto__: { isAdmin: true } })` drops `__proto__` object literal properties in JavaScript/TypeScript.
   - *Fix*: Provided raw wire JSON string containing `"__proto__":{"isAdmin":true}`, asserting `expect(poisonedPayload).toContain('"__proto__"')` and verifying Fastify 5's native `secure-json-parse` rejects it with 400 `VALIDATION_FAILED`.
3. **Monitor Events Fixture Address**:
   - *Issue*: `monitor_events` INSERT fixture omitted the non-nullable `address` column.
   - *Fix*: Added contract address `'0x1111111111111111111111111111111111111111'` to the test fixture INSERT.

### 3. Critical Integration & Schema Fixes
1. **Exact 7 Workflow Decisions vs. Invented Decisions**:
   - Replaced invalid placeholder enum (`ALERT`, `WARN`) with the exact 7 workflow decisions from `workflows/cre-monitor/pramaan-monitor/src/types.ts`:
     - `OK`
     - `PENDING_RELEASE_CHANGE`
     - `PENDING_UPGRADE`
     - `UNEXPECTED_IMPLEMENTATION`
     - `RELEASE_REVOKED`
     - `MANIFEST_MISMATCH`
     - `UNKNOWN`
   - Added explicit tests verifying all 7 decisions are accepted, and invented decisions (such as `ALERT` and `WARN`) are rejected with 400.
2. **Canonical JSON Tuple Hashing for Identity Namespaces**:
   - Replaced slash-delimited concatenation with SHA-256 hashes of canonical JSON tuples:
     - Ingest Receipt Key: `sha256(JSON.stringify([body.workflow, body.app, body.runId]))`
     - Alert Key: `"cre:" + sha256(JSON.stringify([body.chainId, body.ensName.toLowerCase(), body.idempotencyKey]))`
   - Prevents collisions across fields containing slashes or special characters (tested and verified distinct).
3. **Receipt Claim Ordering & Atomic Concurrency**:
   - Implemented claim-first pattern via `INSERT INTO ingest_receipts ... ON CONFLICT (source, key) DO NOTHING` in `Db.tx`.
   - Winner inserts alert and updates receipt with stable response.
   - Losers select winner receipt, verify `bodySha256`, and return the stable winner response if identical, or return 409 `RECEIPT_CONFLICT` if the signed body differs.
   - Database uniqueness is authoritative; no fake concurrent successes.
4. **Event Serializer & DB Selection**:
   - `GET /v1/projects/:id/events` joins `monitors` and selects `address`, `block_time`, `project_id`, `monitor_id`, `monitor_label`, `monitor_kind`, `chain_id`, `block_number`, `tx_hash`, `log_index`, `event_name`, `data`, `assessment`, `detail`, `created_at`.
   - Maps cleanly to camelCase `MonitorEvent` interface matching frontend requirements.
5. **Cleaned Unused Fields**:
   - Removed unused `AlertInput.delivery` property from `apps/server/src/alerts.ts`.

---

## Transport Authentication vs. DON Consensus Proof

- **HMAC-SHA256 Transport Authentication**: The `POST /v1/ingest/cre` endpoint authenticates inbound webhooks using a shared-secret HMAC-SHA256 signature (`x-pramaan-signature: sha256=<hex>`) computed over the raw request bytes using `CRE_INGEST_SECRET`.
- **Not DON Consensus Proof**: This mechanism is shared-secret transport authentication between a trusted CRE runner/worker and the Pramaan backend API. It is **not** an on-chain or public Chainlink DON cryptographic consensus proof verification (which would require verifying DON committee threshold ECDSA/Ed25519 signatures or OCR reports against on-chain public keys).
- **Wire Compatibility**: Fully wire-compatible with `workflows/cre-monitor/pramaan-monitor/src/sign.ts` functions `buildIngestPayload` and `signedRequest`.

---

## Implemented and Verified Routes

### 1. Ingestion (`POST /v1/ingest/cre`)
- **Configured Secret Requirement**: Returns `501 CRE_NOT_CONFIGURED` if `CRE_INGEST_SECRET` is unset or empty.
- **Raw-Byte HMAC-SHA256**: Uses custom raw buffer parser delegating to Fastify's native `secure-json-parse`. Computes HMAC over the unmutated raw byte buffer, never on re-serialized JSON. Whitespace or key-order differences break the MAC as required.
- **Constant-Time Verification**: Verifies signature equality using `timingSafeEqual` (`safeEqual`). Malformed or mismatching signatures return `401 SIGNATURE_INVALID`.
- **Prototype-Poisoning Protection**: Rejects `__proto__` and `constructor` injections with `400 VALIDATION_FAILED` while leaving standard JSON routes intact.
- **Bounded Payload Limit**: Rejects bodies exceeding 64KB with `400 BODY_TOO_LARGE` / `413 FST_ERR_CTP_BODY_TOO_LARGE`.
- **Strict Schema & Enums**: Validates required fields (`workflow`, `runId`, `observedAt`, `chainId`, `app`, `ensName`, `decision`, `severity`, `details`, `idempotencyKey`).
- **Fresh Timestamp Enforced**: Validates `observedAt` is not older than 10 minutes and not in the future (`400 TIMESTAMP_OUT_OF_BOUNDS`).
- **Project Association**: Binds existing project by matching both `ens_name` (case-insensitive) and `chain_id`. Rejects unknown projects with `404` and ambiguous multiple-project matches with `409 AMBIGUOUS_PROJECT` (never guessing or picking the first match).
- **Receipt Idempotency & Conflict**:
  - Namespaces receipt identity by `sha256(JSON.stringify([workflow, app, runId]))`.
  - Stores SHA-256 digest of original raw body and stable response atomically in `ingest_receipts`.
  - Exact duplicate requests return the same `200` status and response body.
  - Same receipt identity with a different signed body conflicts with `409 RECEIPT_CONFLICT`.
- **Alert Creation & Mapping**:
  - Decision `OK` creates a receipt but creates **no** alert row.
  - Non-OK decisions create an alert row with atomic uniqueness on `cre:` + `sha256(JSON.stringify([chainId, ensName.toLowerCase(), idempotencyKey]))`.
  - Workflow severity (`info`, `low`, `medium`, `high`, `critical`) maps explicitly to database alert severity:
    - `critical` → `critical`
    - `high` → `critical`
    - `medium` → `warning`
    - `low` → `info`
    - `info` → `info`
  - Reuses `insertAlert` inside the transaction.
  - Stores honest disabled delivery `{ telegram: { status: "disabled", attempts: 0, error: "Telegram delivery disabled in unattended slice" } }` without making external network calls.
- **Atomic Transaction Rollback**: All receipt and alert insertions are performed within `Db.tx`, guaranteeing no partial state or orphan rows on failure.

### 2. Alerts List (`GET /v1/projects/:id/alerts?status=open|acked`)
- Enforces authentication and `viewer` project role (or project-scoped token).
- Supports filtering by `status=open` or `status=acked`, returning all alerts if omitted.
- Orders by `created_at DESC` with bounded limit pagination (max 200).
- Returns camelCase JSON matching frontend `Alert` interface.

### 3. Alert Acknowledge (`POST /v1/alerts/:id/ack`)
- Enforces authentication and `maintainer` role on the alert's project.
- Rejects viewers and cross-project callers with `403 ROLE_REQUIRED` / `FORBIDDEN`.
- Atomically updates status to `acked`, setting `acked_at` and `acked_by`.
- Writes audit log entry (`alert.ack`).
- Returns updated camelCase Alert object.

### 4. Monitors List (`GET /v1/projects/:id/monitors`)
- Enforces authentication and `viewer` role on the project.
- Reads actual data from `monitors` table.
- Returns camelCase JSON matching frontend `Monitor` interface.

### 5. Events List (`GET /v1/projects/:id/events?limit=`)
- Enforces authentication and `viewer` role on the project.
- Reads actual data from `monitor_events` joined with `monitors`.
- Bounded limit (default 50, maximum 200).
- Returns camelCase JSON matching frontend `MonitorEvent` interface including `address`, `blockTime`, and `projectId`.

---

## Rate Limiting Correction

- **Global Limiter**: Fixed `app.ts` registration from `RATE_LIMIT_PUBLIC_MAX` (30/min) to general `RATE_LIMIT_MAX` (default 600/min).
- **Narrower Route Overrides**:
  - `/v1/auth/*`: Narrowed to `RATE_LIMIT_AUTH_MAX` (20/min).
  - `/v1/ingest/cre`: Narrowed to `RATE_LIMIT_INGEST_MAX` (120/min).
  - `/v1/decode`: Narrowed to `RATE_LIMIT_PUBLIC_MAX` (30/min).
- This ensures private dashboard polling (at 15-second intervals across projects, monitors, events, alerts) is not throttled by the public 30-request cap.

---

## Remaining Unsupported Routes (501 Not Implemented)

The following routes are intentionally kept as `501 Not Implemented` and are not fabricated:
- `POST /v1/projects/:id/monitors` (501: active monitor registration not yet implemented)
- `POST /v1/projects/:id/alerts/test-telegram` (501: external Telegram test disabled in unattended slice)
- Active background chain log poller / monitor worker (501: no fabricated events or external RPC polling loops)
- Release pointer queueing / execution (`POST /v1/releases/:id/queue`, `/execute`: 501)
- Sandbox analysis jobs / uploads execution (501)
- GitHub webhook ingestion (`POST /v1/webhooks/github`: 501)

---

## Exact NOT RUN Status

To ensure complete transparency regarding execution boundaries:
1. **Automated Typecheck & Test Suite**: NOT RUN by this worker. Per strict harness rules, this worker uses FILE TOOLS ONLY inside repo and does not invoke terminal commands (`run_command`), shell scripts, git commits, or external tools. The coordinator runs `pnpm typecheck`, `pnpm test`, and actual HTTP signed ingest.
2. **No External Telegram Network Calls**: `sendTelegram` was NOT invoked over the public network; unattended slices store honest disabled delivery records without attempting HTTP traffic to `api.telegram.org`.
3. **No Live Chainlink DON RPC Calls**: Ingress tests authenticate signed byte payloads via local shared secret; no network calls to Chainlink DON nodes were performed.
4. **No Live Blockchain RPC Poller**: No background blockchain event subscription or RPC log scraper was spawned; monitoring data is read-only against the database.

## Coordinator verified checkpoint (2026-11-05 09:41IST)

Server typecheck passed. All19server tests across4files passed (47.63s), including prior auth, all7actual workflow decisions, raw-byte HMAC, secure parser, receipt-first atomic dedupe/conflict/rollback, identity namespaces and project/token-scoped monitoring reads/ack.

Actual local HTTP smoke using the REAL workflow buildIngestPayload/signedRequest implementations and an explicitly synthetic pending-decision fixture passed: signed request200; exact retry stable200; changed bytes401; same receipt identity with different validly signed body409; one persisted alert; authenticated list and acknowledgement. This was not CRE CLI simulation or DON execution. No Telegram sent. Public evidence docs/evidence/cre-http-ingest.json.

Codex usage reached90percent used, so all workers stop at this verified checkpoint. No new work until quota recovery confirmed. Jobs/findings/releases/import/poller remain unfinished; POSTmonitor/testTelegram stay501; readiness503 false-offline UI label and production bootstrap delivery remain known next tasks. Terra stayed stopped throughout Gemini continuation.

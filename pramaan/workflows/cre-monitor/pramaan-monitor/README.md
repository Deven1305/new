# Pramaan WATCH: Chainlink CRE Monitor

Chainlink Runtime Environment (CRE) workflow that monitors release pointers on ENSv2 resolvers, revocations, timelocked upgrades, and proxy implementations.

## Implemented in Current Slice

1. **Workflow Entrypoint & SDK Runner (`main.ts`, `src/workflow.ts`)**:
   - `main.ts`: Entrypoint exported for CRE SDK / Javy compilation. Exports ONLY zero-argument `async function main(): Promise<void>` as required by the Javy compiler (which rejects exported functions with parameters).
   - Utilizes installed `@chainlink/cre-sdk` 1.23.0 `Runner.newRunner<Config, z.input<typeof configSchema>>({ configSchema })` and `runner.run(initWorkflow)`. Uses the second generic parameter (`TIntermediateConfig`) to correctly match schema input defaults without type mismatches.
   - `src/workflow.ts`: Contains testable helpers:
     - `initWorkflow`: Registers `CronCapability` handler.
     - `executeWorkflow`: Enforces exactly one app per workflow execution budget, header block pinning via `SdkChainPort`, node-mode manifest fetcher, and deterministic evaluation via `decide()`.
     - `WorkflowExecutionSummary`: Structured execution summary with required non-null string `reason` fallback (`"delivered"`) so SDK `Value.from` can serialize without error.

2. **HTTP Node-Mode Manifest Fetcher & Ingest Adapter (`src/sdk-http.ts`)**:
   - `fetchManifestInNodeMode`: Fetches release manifests inside CRE node mode with 10s capability timeout and enforces the 250 KB response body cap (`MAX_MANIFEST_RESPONSE_BYTES`).
   - Hashing & Fact Extraction: Hashes exact received bytes with pure Noble SHA-256 and extracts compact `ManifestFacts`.
   - Bounded Consensus Wire: Aggregates full `ManifestObservation` wire JSON bounded under 20 KB (`MAX_CONSENSUS_WIRE_BYTES = 20 * 1024`) across nodes via `consensusIdenticalAggregation<string>()`. The string primitive satisfies `CreSerializable` (which strictly excludes `null`), guaranteeing consensus serializability without typecasting. Raw manifest/asset bytes are never returned or aggregated across consensus. Oversized wire observations yield `facts=null` with an explicit error, preserving `UNKNOWN` in `decide()`.
   - `deliverIngestInNodeMode`: Optionally delivers non-OK decisions to Pramaan ingest server via signed HTTP POST.
   - Zero Secret Access in Log-Only Mode: When `ingestUrl` is empty or decision is `OK`, `runtime.getSecret` is never called.
   - Secret Retrieval & Signing: In non-OK ingest mode, retrieves `CRE_INGEST_SECRET` via `runtime.getSecret`, signs exact serialized bytes with HMAC-SHA256, and transmits byte-for-byte identical payload.
   - Deterministic Timestamps: `observedAt` ALWAYS uses deterministic DON `runtime.now()` (finalized blocks can be >10min old and local forks future-dated, while ingest rejects stale/future timestamps). Head block chain time is kept separately in decision details for ETA arithmetic.
   - URL Semantics: `resolveIngestUrl` explicitly appends `/v1/ingest/cre` exactly once across trailing/non-trailing base URLs.
   - Final Payload Bound: Ingest request body is bounded to 20 KB (`MAX_INGEST_PAYLOAD_BYTES`).
   - Leak Prevention & Generic Errors: Transport and `getSecret` errors expose stable generic messages (`"failed to retrieve ingest secret"`, `"HTTP manifest request failed"`, `"HTTP ingest delivery request failed"`). Raw exception messages are never echoed, preventing synthetic/real secrets or HMAC signatures from leaking in results or logs.
   - Narrowed HTTP Capability Interface: `HTTPClientCapability` is narrowed to the node-mode `sendRequest` signature, structurally compatible with real SDK `HTTPClient` without requiring the unused DON overload.
   - Architecture & Deduplication: HMAC is a shared-secret transport authentication mechanism, not a DON consensus proof. Node HTTP cache is an optimization; server database deduplication via `idempotencyKey` is authoritative.

3. **Workflow & Project Configuration**:
   - `workflows/cre-monitor/project.yaml`: Canonical target definitions for `staging`, `local-simulation`, and `local-simulation-ingest`. Uses explicit `http://127.0.0.1:8545` for local simulation (avoiding undocumented `${VAR:-default}` shell syntax) and `${SEPOLIA_RPC_URL}` for staging.
   - Removed duplicate workflow-folder `project.yaml`, keeping package build `-R ..` consistent.
   - `workflow.yaml`: Maps targets to `main.ts`, config paths, and empty `secrets-path: ""` for log-only simulation or `secrets.yaml` for ingest simulation.
   - `secrets.yaml`: Maps logical secret ID `CRE_INGEST_SECRET` to local environment variable name `PRAMAAN_INGEST_SECRET` without checking in any secret values.
   - `config.sample.json`: Log-only non-secret sample config using clearly labelled placeholder addresses.
   - `config.ingest.sample.json`: Non-secret ingest sample config using clearly labelled placeholder addresses.

4. **Quota and Schema Enforcements (`src/types.ts`)**:
   - Single-App Constraint: `configSchema` enforces `apps.length === 1`.
   - EVM Read Budget: `limitsSchema` enforces `evmCalls <= 15`.
   - Supported Safe Cron Subset: `validateCronSchedule` validates 6-field cron expressions in the documented safe supported subset: exactly every 30s (`*/30`, `0,30`, `30,0`) or once per minute with fixed second (`0-59`). Arbitrary rollover gap steps (`*/45`, `*/59`, `*/10`, `* * * * * *`) and invalid field ranges are strictly rejected.
   - Header Pinning: `SdkChainPort` requires a successful `header()` call first to pin block height for calls.
   - Decider UNKNOWN: Preserves `UNKNOWN` for incomplete observations, transport failures, missing manifests, or oversized facts.

5. **Pure Unit Tests (`test/unit/sdk-http.test.ts`)**:
   - Single-app constraint validation (accepts 1, rejects 0, rejects >1).
   - Cron schedule validation (accepts supported safe subset, rejects rollover gap steps like `*/45` and `*/59`, rejects invalid field values and non-6 field counts).
   - Base URL resolution semantics appending `/v1/ingest/cre` exactly once.
   - Manifest response 250 KB cap and full observation wire JSON 20 KB consensus limit enforcement.
   - Transport error / 404 yielding `UNKNOWN` in `decide()`.
   - Zero secret retrieval in log-only mode and when decision is `OK`.
   - Deterministic `observedAt` ALWAYS using `runtime.now()` with shifted chain clock.
   - Error redaction: injected getSecret/transport errors containing synthetic secrets/signatures do not leak in result or log output.
   - Ingest payload bounding and HMAC-SHA256 signature verification.
   - Real SDK `HTTPClient` protobuf marshalling test: verifies `fromJson(RequestSchema, input)` decodes headers, base64 body into `Uint8Array` bytes, and timeout `"10s"` into protobuf Duration.
   - Workflow execution tick verification with mock capabilities.

## Commands

Commands executed by Coordinator (Gemini uses file tools only):

```bash
# Typecheck workflow TypeScript definitions
bun run typecheck

# Run unit tests
bun test test/unit

# Compile workflow WASM
cre workflow build . -R .. -T local-simulation -o dist/pramaan-monitor.wasm
```

## Simulation Status

- **Status**: **BLOCKED (UNAVAILABLE)**
- **Blocker 1 (CLI Authentication)**: `cre whoami` reports no login and no `CRE_API_KEY`. CRE simulation requires active account credentials according to official documentation.
- **Blocker 2 (Owner Key Requirement Uncertainty)**: TS starter documentation explicitly requires `CRE_ETH_PRIVATE_KEY` for simulator environment initialization even without blockchain actions, differing from generic documentation that describes keys only for on-chain writes. Because login is unavailable, actual CLI 1.39 behavior beyond the first blocker remains unverified.
- **Blocker 3 (Local Fork Chain Selector Compatibility)**: Local fork chain selector compatibility remains unverified until authenticated simulation is possible.
- **Evidence**: Simulation was NOT run. No credentials were accessed, and no deployment or simulation was claimed.

# Gemini CRE Monitor Status & Implementation Record

**Branch**: `codex/gemini-work`  
**Execution Mode**: File tools only (zero terminal commands, no commits, no settings changes, no credential reads, no other workers)  
**Supervisor Stop Check**: Checked `.pramaan/supervisor-stop` before all edits; verified file was absent.

---

## 1. CRE Adapter Status & Coordinator Run Results

The coordinator verified that **TypeScript typecheck PASSED** and **35/36 unit tests passed** after the previous patch. The remaining 1 failing test and accompanying SDK review items have been resolved:

### A. Base64 Encoding for `filterLogs` Query Bytes (`src/sdk-chain.ts`)
- **Review Finding**: In the CRE SDK, `EVMClient.prototype.filterLogs` deserializes the JSON filter query via `fromJson(FilterLogsRequestSchema, input)`. In protobuf JSON format, `bytes` fields (`FilterQuery.addresses` and `Topics.topic`) must be base64-encoded strings, not raw `0x` hex strings.
- **Fix**:
  - Imported `hexToBase64` from `@chainlink/cre-sdk`.
  - In `SdkChainPort.logs()`, converted both `addresses` (`addresses.map((a) => hexToBase64(getAddress(a)))`) and `topics` (`topics: [{ topic: topic0.map((t) => hexToBase64(t)) }]`) to base64 strings.
  - Updated mock test expectations to match base64 values.

### B. Real SDK `EVMClient` Protobuf Deserialization Test (`test/unit/sdk-chain.test.ts`)
- **Requirement**: Verify actual SDK conversion pipeline end-to-end instead of only mirroring implementation with a mock capability.
- **Fix**:
  - Added a test instantiating the real SDK `EVMClient` via `createEvmClient("ethereum-testnet-sepolia")` with a fake `Runtime.callCapability`.
  - Captured the deserialized protobuf `FilterLogsRequest` payload produced by SDK `fromJson`.
  - Asserted that `payload.filterQuery.addresses[0]` decodes to a 20-byte `Uint8Array` matching `hexToBytes(contractAddr)`, and `payload.filterQuery.topics[0].topic[0]` decodes to a 32-byte `Uint8Array` matching `hexToBytes(topic0)`.

### C. Strict Block Pinning & Rejection Without Successful Header (`src/sdk-chain.ts`)
- **Requirement**: `call()` must never fall back to moving `latest` when `header()` has not succeeded. Calls require a successful header first, otherwise throw without invoking `callContract`. In addition, `pinnedBlockNumber` must reset to `null` at the start of `header()` so a failed second refresh cannot reuse a stale pin.
- **Fix**:
  - `header()` resets `this.pinnedBlockNumber = null` at entry.
  - `call()` checks `if (this.pinnedBlockNumber === null)` and throws immediately without calling `callContract`.
  - Replaced the test expecting fallback to `LATEST` with a test asserting immediate error throw and zero `callContract` invocations.
  - Added a test verifying that a failed second header refresh clears the pin and causes subsequent `call()` invocations to reject without invoking `callContract`.
  - Updated the ordinary `call()` test to invoke `port.header()` first with `mockHeaderReply`.

---

## 2. Explicit Verification & "NOT RUN" Evidence

| Action | Executed by Gemini? | Status / Evidence |
|---|---|---|
| Patch edits (`src/sdk-chain.ts`, `test/unit/sdk-chain.test.ts`) | YES | Written using built-in file tools |
| Supervisor stop check (`.pramaan/supervisor-stop`) | YES | Verified absent prior to each edit group |
| Terminal commands / Shell execution | **NO** | Strictly not executed (file tools only constraint) |
| Git commits / branches / push | **NO** | Strictly not executed (branch remains `codex/gemini-work`) |
| Bun typecheck (`bun run typecheck`) | **NOT RUN** | Previous run: PASSED; awaiting coordinator re-verification |
| Bun unit tests (`bun test test/unit`) | **NOT RUN** | Previous run: 35 pass, 1 fail out of 36; awaiting coordinator re-verification |
| CRE CLI build (`cre workflow build`) | **NOT RUN** | Awaiting coordinator verification |
| CRE simulation (`cre workflow simulate`) | **BLOCKED / NOT RUN** | Requires CRE API credentials |

---

## 3. Next Bounded Slice (Upon Coordinator Sign-Off)

Once the coordinator confirms that all 36+ unit tests pass:
1. Implement `workflows/cre-monitor/pramaan-monitor/main.ts` with CRE `Runner`, `CronCapability` trigger, and HTTP node-mode manifest fetcher.
2. Implement workflow configuration files: `project.yaml`, `workflow.yaml`, and sample non-secret config enforcing exactly one app per execution.
3. Implement `scripts/config-from-demo.ts` generating single-app configuration from public `DemoStateV2` (`packages/release/src/demo-state.ts`).

## Coordinator verified chain slice, 2026-11-05

Bun1.4.4 frozen install (scripts disabled), explicit checksum-verified Javy8.1.0 setup, `bun run typecheck` and `bun test test/unit` passed:38tests across5files. Tests exercise real SDK filterLogs JSON-to-protobuf marshalling (20/32byte request fields), typed response mocks, block pinning/header failure, malformed profile gaps, budget and deterministic signatures. Coordinator also called the new ENSv2 codec against all three actual local-fork PermissionedResolvers: active pointers matched generated manifests and absent revocations decoded correctly. Public evidence docs/evidence/cre-ensv2-rpc.json. This is direct RPC validation, NOT a CRE workflow simulation. Main/HTTP/config/build remain the next slice; CLI login is unavailable. No deployment/broadcast.

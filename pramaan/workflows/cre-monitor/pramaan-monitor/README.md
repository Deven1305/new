# Pramaan WATCH: Chainlink CRE Monitor

Chainlink Runtime Environment (CRE) workflow that monitors release pointers on ENSv2 resolvers, revocations, timelocked upgrades, and proxy implementations.

## Implemented in Current Slice

1. **ENSv2 Profile Reads (`src/abi.ts`, `src/reads.ts`)**:
   - PermissionedResolver text reads executed via `resolve(dnsEncodedName, text(bytes32(0), key) calldata)`.
   - `dnsEncode` encodes ENS names to DNS wire-format bytes without Node-heavy dependencies.
   - Profile return bytes decoded to string; empty/reverted calls surface as gaps (producing UNKNOWN).
   - Explicit `resolverMode: "ensv2" | "ensv1"` support in `appConfigSchema`, defaulting to `ensv2`.

2. **SDK 1.23.0 EVM ChainPort Adapter (`src/sdk-chain.ts`)**:
   - `SdkChainPort` maps `header()`, `call()`, and `logs()` to installed `@chainlink/cre-sdk` `EVMClient` methods.
   - Synchronous DON mode execution via `runtime` and `.result()`.
   - Protocol-level BigInt conversion (`bigintToProtoBigInt`, `protoBigIntToBigint`), `encodeCallMsg`, and block tags (`LATEST_BLOCK_NUMBER`, `LAST_FINALIZED_BLOCK_NUMBER`).
   - `createEvmClient` selector resolution using SDK `getNetwork` lookup.

3. **Focused Pure Unit Tests (`test/unit/`)**:
   - `test/unit/ensv2.test.ts`: DNS wire-format encoding, `resolve` calldata encoding, result decoding, and ENSv1 fallback.
   - `test/unit/sdk-chain.test.ts`: SDK `EVMClient` capability mapping for header, callContract, filterLogs, and selector lookup.
   - `test/unit/reads.test.ts`: `BudgetedChain` quota enforcement, observation collection, timelock queue inspection, gap tracking.
   - `test/unit/decide.test.ts`: Decision engine verification for OK, UNKNOWN, PENDING_RELEASE_CHANGE, PENDING_UPGRADE, and RELEASE_REVOKED.
   - `test/unit/manifest-sign.test.ts`: Deterministic runId/idempotencyKey, manifest fact extraction, and HMAC-SHA256 request signing.

## Commands

Commands executed by Coordinator (Gemini uses file tools only):

```bash
# Typecheck workflow TypeScript definitions
bun run typecheck

# Run unit tests
bun test test/unit

# Compile workflow WASM (when build slice is reached)
cre workflow build . -R .. -T local-simulation -o dist/pramaan-monitor.wasm
```

## Simulation Status

- **Status**: **BLOCKED (UNAVAILABLE)**
- **Reason**: `cre whoami` reports no login and no `CRE_API_KEY`. CRE simulation requires active account credentials according to official documentation.
- **Evidence**: Simulation was NOT run. No credentials were accessed, and no deployment or simulation was claimed.

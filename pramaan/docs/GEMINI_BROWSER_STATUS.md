# Browser E2E Status: Pending Pointer & Revocation Coverage

**Branch:** `codex/gemini-work`
**Base Commits:** Backend `d1cfc2f`, CRE chain `be8b4ab`
**Test Suite:** `apps/extension/test/v2.e2e.ts`
**Run Mode:** Local Sepolia fork running on chain ID 31337, decoder backend OFF (`PRAMAAN_EXPECT_BACKEND_OFF=1`), Chromium headless.

---

## 1. Local Anvil Harness Diagnosis & Manual Mining

During execution on the local Anvil fork:
- The local node reported automine enabled (`true`), yet certain contract transactions (`timelock.queue`, `timelock.cancel`, `resolver.setText`) remained pending in the mempool despite correct nonces and sufficient gas/funds.
- Explicit block mining (`evm_mine`) immediately processed the pending transaction (e.g. queue transaction mined successfully at 606,668 gas).
- This is identified as a local Anvil harness timing/block-trigger behavior, not an on-chain bug or provider verification flaw.

### Resolution: Guarded Typed `createTestClient` Mining
- Configured a typed viem test client: `createTestClient({ chain, mode: "anvil", transport: http() })`.
- Implemented `mineManualBlock()`:
  - Asserts that both the connected public client and chain config resolve to local chain ID `31337`.
  - Refuses to run on any remote, testnet, or public chain.
  - Invokes `testClient.mine({ blocks: 1 })` immediately after locally submitted transactions (`queue`, `cancel`, `setText`).
  - Labeled explicitly in evidence JSON as `"localMining": "manual-anvil-testclient"`.

---

## 2. Test Implementation & Corrections

### A. Exact Runtime Prior Revocation Reading (No Universal Resolver, No Fallback)
- **Direct Resolver Call:** Prior revocation state is queried directly on `app.resolver` by encoding standard text profile calldata (`text(bytes32 node, string key)` using `namehash(app.ensName)`) and invoking `resolve(bytes name, bytes data)` with `dnsEncode(app.ensName)`.
- **Fail-Closed Safety:** No universal resolver fallback and no catch-to-empty fallback. A read failure halts execution before any mutation occurs, ensuring the original record can always be safely restored.
- **Decoding:** Return bytes are decoded via `decodeFunctionResult`.

### B. Accurate Queue ETA Comparison
- The queued operation's `eta` is compared against the actual queue transaction's mined block timestamp (`queueBlock.timestamp`), rather than host wall-clock time (`Date.now()`).
- Asserts `BigInt(queuedEta) === queueBlock.timestamp + timelockDelay` and `BigInt(queuedEta) > queueBlock.timestamp`.
- Asserts `checkTab.manifestSha256 === app.release.sha256` (active manifest is not replaced by the future pending pointer).
- Asserts `checkTab.pending[0].ready === false` and matches the queued pointer digest.

### C. Guardian Cancellation
- Guardian executes `app.timelock.cancel(id)` with gas `500_000n`.
- Block mined via `mineManualBlock()` and receipt awaited (`status === "success"`).
- Navigating back to the origin confirms extension state reflects `pending.length === 0`.
- Cancellation is wrapped in a `finally` block to ensure cleanup even on assertion failure.

### D. Revocation & Provider Hold
- Owner sets `pramaan.revoked` to `app.release.sha256` with gas `500_000n` and mines the block.
- Extension detects revocation (`release.status === "revoked"`).
- Wallet approval request opens `verdict.html` where `#continue` is disabled.
- Rejecting the verdict window resolves the request with zero provider calls (`providerCalls` remains unchanged).

### E. Clean Restoration & Resumed Signing Path
- Exact prior revocation record is restored in `finally` via `owner.setText(..., priorRevocation)` with block mining.
- Page reloads and waits for `release.status === "verified"`.
- **Stale Receipt Guard:** `lastHash` is explicitly reset to `null` before triggering the new restoration wallet request, ensuring a previous test transaction receipt cannot satisfy the new assertion.
- User clicks `#continue` in `verdict.html`, provider call count increments, new `lastHash` is captured, block is mined, and receipt is awaited with `status === "success"`.

---

## 3. Evidence Output Format

Compact JSON emitted on completion:
```json
{
  "evidence": "pending-pointer-and-revocation",
  "localMining": "manual-anvil-testclient",
  "timelockOpId": 2,
  "queuedEta": 1793863482,
  "queueBlockTimestamp": 1793863362,
  "activeManifest": "<sha256>",
  "statusWhileQueued": "verified",
  "pendingCountWhileQueued": 1,
  "pendingCountAfterCancel": 0,
  "statusWhileRevoked": "revoked",
  "providerCallsWhileRevoked": 2,
  "statusAfterRestore": "verified",
  "providerCallsAfterRestore": 3,
  "restoredTx": "0x..."
}
```

Ready for coordinator Playwright verification.

## Coordinator verified after corrections (2026-11-05)

Extension typecheck passed. Full V2 Playwright file:3passed,0skipped (36.3s), decoder backend stopped. Actual queued op3 had ETA1793847179 > queue block1793847059 (120s delay); active digest remained dc5012803557fc7f81f1cf02d8c84df2370f0174a12f8bf8c3143ca53649722f. Distinct guardian cancellation removed pending state. ENS revocation held actual wallet request with provider count unchanged2; exact restoration allowed new mined tx0x60b4d5ffc84a513cebd67f2bab110a361c2e9445d5e451371d18ac67595f4fec, provider count3. Public details docs/evidence/pending-revocation-browser.json.

Local harness explicitly mines blocks through chainId-guarded Anvil TestClient. Earlier timeout was diagnosed: valid queue transaction remained pending despite automine:true, nonce/funds valid; manual evm_mine produced success with606668gas. Coordinator cancelled only that known leftover test op2 before rerun. This supersedes suspected undrained pipe cause; quiet logging alone did not resolve this pending transaction behavior. No public testnet transaction or live wallet extension was exercised.

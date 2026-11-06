# Pramaan on ENSv2: release identities

Every Pramaan app has its **own ENS name, its own resolver and its own release timelock**, all under one parent name
the team controls. The names are real ENSv2 subnames on Sepolia, created with the contracts ENS Labs deployed there.

## 1. The hierarchy

```
RootRegistry 0xB458…C43f
└─ "eth"  → ETHRegistry 0xD4eB…A8B4 (PermissionedRegistry)
   └─ <parent>.eth            token owned by OWNER · resolver: none · subregistry ↓
      UserRegistry proxy      (VerifiableFactory → UserRegistryImpl 0x9bd8…366a), root roles: OWNER only
      ├─ vaultlab.<parent>.eth      resolver = PermissionedResolver A   timelock = PramaanTimelock A
      ├─ mirroryield.<parent>.eth   resolver = PermissionedResolver B   timelock = PramaanTimelock B
      └─ permitmarket.<parent>.eth  resolver = PermissionedResolver C   timelock = PramaanTimelock C
```

How the Universal Resolver finds `vaultlab.<parent>.eth` (verified source `LibResolution.findUnvalidatedResolver`):
root → `getSubregistry("eth")` → ETHRegistry → `getSubregistry("<parent>")` → our UserRegistry →
`getResolver("vaultlab")` → resolver A → `resolve(dnsName, text(node, key))`. The parent has **no resolver** on purpose:
an unregistered `x.<parent>.eth` resolves to nothing, never to a wildcard record.

This is the procedure in the ENS docs ([subnames](https://docs.ens.domains/ensv2/subnames),
[verifiable factory](https://docs.ens.domains/ensv2/verifiable-factory)): deploy a UserRegistry through the
VerifiableFactory with `initialize([{account, roleBitmap: ALL_ROLES}])` and salt `keccak256("UserRegistry", namehash, version)`,
attach it with `setSubregistry` (we pass it straight into `ETHRegistrar.register(…, subregistry, …)`), then
`register(label, owner, registry, resolver, roleBitmap, expiry)` per subname. `setParent(ETHRegistry, "<parent>")` makes
the registry canonical. Subname expiry = parent expiry.

## 2. Roles: who can do what

| Actor | Holds | Can | Cannot |
|---|---|---|---|
| **Owner** (cold key, a Safe in production) | the `<parent>.eth` token (set-subregistry/resolver + admin), all root roles on the UserRegistry and on every app resolver | register/replace subnames and resolvers, write owner records, grant/revoke the scoped roles | nothing is hidden from it: it is the root of trust |
| **PramaanTimelock** (one per app) | `ROLE_SET_TEXT` on resource `keccak256("pramaan.record")` of its app's resolver only | write `pramaan.record` of its own name, only after the delay, only for queued pointers | any other key, any other name's resolver, any role |
| **Proposer** (release CI key) | the timelock's proposer slot — **no ENS role** | queue a pointer (visible, cancellable, delayed) | write any record, grant/revoke roles, touch registries, upgrade resolvers |
| **Guardian** | `ROLE_SET_TEXT` on `keccak256("pramaan.revoked")` of each app resolver + the timelocks' guardian slot | cancel queued pointers, rotate the proposer, revoke releases **immediately** | write `pramaan.record` or any other record, touch registries |

ENSv2 roles are per resolver (`EnhancedAccessControl`), scoped by `grantSetterRoles(setText(_, key, _), account)`, and
`grantRoles` is disabled on PermissionedResolver. One resolver per app means a compromised timelock or guardian of one
app can never write another app's records.

## 3. Records

| Key | Written by | Format |
|---|---|---|
| `pramaan.record` | the app's PramaanTimelock | `pramaan:v1:<tag>:<sha256 of canonical manifest>` (prefix + printable ASCII ≤ 256 enforced on-chain) |
| `pramaan.revoked` | guardian | v1: 0–16 manifest sha256 digests (64 lowercase hex), single-space separated (≤ 1039 chars). Anything else is *malformed* and the verifier refuses to show green. |
| `pramaan.timelock` | owner (in `initialize`) | the app's PramaanTimelock address |
| `pramaan.domain` | owner | the exact origin, e.g. `https://vaultlab.example` |
| `pramaan.attestation` | owner | `key` \| `github` \| `github:<workflow path>` |
| `pramaan.signer` | owner | `p256-spki:<base64url SPKI>` (key mode) |
| `pramaan.repo` | owner | `https://github.com/<owner>/<repo>` (GitHub mode) |
| `url` | owner | the app origin (for ENS apps) |

All owner records are written inside the resolver's `initialize` (role checks are skipped there), so a fresh identity
costs: CREATE2 timelock + resolver proxy + 2 scoped grants + 1 subname registration.

## 4. Supersession, replay and revocation semantics

- **Delay:** a queued pointer executes only after `delay` (default 120 s, 60 s … 30 days); anyone may execute.
- **Executed twice:** impossible (`NotQueued`).
- **Older operation after a newer one:** impossible (`Superseded(id, lastExecutedId)`).
- **Old pointer re-queued under a new id:** impossible — a pointer value can be activated once (`executedIdOf`, `AlreadyExecuted`). An older release can never come back through the proposer.
- **Cancelled:** cannot execute. **Expired** (> 14 days after ETA): cannot execute (`Expired`).
- **Bypass / replay outside the timelock** (e.g. a stolen owner key writing `pramaan.record` directly): the verifier
  reads `pramaan.timelock`, and the record must equal the value of `lastExecutedId`. An older executed value → red
  `replayed-pointer`; any other value → red `pointer-not-from-timelock`.
- **Pending update:** a newer queued, unexpired operation → still verified, amber, with tag and ETA (`update-pending`).
- **Revocation:** the guardian adds the manifest sha256 to `pramaan.revoked` (`pnpm pramaan ens revoke`); verifiers show
  red `revoked` from the next block — no delay, because revocation only reduces trust. Caveat: the guardian's role lets
  it rewrite the whole record, so it could also *remove* entries; the WATCH monitors alert on every `TextUpdated` of
  `pramaan.revoked`, and in production the guardian is a Safe.

## 5. Verifier states (packages/verifier-core)

`ReleaseVerification.status` keeps its six values; `reason` explains it: red = `mismatch` (`domain-mismatch`,
`pin-mismatch`, `manifest-digest-mismatch` from a publisher-controlled source, `binding-mismatch`, `replayed-pointer`,
`pointer-not-from-timelock`), `invalid-signature`, `revoked`; amber = `unverifiable` (`rpc-disagree`, `rpc-unavailable`,
`manifest-unavailable` incl. IPFS gateway errors or wrong bytes from a gateway, malformed pointer/domain/signer/
timelock/revocation records, `timelock-mismatch`, `signature-missing`) and `verified` + `update-pending`. Every RPC is
checked with `eth_chainId` first. Contract rows add `wrong-chain` (red, blocking) and treat beacon proxies, ERC-7511 /
non-standard clones and diamonds as unsupported (amber). Code hashes are deployed-vs-deployed (immutables and metadata
are inside both), see `compareContract`.

## 6. What was verified, and how

On an **anvil fork of Sepolia** (fresh keys, `packages/release/test/identities.fork.test.ts`, 6/6 passing on
2026-11-04) through the same `deployIdentities()` call the Sepolia command uses:
- `<parent>.eth` registered via commit-reveal with MockUSDC (public `mint`), UserRegistry attached at registration;
  three subnames, three resolvers, three CREATE2 timelocks; measured gas ≈ 2.32 M (parent) + 10.87 M per app.
- The real Universal Resolver returns each subname's own `pramaan.domain/signer/timelock`; an unknown subname returns nothing.
- 72 role checks (24 per app: proposer ×12, guardian ×5, timelock ×4, 3 positive controls) all as expected; 6 reverting
  transactions mined as evidence.
- Re-running the setup sends **0** transactions (deterministic addresses, resumable).
- Execute-twice, re-queued old pointer, superseded id, cancelled and expired operations all revert against the real resolver.
- End to end: verified → newer release queued (amber, pending) → proposer cannot revoke → guardian revokes → red; the sibling name is untouched.

**Not done:** nothing was deployed or registered on real Sepolia (no funded keys were provided). Run
`pnpm run doctor --network sepolia --parent <label>` and then `pnpm pramaan deploy identities --network sepolia --parent <label> --yes`;
the result (addresses, tx hashes, Etherscan links) is written to `contracts/deployments/11155111.json` under `"ens"`.
The Sepolia ENS deployment can be reset by ENS Labs; the doctor re-checks every address before anything is sent.

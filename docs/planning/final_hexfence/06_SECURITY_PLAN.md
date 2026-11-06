# 06. Security plan for the merged HexFence

A security product that fails open, locks owners out of their own Safe, or shows a false green does more harm than no product. This plan says what must be trusted, what can go wrong and what to build before mainnet.

## 1. Security goals

1. **No false green.** An unchecked or failed check is grey or amber, never green.
2. **No lock-out.** No HexFence contract may stop Safe owners from removing it. (v1 passes every call to the Safe or the Guard itself, [HexFenceGuard.sol:93](../hexfence/contracts/contracts/HexFenceGuard.sol#L93).)
3. **No silent change.** Releases, signer keys and upgrades change only through a visible delay, with an instant revoke.
4. **No single point of trust** for the user-side check: no HexFence server, two RPCs that agree, publisher attribution for evidence.
5. **No leak** of the address being checked: no per-recipient server lookups.

## 2. Trust roots: what you still have to trust

| Root | Why it is trusted | How to shrink it |
|---|---|---|
| Guard bytecode | It decides what the Safe refuses | Ownerless and non-upgradeable (v1); parity vectors; external audit; Sourcify exact match |
| ENS name owner | Controls the release identity | Owned by a multisig Safe, never a hot key |
| Release signer | Binds a record to the app | Keyless CI signing (GitHub OIDC / Sigstore) preferred; otherwise a KMS/HSM key; rotation only through the timelock |
| Timelock + guardian | Delay plus emergency stop | Production delay 24–48 h (the demo uses 120 s); the guardian can only cancel or revoke, never publish |
| RPC providers | Source of chain state | Two independent providers must agree at the same block; disagreement → grey |
| Extension and Snap code | Runs in the user's browser or wallet | Reproducible builds, a published hash per version, GitHub attestations, two-person store publishing |
| Arkiv publishers | Supply the evidence | Attribution is not truth: client-side publisher allowlist, multi-publisher agreement counts, expiry, explicit retractions |
| CRE network | Runs the watchers | Accept reports only from the real forwarder; deterministic decision rule; an HMAC proves the shared secret, not consensus |
| Anon-RPC (Nox) | Hides the reader's IP for reads | Worker hash checked (the spec requires it); the route is shown; no anonymity audit is claimed |
| The user's device | Everything runs there | Out of scope, **but** the Guard still enforces on-chain even if the device is compromised |

## 3. Threat model

| # | Threat | Control today | Gap | Plan |
|---|---|---|---|---|
| T1 | Tampered dApp front end (Bybit-style) | Pramaan app row: hashes of loaded files vs the signed record; hold before the wallet | Re-fetch TOCTOU: a targeted server can serve different bytes to the page and to the re-fetch | Require **SRI** (`integrity=`) on every script; the record lists the SRI values (the schema already has an `sri` type), so the browser itself refuses changed bytes. Prefer content-addressed hosting (IPFS + ENS contenthash) |
| T2 | Tampered page asks for a delegatecall | Guard v1 reverts `DelegateCallNotAllowed` | Owners can still be tricked into a separate "remove guard" transaction | Guard V3 guard-change delay (§5) plus a CRE alert on any `ChangedGuard` event |
| T3 | Lookalike recipient (address poisoning) | Guard fingerprint rule; Pay/extension RED; Arkiv evidence | 4+4 rule misses weaker lookalikes; first-use mistakes | Client warns on 3+3 and longer common prefix/suffix (warning only, the Guard stays 4+4); V2 learning with a cooling-off period for large amounts |
| T4 | Malicious upgrade (WazirX-style) | Pramaan contract row (proxy implementation vs release); CRE monitor; app timelock | Only for supported proxy types; only when a release exists | Alert on `Upgraded` / timelock `CallScheduled` for every contract a protected Safe paid in the last 90 days |
| T5 | Stolen release-signing key | Timelock delay, guardian revoke, rollback protection | Demo delay is 120 s | 24–48 h delay in production; keyless signing; rotation runbook (§8) |
| T6 | Stolen ENS owner key | Scoped roles: the proposer cannot write records (72/72 fork checks) | Owner can still change resolvers | ENS name owned by a Safe with HexFence Guard; CRE alert on resolver or record changes |
| T7 | Lying or broken RPC | Two-RPC agreement, unknown → grey | Head drift between providers | Compare at one pinned block; three providers for treasuries |
| T8 | Fake or spam evidence on Arkiv | Publisher-scoped reads; "suspected" status | One publisher today | Publisher allowlist in client config; show agreement counts (C3); retraction entity |
| T9 | Malicious extension update | MV3 forbids remote code | A store account takeover ships new code | Two maintainers, published hashes per version, attestation, staged rollout |
| T10 | Page code bypasses the wallet wrapper | EIP-6963 + `window.ethereum` wrapping | Page code can grab the provider first | State the limit; the **Snap** and wallet-native checks run inside the wallet; the Guard enforces anyway |
| T11 | PROVE sandbox escape by a malicious repo | Docker `--network none`, read-only, no capabilities, limits, FFI forced off, `.env` deleted | Docker is shared-kernel isolation | gVisor or Firecracker microVM per job before running anyone else's repo (§6) |
| T12 | Console (backend) compromise | SIWE, hashed sessions, CSRF, scoped tokens, roles | Shared database | Verifier never depends on it (keep it that way); rate limits; audit log; least-privilege DB roles |
| T13 | Forged CRE alert | HMAC on ingest; consumer is advisory | Consumer trusts the mock forwarder | `HexFenceAlerts` V2 accepts only the real forwarder; alerts never change what the Guard allows |
| T14 | Guard bug | Tests against real Safe 1.4.1/1.5.0; parity vectors | No human or external audit yet | Human review now (H-item), external audit before mainnet, bug bounty after |
| T15 | Privacy leak of the checked address | Bulk reads, no per-recipient lookups, Nox, leak observer | Bulk reads stop scaling | Bloom snapshot plus prefix buckets ([07](07_REAL_WORLD_INTEGRATION_AND_SCALE.md) §4) |

## 4. Keys and roles

| Role | Holds | Can | Cannot | Storage | Rotation |
|---|---|---|---|---|---|
| ENS owner | the parent name | manage resolvers and subnames | publish a release directly (by policy) | Safe multisig, hardware keys | Safe owner change |
| Proposer (CI) | release pipeline | **queue** a release | write any ENS record | GitHub OIDC (keyless) | none needed |
| Timelock | contract | write only `hexfence.record` | write other keys | on-chain | redeploy plus ENS role change |
| Guardian | separate Safe | cancel queued changes, write only `hexfence.revoked` | publish | separate signers | Safe owner change |
| Release signer | P-256 key or Sigstore identity | sign records | change ENS | KMS/HSM or keyless | via timelocked `hexfence.signer` |
| Arkiv publisher | EOA | write evidence | change other publishers' records | CI secret, testnet funds only until mainnet | new publisher, announced on the site |
| Deployer | EOA | deploy contracts | own them (guards are ownerless) | hardware key | per deployment |

## 5. Contract rules

**Invariants (tested for every Guard version):**
1. A payment to a lookalike of an approved payee reverts.
2. A payment to an approved payee passes.
3. A payment to a new, non-lookalike recipient passes (it is not an allowlist).
4. A delegatecall reverts (V3: except the canonical MultiSendCallOnly, whose inner calls follow 1–3).
5. A call to the Safe itself or to the Guard passes, so owners can always remove the Guard.

**Guard V3 guard-change delay conflicts with invariant 5.** Design it with an escape hatch (for example: a removal announced N hours earlier passes; an immediate removal needs every owner, not the threshold). It must be externally audited before any real funds. If the escape hatch cannot be made simple, ship V3 without the delay and rely on the CRE alert.

**Process:** Hardhat tests on real Safe contracts (today), Foundry fuzz and invariant tests (add), Slither with Pramaan's plugin (exists), Sourcify exact match for every deployment, CREATE2 for predictable addresses, and an external audit of the guards and the release timelock before mainnet.

## 6. PROVE sandbox for other people's code

Already in place: no network, read-only filesystem, no capabilities, memory/CPU/process limits, a 10-minute kill, `foundry.toml` rewritten from an allowlist (FFI off), `.env` deleted, solc binaries pinned by hash.

Before running repos from strangers:
- One **gVisor or Firecracker microVM per job**, destroyed afterwards.
- No secrets in the job environment; size-limited outputs; signed evidence files.
- Per-account rate limits and queues.
- AI only fills exploit templates; the gates (balance changes, re-entry seen, fix blocks the exploit for the right reason) decide.

## 7. Supply chain

- `pnpm install --frozen-lockfile` everywhere; `onlyBuiltDependencies` (Pramaan allows only esbuild).
- GitHub Actions pinned by commit SHA; Renovate or Dependabot with human review.
- SBOM (CycloneDX) per release, plus GitHub build attestations (HexFence already publishes them).
- Secret scanning (gitleaks) on every PR; branch protection and required reviews on `main`; signed release tags.

## 8. Incident runbooks

| Incident | First 15 minutes | Then |
|---|---|---|
| Release signer key leaked | Guardian writes the current release hash to `hexfence.revoked` (instant) | Queue a new `hexfence.signer` through the timelock; CRE alert; post-mortem on the site |
| Tampered site detected | Users see red; publish `hexfence.alert.v1` | Redeploy from the signed build; compare with the release record |
| Guard bug | Announce; owners remove the Guard (always allowed, invariant 5) | Deploy the fixed Guard; migration guide |
| False evidence published | Write a retraction (the loss pass already did one) | Fix the detector rule; re-run labels (H9-style human check) |
| Extension store compromise | Unpublish; tell users to pin the last good hash | Rotate store credentials; reproducible-build check |

## 9. Data and privacy

- Evidence is always "suspected", about addresses, never about people. Records expire (30/90 days), and retractions are public.
- No personal data is stored. Wallet addresses can still count as personal data when linkable; check India's Digital Personal Data Protection Act, 2023 with a lawyer before offering hosted services.
- The checked address stays on the device: Bloom filter first, then a prefix bucket, through Nox where available.

## 10. Before-mainnet checklist

- [ ] External audit: Guard v1, V2, module guard, Alerts V2 and the release timelock.
- [ ] Human-labelled detector precision published (H9 method, larger sample).
- [ ] SRI required for verified releases; TOCTOU limit stated.
- [ ] Production delays (24–48 h) and guardian Safes in place.
- [ ] CRE on a DON with the real forwarder; the mock forwarder is gone.
- [ ] gVisor/Firecracker sandbox for hosted PROVE.
- [ ] `SECURITY.md`, a security contact and a bug bounty live.
- [ ] Incident runbooks rehearsed once on Sepolia.

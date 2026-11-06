# 04. The merged product: HexFence

**HexFence: check the app, the contract and the recipient before you sign, then let the Safe refuse on-chain what should never be paid.**

Suggested naming: the product is **HexFence**. Pramaan lives on as the name of its developer-side layer, **HexFence Pramaan** (release proofs for dApp teams). *Pramaan* means "proof", which is exactly that layer's job.

## 1. The problem, with real numbers

| Attack | What happened | Which question would have caught it |
|---|---|---|
| **Bybit**, Feb 2025, ~$1.5B | Malicious JavaScript was injected into Safe{Wallet}'s front end (AWS S3) and activated for Bybit's wallet. Signers approved what looked like a normal transfer; the operation was changed to a **delegatecall** that took over the Safe | Is this the real app? (the page bytes would not match the release). And the Guard refuses delegatecall (`DelegateCallNotAllowed`) even if the page lies |
| **WazirX** (India), Jul 2024, ~$230–235M | A multisig was **upgraded** to an attacker-controlled implementation. Whether the compromise was on WazirX's or Liminal's side is disputed | Is this the real contract? (an implementation not in the release, flagged before execution) and the watch on upgrades |
| **Address poisoning**, 2022–2024 | USENIX Security 2025: **270M attacks, 17M victims, at least $83.8M lost** on Ethereum and BSC in two years | Is this the real recipient? (the lookalike rule in the Guard plus the open evidence) |
| Blind signing | Unlimited approvals and permit signatures that users cannot read | What does this do? (deterministic decoder, ERC-7730, English/Hindi/Marathi) |

Sources are in [09](09_SOURCES.md). Do not say HexFence "would have stopped" these attacks; say which check addresses which step.

## 2. Design rules (both projects already follow them)

1. **Enforce on-chain where possible.** A screen can lie; a Guard revert cannot be clicked through.
2. **Fail closed. Unknown is never green.** Four outcomes for every check: proven, mismatch, could not check, service failed.
3. **No silent changes.** Releases, upgrades and (in Guard V3) guard changes are queued and visible before they take effect.
4. **Open data, private reads.** Evidence and releases are public. The address a user checks never leaves the device.
5. **No single point of trust.** The verifier needs no HexFence server; RPC reads need two providers that agree; anyone can publish evidence.
6. **Deterministic verdicts.** AI may help write exploit tests or explanations. It never decides a verdict and can never lower a risk level.
7. **Honest claims.** "Suspected", "simulation", "scripted" and "not tried by a person" are stated wherever they apply.

## 3. Five layers

| Layer | Who it serves | What it does | From |
|---|---|---|---|
| **PROVE** | dApp developers | Reproduce bugs as real exploit tests in a sandbox; re-check the fix | Pramaan engine |
| **PUBLISH** | dApp developers | Signed release record (files, contracts, findings, ERC-7730 descriptors, third parties) → ENS pointer behind a timelock → Arkiv index and mirrors | Pramaan manifest/release + HexFence Arkiv/B7 |
| **CHECK** | Users and AI agents | One pre-sign pipeline in the extension, Pay/Safe App, a MetaMask Snap and the MCP tool | Both |
| **ENFORCE** | Safe owners | Guard refuses lookalikes of approved payees and delegatecalls | HexFence Guards |
| **WATCH** | Everyone | Detector writes poisoning evidence; CRE watches protected Safes, releases, timelocks and upgrades | HexFence detector/Sentinel + Pramaan monitor |

## 4. How it fits together

```
 DEVELOPER SIDE
   repo ──► PROVE (no-network sandbox) ──► findings ─┐
   build ──► site files + contract hashes ───────────┴─► release record ──sign──► ENS pointer
                                                               │            (timelock, guardian, revoke)
                                                               └─► Arkiv release index + any mirror (found by hash)

 USER SIDE (before the wallet sees the request)
   page + wallet request ──► CHECK pipeline (extension | Pay / Safe App | Snap | MCP)
       app row        ◄── ENS records (2 RPCs agree) + signed record + hashes of loaded files
       contract row   ◄── chain reads (bytecode, proxy implementation) vs the release
       action row     ◄── deterministic decoder + ERC-7730 descriptor + EN/HI/MR text
       recipient row  ◄── Guard's approved payees + release addresses + evidence snapshot
       privacy row    ◄── leak observer + which RPC route was used
   ──► combine ──► pass | confirm | block ──► wallet ──► Safe ──► GUARD (on-chain refusal)

 ALWAYS ON
   mainnet logs ──► detector ──► Arkiv poisoning/loss records ──► daily signed Bloom snapshot
   CRE workflow "sentinel": dust/zero-value lookalike transfers to protected Safes ──► alert
   CRE workflow "monitor":  ENS pointer, timelock queue, proxy upgrades           ──► alert
   alerts ──► Arkiv hexfence.alert.v1 + on-chain consumer + Telegram / webhook
```

**Trust rule:** ENS authorises, signatures bind, Arkiv indexes, mirrors serve. A client never trusts a release from Arkiv or a mirror alone. It checks that the record's SHA-256 equals the ENS pointer and that the signature matches the ENS signer key.

## 5. One verdict model

Today HexFence returns one recipient verdict (GREEN/RED/AMBER/GREY) and Pramaan returns rows (green/amber/red/neutral). The merged `@hexfence/core` package uses rows for everything:

```ts
export type Level = "green" | "amber" | "red" | "grey";      // grey = could not check; never shown as green
export type RowKind = "app" | "contract" | "action" | "recipient" | "privacy";

export interface CheckRow {
  kind: RowKind;
  level: Level;
  code: string;                    // stable reason code, e.g. "RESEMBLES_APPROVED_PAYEE"
  params: Record<string, string>;  // values for the translated message (addresses, names, ETA)
  evidence?: string[];             // Arkiv entity keys, release SHA-256, tx hashes
}

export type Hold = "pass" | "confirm" | "block";
export interface Policy { onRed: "block" | "typed-override"; onAmber: "confirm" | "pass"; onGrey: "confirm" }
export interface CheckResult { rows: CheckRow[]; overall: Level; hold: Hold; checkedAt: string }

/** Worst row wins; grey is never upgraded to green. Pure function, no network. */
export function combine(rows: CheckRow[], policy: Policy): CheckResult;
```

| Today | Becomes |
|---|---|
| HexFence `GREEN approved` | `recipient` green `APPROVED_PAYEE` |
| HexFence `RED listed` | `recipient` red `LISTED_IN_EVIDENCE` (evidence ids) |
| HexFence `RED resembles` | `recipient` red `RESEMBLES_APPROVED_PAYEE` |
| HexFence `AMBER new` | `recipient` amber `NEW_RECIPIENT` |
| HexFence `GREY delegatecall / unsupported / admin` | `action` grey `CANNOT_VERIFY_*` |
| Pramaan `siteRow` | `app` row (`SITE_FILE_MISMATCH`, `DOMAIN_NOT_BOUND`, `RELEASE_REVOKED`, `RELEASE_PENDING` …) |
| Pramaan `contractRow` | `contract` row (`NOT_IN_RELEASE`, `IMPLEMENTATION_CHANGED` …) |
| Pramaan `actionRow` (info…critical) | `action`: info/low → green, medium → amber, high/critical → red |
| Pramaan `privacyRow` | `privacy` row |

Default policy: red → block, with a typed override (HexFence already asks for 6 typed characters); amber or grey → confirm; all green → pass. A treasury policy can remove the override. The Guard's revert stays the final word for its own rule whatever the client decides.

## 6. Cross-project features (only possible after the merge)

1. **Lookalikes of a dApp's own contracts.** The release lists the app's contracts. The recipient row also runs the fingerprint rule against them: *"this spender resembles VaultLab's router 0x…, but is not it"*. That explains the problem in plain words instead of just "not in release".
2. **HexFence checks itself.** HexFence's own Pages build publishes a release record, so the extension verifies HexFence Pay like any other app. The B7 attestation becomes a full release.
3. **Safe transactions get all five rows.** Pay and the extension show app, contract and action rows next to the payee verdict, and the Guard enforces the recipient rule on-chain.
4. **One alert stream.** A pending upgrade of a contract your Safe pays, and a lookalike dust transfer to your Safe, arrive in the same feed (Arkiv `hexfence.alert.v1`).
5. **AI agents get the same answer.** `hexfence_check` (MCP) gains app and contract rows, so an agent that signs gets the same five-row result as a person.
6. **Proof travels with the release.** "This exact contract was attacked with this exploit, and the fix blocks it" is shown in the extension for the release you are signing against.

## 7. Data

### ENS (authority)

Pramaan's records were only ever written on local forks, so renaming the keys costs nothing:

| Key | Meaning |
|---|---|
| `hexfence.record` | Active release: `hexfence:v1:<tag>:<sha256>` |
| `hexfence.domain` | The only origin allowed to claim this release |
| `hexfence.signer` | Release-signing public key |
| `hexfence.attestation` | Signature policy (release key or GitHub/Sigstore identity) |
| `hexfence.timelock` | The app's timelock contract |
| `hexfence.revoked` | Up to 16 revoked release hashes |

The well-known hint file becomes `/.well-known/hexfence.json`. ENSv1 text records work on mainnet today. ENSv2 Permissioned Resolvers with scoped roles are used once activated ([07](07_REAL_WORLD_INTEGRATION_AND_SCALE.md)).

### Arkiv (open data)

| Entity | Expiry | Indexed | Note |
|---|---|---|---|
| `hexfence.poisoning.v1` | 30 days | as today | unchanged |
| `hexfence.loss.v1` | 90 days | as today | unchanged |
| `hexfence.release.v1` | 90 days | ensName, tag, sha256, commit | record bytes (≤64 KiB, the existing B7 cap) |
| `hexfence.alert.v1` (new) | 30 days | subject (Safe or app), decision, severity | from both CRE workflows; a public, queryable alert log |
| `hexfence.snapshot.v1` (new) | 7 days | date, sha256, count | points to the daily Bloom filter file on mirrors; only the hash lives on Arkiv |

### Safe (enforcement)

| Guard | State | Plan |
|---|---|---|
| v1 | Live, ownerless, no upgrade | **Never change.** It is the reference |
| V2 learning | Deployed | Funded Sepolia run, then audit |
| Module guard (1.5.0) | Deployed | Live module payment, then audit |
| **V3 (research, needs audit)** | Not built | (a) allow delegatecall only to the canonical **MultiSendCallOnly** by address and code hash, and run every inner call through the same rules, which brings batching back; (b) **guard-change delay**: refuse `setGuard`/module changes unless announced N hours earlier (Safe Shield's Guardian uses a 24-hour removal timelock); (c) **composite guard** so a Safe can run HexFence next to another vendor's guard (a Safe holds one transaction guard) |

A guard cannot read another contract's EIP-1967 implementation slot, so upgrade checks stay off-chain (extension and CRE). Do not promise on-chain upgrade checks.

## 8. Target repo layout

```
hexfence/                         (the existing public repo is the host)
├─ contracts/                     unchanged: Guard v1, V2, module guard, alerts (Hardhat)
├─ contracts-release/             from Pramaan: release timelock + demo contracts (Foundry)
├─ packages/
│  ├─ core/            NEW        CheckRow, combine(), Policy, reason codes
│  ├─ guard-parity/    renamed    today's @hexfence/shared: fingerprint, Safe decoder, recipient verdict (must match the Guard)
│  ├─ decoder/         Pramaan    + HexFence explain.ts (ERC-7730)
│  ├─ i18n/            NEW        EN/HI/MR strings from both, with the missing-key test
│  ├─ manifest/        Pramaan
│  ├─ release/         Pramaan    ENS identities, timelock, IPFS
│  ├─ verifier/        Pramaan    verifier-core
│  ├─ prove/           Pramaan    engine
│  ├─ arkiv/           HexFence   + release index, alerts, snapshots
│  ├─ evidence/        NEW        Bloom snapshot build/verify + prefix buckets (from check/bloom.ts)
│  ├─ transport/       NEW        Nox route + two-RPC agreement (from both)
│  ├─ check/, mcp/     HexFence   + app and contract rows
│  └─ ui/              HexFence
├─ apps/
│  ├─ extension/       Pramaan base + HexFence Safe-payment module
│  ├─ pay/             HexFence Pay / Safe App + app and contract rows
│  ├─ explorer/        HexFence + Releases and Alerts tabs
│  ├─ detector/        HexFence
│  ├─ console/         Pramaan server + web, optional, for dApp teams
│  ├─ cli/             `hexfence prove | publish | verify | watch`
│  ├─ snap/            NEW MetaMask Snap (transaction insights)
│  └─ site/            landing
├─ workflows/cre/                 one CRE project: sentinel + monitor
├─ docker/sandbox/, tools/slither-plugin/
├─ examples/                      Pramaan demo apps and vulnerable example repos
└─ docs/                          one AGENTS.md, a new frozen INTERFACES.md, SECURITY.md
```

`contracts/` stays exactly where it is. Its scripts, deployment files and Sourcify checks depend on those paths, and it is the security-critical part.

## 9. The demo of the merged product (for a future event)

1. A developer runs `hexfence prove`: the exploit drains the vulnerable vault; the fix blocks it.
2. `hexfence publish`: the release record is queued in the timelock; CRE flags "pending release", then it executes.
3. The user opens the app: five green rows. The release shows the proven fix.
4. The attacker changes one line of the site's JavaScript: the app row goes red and the request is held before the wallet.
5. **The extension is turned off.** The tampered page sends a delegatecall to the Safe: the **Guard reverts on-chain**.
6. A lookalike dust transfer reaches the Safe: the CRE alert arrives, and paying the lookalike reverts.

Two independent locks in under three minutes, every step real.

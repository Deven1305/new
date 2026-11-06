# 03. Both projects, audited: what is real, what overlaps, what each brings

Read-only review on 6 Nov 2026, 22:45–23:15 IST. Status words come from each project's own docs and evidence files, cross-checked with git. "Real" means deployed or run with recorded evidence. "Code only" means written and unit-tested, not shown live.

## 1. Side by side

| | HexFence | Pramaan |
|---|---|---|
| One line | A Safe Guard that refuses lookalike payments, with open address-poisoning evidence on Arkiv | Proof before you ship, checks before you sign: exploit-proven fixes, a signed release on ENS, and a pre-sign verifier |
| Protects against | Address poisoning: paying a lookalike of someone you pay | A tampered website, an unexpected contract or upgrade, a misleading signature request, address leaks |
| Main user | Safe owners (treasuries, teams) | dApp teams (publish), their users (verify) |
| Enforcement | **On-chain** (Safe Guard reverts) | **Off-chain** (extension holds the wallet request) |
| Repo | `Deven1305/hexfence`, **public**, 226 commits, started 6 Nov 01:19 | `Deven1305/eth_pramaan`, **private**, 22 commits, base 5 Nov 01:01 (pre-event) |
| Size (src + tests, approx.) | ~11.6K lines | ~65.7K lines (27.7K of it in `workflows/cre-monitor`, not inspected) |
| Toolchain | Node 22, pnpm 10.34.9, Hardhat, Vite, viem, zod | Node 22, pnpm 10.34.9, Foundry, Vite, React, Fastify, Postgres/PGlite, Docker, Bun (CRE) |
| Live today | GitHub Pages site, explorer and Pay; Sepolia contracts; 173 Arkiv records | Nothing public; local Sepolia fork (chain 31337) only |
| Sponsors | Arkiv, EF CROPS, Chainlink CRE (gated) | ENS, EF Anon-RPC/CROPS, Chainlink CRE |

## 2. HexFence components

| Component | Where | State |
|---|---|---|
| v1 Guard (no owner, no upgrade path) | `contracts/contracts/HexFenceGuard.sol` | **Real.** Sepolia `0xA061…9748`, verified on Etherscan and Sourcify; L payment reverted, B and P succeeded, removal drill done (all by script) |
| V2 Guard (opt-in learning) | `HexFenceGuardV2.sol` | Deployed `0x0adF…98c7`; isolated Safe; no funded positive-value payment yet |
| Module Guard (Safe 1.5.0) | `HexFenceModuleGuard.sol` | Deployed `0xa7Dc…546B`; no live Safe uses it |
| Alerts consumer (CRE) | `HexFenceAlerts.sol` | Deployed `0x97F6…D80F`; trusts the public **mock** forwarder (advisory only) |
| Shared logic | `packages/shared` | Fingerprint, Safe decoder and verdicts; **parity-tested against the real Guard** (411 v1, 414 V2 vectors) |
| Arkiv layer | `packages/arkiv`, `arkiv/` | **Real.** `hexfence.poisoning.v1` (30-day expiry) and `hexfence.loss.v1` (90-day); idempotent writer; publisher-scoped bulk reads |
| Detector | `apps/detector` | **Real.** Mainnet USDT/USDC logs; 47,694 suspected pairs in one 7,200-block run; 173 published |
| Explorer | `apps/explorer` | **Real.** Evidence, Losses (rescue pack with SHA-256), Campaigns, private "Check my address" |
| Pay / Safe App | `apps/pay` | **Real** read-only preview; RED/AMBER/GREEN verdict; Nox (Anon-RPC) reads by default; Hindi mode not native-checked; Safe App not tried by a person |
| Chrome extension | `apps/extension` | Code only; reviews Safe payments on app.safe.global; not tried with a real wallet |
| Check SDK + MCP | `packages/check`, `packages/mcp` | Code only; offline verdict plus a Bloom filter; `hexfence_check` tool for AI agents |
| Sentinel (CRE) | `sentinel/` | Source plus WASM build in CI; **no `cre workflow simulate` run**; no Telegram message |
| Client attestation (B7) | `.github/workflows/pages.yml` | **Real:** `SHA256SUMS.txt` plus GitHub build attestations. Arkiv `hexfence.release.v1` is code only |

## 3. Pramaan components

| Component | Where | State (per its docs, 5–6 Nov) |
|---|---|---|
| PROVE engine | `packages/engine`, `docker/sandbox`, `tools/slither-plugin` | Slither/Aderyn candidates → exploit templates → Foundry test in a network-less Docker sandbox → gates → fix re-check. Evidence for 3 example repos in `docs/evidence/prove-*`. 6/6 sandbox tests incl. a malicious-repo test |
| Release manifest | `packages/manifest` | RFC 8785 canonical JSON; file hashes, contracts (with proxy type), findings, ERC-7730 descriptors, third parties; DSSE P-256 signature |
| Release + ENS identity | `packages/release`, `contracts/src/PramaanTimelock.sol` | ENSv2 subnames, one Permissioned Resolver and one timelock per app, guardian revoke; **72/72 permission checks on a Sepolia fork**; no real Sepolia deployment (needs funded wallets) |
| Verifier core | `packages/verifier-core` | Site files, contracts (incl. proxy implementation), signature, timelock and Sourcify checks; verdict rows green/amber/red/neutral; "unknown is never green" |
| Decoder | `packages/decoder` | Deterministic decoding of ERC-20/721/1155, Permit/Permit2, SIWE and multicall, plus ERC-7730 clear signing; English, Hindi and Marathi with a missing-translation test |
| Extension | `apps/extension` | MV3; wraps every wallet (EIP-6963 plus `window.ethereum`); fail-closed; leak detection and blocking; Anon-RPC panel. Browser tests passed on a fork with the backend off, incl. tamper → hold → restore and pending/revoked |
| Demo apps | `apps/demos` (VaultLab, MirrorYield, PermitMarket) | Built and run on a fork; tamper/restore scripts |
| Backend + dashboard | `apps/server`, `apps/web` | SIWE, sessions, CSRF, scoped tokens, job queue, findings, releases, monitors (6 Nov evening); partly finished |
| CRE monitor | `workflows/cre-monitor` | SDK adapter, ENSv2 reads, decision rule, HMAC alert; `cre workflow build` passed (WASM 2.8 MB); **simulation not run** ("NOT cre workflow simulate" in `docs/evidence/cre-live-*.json`) |
| CLI | `apps/cli` | `pramaan prove`, `demo:up`, `record-page` |

## 4. What overlaps, and which version to keep

| Concern | HexFence has | Pramaan has | Keep in the merge |
|---|---|---|---|
| Browser extension | Safe-payment reviewer for app.safe.global (~0.9K lines) | General MV3 interceptor, fail-closed, leaks, privacy (~4.1K lines, more browser-tested) | **Pramaan's as the base**; HexFence's Safe review becomes one check module |
| Decoder | Safe call decoder (must match the Guard exactly) plus a pasted ERC-7730 panel | Broad deterministic decoder, ERC-7730, three languages | **Pramaan's for display.** HexFence's Safe decoder stays separate as the Guard-parity decoder (never merge those two) |
| Verdict | GREEN/RED/AMBER/GREY for one recipient | Rows (release, site, contract, action, privacy) combined | **One row model**; the HexFence recipient verdict becomes the `recipient` row ([04](04_MERGED_ARCHITECTURE.md)) |
| Release integrity | GitHub attestations, `SHA256SUMS.txt`, Arkiv release prototype | Signed manifest, ENS pointer, timelock, revocation | **Pramaan's format and ENS authority**; Arkiv becomes the public index and mirror |
| CRE | Sentinel: poisoning alerts for protected Safes | Monitor: release, timelock and upgrade decisions | **Both**, as two workflows in one CRE project with one alert format |
| Anon-RPC | Nox route in Pay | Nox transport in the extension | One shared transport package |
| i18n | Pay Hindi strings | EN/HI/MR framework with a missing-key test | **Pramaan's framework**, HexFence strings moved in |
| Contracts toolchain | Hardhat (real Safe 1.4.1/1.5.0 tests) | Foundry (fork and fuzz tests) | Both for now; move the guards to Foundry later, keeping the parity vectors |
| Backend | None, by design | Fastify + Postgres | Optional "console" for dApp teams; **the user-side checks never need it** |

## 5. Why they fit together

The two projects defend different moments of the same signature:

```
  dApp team ships          user opens the app          user signs            Safe executes
  ─────────────            ──────────────────          ──────────            ─────────────
  PROVE + PUBLISH   ──►    Is this the real app?  ──►  What does this   ──►  Is this the real
  (Pramaan)                Is this the real            do? (decoder)        recipient? Refuse
                           contract? (Pramaan)                              delegatecall?
                                                                            (HexFence Guard)
                           WATCH: upgrades, releases, poisoning (CRE, detector) run all the time
```

- HexFence's Guard is the **last line**: it works when every screen lies. Its blind spot is everything before the payment: a fake site, a changed contract, a confusing approval.
- Pramaan covers that blind spot but **cannot enforce**: an extension can be bypassed or not installed.
- Together they give two independent locks. Bybit (a tampered Safe{Wallet} page plus a delegatecall) is the textbook case, as [04](04_MERGED_ARCHITECTURE.md) explains.

## 6. Honest weaknesses to fix in the merge

| Weakness | Project | Fix in the merged product |
|---|---|---|
| Most code AI-written; human reviews pending | Both | Human Guard review, an external audit before mainnet, human-labelled precision (H9) |
| No real CRE simulation or DON deployment | Both | One CRE project, a real simulation, then a DON deployment with the real forwarder ([07](07_REAL_WORLD_INTEGRATION_AND_SCALE.md)) |
| Evidence bulk read will not scale past thousands of records | HexFence | Signed Bloom filter snapshots plus prefix buckets ([07](07_REAL_WORLD_INTEGRATION_AND_SCALE.md)) |
| Extension re-fetches files (TOCTOU); page code can bypass wrappers | Pramaan | State it, and add on-chain enforcement through the Guard ([06](06_SECURITY_PLAN.md)) |
| Nothing deployed publicly | Pramaan | Sepolia identities first, then mainnet after ENSv2 activation |
| MultiSend refused, so no batching | HexFence | Guard V3: allow only canonical MultiSendCallOnly by code hash and check each inner call |
| One transaction guard per Safe | HexFence | A composite guard, so HexFence can sit next to Safe Shield's Guardian |
| Nox start-up 26–38 s on the hosted site | HexFence | Warm the route at extension start; cache; show the route state |

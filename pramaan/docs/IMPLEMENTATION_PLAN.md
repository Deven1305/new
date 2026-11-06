# Pramaan — Implementation Plan

This plan turns the research report (`../PRAMAAN_ Verified Research, Redesign and Build Plan for ETHGlobal Mumbai 2026.md`) and the earlier four-ideas plan (`../prev plan.pdf`) into build phases. It is the **team** scope (lanes A–D of the research), not the solo cut.

The current state of each item is tracked in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md). This file is the plan.

## 1. Final architecture (from the research, unchanged in substance)

One trust chain, end to end:

```
prove (Slither/Aderyn candidates → template Foundry exploit in a network-less Docker sandbox)
  → fix (deterministic or AI-drafted patch, human review) → re-prove (exploit must fail, regression suite must pass)
  → canonical release manifest (files + SRI, deployed code hashes incl. proxy implementations, findings + evidence hashes)
  → signature (GitHub Artifact Attestation via Sigstore in CI; or a release key published in ENS for self-hosted use)
  → pointer "pramaan:v1:<tag>:<sha256>" queued in PramaanTimelock → after the delay written to the ENSv2 text key
    `pramaan.record` by the timelock, which holds ROLE_SET_TEXT for that one key only
  → MV3 extension verifies pointer (2 RPCs) → manifest hash → signature identity → site files → contract code → decodes the
    transaction deterministically in English/Hindi/Marathi → observes address leaks → continue or reject
  → monitors (backend viem watcher + Chainlink CRE workflow) alert on queued/executed pointer changes, resolver changes
    and proxy upgrades, delivered to Telegram with idempotency keys.
```

Selected sponsors: **ENS (Best Use of ENSv2)** primary, **Ethereum Foundation (Best CROPS App; Anon-RPC for the extension's own reads)** secondary, **Chainlink CRE** optional third. Uniswap, 0G, World, Hedera, Arc, Arkiv, Whitechain, 1inch and Definitive are skipped on purpose (they would be artificial integrations).

Testnet: **Ethereum Sepolia** (ENSv2 is live there). Local development uses **anvil forking Sepolia**, so the real ENSv2 contracts are exercised with free test funds.

## 2. Research claims checked against reality before building

| Research said | Verified on 2026-11-04 | Adjustment |
|---|---|---|
| ENSv2 Sepolia addresses (UR, ETHRegistrar, ETHRegistry, VerifiableFactory, PermissionedResolverImpl, MockUSDC) | All six have code on Sepolia; Sourcify has verified ABIs and sources | Addresses live in `config/ensv2.sepolia.json` and are checked on-chain by `pramaan ens check` before use |
| `grantSetterRoles(setter, account)` scopes ROLE_SET_TEXT to one key | Confirmed in verified `PermissionedResolver.sol`: `decodeSetter` derives `resource = keccak256(key)`; `grantRoles` always reverts | Implemented as researched |
| `initialize(grants, calls)` on the resolver proxy | Confirmed: `initialize((address,uint256)[],bytes[])`, role checks are skipped while initializing, so initial records can be set in the same transaction | Owner records (`pramaan.repo`, `pramaan.domain`, `pramaan.attestation`, `pramaan.signer`) are written inside `initialize` |
| Registration is commit-reveal with ERC-20 payment | Confirmed: `makeCommitment(label, owner, secret, subregistry, resolver, duration, referrer)`, `register(... paymentToken, referrer)`; resolver can be set at registration | Scripted (`pramaan ens register`), not done by hand |
| `actions/attest-build-provenance` | Now v4 and a thin wrapper over `actions/attest@v4`; permissions `id-token: write`, `attestations: write`, `contents: read` (plus `contents: write` to upload release assets) | `release.yml` uses `actions/attest@v4` |
| Attestations REST route | `GET /repos/{owner}/{repo}/attestations/sha256:<hex>` returns `bundle_url`, not an inline bundle; documented as needing read access | The extension never depends on it; the bundle is uploaded as a release asset and hash-independent |
| `@freedomofpress/sigstore-browser` | v0.3.0: `SigstoreVerifier`, `loadSigstoreRootWithTUF`, `verifyDsse(bundle, policy)`, `AllOf`/`Identity`/`GitHubWorkflowRepository`/`OIDCSourceRepositoryDigest` policies. In Chrome its TUF cache falls back to memory | Used in the extension and in Node (CLI/server) |
| `@ethereum-sourcify/clear-signing` `format()` | v0.3.1: custom `DescriptorResolver { index, fetchDescriptor }` supported | The manifest-pinned ERC-7730 descriptor is served through a custom resolver only after its sha256 matches |
| `@anon-rpc/browser-extension-harness` | v0.4.0: `new AnonRpcWorker({ address, preExisting: { rpcProvider } })`, `worker.fetch`. Specifiers: Nox on **Sepolia** `0x35133267…7A9A`; Tor, Nym and Passthrough on mainnet. Needs offscreen + sandbox page + CSP entries | Extension reads go through Nox on Sepolia by default, with a labelled direct fallback and a boot timeout |
| CRE workflow reads the EIP-1967 slot | CRE `EVMClient` has `callContract`, `filterLogs`, `balanceAt`, `headerByNumber`, … but **no `getStorageAt` / `getCode`** | The CRE workflow detects upgrades from `Upgraded(address)` logs and compares the implementation **address**; the backend watcher does the code-hash comparison |
| CRE TS SDK | `@chainlink/cre-sdk` 1.23.0, requires **Bun ≥ 1.2.21**; CLI v1.39.0 has a Windows build | Installed Bun 1.4.4 and CRE CLI v1.39.0 |
| Aderyn | v0.6.8 ships Linux/macOS binaries only | Aderyn runs inside the Linux sandbox image only |
| Node 22 | This machine has Node 20.20.2 (machine-wide winget install) | Code targets Node ≥ 20.19 and CI uses Node 22; switching the machine to Node 22 is a documented optional step (it needs admin rights) |
| Foundry "pin what foundryup installs" | Latest stable v1.9.0 is 2 days old | Pinned **v1.8.7** (patch release in a line out since October) on the host and in the sandbox |
| IPFS: "earns nothing, P2" | Still no storage sponsor | Implemented anyway (team scope) as an availability layer: manifests are uploaded as raw blocks so the CID is derivable from the pointer's sha256 |
| No backend in the solo MVP | Team/production scope asks for a dashboard, jobs and monitoring | Backend added for the **developer side only**. The extension's trust path never touches it (CROPS: switch the server off and verification still works) |

## 3. Repository layout

```
pramaan/
  contracts/            Foundry: PramaanTimelock, VulnerableVault, VaultV2, VaultV3Unaudited, DemoToken, DemoNFT; tests; Deploy script
  examples/             Self-contained vulnerable sample projects for the other exploit templates
  packages/manifest     zod schema, RFC 8785 canonical JSON, sha256/SRI, pointer codec, CID, DSSE helpers, evidence schema
  packages/decoder      ABI/typed-data decoding, deterministic risk rules, en/hi/mr templates, clear-signing adapter
  packages/verifier-core ENS pointer (2 RPCs), domain binding, manifest fetch + hash, Sigstore/key policy, proxy detection, code-hash compare, verdicts
  packages/engine       Docker sandbox runner, Slither/Aderyn parsing, candidates, exploit templates + gates, fixers, AI assist, evidence + reports
  tools/slither-plugin  Pramaan custom Slither detectors (Python)
  docker/sandbox        Analysis image: Foundry + Slither + Aderyn + pinned solc builds, network-less runner
  apps/cli              `pramaan` CLI: prove, fix, manifest, sign, verify, publish, ens *, monitor, demo *
  apps/server           Fastify API + Postgres (PGlite locally) + job worker + chain monitor + Telegram
  apps/web              React developer dashboard + user-facing verify/decode pages
  apps/extension        Chrome MV3 extension: verifier, wallet guard, verdict window, leak guard, Anon-RPC
  apps/demo-dapp        Vite demo dApp, tamper build, leak test page, simulated third-party collector
  workflows/cre-monitor Chainlink CRE TypeScript workflow (Bun)
  .github/workflows     ci.yml, release.yml (written now; run once the GitHub repo exists)
  docs/                 architecture, security, threat model, API, testing, deployment, sponsors, demo, status
```

## 4. Phases, tasks and acceptance criteria

### Phase 0 — Toolchain (done before code)
- Install pnpm 10, Foundry 1.8.7, Slither 0.11.6 (pipx, Python 3.12), Bun 1.4.4, CRE CLI 1.39.0; start Docker Desktop.
- **Accept:** each tool prints its version; Docker runs a container.

### Phase 1 — Foundation
- pnpm workspace, strict TypeScript, vitest, shared config, `.env.example`, `.gitignore`, MIT licence.
- `contracts/` Foundry project with vendored forge-std and OpenZeppelin (exact versions).
- **Accept:** `pnpm install`, `pnpm typecheck`, `forge build` succeed.

### Phase 2 — Contracts (lane A + B)
- `PramaanTimelock`: immutable resolver, DNS-encoded name, delay; constant key `pramaan.record`; proposer/guardian; `queue` validates the pointer prefix; `execute` by anyone after ETA, only ids newer than the last executed (no rollback); `cancel`, `setProposer` guardian-only; no arbitrary calls.
- `VulnerableVault` (UUPS; `withdrawAll()` missing `onlyOwner`), `VaultV2` (fixed), `VaultV3Unaudited` (for the upgrade alert), `DemoToken` (ERC-20 + EIP-2612, faucet), `DemoNFT`.
- Tests: timelock unit tests with a role-faithful mock resolver; vault unit + fuzz tests; reference exploit (passes on V1, reverts on V2); **fork test against the real Sepolia PermissionedResolver** (deploy via VerifiableFactory, key-scoped grant to the timelock, unauthorized writes revert).
- `Deploy.s.sol` writes `deployments/<chainId>.json` with `keccak256(eth_getCode)` for proxy and implementation.
- **Accept:** `forge test` green; fork test green against Sepolia state.

### Phase 3 — PROVE (lane A)
- Sandbox image (`docker/sandbox`), runner with `analyze` and `test` modes; `--network none --read-only --tmpfs --cap-drop ALL --security-opt no-new-privileges --pids-limit --memory --cpus --user 1000`, 10-minute timeout, `execFile` argument arrays only, output size cap.
- Custom Slither detectors; Slither + Aderyn + forge artifact parsing → normalized candidates.
- Exploit templates: access-control ETH drain, reentrancy, initializer takeover; planner (heuristics + `pramaan.json` + optional AI slot filling); static gates (cheatcode allowlist, concrete assertion, attacker-only attack phase).
- Re-verification on fixed git ref / directory / contract; deterministic fixers + AI-drafted fixes; regression suite.
- `evidence.json` (research schema) + Markdown/JSON report.
- **Accept (S1/S2):** exploit reproduces on VulnerableVault, reverts on VaultV2 and on the Pramaan-patched copy; regression suite passes; a no-template candidate stays "candidate"; malicious inputs (path traversal, symlinks, oversize, ffi) are rejected or contained.

### Phase 4 — PUBLISH (lane B)
- Manifest v1 (research schema, deterministic RFC 8785 bytes), pointer codec, CID derivation.
- Signing: GitHub Attestation in `release.yml`; local DSSE P-256 release key for self-hosted/local use (key fingerprint published in ENS by the owner).
- IPFS: Kubo RPC (local Docker node) and Pinata (with JWT); retrieval verified against the digest.
- ENS scripts: check deployments, register (commit-reveal, MockUSDC), deploy resolver via VerifiableFactory, grant key-scoped role, queue/execute, negative tests.
- **Accept:** manifest round-trips byte-identically; tampered manifest/bundle rejected; `pramaan.record` set only via the timelock; unauthorized proposer writes revert.

### Phase 5 — VERIFY (lanes C + D)
- verifier-core: pointer from two RPCs (disagree → unknown), `pramaan.domain` == origin, TOFU pin, manifest from any source verified by hash, signature policy, site files, contract code + proxies (7702, 1167, 1967 impl/beacon, 1822, Safe slot 0; diamonds → cannot verify).
- decoder: ERC-20 transfer/approve/transferFrom/increaseAllowance, unlimited approval, ERC-721/1155 transfers and `setApprovalForAll`, native transfer, EIP-2612 Permit, Permit2, Safe `execTransaction` (operation 1 → critical), EIP-7702, SIWE/personal_sign, `eth_sign`, multicall; unknown → "cannot confidently interpret"; en/hi/mr templates.
- Extension: MAIN-world wrapper (window.ethereum + EIP-6963), private MessageChannel relay, service-worker verifier, verdict window with reject (EIP-1193 4001) / continue, badge, popup, options; leak guard (webRequest bodies/headers, declared vs actual), DNR blocking; Anon-RPC offscreen worker.
- **Accept (S3–S9):** genuine site green; one-byte JS change red and signing blocked; listed proxy/impl green; unlisted contract amber; impl mismatch red; transfer decoded; unlimited approve and Safe delegatecall high/critical in all three languages; demo leak observed and blockable.

### Phase 6 — WATCH (lane D)
- Backend monitor (viem polling with confirmations): timelock Queued/Executed/Cancelled, resolver TextUpdated/Linked/Upgraded/EACRolesChanged, registry ResolverUpdated, vault proxy Upgraded; compare with the active manifest; alerts with idempotency keys; Telegram.
- CRE workflow: cron → timelock + ENS reads → manifest fetch + sha256 → `Upgraded` logs → POST alert; `cre workflow simulate` log saved.
- **Accept (S10):** a queued pointer change and a proxy upgrade each produce exactly one alert.

### Phase 7 — Backend + dashboard + integration
- Postgres schema (research tables + auth), migrations, PGlite for local, `pg` for production.
- Auth: Sign-In with Ethereum sessions, hashed API tokens for CLI/CI, HMAC GitHub webhook; rate limits; helmet; CSRF guard; input validation with zod.
- Jobs: QUEUED/RUNNING/COMPLETED/FAILED/CANCELLED with `SKIP LOCKED` claiming, idempotency keys, cancellation, SSE progress.
- Dashboard pages: landing, dashboard, project analysis, findings, releases, verify, monitoring, guided demo.
- One release id and artifact identifiers flow from job → finding → evidence → manifest → pointer → verdict → monitor event.
- **Accept:** the 20-step end-to-end flow runs on the local fork with real tools; integration tests pass.

### Phase 8 — Docs, demo, deployment
- README (with CROPS section), ARCHITECTURE, SECURITY, THREAT_MODEL, API, TESTING, DEPLOYMENT, SPONSOR_INTEGRATIONS, DEMO_SCRIPT, IMPLEMENTATION_STATUS, AI_USAGE; `.github/workflows`.
- Sepolia deployment commands prepared; run only when funded keys are provided.

## 5. Cut order (if time runs out) and never-cut items

Cut first: CRE → Marathi → leak guard → Sourcify status → ERC-7730 descriptor. Never cut: prove → fix → re-prove; tamper → red → blocked; the timelocked ENSv2 record.

## 6. Hackathon rules to respect

ETHGlobal Classic requires all project work to begin after kickoff and asks that AI assists rather than creates the whole project. This code was written on 2026-11-04, before kickoff. Whether and how to use it is the team's decision; `docs/AI_USAGE.md` records the AI involvement honestly. No git history was created.

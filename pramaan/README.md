# Pramaan

**Proven before you ship. Verified before you sign.**

Pramaan joins four things that are normally separate, so that a person about to sign a transaction can see whether the app in front of them is the release its developer proved and published:

1. **PROVE** – scanners (Slither, Aderyn) only produce *candidates*. A finding exists only when a generated Foundry exploit test reproduces it in a network-less Docker sandbox, and a fix is "verified" only when the same exploit then fails and the project's own tests still pass.
2. **PUBLISH** – a canonical manifest (files, deployed contract code hashes, proven findings) is signed (DSSE, P-256) and activated through a timelock in ENSv2 text records (`pramaan.record`, `pramaan.signer`, `pramaan.timelock`, `pramaan.revoked`).
3. **VERIFY** – a Chrome (MV3) extension re-checks the served files and the contracts against ENS before a wallet request goes through, explains approvals in English, Hindi and Marathi, and blocks requests that would leak the wallet address to a third party. It fails closed.
4. **WATCH** – a server poller and a Chainlink CRE workflow watch for queued releases, proxy upgrades and records changed outside the timelock.

A matching release is **not an audit and not a guarantee of safety**. A scanner finding is a candidate until reproduced.

> Status, test evidence and everything that is **not** done: [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md), [docs/NEXT_LAPTOP.md](docs/NEXT_LAPTOP.md). Plain-language walkthrough: [EXPLANATION.md](EXPLANATION.md). Run it: [RUN.md](RUN.md).

## Try it locally (about 10 minutes, no real funds)

```powershell
pnpm install --frozen-lockfile
cd contracts; forge build; cd ..
pnpm pramaan sandbox build                         # analysis image (needs Docker)
$env:SEPOLIA_RPC_URL_A = "https://sepolia.gateway.tenderly.co"
pnpm demo:up --fixtures                            # forks Sepolia locally, runs PROVE, deploys 3 apps, signs + activates releases
pnpm pramaan verify http://localhost:5182          # VERIFIED
curl -X POST "http://127.0.0.1:5189/tamper?app=mirroryield"   # really edits the served JS
pnpm pramaan verify http://localhost:5182          # mismatch (red)
```

Load `apps/extension/dist` (after `pnpm --filter @pramaan/extension build`) in Chrome to see the same checks in the wallet flow. The three demo apps are VaultLab (real exploit → fix → re-verify), MirrorYield (tampered website) and PermitMarket (unlimited approval explained in three languages; the wallet-address tracker exists only as a separate attack fixture, never in the production build).

## What is real and what is not

| Part | State |
| --- | --- |
| PROVE in the sandbox (3 exploit templates + oracle-maths, deterministic fixes, "no proof, no finding") | Run for real; evidence in [docs/evidence/](docs/evidence/) |
| Release signing, timelock activation, ENSv2 records, revocation | Run on a local fork of Sepolia with the real ENSv2 contracts |
| Extension (fail-closed signing, leak guard, EIP-6963, Hindi/Marathi) | Real Chromium E2E against that fork |
| Anon-RPC private reads | Run live on Sepolia through the Nox mixnet ([evidence](docs/evidence/anon-rpc-live-2026-11-06.json)) |
| Server monitors + alert ingest from CRE | Implemented and tested; Telegram delivery needs a bot token |
| Chainlink CRE | Workflow builds to WASM and its 65 unit tests pass; `cre workflow simulate` needs `cre login` (not done). The decision logic was run against the live fork by a harness that is labelled as such |
| Live Sepolia deployment | **Not done** (needs funded testnet keys; see [docs/FAUCETS.md](docs/FAUCETS.md)) |
| GitHub Action + Sigstore attestation | Workflow template written; **never run** |

## Ethereum Foundation – CROPS

Pramaan's lead property is that **checking a release needs none of our infrastructure**.

- **C**ensorship resistance – the release record lives in ENS and on IPFS; the extension reads the chain itself. Our server cannot hide, delay or alter a verdict.
- **O**pen source – MIT, public repository, free software end to end (see [LICENSE](LICENSE)).
- **P**rivacy – chain reads go through **Anon-RPC / Nox** by default on Sepolia, so the RPC provider does not see which sites you verify. The Privacy panel lists every read with the path it took (`anon-rpc`, `direct-fallback` with the reason, or `direct-local`), and the leak guard blocks requests that carry your address to an undeclared host. Mixnet reads were measured live (about 2 s each).
- **S**ecurity – the extension never silently allows: a red verdict, an unknown verdict after 30 s, a stopped service worker or an unreachable chain all stop the signing request. Proxy upgrades to code outside the release show orange.

**Demonstrate it:** stop the backend (`netstat` shows nothing on :8787) and run the browser test `v2.e2e.ts` with `PRAMAAN_EXPECT_BACKEND_OFF=1` – signed release, tamper, restore, pending and revoked releases all still work. Verification never contacts a Pramaan server.

## Partner checklist

| Sponsor / track | What is built | What is still missing |
| --- | --- | --- |
| ENS – Best Use of ENSv2 | Subnames per app, PermissionedResolver with a text-key-scoped role, timelocked `pramaan.record`, guardian-only revocation, role-boundary negative tests | A Sepolia deployment with recorded transactions |
| Ethereum Foundation – CROPS / Anon-RPC | See above; Anon-RPC measured live | Judge-facing recording |
| Chainlink – CRE | Workflow (reads ENS record, timelock, EIP-1967 slot; decisions; signed ingest), config generator, 65 unit tests, WASM build | `cre login`, then `cre workflow simulate` |

## Prior art

Related projects are listed, with what each does and does not establish, in [docs/ETHGLOBAL_STRATEGY.md §4](docs/ETHGLOBAL_STRATEGY.md): npmguard, ENShell, Preflight, TEE Shield and WEBCAT. WEBCAT in particular verifies signed web assets *before execution* in Firefox; Pramaan's MV3 extension re-fetches and compares files and does not claim equivalent pre-execution enforcement.

## Eligibility

This repository includes pre-event work. The team's From Scratch eligibility for using it is unresolved; see [ETHGlobal rules](https://ethglobal.com/rules) and the status document.

# 08. What was actually run in this merge (7 Nov 2026, Windows, Node 20.20.2, Docker)

## Merge facts
- Pramaan imported with `git filter-repo --to-subdirectory-filter pramaan` into a fresh clone of HexFence, then one merge commit. Original dates and authors are kept (`git log --follow pramaan/package.json` shows 5 Nov 2026 commits).
- Every git-tracked Pramaan file is present, and every git-tracked HexFence file is present (file lists compared against both source folders: the only differences were git-ignored build output, `.env` and `.pramaan` runtime data).
- `.env`, `.pramaan/demo/keys.json` and `release-key.pem` were **not** copied. `pramaan/.pramaan/prove/` (the non-secret PROVE output) was copied.
- Secret scan of the imported tree: only well-known Hardhat/anvil test keys in Pramaan smoke tests (public, no value). `secrets.yaml` files map names only. Run `gitleaks detect --log-opts="--all"` before any push.
- History is a git repository on branch `merge/pramaan-import`; **nothing was pushed anywhere**.

## Results

| Check | Result |
|---|---|
| HexFence `pnpm -r test` | core 6, ui 3, sentinel 4, shared 52, check 14, arkiv 21 (2 skipped), mcp 9, pay 68, detector 26 (1 skipped), extension 25, explorer 50: **all pass** |
| HexFence `pnpm -r build` | pay, explorer, site, extension, detector, mcp, shared, check, arkiv, core, ui, sentinel: **all build** |
| Guard contracts `npx hardhat test` (Docker, Node 22) | **40 passing** (compile: 31 Solidity files) |
| Pramaan `pnpm test` | **221 passed, 46 skipped; 2 files failed**: `verifier-core/test/contracts.test.ts` and `demos/test/pipeline.test.ts`, both need Foundry (`forge`/`anvil`), which is not installed here |
| Pramaan `pnpm typecheck` | pass |
| Pramaan `build:extension`, `build:web` | build; extension `dist` has background, content, inpage, popup, verdict, options |
| `pnpm merged:test` (new) | **5 of 5** merged scenarios pass |
| `@hexfence/core` tests / typecheck | 6 pass / pass |
| MCP `hexfence_check`, real stdio call | returned `RED resembles` for the lookalike |
| `pnpm pramaan decode` | EN/HI/MR output printed, offline |
| Pramaan server | starts and listens when created directly (`createApp`); `tsx src/index.ts` exited silently on Node 20. My one hand-written `/v1/decode` request got `400 VALIDATION_FAILED`, so I did **not** confirm a decode response from the server |

## NOT done or NOT verified here

- `pnpm demo:up` (the three demo apps), `pnpm pramaan prove`, Pramaan contract tests: need Foundry. Installing it was blocked in this session, so install it yourself. The Pramaan team's recorded results (docs/NEXT_LAPTOP.md): demo:up all three VERIFIED, 13 Playwright tests, forge 108 pass, unit 208 pass.
- Neither Chrome extension was loaded in a browser in this session.
- HexFence extension on the real `app.safe.global`: never tested by anyone.
- Safe App inside Safe{Wallet}: never tested.
- Chainlink: no `cre login`, no real simulation for either workflow.
- No Sepolia deployment of Pramaan; no live use of Guard V2 or the module guard.
- The merge is a source-level merge plus `packages/core` + `integration/`. Not done (phases 2-6 of the merge plan): one workspace, one extension, ENS key rename, one CRE project, Pramaan `app` and `contract` rows inside `combine()`.

## Eligibility reminder
The ETHGlobal Mumbai Classic rules ban prior project-specific code and designs, one project per hacker, and no work after submission before payout. This merged tree contains pre-event code. Submit HexFence alone (public `main`, untouched) and publish this merge only after payout, as `docs/planning/final_hexfence/` recommends.

---

# Update: second pass, Foundry found, full demo run live (7 Nov 2026)

Foundry 1.8.7 was already installed at `%USERPROFILE%\.foundry\bin` (just not on PATH), so the earlier "Foundry missing" gaps are closed.

| Check | Result |
|---|---|
| `forge build` + `forge test` in `pramaan/contracts` | **108 passed**, 0 failed, 1 skipped |
| Pramaan `pnpm test` (Foundry on PATH) | **258 passed**, 9 skipped, 0 failed (the 2 earlier failures are fixed) |
| `pnpm demo:up --fixtures` | all three apps **verified**; PROVE ran in the Docker sandbox: 52 candidates, 8 exploit tests, **1 reproduced**, fix re-proved, suite 106 pass / 0 fail; VaultLab release carries 1 published finding |
| `pramaan verify` on :5180, :5182, :5184 | `VERIFIED` and `files: verified (green)` |
| `pnpm merged:verify` genuine MirrorYield | app GREEN, files GREEN, contract GREEN → **GREEN / pass** |
| after `demo:tamper` (real bytes changed) | files **RED** (`/assets/index-….js does not match the release`) |
| tampered + payment to a lookalike of an approved payee | app-files RED + recipient RED → **RED / confirm** |
| after `demo:restore` | `VERIFIED` again |
| lookalike origin :5183 | `MISMATCH` (`pramaan.domain is http://localhost:5182, page is http://127.0.0.1:5183`) |
| VaultLab upgrade watch: `demo:upgrade schedule` then `execute --advance` | proxy moved to the unaudited V3; merged contract row turned **RED** (`VaultV2: impl-mismatch`) |
| Pramaan extension in real Chromium (Playwright, backend off): `playwright test` | **13 passed**, 1 skipped (live Sepolia Anon-RPC): genuine green, tamper red + signing blocked + restore green, lookalike origin red, unlimited approval high risk in EN/HI/MR, leak shown + blocked, backend-down still verifies, stopped worker fails closed, pending pointer + revocation read from the fork |
| `pnpm smoke:browser` | site, guided demo, explorer and Pay render in Chromium; **both extensions load** (service workers running; manifests "Pramaan" and "HexFence interception spike") |
| `pnpm smoke:pay-live` (real Sepolia Safe) | Pay showed "Nox reads active" and "v1.4.1 · 1/2 · Guard active"; lookalike recipient → **RED "Possible address poisoning"** |
| `pnpm smoke:pramaan-server` (Node 20) | `/healthz` 200; `/v1/decode` flagged the unlimited approval |

Still **not** done: HexFence extension on the real `app.safe.global` (needs a human with MetaMask); Pay inside Safe{Wallet}; `cre login` + a real CRE simulation; Pramaan on live Sepolia; Telegram; a manual MetaMask/Rabby run of the demo; the merge phases 2-6 (one workspace, one extension, one CRE project). The Pay web build needs the public `VITE_*` values: `cp .env.public.example .env` before `pnpm -r build`.

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

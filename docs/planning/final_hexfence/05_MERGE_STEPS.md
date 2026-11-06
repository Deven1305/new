# 05. How to merge, step by step (after prizes are paid out)

**Do not start before payout.** The FAQ says: "you should not be working on your project again until PRIZES have been officially paid out / distributed". Until then, this file is reading only.

## 1. Where the merged code lives

| Option | Verdict | Why |
|---|---|---|
| **Pramaan goes into the HexFence repo** (HexFence is the host) | **Do this** | HexFence is the public, judged repo, with 226 commits, live GitHub Pages, Sourcify-verified Sepolia contracts, an Arkiv publisher history and build attestations tied to `-R Deven1305/hexfence`. The final name is HexFence |
| HexFence goes into the Pramaan repo | No | It would break every link in the submission and the attestation identity, and move a public history into a private, pre-event repo |
| A new repo with both as folders | No | It loses continuity and links, and needs both histories imported anyway |

The `final_hexfence` folder (this one) stays the **plan**. It is not a code folder.

## 2. Preconditions (all must be true)

- [ ] Prizes paid out, and no open judging questions.
- [ ] Both repos have clean working trees. Tag the starting points: `pre-merge` on HexFence `main`, `pramaan-final` on Pramaan `main`.
- [ ] Record the test baselines. In each repo, run the full suites and write the pass/skip counts into the PR description. After the merge, the totals must match.
- [ ] **Secret scan of Pramaan's whole history**, because it becomes public inside HexFence. Checked on 6 Nov: `.env`, `*.pem`, `*.key`, `keys/` and `.pramaan/` are git-ignored, none appear in history, and `workflows/cre-monitor/pramaan-monitor/secrets.yaml` only maps names (no values). Still run a scanner such as `gitleaks detect --log-opts="--all"` before pushing.
- [ ] Licences: both are MIT (checked). The CRE SDK is BUSL-1.1; keep naming it in the README, as HexFence does.
- [ ] Everyone agrees on the target layout in [04](04_MERGED_ARCHITECTURE.md) §8.

## 3. Phase 1: import Pramaan with its history (day 1)

Work in fresh clones, never in the live folders on the laptop. Git Bash:

```bash
mkdir merge-work && cd merge-work
git clone https://github.com/Deven1305/eth_pramaan.git pramaan-import
git clone https://github.com/Deven1305/hexfence.git hexfence

# Rewrite Pramaan's history so every file sits under pramaan/ (dates and authors are kept)
pipx install git-filter-repo          # or: pip install git-filter-repo
cd pramaan-import
git filter-repo --to-subdirectory-filter pramaan
cd ../hexfence

git switch -c merge/pramaan-import
git remote add pramaan-import ../pramaan-import
git fetch pramaan-import
git merge --allow-unrelated-histories pramaan-import/main \
  -m "chore: import Pramaan pre-event prototype with history into pramaan/"
git remote remove pramaan-import
```

Why this way: original dates stay visible, so the history itself shows Pramaan began before the event. That is honest provenance, and `git log --follow` keeps working after files move.

Add a **Provenance** section to the README: Pramaan was a pre-event prototype (base `6d30220`, last pre-kickoff commit `1f10464`), imported on `<date>` after the ETHGlobal Mumbai prizes were paid out.

**Checks:**
- `git log --follow pramaan/packages/engine/src/pipeline.ts` shows Pramaan's commits with 5–6 Nov dates.
- HexFence's tests and Pages build are unchanged. `pramaan/` is not yet in `pnpm-workspace.yaml`, so nothing else changes.
- Open the PR, review it, and merge to `main` only when CI is green.

## 4. Phase 2: one workspace (week 1)

Move **one package per PR** with `git mv`, in dependency order:

`manifest → decoder → verifier → release → prove → cli → extension → console → examples → CRE`

For each package:
1. Make a **move-only commit**: `git mv pramaan/packages/manifest packages/manifest`. No logic changes, so review stays easy and `--follow` keeps working.
2. Make a **rename commit**: `@pramaan/manifest` → `@hexfence/manifest`, update imports, add the package to `pnpm-workspace.yaml`, and refresh the lockfile in the same commit (Pages installs with `--frozen-lockfile`).
3. Run the package's tests. The counts must match the baseline.

Root files: merge `package.json` scripts, `tsconfig.base.json` and the Vitest project list. Both repos already use Node 22 and pnpm 10.34.9 (checked), so there is no toolchain fight. Pramaan's Foundry project moves to `contracts-release/`. HexFence's `contracts/` does not move.

### Package map

| From | To | Action |
|---|---|---|
| `hexfence/packages/shared` | `packages/guard-parity` | Rename only. **No logic change**; parity tests must stay 411/414 green |
| `hexfence/packages/arkiv` | `packages/arkiv` | Extend in phase 5 |
| `hexfence/packages/check` | `packages/check` + `packages/evidence` | Move `bloom.ts` to `evidence` |
| `hexfence/packages/mcp`, `ui` | same | Keep |
| `hexfence/apps/detector`, `explorer`, `pay`, `site` | same | Keep; extend later |
| `hexfence/apps/extension` | module inside `apps/extension` | Port in phase 4, then delete |
| `hexfence/sentinel` | `workflows/cre/sentinel` | Move in phase 6 |
| `hexfence/contracts` | `contracts` | **Unchanged** |
| `pramaan/packages/manifest`, `release` | `packages/manifest`, `packages/release` | Rename scope; ENS keys in phase 5 |
| `pramaan/packages/decoder` | `packages/decoder` + `packages/i18n` | Rename; merge HexFence `explain.ts` |
| `pramaan/packages/verifier-core` | `packages/verifier` | Rename |
| `pramaan/packages/engine` | `packages/prove` | Rename |
| `pramaan/apps/extension` | `apps/extension` | Becomes the base |
| `pramaan/apps/cli` | `apps/cli` | Command becomes `hexfence` |
| `pramaan/apps/server`, `web` | `apps/console/server`, `apps/console/web` | Optional product |
| `pramaan/apps/demos`, `examples` | `examples/` | Move |
| `pramaan/contracts` | `contracts-release/` | Move |
| `pramaan/workflows/cre-monitor` | `workflows/cre/monitor` | Move in phase 6 |
| `pramaan/docker`, `tools` | `docker/`, `tools/` | Move |
| `pramaan/docs` | `docs/history/pramaan/` | Archive; keep for provenance |

### CI

One workflow file per concern, keeping the jobs that exist today:

| Job | Command | From |
|---|---|---|
| unit | `pnpm -r test` | both |
| contracts-guard | `cd contracts && npx hardhat test` | HexFence |
| contracts-release | `forge test` in `contracts-release/` | Pramaan |
| extension-e2e | Playwright (backend off) | Pramaan |
| cre-build | `cre workflow build` for both workflows | both |
| pages | unchanged deploy + `SHA256SUMS.txt` + attestations | HexFence |
| publish-evidence | detector → Arkiv every 6 h, then the snapshot (phase 5) | HexFence |

**Phase check:** a fresh clone runs `pnpm install --frozen-lockfile`, `pnpm -r test`, both contract suites and the Pages build, with the summed baseline counts.

## 5. Phase 3: one verdict model (week 2)

1. Create `packages/core` with `CheckRow`, `combine()` and `Policy` from [04](04_MERGED_ARCHITECTURE.md) §5.
2. Write adapters: `recipientRow()` wraps `guard-parity`'s `verdictFor`/`verdictForV2`, and Pramaan's `siteRow`/`contractRow`/`actionRow`/`privacyRow` map to the new rows.
3. Write a **new frozen `docs/INTERFACES.md`** for `core`. One owner edits it, as HexFence's Lane A did.

**Checks:** a golden test for every row of the mapping table in 04 §5; property tests showing that grey never becomes green and the worst row wins; old HexFence and Pramaan verdict tests still pass through the adapters.

## 6. Phase 4: one extension (weeks 2–3)

1. Keep Pramaan's MV3 extension as the base: wallet interception (EIP-6963 + `window.ethereum`), fail-closed hold, leak observer, privacy panel, Nox transport.
2. Port HexFence's Safe pieces as a module: SafeTx typed-data and `execTransaction` parsing (through `guard-parity`, not the display decoder), the Guard payee read and the review window (VerdictCard, AddressXray). It adds the `recipient` row.
3. Delete `apps/extension` from the HexFence side once the new end-to-end tests pass.

**Checks:** Pramaan's Playwright suites still pass (tamper → hold, restore → pass, pending, revoked). New end-to-end cases: a SafeTx to the synthetic lookalike gives a red recipient row; a Safe payment from a tampered page gives a red app row; a delegatecall gives a grey or red action row.

## 7. Phase 5: data and dogfooding (weeks 3–5)

1. **ENS keys** `pramaan.*` → `hexfence.*`, and `/.well-known/pramaan.json` → `/.well-known/hexfence.json`. Nothing public uses the old keys.
2. **Arkiv:** the `hexfence.release.v1` writer and reader (bytes ≤64 KiB), plus the `alert.v1` and `snapshot.v1` entities. The explorer gains Releases and Alerts tabs.
3. **Evidence snapshot:** the scheduled detector job also builds a daily Bloom filter, publishes the file to Pages, and writes its SHA-256 to `hexfence.snapshot.v1`. Pay and the extension check the Bloom filter first, then download one prefix bucket to confirm ([07](07_REAL_WORLD_INTEGRATION_AND_SCALE.md) §4).
4. **Dogfood:** `pages.yml` produces a HexFence release record. The extension verifies HexFence Pay itself.
5. **Real Sepolia identities:** a parent ENS name with subnames for Pay, the explorer and the examples, each with its own timelock and guardian. This needs funded test wallets (Pramaan's `docs/FAUCETS.md`).

**Checks:** a fresh browser profile verifies HexFence Pay from ENS through two RPCs with the console switched off; changing one byte turns the app row red.

## 8. Phase 6: one CRE project (weeks 5–6)

1. `workflows/cre/` holds two workflows: `sentinel` (HexFence's poisoning watch) and `monitor` (Pramaan's release/timelock/upgrade watch), with one alert format.
2. A real `cre login`, then `cre workflow simulate` for both. Save the raw outputs in the repo.
3. Deploy to a DON (CRE is live on mainnet since Nov 2025; access and an account are needed). Ship `HexFenceAlerts` V2, which accepts reports **only from the real forwarder**, not the mock.

**Checks:** saved simulation outputs; duplicate alerts suppressed; an alert visible in the explorer's Alerts tab and in Pay.

## 9. Phase 7: hardening, audit, mainnet beta (weeks 6–12)

Follow [06](06_SECURITY_PLAN.md) and [08](08_ROADMAP_AND_WINNING_PATH.md). Nothing goes on mainnet before the external audit of the guards and the release timelock.

## 10. Rules for people and agents during the merge

- One package per PR; a move-only commit first; small commits; Conventional Commits; never force-push `main`.
- Never edit Guard v1 or its tests. V2 and the module guard change only in new contracts.
- Never commit `.env`, `.pramaan/demo/keys.json` or `release-key.pem`; run the secret scanner in CI.
- Keep both projects' honesty rules: "suspected", "unknown is never green", "scripted", "simulation".
- Docs change in the same PR as the code they describe.

## 11. Rollback

Until phase 2 passes, all work sits on branches. The import is **one merge commit**, so `git revert -m 1 <merge-sha>` undoes it, and `main` and the live site keep working throughout.

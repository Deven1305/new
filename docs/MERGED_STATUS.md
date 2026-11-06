# Merged status (local, not pushed)

- `pramaan/` = Pramaan imported with history (pre-event work, see README Provenance).
- `packages/core` = unified verdict model; adapters for HexFence and Pramaan; 6 tests.
- Not done: single workspace, single extension, ENS key rename, CRE merge (see docs/planning/final_hexfence/05_MERGE_STEPS.md phases 2-6).

## Run
- HexFence: `pnpm install && pnpm -r test` (Guard contracts need Node 22: `cd contracts && npm ci --legacy-peer-deps && npx hardhat test`).
- Pramaan: `cd pramaan && pnpm install && pnpm test` (221 pass; 2 files need Foundry/anvil).

# 03. Every tool, and how to use it

Commands run from `hexfence_merged/` unless stated. "Verified" means I ran it in this merge on 6-7 Nov 2026.

## HexFence tools

| Tool | What it is for | Run | State |
|---|---|---|---|
| **HexFenceGuard** (`contracts/`) | Safe transaction guard. A payment to a *different* address with the same first-4 + last-4 hex as an approved payee reverts (`LookalikeOfApprovedPayee`). Delegatecalls revert. No owner, no upgrade | `cd contracts && npx hardhat test` | 40 tests pass (Docker, Node 22) |
| **Guard V2 / Module guard** | opt-in learning of recipients; same rules for Safe 1.5.0 modules | same | deployed on Sepolia; no live V2 payment |
| **@hexfence/shared** | the Guard's rules in TypeScript (`fingerprint`, `decodeSafeCall`, `verdictFor`, `verdictForV2`) | `pnpm --filter @hexfence/shared test` | 52 pass, parity with the contract |
| **@hexfence/check** | offline SDK: verdict plus evidence Bloom filter | `pnpm --filter @hexfence/check test` | 14 pass |
| **@hexfence/mcp** | MCP server, tool `hexfence_check(recipient, approvedPayees[])` | `pnpm --silent --filter @hexfence/mcp start` | verified: returns `RED resembles` for the lookalike |
| **Detector** (`apps/detector`) | scans mainnet USDT/USDC logs for poisoning pairs → `evidence.jsonl` → Arkiv | `pnpm --filter @hexfence/detector detect` / `publish:arkiv` / `detect:losses` / `precision` | needs `MAINNET_RPC_URL`; Arkiv write needs keys |
| **Explorer** (`apps/explorer`) | browse the evidence on Arkiv, X-Ray an address, Losses, Campaigns, "Check my address" | `pnpm --filter @hexfence/explorer dev` | 50 tests pass |
| **Pay** (`apps/pay`) | check a Safe payment, send it, set up the Guard and payees; Safe App mode; ERC-7730 explain panel; English/Hindi | `pnpm --filter @hexfence/pay dev` then `/?safe=0x…` | 68 tests pass |
| **Site** (`apps/site`) | landing page + guided demo (`demo.html`) that reads live status | `pnpm --filter @hexfence/site dev` | builds |
| **HexFence extension** (`apps/extension`) | reviews Safe payments on `app.safe.global` before MetaMask sees them | `pnpm --filter @hexfence/extension build`, load `apps/extension/dist` | 25 tests pass; **never tested on the real Safe site** |
| **Sentinel** (`sentinel/`) | CRE workflow: dust / zero-value lookalike transfers to a protected Safe → on-chain alert | `cre workflow simulate hexfence-sentinel …` | source + WASM build; no real simulation yet |

## Pramaan tools

| Tool | What it is for | Run | State |
|---|---|---|---|
| **`pramaan decode`** | explain a wallet request in EN/HI/MR + risk level, offline | `cd pramaan && pnpm pramaan decode --method eth_sendTransaction --params '[{...}]'` | verified |
| **`pramaan verify <url>`** | do the extension's checks from the terminal: ENS record → signature → file hashes | `pnpm pramaan verify http://localhost:5182` | needs the demo running |
| **`pramaan prove <dir> --fix`** | PROVE: Slither/Aderyn candidates → Foundry exploit in a no-network Docker sandbox → verified fix | `pnpm pramaan sandbox build` once, then `pnpm pramaan prove contracts --fix` | Pramaan's record: ran for real on 4 example projects |
| `pramaan keygen / manifest / sign` | create the release key, canonical manifest, DSSE signature | see `pnpm pramaan <cmd> --help` | |
| `pramaan scan --site <dir> --declared <host>` | build-time check for shipped secrets and wallet-address trackers | | exit 1 on the tracker fixture |
| `pramaan ens check/status/setup/execute/cancel` | ENSv2 identities and the timelocked release pointer | | local fork or Sepolia |
| `pramaan deploy identities`, `pramaan doctor` | Sepolia readiness and deployment | | rehearsed on fork only |
| `pramaan revoke / revocations` | guardian revokes a release hash immediately | | |
| `pramaan record-page` | static public "record" page for a manifest | | 4 tests |
| **Pramaan extension** (`pramaan/apps/extension`) | Chrome MV3: verifies the page against the signed release, decodes and holds wallet requests, flags address leaks | `pnpm build:extension`, load `apps/extension/dist` | builds; Pramaan's record: 13 Playwright tests on a clean demo |
| **Server** (`pnpm server`, :8787) | decoder API, dashboard accounts (SIWE), projects, monitors, CRE alert ingest | Node 22 | server starts and listens when created directly; `/v1/decode` rejected my hand-written request body (400 VALIDATION_FAILED), so I did not confirm a decode response. Use `pnpm pramaan decode` instead |
| **Web dashboard** (`pnpm dev:web`, :5173) | landing, `/verify` (decoder), `/demo`, `/dashboard` projects / analysis / findings / releases / monitoring | | builds |
| **Demos** (`pnpm demo:up`) | VaultLab, MirrorYield, PermitMarket | see 05 | needs Foundry |
| **Demo actions** | `demo:tamper`, `demo:restore`, `demo:upgrade schedule|execute|status`, `demo:release queue-evil|cancel` | | |
| **CRE monitor** (`pramaan/workflows/cre-monitor`) | release / timelock / proxy-upgrade watch | `bun test` in the workflow dir (65 tests per Pramaan) | `cre workflow simulate` never run |

## Merge tools (new)

| Tool | Use |
|---|---|
| **`@hexfence/core`** (`packages/core`) | `combine(rows, policy)` → `{overall, hold, rows}`. Worst row wins, grey is never green, empty is grey. `recipientRow()` maps HexFence verdicts, `actionRow()` maps Pramaan severities (info/low→green, medium→amber, high/critical→red). `pnpm --filter @hexfence/core test` (6 pass) |
| **`integration/` → `pnpm merged:check`** | runs both engines on the same transaction, prints the combined verdict. Edit `scenarios` in `integration/src/merged-check.ts` to add your own; `checkTx(tx, payees)` is exported |

## The decision rule the merge uses

- Recipient row (HexFence): GREEN approved payee, RED lookalike or listed in evidence, AMBER new, GREY cannot verify.
- Action row (Pramaan): the risk of what the call does (unlimited approval = critical).
- Overall = worst row; grey never becomes green. Policy default: red → "confirm with typed override", amber/grey → confirm, green → pass. The **on-chain Guard still decides** for its own rule, whatever a client shows.
- Not yet merged in code (needs Pramaan's live release context): Pramaan's `app` and `contract` rows (site-file and bytecode checks). They live in the Pramaan extension; wiring them into `combine()` is the next step of phase 3.

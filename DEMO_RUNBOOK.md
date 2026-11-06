# Demo runbook: what to open, what to click, what you should see

Everything below was started and checked on 7 Nov 2026 (see `docs/merged/08_VERIFICATION_REPORT.md`). Local only; test wallet only; nothing here moves real money.

## 0. Start (one command each, separate terminals)

| What | Command (from `hexfence_merged/`) | Ready when |
|---|---|---|
| Pramaan demo (3 dApps, local chain) | `pnpm merged:up` | prints `Local fork demo ready` (5-8 min: PROVE + 3 ENS registrations) |
| HexFence Pay | `pnpm --filter @hexfence/pay exec vite --port 5201 --strictPort` | http://localhost:5201 |
| HexFence explorer | `pnpm --filter @hexfence/explorer exec vite --port 5202 --strictPort` | http://localhost:5202 |
| HexFence site + guided demo | `pnpm --filter @hexfence/site exec vite --port 5200 --strictPort` | http://localhost:5200 |
| Pramaan API | `cd pramaan/apps/server && node --import tsx src/index.ts` | http://127.0.0.1:8787/healthz = `{"ok":true}` |
| Pramaan dashboard | `cd pramaan && pnpm --filter @pramaan/web exec vite --port 5210 --host 127.0.0.1` | http://127.0.0.1:5210 |

Stop: Ctrl+C in each terminal. If anything stays alive: Task Manager → end `anvil` and the `node` processes.

## 1. Browser setup (once, 5 min)

1. Chrome → `chrome://extensions` → Developer mode → **Load unpacked**:
   - `pramaan\apps\extension\dist` (Pramaan)
   - `apps\extension\dist` (HexFence; only acts on app.safe.global)
2. MetaMask/Rabby with a **new test-only wallet**. Add network: RPC `http://127.0.0.1:8545`, chain id `31337`, symbol ETH.
3. Import the demo user account (fresh on every `merged:up`, local-only, worthless): in a terminal run
   `node -e "console.log(require('./pramaan/.pramaan/demo/keys.json').user)"` and paste into MetaMask → Import account → Private key. Never share or commit that file.
4. Reload the demo tabs after loading the extensions.

## 2. The demo, in order (about 6 minutes)

### Part 1: Pramaan, MirrorYield (tampered website)  http://localhost:5182
| Do | You should see |
|---|---|
| Open the page, click the Pramaan icon | **Release verified**; rows Website / Contract / Action / Privacy green |
| Press **Faucet**, then **Stake** | a **Review before you sign** window: a plain sentence, the spender "listed in the release"; **Continue to wallet** or **Reject** |
| Terminal: `pnpm --dir pramaan demo:tamper` (this really edits the served JavaScript) then reload | popup **Mismatch** (red), the changed file is listed; Stake is **blocked before MetaMask opens** |
| Terminal: `pnpm merged:verify http://localhost:5182` | `SITE_FILES_MISMATCH` → `VERDICT: RED -> confirm` |
| Terminal: `pnpm --dir pramaan demo:restore`, reload | green again |
| Open http://127.0.0.1:5183 (same files, other origin) | red: domain mismatch |

### Part 2: Pramaan, PermitMarket (dangerous approval + leak)  http://localhost:5184
| Do | You should see |
|---|---|
| Faucet, then **Buy** → "Enable one-click buying" | MetaMask would ask `approve(…, 2^256-1)`; Pramaan: **UNLIMITED**, high risk, explained in English; switch to हिन्दी / मराठी |
| Reject, then choose "Approve exact amount" | lower risk; "Sign permit" is decoded too |
| Open http://localhost:5184/__fixtures/leak.html → Connect → **send all** | popup lists the tracker host that got your address, "not declared in the release"; press **Block** |

### Part 3: Pramaan, VaultLab (proof + upgrade watch)  http://localhost:5180
| Do | You should see |
|---|---|
| Scroll to **Security evidence** | the PROVE timeline: candidate → exploit reproduced → fix → exploit blocked → regression passed |
| Terminal: `pnpm --dir pramaan demo:upgrade schedule` | popup **Update queued** with a countdown |
| Terminal: `pnpm --dir pramaan demo:upgrade execute --advance`, then `pnpm merged:verify http://localhost:5180` | contract row **RED** (`VaultV2: impl-mismatch`): the code changed to something the release never listed |

### Part 4: HexFence, who you pay  http://localhost:5201/?safe=0x3BCc3969713778F3Ed26AE1490529eeBAD43FbD5
| Do | You should see |
|---|---|
| Wait 25-40 s | "Nox reads active" and "v1.4.1 · 1/2 · Guard active" |
| Recipient `0x4E185a3FC4B530244aB9ed0dE38167b403344120`, amount `0.0001`, **Check payment** | **RED "Possible address poisoning"**: same first 4 + last 4 as the approved payee, "Your protected Safe will refuse this payment" |
| `0xcB0a33f755826307CcaC3f4b4833e7e19d38cEb6` | AMBER "New recipient" |
| `0x4E185e251Ac7fB83E9DE10723EAda46cadE74120` | GREEN "Approved payee" |
Then http://localhost:5202 (real mainnet poisoning evidence: Evidence, Losses, Campaigns) and http://localhost:5200/demo.html (the guided story).

### Part 5: Both together, one verdict
```powershell
pnpm merged:verify http://localhost:5182 --to 0x4E185a3FC4B530244aB9ed0dE38167b403344120 --payee 0x4E185e251Ac7fB83E9DE10723EAda46cadE74120 --value 0.01
```
Genuine site + lookalike payment → recipient row RED → `VERDICT: RED`. Add `demo:tamper` first and the app-files row goes RED as well.

### Part 6: An AI agent uses it (MCP)
The tool is already registered for Claude Code in this folder (`claude mcp list` → `hexfence ✔ Connected`). In a Claude Code session started in `hexfence_merged/` ask:
> Use hexfence_check: is 0x4E185a3FC4B530244aB9ed0dE38167b403344120 safe to pay if my approved payee is 0x4E185e251Ac7fB83E9DE10723EAda46cadE74120?

Expected: RED, "resembles" the approved payee.

## 3. What to say (honest limits)
Local fork for Pramaan, not live Sepolia. A matching release is not an audit. The extension compares re-fetched files, not the bytes the browser executed. HexFence extension not yet tried on the real Safe site. Chainlink simulation not yet run (needs `cre login`).

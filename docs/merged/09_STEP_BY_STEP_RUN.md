# 09. Step-by-step: run the project, load the extensions, use the MCP tool

Written for someone starting from zero on this laptop (Windows 11, PowerShell or Git Bash). Every command here was run on 7 Nov 2026 unless marked **(needs you)**. Folder name used below: `ROOT` = `D:\Deven\1_Hackathon_proj\my\eth\final_hexfence\hexfence_merged`.

## Part A. Run the project

### A0. What is what (30 seconds)
- **HexFence** = protects *who you pay*: a Safe Guard contract + website (Pay) + evidence explorer + extension + MCP tool.
- **Pramaan** = protects *which app and contract you sign in*: proves a release, then a browser extension checks the page against it.
- **Merged** = both run side by side in `ROOT`; `@hexfence/core` and `integration/` combine their answers into one verdict.

### A1. One-time setup
1. Open PowerShell in `ROOT`.
2. Tools (check each prints a version):
   ```powershell
   node -v                      # 20.19+ works for everything below; 22 only needed for Hardhat
   corepack pnpm@10.34.9 -v     # pnpm 10.34.9
   docker info | Select-String "Server Version"
   & "$HOME\.foundry\bin\forge.exe" --version     # Foundry 1.8.7 (already installed, not on PATH)
   ```
3. Put Foundry on PATH **for this PowerShell window** (needed by Pramaan commands):
   ```powershell
   $env:PATH = "$HOME\.foundry\bin;$env:PATH"
   ```
   (Git Bash: `export PATH="$HOME/.foundry/bin:$PATH"`.) `pnpm merged:up` does this by itself.
4. Public settings for the HexFence websites (no keys inside):
   ```powershell
   Copy-Item .env.public.example .env
   ```
5. Install both workspaces:
   ```powershell
   pnpm install
   pnpm pramaan:install
   ```
6. Compile the Guard contracts once (the HexFence tests read the compiled files). Your Node is 20, Hardhat needs 22, so use Docker:
   ```powershell
   docker run --rm -v "${PWD}/contracts:/src" node:22 sh -c "cp -r /src /c && cd /c && npm ci --legacy-peer-deps && npx hardhat compile && npx hardhat test && cp -r artifacts /src/artifacts"
   ```
   Expect `40 passing`. (If `contracts/artifacts` already exists, skip this.)
7. Build everything: `pnpm -r build` (HexFence apps) and `pnpm pramaan:build:extension` (Pramaan extension).

### A2. Check that it all works (5 minutes, no wallet, no chain)
```powershell
pnpm merged:test                  # 5 merged scenarios -> "All 5 merged scenarios passed."
pnpm -r test                      # HexFence: ~280 tests
pnpm pramaan:test                 # Pramaan: 259 pass (Foundry must be on PATH)
pnpm smoke:browser                # opens site/explorer/Pay in Chromium and loads BOTH extensions
pnpm smoke:pramaan-server         # Pramaan API decodes an unlimited approval
```

### A3. Run the HexFence websites
Three separate terminals (or one at a time):
```powershell
pnpm --filter @hexfence/site dev        # landing + guided demo   -> http://localhost:5173/  and /demo.html
pnpm --filter @hexfence/explorer dev    # evidence explorer
pnpm --filter @hexfence/pay dev         # Pay  -> open  /?safe=0x3BCc3969713778F3Ed26AE1490529eeBAD43FbD5
```
Vite prints each URL (the port changes if one is busy). On Pay: wait 25-40 s until it says **Nox reads active** and **v1.4.1 · 1/2 · Guard active**, paste recipient `0x4E185a3FC4B530244aB9ed0dE38167b403344120`, amount `0.0001`, **Check payment** → RED "Possible address poisoning". `0xcB0a33f755826307CcaC3f4b4833e7e19d38cEb6` → AMBER; `0x4E185e251Ac7fB83E9DE10723EAda46cadE74120` → GREEN. (Verified live with `pnpm smoke:pay-live`.) Pay talks to the real Sepolia network, so it needs internet.

### A4. Run the Pramaan demo (the three dApps)
```powershell
pnpm merged:up
```
It builds what is missing, forks Sepolia into a local chain, runs PROVE in the Docker sandbox (~3-5 min), deploys the contracts, registers three ENS names (each waits ~60 s), signs and activates three releases, and serves the apps. It is ready when you see `Local fork demo ready`. Leave the window open; Ctrl+C stops everything. (If Ctrl+C leaves things running, end `anvil` and `node` from Task Manager.)

| App | URL |
|---|---|
| VaultLab | http://localhost:5180 |
| MirrorYield | http://localhost:5182 (genuine) and http://127.0.0.1:5183 (lookalike origin) |
| PermitMarket | http://localhost:5184 (fixture: /__fixtures/leak.html) |
| Tracker log | http://127.0.0.1:5190/log |

In a **second** PowerShell (with Foundry on PATH), from `ROOT`:
```powershell
pnpm --dir pramaan pramaan verify http://localhost:5182     # -> release: VERIFIED, files: verified (green)
pnpm merged:verify http://localhost:5182                    # -> VERDICT: GREEN -> pass
pnpm --dir pramaan demo:tamper                              # really edits the served JavaScript
pnpm merged:verify http://localhost:5182                    # -> SITE_FILES_MISMATCH, VERDICT: RED
pnpm --dir pramaan demo:restore                             # put the original bytes back -> GREEN again
pnpm --dir pramaan demo:upgrade schedule                    # VaultLab: queue an upgrade to unaudited code
pnpm --dir pramaan demo:upgrade execute --advance           # apply it (advances the local clock)
pnpm merged:verify http://localhost:5180                    # -> contract row RED (impl-mismatch)
```
Add a payment to any `merged:verify`: `--to 0x4E185a3FC4B530244aB9ed0dE38167b403344120 --payee 0x4E185e251Ac7fB83E9DE10723EAda46cadE74120 --value 0.01` → recipient row RED.

### A5. Pramaan's other tools
```powershell
pnpm --dir pramaan --silent pramaan decode --method eth_sendTransaction --params '[{"from":"0x3BCc3969713778F3Ed26AE1490529eeBAD43FbD5","to":"0x1111111111111111111111111111111111111111","data":"0x095ea7b3...."}]'
pnpm --dir pramaan server           # API on http://127.0.0.1:8787   (healthz, v1/decode ...)
pnpm --dir pramaan dev:web          # developer dashboard http://localhost:5173  (pages: /verify, /demo, /dashboard)
```
(`dev:web` and the HexFence site both default to port 5173; Vite moves the second one to 5174, read the printed URL.)

## Part B. Run it as a Chrome extension

There are **two extensions**. Both are "unpacked" (not in the Chrome store).

### B1. Pramaan extension (verifies the app + contract, explains the request)
1. Build: `pnpm pramaan:build:extension` → folder `ROOT\pramaan\apps\extension\dist`.
2. Chrome → address bar `chrome://extensions` → switch **Developer mode** on (top right) → **Load unpacked** → choose that `dist` folder. "Pramaan" appears; click the puzzle icon → pin it.
3. **A wallet on the local chain (needs you):** install MetaMask or Rabby (official site only), make a **new test-only wallet**. Add a network: name `Pramaan local`, RPC `http://127.0.0.1:8545`, chain id `31337`, symbol `ETH`. Import a funded demo account: `pnpm merged:up` prints nothing secret; the demo user's key is in `pramaan/.pramaan/demo/keys.json` (field `user`, local-fork-only, never commit or share). Or use the tests' automated wallet instead (B3).
4. With `pnpm merged:up` running, open http://localhost:5182. Click the Pramaan icon: **Release verified**, rows Website / Contract / Action / Privacy green.
5. In MirrorYield press **Faucet**, then **Stake** → the wallet request is intercepted: a *Review before you sign* window shows the plain sentence, risk chips and the rows. **Continue to wallet** to sign or **Reject**.
6. Break it: `pnpm --dir pramaan demo:tamper`, reload the page, try Stake → popup **Mismatch** (red), signing is blocked. `demo:restore`, reload → green.
7. http://127.0.0.1:5183 → red "domain mismatch". http://localhost:5184 → PermitMarket → Buy → "Enable one-click buying" → the request is rated high risk and explained in English/हिन्दी/मराठी (language switch in the review window). `/__fixtures/leak.html` → Connect → "send all" → popup lists the host that got your address; press **Block**.
8. Settings (popup → Settings): language, RPC endpoints, Anon-RPC on/off (Sepolia only), strict blocking of undeclared third parties.

### B2. HexFence extension (reviews Safe payments on app.safe.global)
1. Build: `pnpm --filter @hexfence/extension build` → `ROOT\apps\extension\dist`.
2. `chrome://extensions` → Load unpacked → that `dist`. It is named "HexFence interception spike".
3. Open its **Details → Extension options**, fill: **Sepolia HTTPS RPC URL** (e.g. `https://ethereum-sepolia-rpc.publicnode.com`), **HexFence Guard address** `0xA061fB511D69e5c92E50E3BE5c789472d6f19748`, optionally the Arkiv publisher `0x36141ba063390f0d91Af7a5a9dF8dc1d80D699ec`. Save and allow the requested host.
4. **(needs you)** The real test on https://app.safe.global is item 1 of `10_REMAINING_WORK_HOWTO.md`. Until a person has done it, the extension is an unverified spike. With no options it shows GREY "CANNOT VERIFY" and never a pass.

### B3. See the extensions work without touching a wallet
```powershell
pnpm smoke:browser     # loads both extensions in Chromium, checks service worker + manifest
# Pramaan's own browser tests (demo from `pnpm merged:up` must be running):
cd pramaan
$env:PRAMAAN_EXPECT_BACKEND_OFF = "1"
pnpm --filter @pramaan/extension exec playwright test -c playwright.config.ts
```
Expect `13 passed, 1 skipped`. A Chromium window flashing is normal (it is headless; if not, nothing is wrong).

## Part C. Use the MCP tool (for AI agents)

MCP = Model Context Protocol, the standard way to give an AI app a tool. HexFence exposes one tool, `hexfence_check(recipient, approvedPayees[])`. It is **offline** (reads no chain, sends nothing) and answers GREEN / RED / AMBER / GREY.

### C1. Test it by hand (any shell, any folder)
```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"hexfence_check","arguments":{"recipient":"0x4E185a3FC4B530244aB9ed0dE38167b403344120","approvedPayees":["0x4E185e251Ac7fB83E9DE10723EAda46cadE74120"]}}}' \
 | pnpm --silent --dir "D:/Deven/1_Hackathon_proj/my/eth/final_hexfence/hexfence_merged" --filter @hexfence/mcp start
```
Last line: `{"level":"RED","reason":"resembles",...}`. Verified from a different working folder. **`--silent` is required**: the server speaks JSON on stdout, so pnpm must print nothing else.

### C2. Plug it into Claude Code
```powershell
claude mcp add hexfence -- pnpm --silent --dir "D:/Deven/1_Hackathon_proj/my/eth/final_hexfence/hexfence_merged" --filter @hexfence/mcp start
claude mcp list          # hexfence should show as connected
```
In a Claude Code session, `/mcp` lists it. Then ask: "Before paying 0xAAA… check it with hexfence_check against my approved payees 0xBBB…, 0xCCC…".

### C3. Plug it into Claude Desktop (or another MCP client)
Edit `claude_desktop_config.json` (Claude Desktop → Settings → Developer → Edit Config) and add:
```json
{
  "mcpServers": {
    "hexfence": {
      "command": "pnpm",
      "args": ["--silent", "--dir", "D:/Deven/1_Hackathon_proj/my/eth/final_hexfence/hexfence_merged", "--filter", "@hexfence/mcp", "start"]
    }
  }
}
```
Restart Claude Desktop. If it cannot find `pnpm`, replace `"command"` with the full path of `pnpm.cmd` (`where.exe pnpm`).

### C4. The rule to give the agent (system prompt)
> Before any transfer, call `hexfence_check` with the recipient and the account's approved payees. Never send on RED. On AMBER or GREY stop and ask a human: AMBER means "new, not cleared", never "safe". Never treat a missing or failed check as safe.

### C5. Other agent-friendly commands
- What a call does (approvals, permits): `pnpm --dir pramaan --silent pramaan decode --method … --params …` → ends with `level: info|low|medium|high|critical`; refuse high/critical without a human.
- Everything at once, as code: `import { checkTx } from "./integration/src/merged-check.js"`.
- Live page + contract + payment: `pnpm merged:verify <url> --to <addr> --payee <addr>`; exit code 0 only when GREEN.
- The on-chain Guard is the only protection that survives a lying screen. An agent that signs for a Safe should have HexFenceGuard enabled on that Safe (Pay → section 4 Setup).

## D. If something does not work
| Symptom | Fix |
|---|---|
| `forge`/`anvil` not found | `$env:PATH = "$HOME\.foundry\bin;$env:PATH"` |
| Pay says "Missing or invalid settings in the root .env" | `Copy-Item .env.public.example .env`, then rebuild/restart |
| `port … already in use` on `merged:up` | an old demo is running; end `anvil`/`node` processes, then retry |
| Extension shows nothing | reload the page after loading the extension; for Safe pages open a **new** tab |
| Red on a page you did not edit | check `pnpm --dir pramaan demo:tamper status`; run `demo:restore` |
| `shared` test fails on `contracts/artifacts` | run step A1.6 |
| PROVE says sandbox unavailable | start Docker Desktop; image `pramaan/sandbox:0.1.0` must exist (`docker images`) |

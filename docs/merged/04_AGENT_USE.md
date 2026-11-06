# 04. Using it as an AI agent

An agent that can sign or send payments needs the same pre-sign answer a person gets. Three ways, from simplest to deepest.

## 1. MCP tool `hexfence_check` (verified)

An MCP stdio server. One tool: `hexfence_check(recipient, approvedPayees[])`. Offline: it reads no chain data and does not check the evidence set.

Returns `GREEN approved`, `RED resembles` (a lookalike of an approved payee), `AMBER new` (not cleared, just not resembling), or `GREY` (cannot verify). **AMBER is not "safe".**

### Register it

From `hexfence_merged/` after `pnpm install`:

**Claude Code**
```bash
claude mcp add hexfence -- pnpm --silent --dir D:/Deven/1_Hackathon_proj/my/eth/final_hexfence/hexfence_merged --filter @hexfence/mcp start
```
**Claude Desktop / any MCP client** (`claude_desktop_config.json`):
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
`--silent` matters: the server speaks JSON-RPC on stdout, so nothing else may print there.

### Test it by hand (verified output)
```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"hexfence_check","arguments":{"recipient":"0x4E185a3FC4B530244aB9ed0dE38167b403344120","approvedPayees":["0x4E185e251Ac7fB83E9DE10723EAda46cadE74120"]}}}' \
 | pnpm --silent --filter @hexfence/mcp start
# -> {"level":"RED","reason":"resembles", ...}
```

### Rule to give the agent (put it in its system prompt)
> Before any transfer, call `hexfence_check` with the recipient and the account's approved payees. Never send on RED. On AMBER or GREY stop and ask a human; they mean "not cleared". Never treat an unknown result as safe.

## 2. `pramaan decode` as a pre-sign explainer (verified)

For *what a call does* (approvals, permits, NFT approvals, batched calls), not *who gets paid*:
```bash
cd pramaan
pnpm --silent pramaan decode --method eth_sendTransaction --params '[{"from":"0x…","to":"<token>","data":"0x095ea7b3…"}]' --chain 11155111
```
It prints the explanation in English, Hindi and Marathi and a `level:` line (info, low, medium, high, critical). An agent should refuse `high` and `critical` without a human. The decoder is deterministic: no AI guesses the meaning, and unknown functions are amber, never green.

## 3. The merged check as a library (verified)

`integration/src/merged-check.ts` exports `checkTx(tx, payees)`. It runs the HexFence recipient rule and the Pramaan decoder and returns one `CheckResult` from `@hexfence/core`:

```ts
import { checkTx } from "./integration/src/merged-check.js";
const { result, text } = await checkTx({ to, value, data }, approvedPayees);
if (result.overall === "red") throw new Error(`blocked: ${text}`);
if (result.hold !== "pass") askHuman(result.rows);
```
Hold values: `pass`, `confirm`, `block`. Rows carry stable codes (`RESEMBLES_APPROVED_PAYEE`, `PRAMAAN_UNLIMITED_APPROVAL`, …) so an agent can branch on them.

## What an agent still cannot get

- The on-chain Guard is the only enforcement that survives a lying screen. An agent that signs through a Safe should have **HexFenceGuard enabled on that Safe**.
- Pramaan's site-file and contract-bytecode rows exist only inside its browser extension today. A headless agent can run `pnpm pramaan verify <url>` (needs the target to publish a Pramaan release and an ENS RPC).
- A passing check is not an audit.

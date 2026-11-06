// One pre-sign check that uses BOTH projects:
//   HexFence  -> recipient row (fingerprint / lookalike rule, same as the on-chain Guard)
//   Pramaan   -> action row (deterministic decoder + risk rules, EN/HI/MR text)
// Both are folded into one verdict by @hexfence/core. Pure and offline: no chain, no wallet.
import { encodeFunctionData, erc20Abi, getAddress, maxUint256, parseEther, type Address, type Hex } from "viem";
import { combine, recipientRow, actionRow, type CheckRow, type HexFenceVerdict } from "../../packages/core/src/index.js";
import { decodeSafeCall, verdictFor } from "../../packages/shared/src/index.js";
import { assess, decodeTransaction, explain } from "../../pramaan/packages/decoder/src/index.js";

const SAFE = getAddress("0x3BCc3969713778F3Ed26AE1490529eeBAD43FbD5");
const GUARD = getAddress("0xA061fB511D69e5c92E50E3BE5c789472d6f19748");
const P = getAddress("0x4E185e251Ac7fB83E9DE10723EAda46cadE74120"); // approved payee
const L = getAddress("0x4E185a3FC4B530244aB9ed0dE38167b403344120"); // synthetic lookalike of P
const B = getAddress("0xcB0a33f755826307CcaC3f4b4833e7e19d38cEb6"); // brand-new supplier
const TOKEN = getAddress("0x1111111111111111111111111111111111111111");
const MARKET = getAddress("0x2222222222222222222222222222222222222222");

interface Scenario {
  name: string;
  tx: { to: Address; value?: bigint; data?: Hex };
  expect: { overall: CheckRow["level"]; hold: string; recipient?: CheckRow["level"]; action?: CheckRow["level"] };
}

const transfer = (to: Address): Hex => encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, 1000000n] });
const approve = (spender: Address, amt: bigint): Hex => encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amt] });

export const scenarios: Scenario[] = [
  { name: "ETH to the approved payee P", tx: { to: P, value: parseEther("0.01") }, expect: { overall: "green", hold: "pass", recipient: "green" } },
  { name: "ETH to lookalike L (address poisoning)", tx: { to: L, value: parseEther("0.01") }, expect: { overall: "red", hold: "confirm", recipient: "red" } },
  { name: "ETH to a new supplier B", tx: { to: B, value: parseEther("0.01") }, expect: { overall: "amber", hold: "confirm", recipient: "amber" } },
  { name: "ERC-20 transfer to lookalike L", tx: { to: TOKEN, data: transfer(L) }, expect: { overall: "red", hold: "confirm", recipient: "red" } },
  { name: "UNLIMITED approve to a marketplace", tx: { to: TOKEN, data: approve(MARKET, maxUint256) }, expect: { overall: "red", hold: "confirm", action: "red" } },
];

export async function checkTx(tx: Scenario["tx"], payees: Address[]) {
  const rows: CheckRow[] = [];
  const pay = decodeSafeCall({ to: tx.to, value: tx.value ?? 0n, data: tx.data ?? "0x", operation: 0 }, { safe: SAFE, guard: GUARD });
  if (pay.kind === "eth" || pay.kind === "erc20-transfer" || pay.kind === "erc20-transferFrom") {
    const v = verdictFor(pay, payees);
    const code = v.level === "GREEN" ? "APPROVED_PAYEE" : v.level === "RED" ? (v.reason === "listed" ? "LISTED_IN_EVIDENCE" : "RESEMBLES_APPROVED_PAYEE") : "NEW_RECIPIENT";
    rows.push(recipientRow(v.level as HexFenceVerdict, code, { recipient: v.level === "GREY" ? "" : v.recipient }));
  }
  const ctx = { chainId: 11155111, from: SAFE };
  const action = await decodeTransaction({ from: SAFE, to: tx.to, value: tx.value ?? 0n, data: tx.data ?? "0x", chainId: 11155111 }, ctx);
  const assessment = await assess(action, ctx);
  rows.push(actionRow(assessment.level, "PRAMAAN_" + (assessment.findings[0]?.code ?? "NO_FINDING"), {}));
  const text = explain(action, assessment, "en", ctx).headline;
  return { result: combine(rows), text };
}

async function main() {
  const assertMode = process.argv.includes("--assert");
  let failed = 0;
  for (const s of scenarios) {
    const { result, text } = await checkTx(s.tx, [P]);
    const find = (k: CheckRow["kind"]) => result.rows.find((r) => r.kind === k)?.level;
    const ok =
      result.overall === s.expect.overall && result.hold === s.expect.hold &&
      (!s.expect.recipient || find("recipient") === s.expect.recipient) &&
      (!s.expect.action || find("action") === s.expect.action);
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${s.name}\n      -> ${result.overall.toUpperCase()} / ${result.hold}   rows: ${result.rows.map((r) => `${r.kind}:${r.level}(${r.code})`).join(", ")}\n      Pramaan says: ${text}`);
  }
  console.log(failed ? `\n${failed} scenario(s) FAILED` : `\nAll ${scenarios.length} merged scenarios passed.`);
  if (assertMode && failed) process.exit(1);
}
main();

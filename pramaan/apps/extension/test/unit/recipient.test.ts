import { encodeFunctionData, erc20Abi, getAddress, pad, parseEther, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { matchSafeRequest, recipientRow, type RecipientClient } from "../../src/background/recipient.js";

const SAFE = getAddress("0x3BCc3969713778F3Ed26AE1490529eeBAD43FbD5");
const GUARD = getAddress("0xA061fB511D69e5c92E50E3BE5c789472d6f19748");
const P = getAddress("0x4E185e251Ac7fB83E9DE10723EAda46cadE74120"); // approved payee
const L = getAddress("0x4E185a3FC4B530244aB9ed0dE38167b403344120"); // lookalike of P
const B = getAddress("0xcB0a33f755826307CcaC3f4b4833e7e19d38cEb6"); // brand-new supplier
const TOKEN = getAddress("0x1111111111111111111111111111111111111111");

const typedData = (to: Address, value = 0n, data: Hex = "0x", operation = 0) =>
  JSON.stringify({
    primaryType: "SafeTx",
    domain: { chainId: 11155111, verifyingContract: SAFE },
    types: {},
    message: { to, value: value.toString(), data, operation, safeTxGas: "0", baseGas: "0", gasPrice: "0", gasToken: "0x0000000000000000000000000000000000000000", refundReceiver: "0x0000000000000000000000000000000000000000", nonce: "0" },
  });
const safeReq = (to: Address, value = 0n, data: Hex = "0x", operation = 0) => ({ method: "eth_signTypedData_v4", params: [SAFE, typedData(to, value, data, operation)] });

function client(opts: { guardActive?: boolean; payees?: Address[]; fail?: boolean } = {}): RecipientClient {
  const { guardActive = true, payees = [P], fail = false } = opts;
  return {
    getBlockNumber: async () => 1n,
    getStorageAt: async () => (fail ? undefined : pad(guardActive ? GUARD : "0x0", { size: 32 })),
    readContract: async () => payees,
  };
}

describe("matchSafeRequest", () => {
  it("recognises SafeTx typed data and execTransaction calls, and nothing else", () => {
    expect(matchSafeRequest("eth_signTypedData_v4", safeReq(L, 1n).params)?.kind).toBe("SafeTx");
    expect(matchSafeRequest("eth_sendTransaction", [{ to: SAFE, data: "0x6a761202" + "00".repeat(32) }])?.kind).toBe("execTransaction");
    expect(matchSafeRequest("eth_sendTransaction", [{ to: TOKEN, data: "0xa9059cbb" }])).toBeNull();
    expect(matchSafeRequest("personal_sign", ["0x00", SAFE])).toBeNull();
    expect(matchSafeRequest("eth_signTypedData_v4", [SAFE, "not json"])).toBeNull();
  });
});

describe("recipientRow (HexFence's rule inside the Pramaan review)", () => {
  const run = (req: { method: string; params: readonly unknown[] }, c = client()) => recipientRow({ ...req, guard: GUARD, client: c });

  it("a lookalike of an approved payee is RED and blocking, ETH and ERC-20 alike", async () => {
    const eth = await run(safeReq(L, parseEther("0.01")));
    expect(eth).toMatchObject({ id: "recipient", color: "red", key: "verify.recipient.resembles", blocking: true, params: { recipient: L, payee: P } });
    const erc20 = await run(safeReq(TOKEN, 0n, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [L, 5n] })));
    expect(erc20).toMatchObject({ color: "red", blocking: true });
  });
  it("an approved payee is green and a new supplier is amber (never blocking)", async () => {
    expect(await run(safeReq(P, 1n))).toMatchObject({ color: "green", key: "verify.recipient.approved", blocking: false });
    expect(await run(safeReq(B, 1n))).toMatchObject({ color: "amber", key: "verify.recipient.new", blocking: false });
  });
  it("says so when the Guard is not active, so nothing on-chain will stop it", async () => {
    const r = await run(safeReq(L, 1n), client({ guardActive: false }));
    expect(r?.color).toBe("red");
    expect(r?.detail).toMatch(/not active/);
  });
  it("a delegatecall or an unsupported call is grey, never green", async () => {
    expect(await run(safeReq(B, 0n, "0x", 1))).toMatchObject({ color: "neutral", key: "verify.recipient.delegatecall" });
    expect(await run(safeReq(TOKEN, 0n, ("0x095ea7b3" + "00".repeat(64)) as Hex))).toMatchObject({ color: "neutral", key: "verify.recipient.unsupported" });
  });
  it("unknown is never green: unreadable payees, no RPC or no Guard for the chain", async () => {
    expect((await run(safeReq(P, 1n), client({ fail: true })))?.color).toBe("amber");
    expect(await recipientRow({ ...safeReq(P, 1n), guard: GUARD, client: undefined })).toMatchObject({ color: "amber", key: "verify.recipient.unreadable" });
    expect(await recipientRow({ ...safeReq(P, 1n), guard: undefined, client: client() })).toMatchObject({ color: "neutral", key: "verify.recipient.no-guard" });
  });
  it("a request that is not a Safe payment gets no Recipient row", async () => {
    expect(await run({ method: "eth_sendTransaction", params: [{ to: TOKEN, data: "0x095ea7b3" }] })).toBeNull();
  });
});

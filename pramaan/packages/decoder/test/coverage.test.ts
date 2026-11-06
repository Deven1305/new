import { concatHex, encodeAbiParameters, encodeFunctionData, encodePacked, maxUint256, parseAbi, toFunctionSelector, toHex, zeroAddress, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import {
  analyzeRequest,
  BLOCKING_CODES,
  contradictsRelease,
  erc1155Abi,
  erc20Abi,
  erc721Abi,
  GUARDED_METHODS,
  MAX_CALLS,
  multicallAbi,
  multiSendAbi,
  parseMultiSend,
  PERMIT2_ADDRESS,
  RISK_ORDER,
  safeAbi,
  SAFE_MULTISEND,
  SELECTORS,
  type DecodeContext,
  type RequestAnalysis,
  type TokenInfo,
} from "../src/index.js";

const TOKEN = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as const;
const NFT = "0x2222222222222222222222222222222222222222" as const;
const MULTI = "0x7777777777777777777777777777777777777777" as const; // ERC-1155
const MARKET = "0x3333333333333333333333333333333333333333" as const;
const ATTACKER = "0x4444444444444444444444444444444444444444" as const;
const EOA = "0x5555555555555555555555555555555555555555" as const;
const ME = "0x6666666666666666666666666666666666666666" as const;
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
const SAFE = "0x8888888888888888888888888888888888888888" as const;
const NOW = 1_800_000_000; // 2027-01-15

const tokens: Record<string, TokenInfo> = {
  [TOKEN.toLowerCase()]: { address: TOKEN, kind: "erc20", symbol: "pUSD", decimals: 6 },
  [NFT.toLowerCase()]: { address: NFT, kind: "erc721", symbol: "pNFT" },
  [MULTI.toLowerCase()]: { address: MULTI, kind: "erc1155", symbol: "ITEM" },
};

const base: DecodeContext = {
  chainId: 11155111,
  from: ME,
  origin: "http://localhost:5184",
  now: NOW,
  tokenInfo: async (a) => tokens[a.toLowerCase()] ?? null,
  isContract: async (a) => a.toLowerCase() !== EOA.toLowerCase() && a.toLowerCase() !== ME.toLowerCase(),
};
const release = {
  ensName: "permitmarket.kosh.eth",
  chainIds: [11155111],
  contracts: [
    { address: TOKEN, chainId: 11155111, label: "pUSD" },
    { address: MARKET, chainId: 11155111, label: "Marketplace" },
    { address: NFT, chainId: 11155111, label: "pNFT" },
  ],
};
const withRelease: DecodeContext = { ...base, release, labels: { [MARKET.toLowerCase()]: "Marketplace" } };

const tx = (to: string | null, data: string, value = "0x0") => [{ from: ME, to, data, value }];
const codes = (r: RequestAnalysis) => r.assessment.findings.map((f) => f.code).sort();
const approve = (spender: string, amount: bigint) => encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender as Hex, amount] });

function permitTd(over: { value?: unknown; deadline?: unknown; spender?: unknown; chainId?: unknown; verifyingContract?: unknown } = {}) {
  return {
    domain: { name: "Pramaan Demo USD", version: "1", chainId: over.chainId ?? 11155111, verifyingContract: over.verifyingContract ?? TOKEN },
    primaryType: "Permit",
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    message: { owner: ME, spender: over.spender ?? MARKET, value: over.value ?? "25000000", nonce: "0", deadline: over.deadline ?? String(NOW + 1200) },
  };
}

describe("selectors added for batches", () => {
  it("match their signatures", () => {
    expect(toFunctionSelector("tryAggregate(bool,(address,bytes)[])")).toBe(SELECTORS.tryAggregate);
    expect(toFunctionSelector("blockAndAggregate((address,bytes)[])")).toBe(SELECTORS.blockAndAggregate);
    expect(toFunctionSelector("tryBlockAndAggregate(bool,(address,bytes)[])")).toBe(SELECTORS.tryBlockAndAggregate);
    expect(toFunctionSelector("multicall(bytes32,bytes[])")).toBe(SELECTORS.multicallBlockhash);
    expect(toFunctionSelector("multiSend(bytes)")).toBe(SELECTORS.multiSend);
    expect(GUARDED_METHODS).toContain("eth_signTransaction");
  });
});

describe("ERC-20", () => {
  it("unlimited = max uint or anything >= 2^255", async () => {
    for (const amount of [maxUint256, 2n ** 255n]) {
      const r = await analyzeRequest("eth_sendTransaction", tx(TOKEN, approve(MARKET, amount)), base);
      expect(r.action).toMatchObject({ kind: "erc20-approve", unlimited: true });
      expect(r.assessment.level).toBe("high");
      expect(r.explanations.en.headline).toBe("Give 0x3333…3333 unlimited permission to spend your pUSD");
    }
    const below = await analyzeRequest("eth_sendTransaction", tx(TOKEN, approve(MARKET, 2n ** 255n - 1n)), base);
    expect(below.action).toMatchObject({ unlimited: false });
  });

  it("flags an approval that covers the whole balance when the balance is known", async () => {
    const ctx: DecodeContext = { ...base, balanceOf: async () => 40_000_000n };
    const large = await analyzeRequest("eth_sendTransaction", tx(TOKEN, approve(MARKET, 40_000_000n)), ctx);
    expect(codes(large)).toEqual(["LARGE_APPROVAL"]);
    expect(large.assessment.level).toBe("medium");
    expect(large.explanations.en.risks[0]!.text).toContain("whole current balance (40 pUSD)");
    expect(large.explanations.hi.risks[0]!.text).toContain("40 pUSD");
    const small = await analyzeRequest("eth_sendTransaction", tx(TOKEN, approve(MARKET, 5_000_000n)), ctx);
    expect(codes(small)).toEqual([]);
    expect(small.assessment.level).toBe("info");
    // A failing balance read is ignored, never treated as "large".
    const failing = await analyzeRequest("eth_sendTransaction", tx(TOKEN, approve(MARKET, 5n)), { ...base, balanceOf: async () => { throw new Error("rpc down"); } });
    expect(codes(failing)).toEqual([]);
  });

  it("decodes increaseAllowance and transferFrom", async () => {
    const inc = await analyzeRequest("eth_sendTransaction", tx(TOKEN, encodeFunctionData({ abi: erc20Abi, functionName: "increaseAllowance", args: [MARKET, maxUint256] })), base);
    expect(inc.action).toMatchObject({ kind: "erc20-increase-allowance", unlimited: true });
    expect(codes(inc)).toEqual(["UNLIMITED_APPROVAL"]);
    const tf = await analyzeRequest("eth_sendTransaction", tx(TOKEN, encodeFunctionData({ abi: erc20Abi, functionName: "transferFrom", args: [ME, ATTACKER, 7_000_000n] })), base);
    expect(tf.action).toMatchObject({ kind: "token-transfer-from", amount: 7_000_000n });
    expect(tf.explanations.en.headline).toBe("Move 7 pUSD from 0x6666…6666 to 0x4444…4444");
  });

  it("reports truncated approve calldata as malformed, not as an approval", async () => {
    const r = await analyzeRequest("eth_sendTransaction", tx(TOKEN, approve(MARKET, 1n).slice(0, 40)), base);
    expect(r.action).toMatchObject({ kind: "unknown", malformed: true, reasonKey: "reason.abi-mismatch" });
    expect(codes(r)).toEqual(["MALFORMED_REQUEST", "UNKNOWN_ACTION"]);
    expect(r.explanations.mr.details[0]).toContain("approve");
  });
});

describe("release checks", () => {
  it("an approval to a contract outside the release is red and blocking", async () => {
    const r = await analyzeRequest("eth_sendTransaction", tx(TOKEN, approve(ATTACKER, 10_000_000n)), withRelease);
    expect(codes(r)).toEqual(["SPENDER_NOT_IN_RELEASE"]);
    expect(r.assessment.level).toBe("high");
    expect(contradictsRelease(r.assessment)).toBe(true);
    expect(r.explanations.en.risks[0]!.text).toContain("not one of the contracts in this site's signed release");
    const ok = await analyzeRequest("eth_sendTransaction", tx(TOKEN, approve(MARKET, 10_000_000n)), withRelease);
    expect(codes(ok)).toEqual([]);
    expect(ok.explanations.en.headline).toBe("Allow Marketplace (0x3333…3333) to spend up to 10 pUSD");
  });

  it("the unlimited approve(marketplace, max) is high risk but does not contradict the release", async () => {
    const r = await analyzeRequest("eth_sendTransaction", tx(TOKEN, approve(MARKET, maxUint256)), withRelease);
    expect(codes(r)).toEqual(["UNLIMITED_APPROVAL"]);
    expect(contradictsRelease(r.assessment)).toBe(false);
  });

  it("checks NFT operators and permit spenders too, but never a revoke", async () => {
    const op = await analyzeRequest("eth_sendTransaction", tx(NFT, encodeFunctionData({ abi: erc721Abi, functionName: "setApprovalForAll", args: [ATTACKER, true] })), withRelease);
    expect(codes(op)).toEqual(["APPROVE_ALL_NFTS", "SPENDER_NOT_IN_RELEASE"]);
    const revoke = await analyzeRequest("eth_sendTransaction", tx(NFT, encodeFunctionData({ abi: erc721Abi, functionName: "setApprovalForAll", args: [ATTACKER, false] })), withRelease);
    expect(codes(revoke)).toEqual(["REVOKE"]);
    const permit = await analyzeRequest("eth_signTypedData_v4", [ME, JSON.stringify(permitTd({ spender: ATTACKER }))], withRelease);
    expect(codes(permit)).toContain("SPENDER_NOT_IN_RELEASE");
  });

  it("a wrong chain id versus the release is red and blocking", async () => {
    const r = await analyzeRequest("eth_sendTransaction", tx(TOKEN, approve(MARKET, 1n)), { ...withRelease, chainId: 1 });
    expect(codes(r)).toContain("WRONG_CHAIN");
    expect(contradictsRelease(r.assessment)).toBe(true);
    expect(r.explanations.hi.risks.find((x) => x.code === "WRONG_CHAIN")!.text).toContain("चेन 1");
    const typed = await analyzeRequest("eth_signTypedData_v4", [ME, JSON.stringify(permitTd({ chainId: 1 }))], withRelease);
    expect(codes(typed)).toEqual(expect.arrayContaining(["WRONG_CHAIN", "TYPED_DATA_CHAIN_MISMATCH"]));
    const calls = await analyzeRequest("wallet_sendCalls", [{ version: "2.0.0", chainId: "0x1", from: ME, calls: [{ to: TOKEN, data: approve(MARKET, 1n) }] }], withRelease);
    expect(calls.chainId).toBe(1);
    expect(codes(calls)).toContain("WRONG_CHAIN");
    // Plain messages are not bound to a chain.
    const msg = await analyzeRequest("personal_sign", [toHex("hello"), ME], { ...withRelease, chainId: 1 });
    expect(codes(msg)).toEqual([]);
  });

  it("transfers to an address outside the release are amber; to yourself they are fine", async () => {
    const out = await analyzeRequest("eth_sendTransaction", tx(TOKEN, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [ATTACKER, 1n] })), withRelease);
    expect(codes(out)).toEqual(["RECIPIENT_NOT_IN_RELEASE"]);
    expect(out.assessment.level).toBe("medium");
    const self = await analyzeRequest("eth_sendTransaction", tx(TOKEN, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [ME, 1n] })), withRelease);
    expect(codes(self)).toEqual([]);
    const eth = await analyzeRequest("eth_sendTransaction", tx(EOA, "0x", "0x1"), withRelease);
    expect(codes(eth)).toEqual(["RECIPIENT_NOT_IN_RELEASE"]);
  });
});

describe("ERC-721 and ERC-1155", () => {
  it("decodes ERC-721 approve and safeTransferFrom (with and without data)", async () => {
    const ap = await analyzeRequest("eth_sendTransaction", tx(NFT, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [EOA, 9n] })), base);
    expect(ap.action).toMatchObject({ kind: "nft-approve", tokenId: 9n });
    expect(codes(ap)).toEqual(["APPROVAL_TO_EOA"]);
    expect(ap.explanations.en.headline).toBe("Allow 0x5555…5555 to transfer your NFT #9 of pNFT");
    for (const data of [
      encodeFunctionData({ abi: erc721Abi, functionName: "safeTransferFrom", args: [ME, ATTACKER, 3n] }),
      encodeFunctionData({ abi: erc721Abi, functionName: "safeTransferFrom", args: [ME, ATTACKER, 3n, "0x1234"] }),
    ]) {
      const r = await analyzeRequest("eth_sendTransaction", tx(NFT, data), base);
      expect(r.action).toMatchObject({ kind: "nft-transfer", tokenId: 3n, amount: null });
    }
  });

  it("decodes ERC-1155 setApprovalForAll and safeBatchTransferFrom", async () => {
    const all = await analyzeRequest("eth_sendTransaction", tx(MULTI, encodeFunctionData({ abi: erc721Abi, functionName: "setApprovalForAll", args: [MARKET, true] })), base);
    expect(all.explanations.en.headline).toBe("Give 0x3333…3333 control of ALL your NFTs in ITEM");
    const batch = await analyzeRequest(
      "eth_sendTransaction",
      tx(MULTI, encodeFunctionData({ abi: erc1155Abi, functionName: "safeBatchTransferFrom", args: [ME, ATTACKER, [1n, 2n], [10n, 20n], "0x"] })),
      base,
    );
    expect(batch.action).toMatchObject({ kind: "nft-batch-transfer", ids: [1n, 2n], amounts: [10n, 20n] });
    expect(batch.explanations.en.headline).toBe("Transfer 2 kinds of NFT from ITEM to 0x4444…4444");
    expect(batch.explanations.en.details).toEqual(["Token IDs and amounts: #1 × 10, #2 × 20"]);
    expect(batch.explanations.mr.headline).toContain("2 प्रकारचे NFT");
  });

  it("rejects an ERC-1155 batch whose id and amount lists differ in length", async () => {
    const good = encodeFunctionData({ abi: erc1155Abi, functionName: "safeBatchTransferFrom", args: [ME, ATTACKER, [1n, 2n], [10n], "0x"] });
    const r = await analyzeRequest("eth_sendTransaction", tx(MULTI, good), base);
    expect(r.action).toMatchObject({ kind: "unknown", malformed: true });
  });
});

describe("native value and contract creation", () => {
  it("explains a native transfer and a value-carrying unknown call", async () => {
    const r = await analyzeRequest("eth_sendTransaction", tx(EOA, "0x", "0x2386f26fc10000"), base);
    expect(r.explanations.en.headline).toBe("Send 0.01 ETH to 0x5555…5555");
    const u = await analyzeRequest("eth_sendTransaction", tx(EOA, "0xdeadbeef", "0x2386f26fc10000"), base);
    expect(u.explanations.en.details).toContain("Also sends 0.01 ETH");
  });

  it("decodes contract creation (to missing, null or empty) as a medium-risk deployment", async () => {
    for (const to of [undefined, null, ""]) {
      const r = await analyzeRequest("eth_sendTransaction", [{ from: ME, to, data: "0x6080604052", value: "0x0" }], base);
      expect(r.action).toMatchObject({ kind: "contract-deployment", bytecodeSize: 5 });
      expect(codes(r)).toEqual(["CONTRACT_DEPLOYMENT"]);
      expect(r.explanations.en.headline).toBe("Create a new contract (5 bytes of code)");
      expect(r.explanations.hi.headline).toBe("एक नया कॉन्ट्रैक्ट बनाएँ (5 बाइट कोड)");
    }
    const empty = await analyzeRequest("eth_sendTransaction", [{ from: ME, data: "0x" }], base);
    expect(empty.action).toMatchObject({ kind: "unknown", malformed: true });
  });
});

describe("EIP-712: EIP-2612 and Permit2", () => {
  it("a bounded short-lived permit is medium, an unlimited one high", async () => {
    const r = await analyzeRequest("eth_signTypedData_v4", [ME, JSON.stringify(permitTd())], withRelease);
    expect(r.action).toMatchObject({ kind: "permit", standard: "eip2612", spender: MARKET, chainId: 11155111 });
    expect(codes(r)).toEqual(["OFFCHAIN_PERMIT"]);
    expect(r.explanations.en.headline).toContain("Marketplace (0x3333…3333) spend up to 25 pUSD");
    const max = await analyzeRequest("eth_signTypedData_v4", [ME, JSON.stringify(permitTd({ value: maxUint256.toString() }))], withRelease);
    expect(codes(max)).toEqual(["UNLIMITED_PERMIT"]);
  });

  it("a far-future deadline is flagged as long-lived and shown as 'never expires'", async () => {
    const r = await analyzeRequest("eth_signTypedData_v4", [ME, JSON.stringify(permitTd({ deadline: maxUint256.toString() }))], withRelease);
    expect(codes(r)).toEqual(["LONG_DEADLINE", "OFFCHAIN_PERMIT"]);
    expect(r.explanations.en.headline).toContain("valid until never expires");
    expect(r.explanations.en.risks.find((x) => x.code === "LONG_DEADLINE")!.text).toContain("This signature stays valid until never expires");
    const twoYears = await analyzeRequest("eth_signTypedData_v4", [ME, JSON.stringify(permitTd({ deadline: String(NOW + 2 * 365 * 86400) }))], withRelease);
    expect(codes(twoYears)).toContain("LONG_DEADLINE");
    const expired = await analyzeRequest("eth_signTypedData_v4", [ME, JSON.stringify(permitTd({ deadline: String(NOW - 10) }))], withRelease);
    expect(codes(expired)).toContain("EXPIRED_PERMIT");
  });

  it("accepts the payload as an object and in reversed param order", async () => {
    const obj = await analyzeRequest("eth_signTypedData_v4", [ME, permitTd()], base);
    expect(obj.action.kind).toBe("permit");
    const reversed = await analyzeRequest("eth_signTypedData_v4", [JSON.stringify(permitTd()), ME], base);
    expect(reversed.action.kind).toBe("permit");
  });

  it("malformed permits are red with a reason, never a crash", async () => {
    const cases = [
      permitTd({ value: "-1" }),
      permitTd({ value: (2n ** 256n).toString() }),
      permitTd({ spender: "0x1234" }),
      permitTd({ deadline: "soon" }),
      permitTd({ verifyingContract: "not an address" }),
      permitTd({ chainId: "zero" }),
    ];
    for (const td of cases) {
      const r = await analyzeRequest("eth_signTypedData_v4", [ME, JSON.stringify(td)], base);
      expect(r.action).toMatchObject({ kind: "unknown", subject: "signature", malformed: true });
      expect(r.assessment.level).toBe("high");
      expect(r.explanations.en.details[0]).toMatch(/^Reason: /);
    }
  });

  const p2 = (primaryType: string, message: Record<string, unknown>, verifyingContract: string = PERMIT2_ADDRESS) =>
    JSON.stringify({ domain: { name: "Permit2", chainId: 11155111, verifyingContract }, primaryType, types: { EIP712Domain: [] }, message });

  it("decodes PermitSingle with its allowance expiration", async () => {
    const r = await analyzeRequest(
      "eth_signTypedData_v4",
      [ME, p2("PermitSingle", { details: { token: TOKEN, amount: "5000000", expiration: "281474976710655", nonce: "0" }, spender: MARKET, sigDeadline: String(NOW + 600) })],
      withRelease,
    );
    expect(r.action).toMatchObject({ kind: "permit", standard: "permit2-single", expiration: 281474976710655n });
    expect(codes(r)).toEqual(["LONG_DEADLINE", "OFFCHAIN_PERMIT"]);
    expect(r.explanations.en.details).toContain("The allowance itself lasts until never expires");
  });

  it("decodes PermitBatch, PermitTransferFrom, PermitBatchTransferFrom and the witness variant", async () => {
    const batch = await analyzeRequest(
      "eth_signTypedData_v4",
      [ME, p2("PermitBatch", { details: [{ token: TOKEN, amount: (2n ** 160n - 1n).toString(), expiration: "0", nonce: "1" }, { token: NFT, amount: "1", expiration: "0", nonce: "1" }], spender: MARKET, sigDeadline: String(NOW + 600) })],
      base,
    );
    expect(batch.action).toMatchObject({ kind: "permit", standard: "permit2-batch" });
    expect(codes(batch)).toEqual(["UNLIMITED_PERMIT"]);
    const one = await analyzeRequest("eth_signTypedData_v4", [ME, p2("PermitTransferFrom", { permitted: { token: TOKEN, amount: "100" }, spender: MARKET, nonce: "5", deadline: String(NOW + 600) })], base);
    expect(one.action).toMatchObject({ kind: "permit", standard: "permit2-transfer" });
    const many = await analyzeRequest(
      "eth_signTypedData_v4",
      [ME, p2("PermitBatchTransferFrom", { permitted: [{ token: TOKEN, amount: "100" }, { token: TOKEN, amount: maxUint256.toString() }], spender: MARKET, nonce: "5", deadline: String(NOW + 600) })],
      base,
    );
    expect(codes(many)).toEqual(["UNLIMITED_PERMIT"]);
    const witness = await analyzeRequest(
      "eth_signTypedData_v4",
      [ME, p2("PermitWitnessTransferFrom", { permitted: { token: TOKEN, amount: "100" }, spender: MARKET, nonce: "5", deadline: String(NOW + 600), witness: { order: "x" } })],
      base,
    );
    expect(witness.action).toMatchObject({ standard: "permit2-witness-transfer" });
  });

  it("Permit2 types for a contract that is not Permit2 are unknown (amber), malformed details red", async () => {
    const fake = await analyzeRequest("eth_signTypedData_v4", [ME, p2("PermitSingle", { details: { token: TOKEN, amount: "1", expiration: "0", nonce: "0" }, spender: MARKET, sigDeadline: "1" }, ATTACKER)], base);
    expect(fake.action).toMatchObject({ kind: "unknown", reasonKey: "reason.typed-not-permit2" });
    expect(fake.assessment.level).toBe("medium");
    const broken = await analyzeRequest("eth_signTypedData_v4", [ME, p2("PermitBatch", { details: "nope", spender: MARKET, sigDeadline: "1" })], base);
    expect(broken.action).toMatchObject({ kind: "unknown", malformed: true });
    expect(broken.assessment.level).toBe("high");
  });

  it("unknown typed data is amber and shows its domain", async () => {
    const td = { domain: { name: "Some DEX", chainId: 11155111, verifyingContract: MARKET }, primaryType: "Order", types: { Order: [{ name: "x", type: "uint256" }] }, message: { x: "1" } };
    const r = await analyzeRequest("eth_signTypedData_v4", [ME, JSON.stringify(td)], base);
    expect(r.action.kind).toBe("unknown");
    expect(r.assessment.level).toBe("medium");
    expect(r.explanations.en.details).toEqual(
      expect.arrayContaining(["Typed-data type: Order", "Signed for: Some DEX", `Contract named in the signature: ${MARKET}`, "Chain ID: 11155111"]),
    );
    const legacy = await analyzeRequest("eth_signTypedData", [[{ type: "string", name: "m", value: "hi" }], ME], base);
    expect(legacy.action).toMatchObject({ kind: "unknown", reasonKey: "reason.typed-legacy" });
  });
});

describe("personal_sign and SIWE", () => {
  const siwe = (domain: string, uri: string, address: string = ME, extra: string[] = []) =>
    toHex(
      [
        `${domain} wants you to sign in with your Ethereum account:`,
        address,
        "",
        "Sign in to PermitMarket.",
        "",
        `URI: ${uri}`,
        "Version: 1",
        "Chain ID: 11155111",
        "Nonce: abcdef12",
        "Issued At: 2026-11-04T10:00:00Z",
        ...extra,
      ].join("\n"),
    );

  it("a matching SIWE request has no findings", async () => {
    const r = await analyzeRequest("personal_sign", [siwe("localhost:5184", "http://localhost:5184/login"), ME], base);
    expect(r.action).toMatchObject({ kind: "siwe", domain: "localhost:5184" });
    expect(codes(r)).toEqual([]);
    expect(r.explanations.en.details).toContain("Sign-in address: http://localhost:5184/login");
  });

  it("domain or URI pointing elsewhere is red", async () => {
    const d = await analyzeRequest("personal_sign", [siwe("localhost:5183", "http://localhost:5184"), ME], base);
    expect(codes(d)).toEqual(["SIWE_DOMAIN_MISMATCH"]);
    const u = await analyzeRequest("personal_sign", [siwe("localhost:5184", "https://evil.example/login"), ME], base);
    expect(codes(u)).toEqual(["SIWE_URI_MISMATCH"]);
    expect(u.assessment.level).toBe("high");
    expect(u.explanations.mr.risks[0]!.text).toContain("https://evil.example/login");
  });

  it("a different account in the message is amber", async () => {
    const r = await analyzeRequest("personal_sign", [siwe("localhost:5184", "http://localhost:5184", EOA), ME], base);
    expect(codes(r)).toEqual(["SIWE_ADDRESS_MISMATCH"]);
  });

  it("a SIWE-looking message that does not parse is never shown as harmless text", async () => {
    const text = ["evil.example wants you to sign in with your Ethereum account:", ME, "", "URI: https://evil.example"].join("\n");
    const r = await analyzeRequest("personal_sign", [toHex(text), ME], base);
    expect(r.action.kind).toBe("siwe-invalid");
    expect(codes(r)).toEqual(["SIWE_DOMAIN_MISMATCH", "SIWE_MALFORMED"]);
  });

  it("handles reversed params and messages that look like addresses", async () => {
    const reversed = await analyzeRequest("personal_sign", [ME, toHex("hello")], base);
    expect(reversed.action).toEqual({ kind: "message", text: "hello" });
    const addrLike = await analyzeRequest("personal_sign", [EOA, ME], base);
    expect(addrLike.action.kind).not.toBe("siwe");
  });

  it("eth_sign is critical; non-string messages are malformed", async () => {
    const r = await analyzeRequest("eth_sign", [ME, `0x${"cd".repeat(32)}`], base);
    expect(codes(r)).toEqual(["ETH_SIGN"]);
    expect(r.assessment.level).toBe("critical");
    const bad = await analyzeRequest("personal_sign", [{ x: 1 }, ME], base);
    expect(bad.action).toMatchObject({ kind: "unknown", malformed: true });
    expect(bad.assessment.level).toBe("high");
  });
});

describe("batches", () => {
  const approveMax = approve(ATTACKER, maxUint256);
  const transferOk = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [MARKET, 1n] });

  it("wallet_sendCalls (EIP-5792) batches are decoded call by call", async () => {
    const r = await analyzeRequest("wallet_sendCalls", [{ version: "2.0.0", chainId: "0xaa36a7", from: ME, atomicRequired: true, calls: [{ to: TOKEN, data: approve(MARKET, 5_000_000n) }, { to: MARKET, data: "0x12345678" }] }], withRelease);
    expect(r.action).toMatchObject({ kind: "batch", source: "wallet_sendCalls" });
    expect(codes(r)).toEqual(["UNPARSED_BATCH"]);
    expect(r.explanations.en.details[0]).toBe("1. Allow Marketplace (0x3333…3333) to spend up to 5 pUSD");
    const empty = await analyzeRequest("wallet_sendCalls", [{ calls: [] }], base);
    expect(empty.action).toMatchObject({ kind: "unknown", malformed: true });
    const garbage = await analyzeRequest("wallet_sendCalls", ["nope"], base);
    expect(garbage.action.kind).toBe("unknown");
  });

  it("decodes Multicall3 tryAggregate and blockAndAggregate", async () => {
    for (const functionName of ["tryAggregate", "tryBlockAndAggregate"] as const) {
      const data = encodeFunctionData({ abi: multicallAbi, functionName, args: [false, [{ target: TOKEN, callData: approveMax }]] });
      const r = await analyzeRequest("eth_sendTransaction", tx(MULTICALL3, data), base);
      expect(r.action).toMatchObject({ kind: "batch", source: "multicall3" });
      expect(codes(r)).toEqual(["UNLIMITED_APPROVAL"]);
    }
    const bAgg = encodeFunctionData({ abi: multicallAbi, functionName: "blockAndAggregate", args: [[{ target: TOKEN, callData: transferOk }]] });
    expect((await analyzeRequest("eth_sendTransaction", tx(MULTICALL3, bAgg), base)).action.kind).toBe("batch");
  });

  it("decodes Uniswap-style multicall(bytes[]) and multicall(uint256,bytes[]) against the contract itself", async () => {
    const plain = encodeFunctionData({ abi: multicallAbi, functionName: "multicall", args: [[approveMax, transferOk]] });
    const r = await analyzeRequest("eth_sendTransaction", tx(TOKEN, plain), base);
    expect(r.action).toMatchObject({ kind: "batch", source: "multicall", targets: [TOKEN, TOKEN] });
    expect(codes(r)).toEqual(["UNLIMITED_APPROVAL"]);
    const deadline = encodeFunctionData({ abi: multicallAbi, functionName: "multicall", args: [123n, [transferOk]] });
    expect((await analyzeRequest("eth_sendTransaction", tx(TOKEN, deadline), base)).action.kind).toBe("batch");
  });

  it("recurses into nested batches and lists every call", async () => {
    const inner = encodeFunctionData({ abi: multicallAbi, functionName: "aggregate3", args: [[{ target: TOKEN, allowFailure: false, callData: approveMax }]] });
    const outer = encodeFunctionData({ abi: multicallAbi, functionName: "aggregate", args: [[{ target: MULTICALL3, callData: inner }, { target: TOKEN, callData: transferOk }]] });
    const r = await analyzeRequest("eth_sendTransaction", tx(MULTICALL3, outer), base);
    expect(codes(r)).toEqual(["UNLIMITED_APPROVAL"]);
    expect(r.explanations.en.details).toEqual([
      "1. Run 1 actions in one transaction",
      "1.1. Give 0x4444…4444 unlimited permission to spend your pUSD",
      "2. Send 0.000001 pUSD to 0x3333…3333",
    ]);
  });

  it("stops at the depth limit and calls the rest unparsed (amber), never green", async () => {
    let data: Hex = transferOk;
    let target: Hex = TOKEN;
    for (let i = 0; i < 8; i++) {
      data = encodeFunctionData({ abi: multicallAbi, functionName: "aggregate", args: [[{ target, callData: data }]] });
      target = MULTICALL3;
    }
    const r = await analyzeRequest("eth_sendTransaction", tx(MULTICALL3, data), base);
    expect(codes(r)).toContain("UNPARSED_BATCH");
    expect(RISK_ORDER[r.assessment.level]).toBeGreaterThanOrEqual(RISK_ORDER.medium);
    expect(JSON.stringify(r.action, (_k, v) => (typeof v === "bigint" ? String(v) : v))).toContain("reason.too-deep");
    expect(r.explanations.en.details.at(-1)).toMatch(/Unable to confidently interpret/);
  });

  it("refuses batches above the call budget", async () => {
    const calls = Array.from({ length: MAX_CALLS + 1 }, () => ({ target: TOKEN, callData: transferOk }));
    const r = await analyzeRequest("eth_sendTransaction", tx(MULTICALL3, encodeFunctionData({ abi: multicallAbi, functionName: "aggregate", args: [calls] })), base);
    expect(r.action).toMatchObject({ kind: "unknown", reasonKey: "reason.too-many-calls" });
  });

  it("flags inner calls to contracts outside the release", async () => {
    const data = encodeFunctionData({ abi: multicallAbi, functionName: "aggregate3", args: [[{ target: ATTACKER, allowFailure: false, callData: "0x12345678" }]] });
    const r = await analyzeRequest("eth_sendTransaction", tx(MARKET, data), withRelease);
    expect(codes(r)).toEqual(expect.arrayContaining(["CALL_TARGET_NOT_IN_RELEASE", "UNPARSED_BATCH"]));
  });
});

describe("Safe MultiSend", () => {
  const entry = (operation: number, to: Hex, value: bigint, data: Hex) => encodePacked(["uint8", "address", "uint256", "uint256", "bytes"], [operation, to, value, BigInt((data.length - 2) / 2), data]);
  const exec = (to: Hex, data: Hex, operation: number) =>
    encodeFunctionData({ abi: safeAbi, functionName: "execTransaction", args: [to, 0n, data, operation, 0n, 0n, 0n, zeroAddress, zeroAddress, "0x"] });
  const callOnly = SAFE_MULTISEND.callOnly[0] as Hex;
  const full = SAFE_MULTISEND.full[0] as Hex;

  it("parses the packed encoding and rejects truncated data", () => {
    const packed = concatHex([entry(0, TOKEN, 0n, approve(MARKET, 1n)), entry(0, EOA, 5n, "0x")]);
    expect(parseMultiSend(packed)).toEqual([
      { operation: 0, target: TOKEN, value: 0n, data: approve(MARKET, 1n) },
      { operation: 0, target: EOA, value: 5n, data: "0x" },
    ]);
    expect(parseMultiSend(packed.slice(0, -2) as Hex)).toBeNull();
    expect(parseMultiSend(concatHex([entry(2, TOKEN, 0n, "0x")]))).toBeNull();
  });

  it("a Safe DELEGATECALL into MultiSendCallOnly is the normal batch path: inner calls are assessed", async () => {
    const packed = concatHex([entry(0, TOKEN, 0n, approve(ATTACKER, maxUint256)), entry(0, EOA, 5n, "0x")]);
    const r = await analyzeRequest("eth_sendTransaction", tx(SAFE, exec(callOnly, encodeFunctionData({ abi: multiSendAbi, functionName: "multiSend", args: [packed] }), 1)), base);
    expect(r.action).toMatchObject({ kind: "safe-exec", operation: 1, multisend: "call-only" });
    expect(codes(r)).toEqual(["UNLIMITED_APPROVAL"]);
    expect(r.explanations.en.headline).toBe("Run a batch of Safe transactions through Safe's MultiSend");
    expect(r.explanations.en.details).toContain("1. Give 0x4444…4444 unlimited permission to spend your pUSD");
  });

  it("a DELEGATECALL entry inside MultiSend, or into an unknown contract, is critical", async () => {
    const packed = concatHex([entry(1, ATTACKER, 0n, "0xa619486e")]);
    const r = await analyzeRequest("eth_sendTransaction", tx(SAFE, exec(full, encodeFunctionData({ abi: multiSendAbi, functionName: "multiSend", args: [packed] }), 1)), base);
    expect(codes(r)).toEqual(["SAFE_DELEGATECALL"]);
    expect(r.assessment.level).toBe("critical");
    // The same MultiSend address on a chain where it is not a known deployment is NOT trusted.
    const other = await analyzeRequest("eth_sendTransaction", tx(SAFE, exec(callOnly, "0x8d80ff0a", 1)), { ...base, chainId: 31337 });
    expect(codes(other)).toEqual(["SAFE_DELEGATECALL"]);
  });

  it("a malformed MultiSend payload is amber with a reason", async () => {
    const r = await analyzeRequest("eth_sendTransaction", tx(callOnly, encodeFunctionData({ abi: multiSendAbi, functionName: "multiSend", args: ["0x00ff"] })), base);
    expect(r.action).toMatchObject({ kind: "unknown", reasonKey: "reason.bad-multisend", malformed: true });
  });
});

describe("eth_signTransaction", () => {
  it("is decoded like a transaction plus a sign-only warning", async () => {
    const r = await analyzeRequest("eth_signTransaction", tx(TOKEN, approve(MARKET, maxUint256)), base);
    expect(r.action.kind).toBe("sign-transaction");
    expect(codes(r)).toEqual(["SIGN_ONLY_TRANSACTION", "UNLIMITED_APPROVAL"]);
    expect(r.explanations.en.headline).toBe("Sign, without sending, a transaction that would: Give 0x3333…3333 unlimited permission to spend your pUSD");
    expect(r.target).toBe(TOKEN);
  });
});

describe("malformed input never crashes and never comes out green", () => {
  // Deterministic PRNG so failures reproduce.
  let seed = 0x5eed;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const hex = (n: number) => `0x${Array.from({ length: n }, () => Math.floor(rnd() * 256).toString(16).padStart(2, "0")).join("")}` as Hex;
  const selectors = Object.values(SELECTORS);

  it("random calldata against every known selector", async () => {
    for (let i = 0; i < 400; i++) {
      const sel = selectors[i % selectors.length]!;
      const data = `${sel}${hex(Math.floor(rnd() * 200)).slice(2)}`;
      const r = await analyzeRequest("eth_sendTransaction", tx(MARKET, data), withRelease);
      if (r.action.kind === "unknown") expect(RISK_ORDER[r.assessment.level]).toBeGreaterThanOrEqual(RISK_ORDER.medium);
      for (const lang of ["en", "hi", "mr"] as const) expect(r.explanations[lang].headline).not.toMatch(/^(action|risk|reason|detail)\./);
    }
  });

  it("garbage params for every method", async () => {
    const junk: unknown[] = [undefined, null, 42, "x", {}, [], [null], [{}], [{ to: 5, data: 7, value: "lots" }], ["0xzz"], [ME], [[1, 2]], ["{not json"], [ME, "{\"primaryType\":5}"], [ME, { domain: 1, primaryType: "Permit", types: {}, message: {} }]];
    for (const method of GUARDED_METHODS) {
      for (const params of junk) {
        const r = await analyzeRequest(method, params as unknown[], base);
        expect(r.explanations.en.headline.length).toBeGreaterThan(0);
        if (r.action.kind === "unknown") expect(RISK_ORDER[r.assessment.level]).toBeGreaterThanOrEqual(RISK_ORDER.medium);
      }
    }
  });

  it("odd-length hex, invalid values and a throwing tokenInfo", async () => {
    const odd = await analyzeRequest("eth_sendTransaction", tx(MARKET, "0x095ea7b"), base);
    expect(odd.action).toMatchObject({ kind: "unknown", malformed: true });
    const badValue = await analyzeRequest("eth_sendTransaction", [{ to: MARKET, data: "0x", value: "-5" }], base);
    expect(badValue.action).toMatchObject({ kind: "unknown", reasonKey: "reason.bad-value" });
    const throwing = await analyzeRequest("eth_sendTransaction", tx(TOKEN, approve(MARKET, 1n)), { ...base, tokenInfo: () => { throw new Error("boom"); } });
    expect(throwing.action.kind).toBe("erc20-approve");
  });

  it("encoded but semantically odd values decode without guessing", async () => {
    const bytes = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [MARKET, 1n]);
    const r = await analyzeRequest("eth_sendTransaction", tx(MARKET, `0xabcdef01${bytes.slice(2)}`), base);
    expect(r.explanations.en.headline).toBe("Unable to confidently interpret this transaction.");
    expect(BLOCKING_CODES.has("UNKNOWN_ACTION")).toBe(false);
  });
});

import { encodeFunctionData, maxUint256, parseAbi, toFunctionSelector, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import {
  analyzeRequest,
  clearSignFormat,
  erc1155Abi,
  erc20Abi,
  erc721Abi,
  formatUnitsExact,
  multicallAbi,
  permit2Abi,
  PERMIT2_ADDRESS,
  safeAbi,
  SELECTORS,
  type DecodeContext,
  type TokenInfo,
} from "../src/index.js";

const USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as const;
const NFT = "0x2222222222222222222222222222222222222222" as const;
const VAULT = "0x3333333333333333333333333333333333333333" as const;
const SPENDER = "0x4444444444444444444444444444444444444444" as const;
const EOA = "0x5555555555555555555555555555555555555555" as const;
const ME = "0x6666666666666666666666666666666666666666" as const;

const tokens: Record<string, TokenInfo> = {
  [USDC.toLowerCase()]: { address: USDC, kind: "erc20", symbol: "USDC", decimals: 6, name: "USD Coin" },
  [NFT.toLowerCase()]: { address: NFT, kind: "erc721", symbol: "pNFT", name: "Pramaan Demo Pass" },
};

const vaultDescriptor = {
  context: { contract: { deployments: [{ chainId: 11155111, address: VAULT }] } },
  metadata: { owner: "Pramaan Demo", contractName: "VaultV2" },
  display: {
    formats: {
      "deposit()": { intent: "Deposit ETH into the vault", fields: [{ path: "@.value", label: "Amount", format: "amount" }] },
      "depositToken(uint256 amount)": {
        intent: "Deposit pUSD into the vault",
        fields: [{ path: "amount", label: "Amount", format: "tokenAmount", params: { token: USDC } }],
      },
    },
  },
};

const ctx: DecodeContext = {
  chainId: 11155111,
  from: ME,
  origin: "https://vault.pramaan.example",
  now: 1_880_000_000, // mid-2029: the fixtures' 2030 deadlines are then less than a year away
  nativeSymbol: "ETH",
  tokenInfo: async (a) => tokens[a.toLowerCase()] ?? null,
  isContract: async (a) => a.toLowerCase() !== EOA.toLowerCase(),
  labels: { [VAULT.toLowerCase()]: "VaultV2" },
  descriptors: [{ chainId: 11155111, address: VAULT, descriptor: vaultDescriptor }],
};

const tx = (to: string, data: string, value = "0x0") => [{ from: ME, to, data, value }];

describe("selector table", () => {
  it("matches the ABIs", () => {
    expect(toFunctionSelector("transfer(address,uint256)")).toBe(SELECTORS.transfer);
    expect(toFunctionSelector("approve(address,uint256)")).toBe(SELECTORS.approve);
    expect(toFunctionSelector("transferFrom(address,address,uint256)")).toBe(SELECTORS.transferFrom);
    expect(toFunctionSelector("increaseAllowance(address,uint256)")).toBe(SELECTORS.increaseAllowance);
    expect(toFunctionSelector("setApprovalForAll(address,bool)")).toBe(SELECTORS.setApprovalForAll);
    expect(toFunctionSelector("safeTransferFrom(address,address,uint256)")).toBe(SELECTORS.safeTransferFrom721);
    expect(toFunctionSelector("safeTransferFrom(address,address,uint256,bytes)")).toBe(SELECTORS.safeTransferFrom721Data);
    expect(toFunctionSelector("safeTransferFrom(address,address,uint256,uint256,bytes)")).toBe(SELECTORS.safeTransferFrom1155);
    expect(toFunctionSelector("safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)")).toBe(SELECTORS.safeBatchTransferFrom1155);
    expect(toFunctionSelector("permit(address,address,uint256,uint256,uint8,bytes32,bytes32)")).toBe(SELECTORS.permit2612);
    expect(toFunctionSelector("approve(address,address,uint160,uint48)")).toBe(SELECTORS.permit2Approve);
    expect(toFunctionSelector("permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)")).toBe(SELECTORS.permit2PermitSingle);
    expect(toFunctionSelector("permit(address,((address,uint160,uint48,uint48)[],address,uint256),bytes)")).toBe(SELECTORS.permit2PermitBatch);
    expect(toFunctionSelector("transferFrom(address,address,uint160,address)")).toBe(SELECTORS.permit2TransferFrom);
    expect(toFunctionSelector("execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)")).toBe(SELECTORS.safeExecTransaction);
    expect(toFunctionSelector("aggregate((address,bytes)[])")).toBe(SELECTORS.aggregate);
    expect(toFunctionSelector("aggregate3((address,bool,bytes)[])")).toBe(SELECTORS.aggregate3);
    expect(toFunctionSelector("aggregate3Value((address,bool,uint256,bytes)[])")).toBe(SELECTORS.aggregate3Value);
    expect(toFunctionSelector("multicall(bytes[])")).toBe(SELECTORS.multicall);
    expect(toFunctionSelector("multicall(uint256,bytes[])")).toBe(SELECTORS.multicallDeadline);
  });
});

describe("ERC-20", () => {
  it("decodes a transfer with exact amounts", async () => {
    const r = await analyzeRequest("eth_sendTransaction", tx(USDC, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [SPENDER, 1_234_500_000n] })), ctx);
    expect(r.action.kind).toBe("erc20-transfer");
    expect(r.explanations.en.headline).toBe("Send 1,234.5 USDC to 0x4444…4444");
    expect(r.explanations.hi.headline).toBe("0x4444…4444 को 1,234.5 USDC भेजें");
    expect(r.explanations.mr.headline).toBe("0x4444…4444 ला 1,234.5 USDC पाठवा");
    expect(r.assessment.level).toBe("low");
  });

  it("flags an unlimited approval as high risk in all three languages", async () => {
    const r = await analyzeRequest("eth_sendTransaction", tx(USDC, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [SPENDER, maxUint256] })), ctx);
    expect(r.assessment.level).toBe("high");
    expect(r.assessment.findings.map((f) => f.code)).toEqual(["UNLIMITED_APPROVAL"]);
    expect(r.explanations.en.risks[0]!.text).toBe(
      "This transaction gives 0x4444…4444 unlimited permission to use your USDC, now and in the future, without asking you again.",
    );
    expect(r.explanations.hi.risks[0]!.text).toContain("यह लेन-देन 0x4444…4444 को आपके सभी USDC इस्तेमाल करने की अनुमति देता है");
    expect(r.explanations.mr.risks[0]!.text).toContain("हा व्यवहार 0x4444…4444 ला तुमचे सर्व USDC वापरण्याची परवानगी देतो");
  });

  it("does not call a bounded approval unlimited", async () => {
    const r = await analyzeRequest("eth_sendTransaction", tx(USDC, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [SPENDER, 50_000_000n] })), ctx);
    expect(r.assessment.findings).toEqual([]);
    expect(r.explanations.en.headline).toBe("Allow 0x4444…4444 to spend up to 50 USDC");
  });

  it("treats approve(0) as a revoke and an EOA spender as a scam pattern", async () => {
    const revoke = await analyzeRequest("eth_sendTransaction", tx(USDC, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [SPENDER, 0n] })), ctx);
    expect(revoke.assessment.findings.map((f) => f.code)).toEqual(["REVOKE"]);
    const toEoa = await analyzeRequest("eth_sendTransaction", tx(USDC, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [EOA, 10n] })), ctx);
    expect(toEoa.assessment.findings.map((f) => f.code)).toEqual(["APPROVAL_TO_EOA"]);
    expect(toEoa.assessment.level).toBe("high");
  });

  it("warns when tokens are sent to the token contract itself", async () => {
    const r = await analyzeRequest("eth_sendTransaction", tx(USDC, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [USDC, 1n] })), ctx);
    expect(r.assessment.findings.map((f) => f.code)).toEqual(["TRANSFER_TO_TOKEN_CONTRACT"]);
  });
});

describe("NFTs and native value", () => {
  it("decodes setApprovalForAll(true) as high risk", async () => {
    const r = await analyzeRequest("eth_sendTransaction", tx(NFT, encodeFunctionData({ abi: erc721Abi, functionName: "setApprovalForAll", args: [SPENDER, true] })), ctx);
    expect(r.action.kind).toBe("nft-approval-for-all");
    expect(r.assessment.findings.map((f) => f.code)).toEqual(["APPROVE_ALL_NFTS"]);
    expect(r.explanations.en.headline).toBe("Give 0x4444…4444 control of ALL your NFTs in pNFT");
  });

  it("uses ERC-721 semantics for transferFrom on an NFT collection", async () => {
    const r = await analyzeRequest("eth_sendTransaction", tx(NFT, encodeFunctionData({ abi: erc20Abi, functionName: "transferFrom", args: [ME, SPENDER, 7n] })), ctx);
    expect(r.action.kind).toBe("nft-transfer");
    expect(r.explanations.en.headline).toBe("Transfer NFT #7 of pNFT to 0x4444…4444");
  });

  it("decodes ERC-1155 transfers", async () => {
    const r = await analyzeRequest(
      "eth_sendTransaction",
      tx(NFT, encodeFunctionData({ abi: erc1155Abi, functionName: "safeTransferFrom", args: [ME, SPENDER, 3n, 2n, "0x"] })),
      ctx,
    );
    expect(r.action).toMatchObject({ kind: "nft-transfer", tokenId: 3n, amount: 2n });
  });

  it("decodes a plain native transfer", async () => {
    const r = await analyzeRequest("eth_sendTransaction", tx(SPENDER, "0x", "0xde0b6b3a7640000"), ctx);
    expect(r.explanations.en.headline).toBe("Send 1 ETH to 0x4444…4444");
  });
});

describe("signatures", () => {
  const permitTypedData = (value: bigint) =>
    JSON.stringify({
      domain: { name: "USD Coin", version: "2", chainId: 11155111, verifyingContract: USDC },
      primaryType: "Permit",
      types: {
        EIP712Domain: [],
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      message: { owner: ME, spender: SPENDER, value: value.toString(), nonce: "0", deadline: "1893456000" },
    });

  it("flags an unlimited EIP-2612 permit", async () => {
    const r = await analyzeRequest("eth_signTypedData_v4", [ME, permitTypedData(maxUint256)], ctx);
    expect(r.action).toMatchObject({ kind: "permit", standard: "eip2612", onChain: false });
    expect(r.assessment.findings.map((f) => f.code)).toEqual(["UNLIMITED_PERMIT"]);
  });

  it("explains a bounded permit as an off-chain approval", async () => {
    const r = await analyzeRequest("eth_signTypedData_v4", [ME, permitTypedData(25_000_000n)], ctx);
    expect(r.assessment.findings.map((f) => f.code)).toEqual(["OFFCHAIN_PERMIT"]);
    expect(r.explanations.en.headline).toContain("up to 25 USDC");
  });

  it("decodes Permit2 PermitSingle", async () => {
    const td = {
      domain: { name: "Permit2", chainId: 11155111, verifyingContract: PERMIT2_ADDRESS },
      primaryType: "PermitSingle",
      types: {},
      message: { details: { token: USDC, amount: (2n ** 160n - 1n).toString(), expiration: "0", nonce: "0" }, spender: SPENDER, sigDeadline: "1893456000" },
    };
    const r = await analyzeRequest("eth_signTypedData_v4", [ME, JSON.stringify(td)], ctx);
    expect(r.action).toMatchObject({ kind: "permit", standard: "permit2-single" });
    expect(r.assessment.level).toBe("high");
  });

  it("detects a SIWE domain mismatch", async () => {
    const siwe = [
      "evil.example wants you to sign in with your Ethereum account:",
      ME,
      "",
      "Sign in",
      "",
      "URI: https://evil.example",
      "Version: 1",
      "Chain ID: 1",
      "Nonce: abcdef12",
      "Issued At: 2026-11-04T10:00:00Z",
    ].join("\n");
    const hex = `0x${Buffer.from(siwe).toString("hex")}`;
    const r = await analyzeRequest("personal_sign", [hex, ME], ctx);
    expect(r.action.kind).toBe("siwe");
    expect(r.assessment.findings[0]).toMatchObject({ code: "SIWE_DOMAIN_MISMATCH", level: "high" });
  });

  it("treats 32-byte messages and eth_sign as dangerous", async () => {
    const raw = await analyzeRequest("personal_sign", [`0x${"ab".repeat(32)}`, ME], ctx);
    expect(raw.assessment.findings.map((f) => f.code)).toEqual(["RAW_HASH_SIGNATURE"]);
    const ethSign = await analyzeRequest("eth_sign", [ME, `0x${"ab".repeat(32)}`], ctx);
    expect(ethSign.assessment.level).toBe("critical");
  });

  it("decodes a readable personal_sign message", async () => {
    const r = await analyzeRequest("personal_sign", [`0x${Buffer.from("Hello Pramaan").toString("hex")}`, ME], ctx);
    expect(r.action).toEqual({ kind: "message", text: "Hello Pramaan" });
  });
});

describe("Safe, EIP-7702 and batches", () => {
  const exec = (to: string, data: `0x${string}`, operation: number) =>
    encodeFunctionData({ abi: safeAbi, functionName: "execTransaction", args: [to as `0x${string}`, 0n, data, operation, 0n, 0n, 0n, zeroAddress, zeroAddress, "0x"] });

  it("marks a Safe DELEGATECALL as critical (the Bybit pattern)", async () => {
    const r = await analyzeRequest("eth_sendTransaction", tx(VAULT, exec(SPENDER, "0xa9059cbb", 1)), { ...ctx, descriptors: [] });
    expect(r.assessment.level).toBe("critical");
    expect(r.assessment.findings.map((f) => f.code)).toContain("SAFE_DELEGATECALL");
    expect(r.explanations.hi.risks[0]!.text).toContain("Bybit");
  });

  it("looks inside a Safe CALL", async () => {
    const inner = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [SPENDER, maxUint256] });
    const r = await analyzeRequest("eth_sendTransaction", tx(VAULT, exec(USDC, inner, 0)), { ...ctx, descriptors: [] });
    expect(r.assessment.findings.map((f) => f.code)).toEqual(["UNLIMITED_APPROVAL"]);
    expect(r.explanations.en.details[0]).toContain("unlimited permission");
  });

  it("marks SafeTx typed data with operation 1 as critical", async () => {
    const td = { domain: { chainId: 11155111, verifyingContract: VAULT }, primaryType: "SafeTx", types: {}, message: { to: SPENDER, value: "0", data: "0x", operation: 1 } };
    const r = await analyzeRequest("eth_signTypedData_v4", [ME, JSON.stringify(td)], ctx);
    expect(r.assessment.level).toBe("critical");
  });

  it("marks an EIP-7702 authorization as critical", async () => {
    const r = await analyzeRequest("eth_sendTransaction", [{ from: ME, to: ME, data: "0x", authorizationList: [{ address: SPENDER, chainId: 11155111, nonce: 0 }] }], ctx);
    expect(r.action).toEqual({ kind: "eip7702-authorization", delegates: [SPENDER] });
    expect(r.assessment.level).toBe("critical");
  });

  it("decodes Multicall3 and flags calls it cannot read", async () => {
    const approve = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [SPENDER, maxUint256] });
    const data = encodeFunctionData({
      abi: multicallAbi,
      functionName: "aggregate3",
      args: [[{ target: USDC, allowFailure: false, callData: approve }, { target: SPENDER, allowFailure: false, callData: "0xdeadbeef" }]],
    });
    const r = await analyzeRequest("eth_sendTransaction", tx("0xcA11bde05977b3631167028862bE2a173976CA11", data), ctx);
    expect(r.action.kind).toBe("batch");
    expect(r.assessment.findings.map((f) => f.code).sort()).toEqual(["UNLIMITED_APPROVAL", "UNPARSED_BATCH"]);
  });

  it("decodes an on-chain Permit2 approve", async () => {
    const data = encodeFunctionData({ abi: permit2Abi, functionName: "approve", args: [USDC, SPENDER, 2n ** 160n - 1n, 0] });
    const r = await analyzeRequest("eth_sendTransaction", tx(PERMIT2_ADDRESS, data), ctx);
    expect(r.action).toMatchObject({ kind: "permit", standard: "permit2-approve", onChain: true });
    expect(r.assessment.findings.map((f) => f.code)).toEqual(["UNLIMITED_APPROVAL"]);
  });
});

describe("unknown calls and release descriptors", () => {
  it("never guesses an unknown selector", async () => {
    const r = await analyzeRequest("eth_sendTransaction", tx(SPENDER, "0x12345678000000000000000000000000000000000000000000000000000000000000002a"), ctx);
    expect(r.action.kind).toBe("unknown");
    expect(r.explanations.en.headline).toBe("Unable to confidently interpret this transaction.");
    expect(r.explanations.mr.headline).toBe("या व्यवहाराचा खात्रीने अर्थ लावता आला नाही.");
    expect(r.assessment.findings.map((f) => f.code)).toEqual(["UNKNOWN_ACTION"]);
  });

  it("decodes the release's own contract through its pinned ERC-7730 descriptor", async () => {
    const data = encodeFunctionData({ abi: parseAbi(["function depositToken(uint256 amount)"]), functionName: "depositToken", args: [5_000_000n] });
    const r = await analyzeRequest("eth_sendTransaction", tx(VAULT, data), ctx);
    expect(r.action).toMatchObject({ kind: "contract-call", functionName: "depositToken", label: "VaultV2", descriptorIntent: "Deposit pUSD into the vault" });
    expect(r.explanations.en.details).toContain("amount: 5000000");
  });

  it("formats through the ERC-7730 reference implementation with only the pinned descriptor", async () => {
    const data = encodeFunctionData({ abi: parseAbi(["function depositToken(uint256 amount)"]), functionName: "depositToken", args: [5_000_000n] });
    const model = await clearSignFormat({ chainId: 11155111, to: VAULT, data }, ctx.descriptors!, ctx);
    expect(model?.intent).toBe("Deposit pUSD into the vault");
    expect(model?.fields.find((f) => f.label === "Amount")?.value).toContain("5");
    expect(await clearSignFormat({ chainId: 11155111, to: SPENDER, data }, ctx.descriptors!, ctx)).toBeNull();
  });
});

describe("formatting", () => {
  it("uses exact decimals and Indian digit grouping for hi/mr", () => {
    expect(formatUnitsExact(123456789012345n, 6, "en")).toBe("123,456,789.012345");
    expect(formatUnitsExact(123456789012345n, 6, "hi")).toBe("12,34,56,789.012345");
    expect(formatUnitsExact(1n, 18, "en")).toBe("≈0");
  });
});

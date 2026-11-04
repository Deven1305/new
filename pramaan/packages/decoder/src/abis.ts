import { parseAbi } from "viem";

/** Canonical Permit2 deployment (same address on every chain). */
export const PERMIT2_ADDRESS = "0x000000000022d473030f116ddee9f6b43ac78ba3";

export const erc20Abi = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "function increaseAllowance(address spender, uint256 addedValue) returns (bool)",
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
]);

export const erc721Abi = parseAbi([
  "function safeTransferFrom(address from, address to, uint256 tokenId)",
  "function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)",
  "function setApprovalForAll(address operator, bool approved)",
]);

export const erc1155Abi = parseAbi([
  "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
  "function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts, bytes data)",
]);

export const permit2Abi = parseAbi([
  "struct PermitDetails { address token; uint160 amount; uint48 expiration; uint48 nonce; }",
  "struct PermitSingle { PermitDetails details; address spender; uint256 sigDeadline; }",
  "struct PermitBatch { PermitDetails[] details; address spender; uint256 sigDeadline; }",
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  "function permit(address owner, PermitSingle permitSingle, bytes signature)",
  "function permit(address owner, PermitBatch permitBatch, bytes signature)",
  "function transferFrom(address from, address to, uint160 amount, address token)",
]);

export const safeAbi = parseAbi([
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)",
]);

export const multicallAbi = parseAbi([
  "struct Call { address target; bytes callData; }",
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Call3Value { address target; bool allowFailure; uint256 value; bytes callData; }",
  "function aggregate(Call[] calls) payable returns (uint256 blockNumber, bytes[] returnData)",
  "function aggregate3(Call3[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
  "function aggregate3Value(Call3Value[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
  "function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)",
  "function multicall(bytes32 previousBlockhash, bytes[] data) payable returns (bytes[] results)",
  "function tryAggregate(bool requireSuccess, Call[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
  "function blockAndAggregate(Call[] calls) payable returns (uint256 blockNumber, bytes32 blockHash, (bool success, bytes returnData)[] returnData)",
  "function tryBlockAndAggregate(bool requireSuccess, Call[] calls) payable returns (uint256 blockNumber, bytes32 blockHash, (bool success, bytes returnData)[] returnData)",
]);

export const multiSendAbi = parseAbi(["function multiSend(bytes transactions) payable"]);

/**
 * Safe's MultiSend / MultiSendCallOnly singletons (safe-global/safe-deployments v1.3.0 canonical + eip155, v1.4.1),
 * deployed at these deterministic addresses on Ethereum and Sepolia. A Safe DELEGATECALL into one of them is the
 * standard way to batch; a DELEGATECALL anywhere else is the Bybit pattern.
 */
export const SAFE_MULTISEND = {
  callOnly: [
    "0x40a2accbd92bca938b02010e17a5b8929b49130d",
    "0xa1dabef33b3b82c7814b6d82a79e50f4ac44102b",
    "0x9641d764fc13c8b624c04430c7356c1c7c8102e2",
  ],
  full: ["0xa238cbeb142c10ef7ad8442c6d1f9e89e07e7761", "0x998739bfdaadde7c933b942a68053933098f9eda", "0x38869bf66a61cf6bdb996a6ae40d5853fd43b526"],
  chains: [1, 11155111],
} as const;

/** Selectors whose meaning depends on whether the target is an ERC-20 or an ERC-721. */
export const SELECTORS = {
  transfer: "0xa9059cbb",
  approve: "0x095ea7b3",
  transferFrom: "0x23b872dd",
  increaseAllowance: "0x39509351",
  setApprovalForAll: "0xa22cb465",
  safeTransferFrom721: "0x42842e0e",
  safeTransferFrom721Data: "0xb88d4fde",
  safeTransferFrom1155: "0xf242432a",
  safeBatchTransferFrom1155: "0x2eb2c2d6",
  permit2612: "0xd505accf",
  permit2Approve: "0x87517c45",
  permit2PermitSingle: "0x2b67b570",
  permit2PermitBatch: "0x2a2d80d1",
  permit2TransferFrom: "0x36c78516",
  safeExecTransaction: "0x6a761202",
  aggregate: "0x252dba42",
  aggregate3: "0x82ad56cb",
  aggregate3Value: "0x174dea71",
  multicall: "0xac9650d8",
  multicallDeadline: "0x5ae401dc",
  multicallBlockhash: "0x1f0464d1",
  tryAggregate: "0xbce38bd7",
  blockAndAggregate: "0xc3077fa9",
  tryBlockAndAggregate: "0x399542e9",
  multiSend: "0x8d80ff0a",
} as const;

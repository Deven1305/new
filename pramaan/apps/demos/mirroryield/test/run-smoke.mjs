import { createWalletClient, createPublicClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = "http://127.0.0.1:9120";
const TOKEN = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const FARM = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const userAccount = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

const tokenAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function faucet()",
  "error FaucetCooldown(uint256)"
]);

const farmAbi = parseAbi([
  "function totalStaked() view returns (uint256)",
  "function stakedOf(address) view returns (uint256)",
  "function earned(address) view returns (uint256)",
  "function stake(uint256)",
  "function unstake(uint256)",
  "function claim()",
  "function exit()",
  "error InsufficientStake(uint256,uint256)",
  "error NothingToClaim()"
]);

async function main() {
  const pub = createPublicClient({ transport: http(RPC) });
  const wallet = createWalletClient({ account: userAccount, transport: http(RPC) });

  console.log("=== Flow 1: Faucet ===");
  const faucetTx = await wallet.writeContract({ address: TOKEN, abi: tokenAbi, functionName: "faucet", args: [] });
  await pub.waitForTransactionReceipt({ hash: faucetTx });
  const bal1 = await pub.readContract({ address: TOKEN, abi: tokenAbi, functionName: "balanceOf", args: [userAccount.address] });
  console.log("Faucet Tx:", faucetTx);
  console.log("Wallet pUSD balance after faucet:", bal1.toString());

  console.log("=== Flow 1b: Second Faucet (Cooldown Check) ===");
  try {
    await wallet.writeContract({ address: TOKEN, abi: tokenAbi, functionName: "faucet", args: [] });
    console.log("ERROR: Second faucet call should have reverted!");
  } catch (err) {
    console.log("Second faucet reverted with cooldown as expected.");
  }

  console.log("=== Flow 2: Approve Exact ===");
  const approveTx = await wallet.writeContract({ address: TOKEN, abi: tokenAbi, functionName: "approve", args: [FARM, 500000000n] });
  await pub.waitForTransactionReceipt({ hash: approveTx });
  const allowance = await pub.readContract({ address: TOKEN, abi: tokenAbi, functionName: "allowance", args: [userAccount.address, FARM] });
  console.log("Approve Tx:", approveTx);
  console.log("Allowance:", allowance.toString());

  console.log("=== Flow 3: Stake ===");
  const stakeTx = await wallet.writeContract({ address: FARM, abi: farmAbi, functionName: "stake", args: [500000000n] });
  await pub.waitForTransactionReceipt({ hash: stakeTx });
  const staked = await pub.readContract({ address: FARM, abi: farmAbi, functionName: "stakedOf", args: [userAccount.address] });
  const totalStaked = await pub.readContract({ address: FARM, abi: farmAbi, functionName: "totalStaked" });
  console.log("Stake Tx:", stakeTx);
  console.log("User Staked:", staked.toString());
  console.log("Total Staked in Pool:", totalStaked.toString());

  console.log("=== Flow 4: Advance Time & Earn Rewards ===");
  await pub.request({ method: "evm_increaseTime", params: [3600] });
  await pub.request({ method: "evm_mine", params: [] });
  const earned = await pub.readContract({ address: FARM, abi: farmAbi, functionName: "earned", args: [userAccount.address] });
  console.log("Earned after 1 hour (3600s):", earned.toString());

  console.log("=== Flow 5: Claim Rewards ===");
  const balBeforeClaim = await pub.readContract({ address: TOKEN, abi: tokenAbi, functionName: "balanceOf", args: [userAccount.address] });
  const claimTx = await wallet.writeContract({ address: FARM, abi: farmAbi, functionName: "claim", args: [] });
  await pub.waitForTransactionReceipt({ hash: claimTx });
  const balAfterClaim = await pub.readContract({ address: TOKEN, abi: tokenAbi, functionName: "balanceOf", args: [userAccount.address] });
  console.log("Claim Tx:", claimTx);
  console.log("Tokens claimed:", (balAfterClaim - balBeforeClaim).toString());

  console.log("=== Flow 6: Partial Unstake ===");
  const unstakeTx = await wallet.writeContract({ address: FARM, abi: farmAbi, functionName: "unstake", args: [200000000n] });
  await pub.waitForTransactionReceipt({ hash: unstakeTx });
  const stakedAfter = await pub.readContract({ address: FARM, abi: farmAbi, functionName: "stakedOf", args: [userAccount.address] });
  console.log("Unstake Tx:", unstakeTx);
  console.log("Remaining User Stake:", stakedAfter.toString());

  console.log("=== Flow 7: Unstake Too Much (Revert Check) ===");
  try {
    await wallet.writeContract({ address: FARM, abi: farmAbi, functionName: "unstake", args: [500000000n] });
    console.log("ERROR: Unstake 500 pUSD with 300 pUSD stake should have reverted!");
  } catch (err) {
    console.log("Unstake too much reverted with InsufficientStake as expected.");
  }

  console.log("=== Flow 8: Exit (Unstake All + Claim Remaining) ===");
  await pub.request({ method: "evm_increaseTime", params: [1800] });
  await pub.request({ method: "evm_mine", params: [] });
  const exitTx = await wallet.writeContract({ address: FARM, abi: farmAbi, functionName: "exit", args: [] });
  await pub.waitForTransactionReceipt({ hash: exitTx });
  const stakedFinal = await pub.readContract({ address: FARM, abi: farmAbi, functionName: "stakedOf", args: [userAccount.address] });
  const earnedFinal = await pub.readContract({ address: FARM, abi: farmAbi, functionName: "earned", args: [userAccount.address] });
  const balFinal = await pub.readContract({ address: TOKEN, abi: tokenAbi, functionName: "balanceOf", args: [userAccount.address] });
  console.log("Exit Tx:", exitTx);
  console.log("Final User Stake:", stakedFinal.toString());
  console.log("Final Earned:", earnedFinal.toString());
  console.log("Final Wallet Balance:", balFinal.toString());
}

main().catch(console.error);

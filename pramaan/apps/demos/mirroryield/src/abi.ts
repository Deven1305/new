import { parseAbi } from "viem";

export const farmAbi = parseAbi([
  "function stakingToken() view returns (address)",
  "function rewardToken() view returns (address)",
  "function rewardRate() view returns (uint256)",
  "function periodFinish() view returns (uint256)",
  "function totalStaked() view returns (uint256)",
  "function totalRewardsFunded() view returns (uint256)",
  "function totalRewardsPaid() view returns (uint256)",
  "function stakedOf(address) view returns (uint256)",
  "function earned(address) view returns (uint256)",
  "function rewardsRemaining() view returns (uint256)",
  "function stake(uint256 amount)",
  "function unstake(uint256 amount)",
  "function claim()",
  "function exit()",
  "error ZeroAmount()",
  "error InsufficientStake(uint256 requested, uint256 available)",
  "error NothingToClaim()",
  "error ZeroAddress()",
  "error InvalidDuration(uint256 duration)",
  "error RewardRateTooLow()",
]);

export const tokenAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function faucet()",
  "function lastFaucetAt(address) view returns (uint256)",
  "function FAUCET_AMOUNT() view returns (uint256)",
  "function FAUCET_COOLDOWN() view returns (uint256)",
  "error FaucetCooldown(uint256 availableAt)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
]);

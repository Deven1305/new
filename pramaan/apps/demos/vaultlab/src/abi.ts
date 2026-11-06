import { parseAbi } from "viem";

export const vaultAbi = parseAbi([
  "function version() view returns (string)",
  "function owner() view returns (address)",
  "function token() view returns (address)",
  "function totalEthDeposits() view returns (uint256)",
  "function totalTokenDeposits() view returns (uint256)",
  "function ethBalanceOf(address) view returns (uint256)",
  "function tokenBalanceOf(address) view returns (uint256)",
  "function deposit() payable",
  "function depositToken(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function withdrawToken(uint256 amount)",
  "error ZeroAmount()",
  "error InsufficientBalance(uint256 requested, uint256 available)",
  "error EthTransferFailed()",
  "error OwnableUnauthorizedAccount(address account)",
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


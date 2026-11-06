import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

/** Plain-words messages for the custom errors in contracts/src/demo/*.sol. */
export const ERROR_TEXT: Record<string, string> = {
  ZeroAmount: "Enter an amount greater than zero.",
  FaucetCooldown: "The faucet can be used once per hour per address. Try again later.",
  InsufficientStake: "You can't unstake more than you have staked.",
  NothingToClaim: "You have no rewards to claim yet.",
  InvalidDuration: "The reward duration is invalid.",
  RewardRateTooLow: "The reward rate is too low for this duration.",
  ERC20InsufficientBalance: "Your wallet doesn't have enough pUSD.",
  ERC20InsufficientAllowance: "Approve the farm for this amount first.",
};

export function humanError(e: unknown): string {
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError)) return "You rejected the request in your wallet.";
    const rev = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (rev instanceof ContractFunctionRevertedError) {
      const name = rev.data?.errorName;
      if (name) return ERROR_TEXT[name] ?? `The contract rejected this (${name}).`;
      return rev.reason ?? "The contract rejected this transaction.";
    }
    return e.shortMessage;
  }
  if ((e as { code?: number })?.code === 4001) return "You rejected the request in your wallet.";
  return e instanceof Error ? e.message : String(e);
}

import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

/** Plain-words messages for custom errors in PermitMarketplace, DemoNFT and DemoToken. */
export const ERROR_TEXT: Record<string, string> = {
  ZeroAmount: "Enter an amount greater than zero.",
  ZeroAddress: "Invalid address provided.",
  ZeroPrice: "Price must be greater than zero.",
  NotTokenOwner: "You don't own this pass.",
  MarketplaceNotApproved: "First allow the marketplace to transfer your NFTs.",
  AlreadyListed: "This pass is already listed for sale.",
  ListingNotActive: "This listing is no longer active.",
  NotSeller: "Only the seller can cancel this listing.",
  SellerIsBuyer: "You can't buy your own listing.",
  StaleListing: "This listing is no longer valid because the pass was transferred.",
  PermitAllowanceTooLow: "The permit signature did not grant enough allowance for this price.",
  MintLimit: "You've minted the maximum of 5 passes.",
  FaucetCooldown: "The faucet can be used once per hour per address. Try again later.",
  ERC20InsufficientBalance: "Your wallet doesn't have enough pUSD.",
  ERC20InsufficientAllowance: "Approve the marketplace for this amount first.",
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


import { parseAbi } from "viem";

export const marketAbi = parseAbi([
  "struct Listing { address seller; bool active; uint256 tokenId; uint256 price; }",
  "function listingCount() view returns (uint256)",
  "function listingsPage(uint256 firstId, uint256 count) view returns (Listing[])",
  "function isBuyable(uint256 listingId) view returns (bool)",
  "function activeListingOf(uint256 tokenId) view returns (uint256)",
  "function list(uint256 tokenId, uint256 price) returns (uint256)",
  "function cancel(uint256 listingId)",
  "function buy(uint256 listingId)",
  "function buyWithPermit(uint256 listingId, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "error ZeroAddress()",
  "error ZeroPrice()",
  "error NotTokenOwner(uint256 tokenId)",
  "error MarketplaceNotApproved(uint256 tokenId)",
  "error AlreadyListed(uint256 tokenId, uint256 listingId)",
  "error ListingNotActive(uint256 listingId)",
  "error NotSeller(uint256 listingId)",
  "error SellerIsBuyer(uint256 listingId)",
  "error StaleListing(uint256 listingId)",
  "error PermitAllowanceTooLow(uint256 allowance, uint256 price)",
]);

export const nftAbi = parseAbi([
  "function mint() returns (uint256)",
  "function totalMinted() view returns (uint256)",
  "function mintedBy(address) view returns (uint256)",
  "function MAX_PER_ACCOUNT() view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function balanceOf(address) view returns (uint256)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
  "error MintLimit()",
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
  "function nonces(address) view returns (uint256)",
  "function name() view returns (string)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "error FaucetCooldown(uint256 availableAt)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
]);


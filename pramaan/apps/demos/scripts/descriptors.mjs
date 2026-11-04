// ERC-7730 clear-signing descriptors, generated per app from the demo state. They are written into the built site
// (/erc7730/*.json) and pinned by hash in the release manifest, so the extension can show readable intents.
const SCHEMA = "https://github.com/ethereum/clear-signing-erc7730-registry/blob/master/specs/erc7730-v1.schema.json";

const tokenAmount = (path, token, label = "Amount") => ({ path, label, format: "tokenAmount", params: { token } });
const raw = (path, label) => ({ path, label, format: "raw" });

/** Returns { "<file>.json": descriptor } for one app. */
export function descriptorsFor(appId, app, chainId) {
  const c = app.contracts;
  const owner = `${app.name} (Pramaan demo)`;
  const make = (role, id, contractName, formats, extra = {}) => ({
    $schema: SCHEMA,
    context: { $id: id, contract: { deployments: [{ chainId, address: c[role] }] } },
    metadata: { owner, contractName, info: { url: app.origin }, ...extra },
    display: { formats },
  });
  const faucet = { "faucet()": { intent: "Claim 1,000 test pUSD from the faucet", fields: [] } };
  const token = (extra) =>
    make("token", "pUSD", "DemoToken", faucet, { token: { name: "Pramaan Demo USD", ticker: "pUSD", decimals: 6 }, ...extra });

  if (appId === "vaultlab") {
    return {
      "vault.json": make("vault", "VaultLab Vault", "VaultV2", {
        "deposit()": { intent: "Deposit ETH into VaultLab", fields: [{ path: "@.value", label: "Amount", format: "amount" }] },
        "withdraw(uint256 amount)": { intent: "Withdraw ETH from VaultLab", fields: [{ path: "amount", label: "Amount", format: "amount" }] },
        "depositToken(uint256 amount)": { intent: "Deposit pUSD into VaultLab", fields: [tokenAmount("amount", c.token)] },
        "withdrawToken(uint256 amount)": { intent: "Withdraw pUSD from VaultLab", fields: [tokenAmount("amount", c.token)] },
        "withdrawAll()": { intent: "Emergency: move every asset to the owner (owner only)", fields: [] },
      }),
      "token.json": token(),
    };
  }
  if (appId === "mirroryield") {
    return {
      "farm.json": make("farm", "MirrorYield Farm", "MirrorYieldFarm", {
        "stake(uint256 amount)": { intent: "Stake pUSD in the MirrorYield pool", fields: [tokenAmount("amount", c.token)] },
        "unstake(uint256 amount)": { intent: "Unstake pUSD from the MirrorYield pool", fields: [tokenAmount("amount", c.token)] },
        "claim()": { intent: "Claim pUSD staking rewards", fields: [] },
        "exit()": { intent: "Unstake everything and claim rewards", fields: [] },
      }),
      "token.json": token(),
    };
  }
  if (appId === "permitmarket") {
    return {
      "marketplace.json": make("marketplace", "PermitMarket", "PermitMarketplace", {
        "list(uint256 tokenId,uint256 price)": { intent: "List a Pramaan Demo Pass for sale", fields: [raw("tokenId", "Token id"), tokenAmount("price", c.token, "Price")] },
        "cancel(uint256 listingId)": { intent: "Cancel a listing", fields: [raw("listingId", "Listing")] },
        "buy(uint256 listingId)": { intent: "Buy a Pramaan Demo Pass (paid from your pUSD allowance)", fields: [raw("listingId", "Listing")] },
        "buyWithPermit(uint256 listingId,uint256 deadline,uint8 v,bytes32 r,bytes32 s)": {
          intent: "Buy a Pramaan Demo Pass with a signed permit",
          fields: [raw("listingId", "Listing"), raw("deadline", "Permit deadline")],
        },
      }),
      "nft.json": make("nft", "pNFT", "DemoNFT", { "mint()": { intent: "Mint a free Pramaan Demo Pass (pNFT)", fields: [] } }),
      "token.json": token(),
    };
  }
  throw new Error(`unknown app ${appId}`);
}

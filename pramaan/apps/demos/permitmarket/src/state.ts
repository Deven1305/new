import { contract, type Hex } from "./lib/config";
import { publicClient, type Session } from "./lib/wallet";
import { marketAbi, nftAbi, tokenAbi } from "./abi";

export interface ActiveListing {
  id: bigint;
  seller: Hex;
  active: boolean;
  tokenId: bigint;
  price: bigint;
  isBuyable: boolean;
}

export interface AppData {
  listingCount: bigint;
  listings: ActiveListing[];
  totalMinted: bigint;
  maxPerAccount: bigint;
  tokenDecimals: number;
  tokenSymbol: string;
  tokenName: string;
  faucetCooldown: bigint;
  faucetAmount: bigint;
  // User data
  userTokenBalance: bigint;
  userAllowance: bigint;
  userNonce: bigint;
  userLastFaucetAt: bigint;
  userMintedCount: bigint;
  isApprovedForAll: boolean;
  ownedTokens: { tokenId: bigint; activeListingId: bigint; price?: bigint }[];
}

export interface State {
  session: Session | null;
  decimals: number;
  symbol: string;
  data: AppData;
  loading: boolean;
  error: string | null;
}

export const state: State = {
  session: null,
  decimals: 6,
  symbol: "pUSD",
  data: {
    listingCount: 0n,
    listings: [],
    totalMinted: 0n,
    maxPerAccount: 5n,
    tokenDecimals: 6,
    tokenSymbol: "pUSD",
    tokenName: "Pramaan Demo USD",
    faucetCooldown: 3600n,
    faucetAmount: 1000_000_000n,
    userTokenBalance: 0n,
    userAllowance: 0n,
    userNonce: 0n,
    userLastFaucetAt: 0n,
    userMintedCount: 0n,
    isApprovedForAll: false,
    ownedTokens: [],
  },
  loading: false,
  error: null,
};

const listeners = new Set<() => void>();

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function notify(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch (e) {
      console.error(e);
    }
  }
}

export function setSession(session: Session | null): void {
  state.session = session;
  notify();
  void refresh();
}

export async function refresh(): Promise<void> {
  const client = publicClient();
  let marketAddr: Hex;
  let tokenAddr: Hex;
  let nftAddr: Hex;

  try {
    marketAddr = contract("marketplace");
    tokenAddr = contract("token");
    nftAddr = contract("nft");
  } catch (e) {
    state.error = e instanceof Error ? e.message : String(e);
    notify();
    return;
  }

  state.loading = true;
  try {
    const [
      listingCount,
      totalMinted,
      maxPerAccount,
      decimals,
      symbol,
      name,
      faucetCooldown,
      faucetAmount,
    ] = await Promise.all([
      client.readContract({ address: marketAddr, abi: marketAbi, functionName: "listingCount" }) as Promise<bigint>,
      client.readContract({ address: nftAddr, abi: nftAbi, functionName: "totalMinted" }) as Promise<bigint>,
      client.readContract({ address: nftAddr, abi: nftAbi, functionName: "MAX_PER_ACCOUNT" }) as Promise<bigint>,
      client.readContract({ address: tokenAddr, abi: tokenAbi, functionName: "decimals" }) as Promise<number>,
      client.readContract({ address: tokenAddr, abi: tokenAbi, functionName: "symbol" }) as Promise<string>,
      client.readContract({ address: tokenAddr, abi: tokenAbi, functionName: "name" }) as Promise<string>,
      client.readContract({ address: tokenAddr, abi: tokenAbi, functionName: "FAUCET_COOLDOWN" }) as Promise<bigint>,
      client.readContract({ address: tokenAddr, abi: tokenAbi, functionName: "FAUCET_AMOUNT" }) as Promise<bigint>,
    ]);

    state.decimals = decimals;
    state.symbol = symbol;
    state.data.listingCount = listingCount;
    state.data.totalMinted = totalMinted;
    state.data.maxPerAccount = maxPerAccount;
    state.data.tokenDecimals = decimals;
    state.data.tokenSymbol = symbol;
    state.data.tokenName = name;
    state.data.faucetCooldown = faucetCooldown;
    state.data.faucetAmount = faucetAmount;

    // Fetch all listings across pages
    const rawListings: { id: bigint; seller: Hex; active: boolean; tokenId: bigint; price: bigint }[] = [];
    let firstId = 1n;
    while (firstId <= listingCount) {
      const count = listingCount - firstId + 1n > 100n ? 100n : listingCount - firstId + 1n;
      const page = (await client.readContract({
        address: marketAddr,
        abi: marketAbi,
        functionName: "listingsPage",
        args: [firstId, count],
      })) as { seller: Hex; active: boolean; tokenId: bigint; price: bigint }[];

      for (let i = 0; i < page.length; i++) {
        const item = page[i]!;
        rawListings.push({
          id: firstId + BigInt(i),
          seller: item.seller,
          active: item.active,
          tokenId: item.tokenId,
          price: item.price,
        });
      }
      firstId += count;
    }

    // Check isBuyable for each active listing
    const listingsWithBuyable: ActiveListing[] = await Promise.all(
      rawListings.map(async (l) => {
        if (!l.active) return { ...l, isBuyable: false };
        try {
          const buyable = (await client.readContract({
            address: marketAddr,
            abi: marketAbi,
            functionName: "isBuyable",
            args: [l.id],
          })) as boolean;
          return { ...l, isBuyable: buyable };
        } catch {
          return { ...l, isBuyable: false };
        }
      })
    );

    state.data.listings = listingsWithBuyable;

    // Connected user reads
    if (state.session?.address) {
      const user = state.session.address;
      const [userBal, userAllow, userNonce, lastFaucet, userMinted, isAppr] = await Promise.all([
        client.readContract({ address: tokenAddr, abi: tokenAbi, functionName: "balanceOf", args: [user] }) as Promise<bigint>,
        client.readContract({ address: tokenAddr, abi: tokenAbi, functionName: "allowance", args: [user, marketAddr] }) as Promise<bigint>,
        client.readContract({ address: tokenAddr, abi: tokenAbi, functionName: "nonces", args: [user] }) as Promise<bigint>,
        client.readContract({ address: tokenAddr, abi: tokenAbi, functionName: "lastFaucetAt", args: [user] }) as Promise<bigint>,
        client.readContract({ address: nftAddr, abi: nftAbi, functionName: "mintedBy", args: [user] }) as Promise<bigint>,
        client.readContract({ address: nftAddr, abi: nftAbi, functionName: "isApprovedForAll", args: [user, marketAddr] }) as Promise<boolean>,
      ]);

      state.data.userTokenBalance = userBal;
      state.data.userAllowance = userAllow;
      state.data.userNonce = userNonce;
      state.data.userLastFaucetAt = lastFaucet;
      state.data.userMintedCount = userMinted;
      state.data.isApprovedForAll = isAppr;

      // Scan owned tokens in batches of 20
      const owned: { tokenId: bigint; activeListingId: bigint; price?: bigint }[] = [];
      const total = Number(totalMinted);
      const allIds: bigint[] = [];
      for (let i = 1; i <= total; i++) allIds.push(BigInt(i));

      const chunkSize = 20;
      for (let i = 0; i < allIds.length; i += chunkSize) {
        const chunk = allIds.slice(i, i + chunkSize);
        const owners = await Promise.all(
          chunk.map(async (tid) => {
            try {
              const o = (await client.readContract({
                address: nftAddr,
                abi: nftAbi,
                functionName: "ownerOf",
                args: [tid],
              })) as Hex;
              return { tid, owner: o };
            } catch {
              return { tid, owner: null };
            }
          })
        );

        for (const item of owners) {
          if (item.owner && item.owner.toLowerCase() === user.toLowerCase()) {
            try {
              const activeListingId = (await client.readContract({
                address: marketAddr,
                abi: marketAbi,
                functionName: "activeListingOf",
                args: [item.tid],
              })) as bigint;

              let listingPrice: bigint | undefined = undefined;
              if (activeListingId > 0n) {
                const found = listingsWithBuyable.find((x) => x.id === activeListingId);
                if (found) listingPrice = found.price;
              }

              owned.push({ tokenId: item.tid, activeListingId, price: listingPrice });
            } catch {
              owned.push({ tokenId: item.tid, activeListingId: 0n });
            }
          }
        }
      }

      state.data.ownedTokens = owned;
    } else {
      state.data.userTokenBalance = 0n;
      state.data.userAllowance = 0n;
      state.data.userNonce = 0n;
      state.data.userLastFaucetAt = 0n;
      state.data.userMintedCount = 0n;
      state.data.isApprovedForAll = false;
      state.data.ownedTokens = [];
    }

    state.error = null;
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.loading = false;
    notify();
  }
}

setInterval(() => {
  void refresh();
}, 15000);


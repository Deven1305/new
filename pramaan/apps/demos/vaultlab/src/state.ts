import { contract, type Hex } from "./lib/config";
import { publicClient, type Session } from "./lib/wallet";
import { vaultAbi, tokenAbi } from "./abi";

export interface AppData {
  vaultVersion: string;
  vaultOwner: Hex | null;
  totalEthDeposits: bigint;
  totalTokenDeposits: bigint;
  vaultEthBalance: bigint;
  faucetCooldown: bigint;
  faucetAmount: bigint;
  userTokenVault: bigint;
  userEthVault: bigint;
  userTokenWallet: bigint;
  userEthWallet: bigint;
  allowance: bigint;
  lastFaucetAt: bigint;
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
    vaultVersion: "—",
    vaultOwner: null,
    totalEthDeposits: 0n,
    totalTokenDeposits: 0n,
    vaultEthBalance: 0n,
    faucetCooldown: 3600n,
    faucetAmount: 1000_000_000n,
    userTokenVault: 0n,
    userEthVault: 0n,
    userTokenWallet: 0n,
    userEthWallet: 0n,
    allowance: 0n,
    lastFaucetAt: 0n,
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
  let vaultAddr: Hex;
  let tokenAddr: Hex;
  try {
    vaultAddr = contract("vault");
    tokenAddr = contract("token");
  } catch (e) {
    state.error = e instanceof Error ? e.message : String(e);
    notify();
    return;
  }

  state.loading = true;
  try {
    const [
      version,
      owner,
      totalEth,
      totalToken,
      vaultEth,
      tokenDecimals,
      tokenSymbol,
      faucetCooldown,
      faucetAmount,
    ] = await Promise.all([
      client.readContract({ address: vaultAddr, abi: vaultAbi, functionName: "version" }) as Promise<string>,
      client.readContract({ address: vaultAddr, abi: vaultAbi, functionName: "owner" }) as Promise<Hex>,
      client.readContract({ address: vaultAddr, abi: vaultAbi, functionName: "totalEthDeposits" }) as Promise<bigint>,
      client.readContract({ address: vaultAddr, abi: vaultAbi, functionName: "totalTokenDeposits" }) as Promise<bigint>,
      client.getBalance({ address: vaultAddr }),
      client.readContract({ address: tokenAddr, abi: tokenAbi, functionName: "decimals" }) as Promise<number>,
      client.readContract({ address: tokenAddr, abi: tokenAbi, functionName: "symbol" }) as Promise<string>,
      client.readContract({ address: tokenAddr, abi: tokenAbi, functionName: "FAUCET_COOLDOWN" }) as Promise<bigint>,
      client.readContract({ address: tokenAddr, abi: tokenAbi, functionName: "FAUCET_AMOUNT" }) as Promise<bigint>,
    ]);

    state.decimals = tokenDecimals;
    state.symbol = tokenSymbol;
    state.data.vaultVersion = version;
    state.data.vaultOwner = owner;
    state.data.totalEthDeposits = totalEth;
    state.data.totalTokenDeposits = totalToken;
    state.data.vaultEthBalance = vaultEth;
    state.data.faucetCooldown = faucetCooldown;
    state.data.faucetAmount = faucetAmount;

    if (state.session?.address) {
      const user = state.session.address;
      const [userTokenV, userEthV, userTokenW, userEthW, userAllowance, lastFaucet] = await Promise.all([
        client.readContract({ address: vaultAddr, abi: vaultAbi, functionName: "tokenBalanceOf", args: [user] }) as Promise<bigint>,
        client.readContract({ address: vaultAddr, abi: vaultAbi, functionName: "ethBalanceOf", args: [user] }) as Promise<bigint>,
        client.readContract({ address: tokenAddr, abi: tokenAbi, functionName: "balanceOf", args: [user] }) as Promise<bigint>,
        client.getBalance({ address: user }),
        client.readContract({ address: tokenAddr, abi: tokenAbi, functionName: "allowance", args: [user, vaultAddr] }) as Promise<bigint>,
        client.readContract({ address: tokenAddr, abi: tokenAbi, functionName: "lastFaucetAt", args: [user] }) as Promise<bigint>,
      ]);

      state.data.userTokenVault = userTokenV;
      state.data.userEthVault = userEthV;
      state.data.userTokenWallet = userTokenW;
      state.data.userEthWallet = userEthW;
      state.data.allowance = userAllowance;
      state.data.lastFaucetAt = lastFaucet;
    } else {
      state.data.userTokenVault = 0n;
      state.data.userEthVault = 0n;
      state.data.userTokenWallet = 0n;
      state.data.userEthWallet = 0n;
      state.data.allowance = 0n;
      state.data.lastFaucetAt = 0n;
    }

    state.error = null;
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.loading = false;
    notify();
  }
}

// Refresh every 15 seconds
setInterval(() => {
  void refresh();
}, 15000);


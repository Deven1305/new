import { publicClient, type Session } from "./lib/wallet";
import { contract, type Hex } from "./lib/config";
import { farmAbi, tokenAbi } from "./abi";

export const FARM: Hex = contract("farm");
export const TOKEN: Hex = contract("token");

export interface FarmState {
  rewardRate: bigint;
  periodFinish: bigint;
  totalStaked: bigint;
  totalRewardsFunded: bigint;
  totalRewardsPaid: bigint;
  rewardsRemaining: bigint;
  staked: bigint;
  earned: bigint;
  tokenDecimals: number;
  tokenSymbol: string;
  tokenBalance: bigint;
  tokenAllowance: bigint;
  lastFaucetAt: bigint;
  faucetAmount: bigint;
  faucetCooldown: bigint;
  loading: boolean;
  error: string | null;
}

export const state: FarmState = {
  rewardRate: 0n,
  periodFinish: 0n,
  totalStaked: 0n,
  totalRewardsFunded: 0n,
  totalRewardsPaid: 0n,
  rewardsRemaining: 0n,
  staked: 0n,
  earned: 0n,
  tokenDecimals: 6,
  tokenSymbol: "pUSD",
  tokenBalance: 0n,
  tokenAllowance: 0n,
  lastFaucetAt: 0n,
  faucetAmount: 1_000_000_000n,
  faucetCooldown: 3600n,
  loading: true,
  error: null,
};

let currentSession: Session | null = null;
const listeners = new Set<() => void>();

export function getSession(): Session | null {
  return currentSession;
}

export function setSession(session: Session | null): void {
  currentSession = session;
  notify();
  void refresh();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch (e) {
      console.error(e);
    }
  }
}

export async function refresh(): Promise<void> {
  const client = publicClient();
  try {
    const [
      rewardRate,
      periodFinish,
      totalStaked,
      rewardsRemaining,
      totalRewardsPaid,
      totalRewardsFunded,
      tokenDecimals,
      tokenSymbol,
      faucetAmount,
      faucetCooldown,
    ] = await Promise.all([
      client.readContract({ address: FARM, abi: farmAbi, functionName: "rewardRate" }),
      client.readContract({ address: FARM, abi: farmAbi, functionName: "periodFinish" }),
      client.readContract({ address: FARM, abi: farmAbi, functionName: "totalStaked" }),
      client.readContract({ address: FARM, abi: farmAbi, functionName: "rewardsRemaining" }),
      client.readContract({ address: FARM, abi: farmAbi, functionName: "totalRewardsPaid" }),
      client.readContract({ address: FARM, abi: farmAbi, functionName: "totalRewardsFunded" }),
      client.readContract({ address: TOKEN, abi: tokenAbi, functionName: "decimals" }),
      client.readContract({ address: TOKEN, abi: tokenAbi, functionName: "symbol" }),
      client.readContract({ address: TOKEN, abi: tokenAbi, functionName: "FAUCET_AMOUNT" }).catch(() => 1_000_000_000n),
      client.readContract({ address: TOKEN, abi: tokenAbi, functionName: "FAUCET_COOLDOWN" }).catch(() => 3600n),
    ]);

    state.rewardRate = rewardRate;
    state.periodFinish = periodFinish;
    state.totalStaked = totalStaked;
    state.rewardsRemaining = rewardsRemaining;
    state.totalRewardsPaid = totalRewardsPaid;
    state.totalRewardsFunded = totalRewardsFunded;
    state.tokenDecimals = tokenDecimals;
    state.tokenSymbol = tokenSymbol;
    state.faucetAmount = faucetAmount;
    state.faucetCooldown = faucetCooldown;

    if (currentSession?.address) {
      const user = currentSession.address;
      const [staked, earned, tokenBalance, tokenAllowance, lastFaucetAt] = await Promise.all([
        client.readContract({ address: FARM, abi: farmAbi, functionName: "stakedOf", args: [user] }),
        client.readContract({ address: FARM, abi: farmAbi, functionName: "earned", args: [user] }),
        client.readContract({ address: TOKEN, abi: tokenAbi, functionName: "balanceOf", args: [user] }),
        client.readContract({ address: TOKEN, abi: tokenAbi, functionName: "allowance", args: [user, FARM] }),
        client.readContract({ address: TOKEN, abi: tokenAbi, functionName: "lastFaucetAt", args: [user] }).catch(() => 0n),
      ]);
      state.staked = staked;
      state.earned = earned;
      state.tokenBalance = tokenBalance;
      state.tokenAllowance = tokenAllowance;
      state.lastFaucetAt = lastFaucetAt;
    } else {
      state.staked = 0n;
      state.earned = 0n;
      state.tokenBalance = 0n;
      state.tokenAllowance = 0n;
      state.lastFaucetAt = 0n;
    }

    state.loading = false;
    state.error = null;
  } catch (err) {
    state.loading = false;
    state.error = (err as Error).message;
  }
  notify();
}

// Poll every 10 s (pending rewards grow)
setInterval(() => {
  void refresh();
}, 10_000);

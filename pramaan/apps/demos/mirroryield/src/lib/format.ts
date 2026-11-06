import { formatUnits, parseUnits } from "viem";
export function fmt(v: bigint, decimals: number, maxFrac = 4): string {
  const s = formatUnits(v, decimals);
  const [i, f = ""] = s.split(".");
  const frac = f.slice(0, maxFrac).replace(/0+$/, "");
  return `${BigInt(i).toLocaleString("en-US")}${frac ? "." + frac : ""}`;
}
export function parseAmount(input: string, decimals: number): bigint {
  const t = input.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) throw new Error("Enter a positive number.");
  const v = parseUnits(t, decimals);
  if (v <= 0n) throw new Error("Amount must be greater than zero.");
  return v;
}
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export function countdown(untilSec: bigint | number): string {
  const s = Number(untilSec) - Math.floor(Date.now() / 1000);
  if (s <= 0) return "ended";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

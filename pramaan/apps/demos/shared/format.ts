import { formatUnits, parseUnits } from "viem";

/** Human-readable token amount: thousands separators, at most `max` fraction digits (truncated, never rounded up). */
export function fmtUnits(v: bigint, decimals: number, max = 4): string {
  const negative = v < 0n;
  const [whole = "0", fraction = ""] = formatUnits(negative ? -v : v, decimals).split(".");
  const kept = fraction.slice(0, Math.max(0, max)).replace(/0+$/, "");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (v !== 0n && grouped === "0" && kept === "") return `${negative ? "-" : ""}<${(10 ** -max).toFixed(max)}`;
  return `${negative ? "-" : ""}${grouped}${kept ? `.${kept}` : ""}`;
}

/** 0x1234…abcd */
export function shortAddr(a: string): string {
  return /^0x[0-9a-fA-F]{40}$/.test(a) ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/**
 * Parses what a user typed into a base-unit amount. Returns null for anything that is not a plain positive decimal with
 * at most `decimals` fraction digits (no exponent, no sign, no spaces).
 */
export function parseAmount(text: string, decimals: number): bigint | null {
  const t = text.trim().replace(/,/g, "");
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return null;
  const [, fraction = ""] = t.split(".");
  if (fraction.length > decimals) return null;
  try {
    return parseUnits(t, decimals);
  } catch {
    return null;
  }
}

/** "in 2d 3h", "in 14m 5s", "ended" for a unix timestamp (seconds). */
export function fmtCountdown(untilSeconds: number, nowSeconds = Math.floor(Date.now() / 1000)): string {
  let left = untilSeconds - nowSeconds;
  if (left <= 0) return "ended";
  const d = Math.floor(left / 86_400);
  left -= d * 86_400;
  const h = Math.floor(left / 3_600);
  left -= h * 3_600;
  const m = Math.floor(left / 60);
  const s = left - m * 60;
  if (d > 0) return `in ${d}d ${h}h`;
  if (h > 0) return `in ${h}h ${m}m`;
  return m > 0 ? `in ${m}m ${s}s` : `in ${s}s`;
}

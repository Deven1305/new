import type { Address, Lang, TokenRef } from "./types.js";

/** Approvals at or above 2^255 (and Permit2's uint160 max) are treated as unlimited, the convention wallets use. */
export const UNLIMITED_THRESHOLD = 2n ** 255n;
export const UINT160_MAX = 2n ** 160n - 1n;
export const UINT48_MAX = 2n ** 48n - 1n;

export function isUnlimited(amount: bigint, bits = 256): boolean {
  if (bits === 160) return amount >= UINT160_MAX;
  return amount >= UNLIMITED_THRESHOLD;
}

export function shortAddress(address: string): string {
  return address.length === 42 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

export function labelAddress(address: Address, labels?: Record<string, string>): string {
  const label = labels?.[address.toLowerCase()];
  return label ? `${label} (${shortAddress(address)})` : shortAddress(address);
}

function group(intPart: string, lang: Lang): string {
  if (lang === "en") return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  // Indian grouping (12,34,567) for Hindi and Marathi.
  if (intPart.length <= 3) return intPart;
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}

/** Exact decimal rendering of a token amount (no floating point), trimmed to `maxFraction` digits. */
export function formatUnitsExact(amount: bigint, decimals: number, lang: Lang = "en", maxFraction = 6): string {
  const neg = amount < 0n;
  const abs = neg ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const intPart = (abs / base).toString();
  let frac = decimals > 0 ? (abs % base).toString().padStart(decimals, "0") : "";
  let approx = false;
  if (frac.length > maxFraction) {
    approx = /[1-9]/.test(frac.slice(maxFraction));
    frac = frac.slice(0, maxFraction);
  }
  frac = frac.replace(/0+$/, "");
  const text = `${group(intPart, lang)}${frac ? `.${frac}` : ""}`;
  return `${neg ? "-" : ""}${approx ? "≈" : ""}${text}`;
}

const UNLIMITED_WORD: Record<Lang, string> = { en: "unlimited", hi: "असीमित", mr: "अमर्यादित" };

export function formatTokenAmount(amount: bigint, token: TokenRef | null, lang: Lang, unlimited = false): string {
  if (unlimited) return UNLIMITED_WORD[lang];
  if (!token || token.decimals === null) return `${amount.toString()} ${lang === "en" ? "base units" : "units"}`;
  return formatUnitsExact(amount, token.decimals, lang);
}

export function tokenName(token: TokenRef | null): string {
  if (!token) return "tokens";
  return token.symbol ?? shortAddress(token.address);
}

export function formatDeadline(deadline: bigint | null, lang: Lang): string {
  if (deadline === null) return lang === "en" ? "no expiry" : lang === "hi" ? "बिना समय-सीमा" : "मुदत नाही";
  if (deadline >= UINT48_MAX || deadline > 4_102_444_800n) {
    return lang === "en" ? "never expires" : lang === "hi" ? "कभी समाप्त नहीं" : "कधीही संपत नाही";
  }
  const d = new Date(Number(deadline) * 1000);
  return d.toISOString().replace("T", " ").replace(/:\d{2}\.\d{3}Z$/, " UTC");
}

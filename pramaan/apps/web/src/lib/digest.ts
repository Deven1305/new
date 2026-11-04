/**
 * In-browser hashing so the dashboard can check what it downloads instead of trusting the label next to it.
 * `canonicalJson` is RFC 8785 (JCS) for the JSON the backend serves: object keys sorted by UTF-16 code units,
 * ECMAScript number and string serialisation, no whitespace (the same scheme as @pramaan/manifest).
 */

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("canonicalJson: non-finite number");
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new TypeError(`canonicalJson: unsupported type ${typeof value}`);
  }
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

const HEX = "0123456789abcdef";

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += HEX[b >> 4]! + HEX[b & 15]!;
  return out;
}

export function hasWebCrypto(): boolean {
  return typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.subtle?.digest === "function";
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy.buffer);
  return toHex(new Uint8Array(digest));
}

export type DigestCheck =
  | { status: "match"; actual: string; method: "bytes" | "canonical" }
  | { status: "mismatch"; actual: string; canonical: string | null }
  | { status: "unavailable"; reason: string };

/**
 * Checks downloaded bytes against an expected sha256: first the raw bytes, then (for JSON) the RFC 8785 canonical
 * form, since the backend may store JSON in a database that does not preserve key order.
 */
export async function checkDigest(bytes: Uint8Array, expected: string): Promise<DigestCheck> {
  if (!hasWebCrypto()) return { status: "unavailable", reason: "WebCrypto is not available in this browser context" };
  const want = expected.trim().toLowerCase().replace(/^0x/, "");
  const actual = await sha256Hex(bytes);
  if (actual === want) return { status: "match", actual, method: "bytes" };
  let canonical: string | null = null;
  try {
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    canonical = await sha256Hex(canonicalJson(parsed));
    if (canonical === want) return { status: "match", actual: canonical, method: "canonical" };
  } catch {
    canonical = null;
  }
  return { status: "mismatch", actual, canonical };
}

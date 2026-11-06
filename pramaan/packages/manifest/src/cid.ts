import { hexToBytes, sha256Hex } from "./hash.js";

/**
 * CIDv1 with the `raw` codec (0x55) and a sha2-256 multihash, base32-lower multibase (`bafkrei…`).
 *
 * A manifest uploaded to IPFS as a single raw block has exactly this CID, and the multihash digest IS the manifest's
 * sha256. So the CID can be derived from the ENS pointer alone, and any gateway's bytes can be checked locally.
 */
const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

function base32Lower(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]!;
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]!;
  return out;
}

function base32LowerDecode(text: string): Uint8Array {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of text) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("invalid base32 character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function rawCidFromSha256(sha256hex: string): string {
  const digest = hexToBytes(sha256hex);
  if (digest.length !== 32) throw new Error("sha256 digest must be 32 bytes");
  const bytes = new Uint8Array(4 + 32);
  bytes.set([0x01, 0x55, 0x12, 0x20], 0);
  bytes.set(digest, 4);
  return `b${base32Lower(bytes)}`;
}

export function rawCidForBytes(data: Uint8Array): string {
  return rawCidFromSha256(sha256Hex(data));
}

/** Returns the sha256 hex inside a raw-codec sha2-256 CIDv1, or null for any other CID. */
export function sha256FromRawCid(cid: string): string | null {
  if (!cid.startsWith("b")) return null;
  let bytes: Uint8Array;
  try {
    bytes = base32LowerDecode(cid.slice(1));
  } catch {
    return null;
  }
  if (bytes.length !== 36 || bytes[0] !== 0x01 || bytes[1] !== 0x55 || bytes[2] !== 0x12 || bytes[3] !== 0x20) return null;
  return Array.from(bytes.slice(4), (b) => b.toString(16).padStart(2, "0")).join("");
}

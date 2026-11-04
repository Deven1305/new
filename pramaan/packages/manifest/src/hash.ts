import { sha256 as nobleSha256, sha384 as nobleSha384 } from "@noble/hashes/sha2.js";

const HEX = "0123456789abcdef";

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += HEX[b >> 4]! + HEX[b & 15]!;
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) throw new Error("invalid hex");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Lowercase hex sha256, no 0x prefix (the form used in pointers and manifest `files[].sha256`). */
export function sha256Hex(data: Uint8Array | string): string {
  return bytesToHex(nobleSha256(typeof data === "string" ? utf8(data) : data));
}

export function sha256Bytes(data: Uint8Array | string): Uint8Array {
  return nobleSha256(typeof data === "string" ? utf8(data) : data);
}

export function base64Encode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function base64Decode(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  return base64Encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(text: string): Uint8Array {
  const normal = text.replace(/-/g, "+").replace(/_/g, "/");
  return base64Decode(normal + "=".repeat((4 - (normal.length % 4)) % 4));
}

/** W3C Subresource Integrity value using sha384, e.g. `sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K/uxy9rx7HNQlGYl1kPzQho1wx4JwY8wC`. */
export function sriSha384(data: Uint8Array | string): string {
  return `sha384-${base64Encode(nobleSha384(typeof data === "string" ? utf8(data) : data))}`;
}

/** Constant-time comparison for equal-length strings (digests). */
export function digestEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const enc = new TextEncoder();

/** Pure-JS sha256 (the CRE WASM runtime has no node:crypto / WebCrypto). */
export function sha256Hex(data: Uint8Array | string): string {
  return bytesToHex(sha256(typeof data === "string" ? enc.encode(data) : data));
}

export function hmacSha256Hex(key: string, data: Uint8Array | string): string {
  return bytesToHex(hmac(sha256, enc.encode(key), typeof data === "string" ? enc.encode(data) : data));
}

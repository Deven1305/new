import { canonicalBytes } from "./canonical.js";
import { sha256Hex } from "./hash.js";
import { ManifestV1 } from "./schema.js";

export * from "./canonical.js";
export * from "./hash.js";
export * from "./pointer.js";
export * from "./cid.js";
export * from "./schema.js";
export * from "./dsse.js";

/** The exact bytes that get published, hashed, pinned to IPFS and pointed to from ENS. */
export function manifestBytes(manifest: ManifestV1): Uint8Array {
  return canonicalBytes(ManifestV1.parse(manifest));
}

export function manifestDigest(manifest: ManifestV1): string {
  return sha256Hex(manifestBytes(manifest));
}

export type ManifestParse = { ok: true; manifest: ManifestV1; sha256: string } | { ok: false; reason: string };

/**
 * Parses fetched manifest bytes and checks them against the digest the ENS pointer committed to. The digest check runs
 * on the raw bytes BEFORE any parsing, so a modified manifest is rejected no matter what it contains.
 */
export function parseManifestBytes(bytes: Uint8Array, expectedSha256?: string): ManifestParse {
  const actual = sha256Hex(bytes);
  if (expectedSha256 !== undefined && actual !== expectedSha256) {
    return { ok: false, reason: `manifest sha256 ${actual} does not match the ENS pointer ${expectedSha256}` };
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, reason: "manifest is not valid UTF-8 JSON" };
  }
  const parsed = ManifestV1.safeParse(json);
  if (!parsed.success) return { ok: false, reason: `manifest does not match schema v1: ${parsed.error.issues[0]?.message ?? "invalid"}` };
  return { ok: true, manifest: parsed.data, sha256: actual };
}

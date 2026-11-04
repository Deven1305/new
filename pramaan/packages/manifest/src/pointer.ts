/**
 * The value stored in the ENS text record `pramaan.record`:
 *
 *   pramaan:v1:<tag>:<sha256 of the canonical manifest bytes, 64 lowercase hex>
 *
 * PramaanTimelock enforces the `pramaan:v1:` prefix and printable ASCII on-chain; this codec enforces the full shape.
 */
export const POINTER_PREFIX = "pramaan:v1:";
const TAG_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const DIGEST_RE = /^[0-9a-f]{64}$/;

export interface Pointer {
  version: 1;
  tag: string;
  manifestSha256: string;
}

export function encodePointer(tag: string, manifestSha256: string): string {
  if (!TAG_RE.test(tag)) throw new Error(`invalid release tag "${tag}"`);
  if (!DIGEST_RE.test(manifestSha256)) throw new Error("manifest sha256 must be 64 lowercase hex characters");
  return `${POINTER_PREFIX}${tag}:${manifestSha256}`;
}

export type PointerParse = { ok: true; pointer: Pointer } | { ok: false; reason: string };

export function parsePointer(value: string | null | undefined): PointerParse {
  if (!value) return { ok: false, reason: "record is empty" };
  if (value.length > 256) return { ok: false, reason: "record is longer than 256 characters" };
  if (!value.startsWith(POINTER_PREFIX)) return { ok: false, reason: "record does not start with pramaan:v1:" };
  const rest = value.slice(POINTER_PREFIX.length);
  const sep = rest.lastIndexOf(":");
  if (sep <= 0) return { ok: false, reason: "record has no tag/digest separator" };
  const tag = rest.slice(0, sep);
  const digest = rest.slice(sep + 1);
  if (!TAG_RE.test(tag)) return { ok: false, reason: `invalid tag "${tag}"` };
  if (!DIGEST_RE.test(digest)) return { ok: false, reason: "digest is not 64 lowercase hex characters" };
  return { ok: true, pointer: { version: 1, tag, manifestSha256: digest } };
}

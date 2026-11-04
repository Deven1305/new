/** Pointer codec, identical to packages/manifest/src/pointer.ts (`pramaan:v1:<tag>:<sha256>`). */
export const POINTER_PREFIX = "pramaan:v1:";
const TAG_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const DIGEST_RE = /^[0-9a-f]{64}$/;

export type PointerParse = { ok: true; tag: string; sha256: string } | { ok: false; reason: string };

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
  return { ok: true, tag, sha256: digest };
}

/**
 * `pramaan.revoked`: whitespace/comma separated sha256 digests, optionally written as `sha256:<hex>`.
 * Tokens that are not a 64-hex digest are ignored (and counted), so a garbled entry can never revoke or hide a release
 * by accident.
 */
export function parseRevoked(raw: string | null | undefined): { digests: string[]; ignored: number } {
  if (!raw) return { digests: [], ignored: 0 };
  const digests: string[] = [];
  let ignored = 0;
  for (const token of raw.split(/[\s,]+/)) {
    if (!token) continue;
    const hex = (token.startsWith("sha256:") ? token.slice(7) : token).toLowerCase();
    if (DIGEST_RE.test(hex)) digests.push(hex);
    else ignored++;
  }
  return { digests: [...new Set(digests)], ignored };
}

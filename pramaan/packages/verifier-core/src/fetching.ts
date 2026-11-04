import { parseManifestBytes, rawCidFromSha256, sha256FromRawCid, sha256Hex, type ManifestV1, type Pointer, type WellKnownHint } from "@pramaan/manifest";

export const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
export const MAX_BUNDLE_BYTES = 512 * 1024;
export const DEFAULT_IPFS_GATEWAYS = ["https://ipfs.io", "https://dweb.link"];

export interface FetchOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

/** GETs a URL with a timeout and a hard byte cap (streamed, so an endless body cannot exhaust memory). */
export async function fetchBytes(url: string, opts: FetchOptions = {}): Promise<Uint8Array> {
  const f = opts.fetchFn ?? fetch;
  const max = opts.maxBytes ?? MAX_MANIFEST_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await f(url, { signal: controller.signal, cache: "no-store", credentials: "omit", redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > max) throw new Error(`response larger than ${max} bytes`);
    if (!res.body) return new Uint8Array(await res.arrayBuffer());
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel();
        throw new Error(`response larger than ${max} bytes`);
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}

function safeUrl(raw: string, origin: string): string | null {
  try {
    const u = new URL(raw, origin);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function githubReleaseAsset(repo: string | null | undefined, tag: string, file: string): string | null {
  if (!repo) return null;
  const m = repo.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  return m ? `https://github.com/${m[1]}/${m[2]}/releases/download/${encodeURIComponent(tag)}/${file}` : null;
}

export interface ManifestSourceInput {
  pointer: Pointer;
  origin: string;
  hint?: WellKnownHint | null;
  /** The owner-set `pramaan.repo` record (never the manifest's own claim). */
  repo?: string | null;
  ipfsGateways?: string[];
}

/**
 * Every place the manifest may be served from. None is trusted: the bytes are accepted only if they hash to the
 * digest in the ENS pointer, so availability can come from the site, GitHub releases or any IPFS gateway.
 */
export function manifestCandidateUrls(input: ManifestSourceInput): string[] {
  return manifestCandidates(input).flatMap((c) => (c.url ? [c.url] : []));
}

export type ManifestSourceKind = "hint" | "origin" | "github" | "ipfs";

/** Checks that a CID named by a hint commits to the pointer: only a raw-codec sha2-256 CIDv1 of the same digest can. */
export function cidMatchesPointer(cid: string, manifestSha256: string): { ok: true } | { ok: false; reason: string } {
  if (!/^b[a-z2-7]{20,}$/.test(cid)) return { ok: false, reason: `"${cid.slice(0, 64)}" is not a base32 CIDv1` };
  const digest = sha256FromRawCid(cid);
  if (digest === null) return { ok: false, reason: `CID ${cid.slice(0, 20)}… is not a raw sha2-256 CID, so it cannot commit to the ENS pointer` };
  if (digest !== manifestSha256) return { ok: false, reason: `CID ${cid.slice(0, 20)}… names sha256 ${digest.slice(0, 16)}…, not the ENS pointer's digest` };
  return { ok: true };
}

function cidInUrl(u: string): string | null {
  const m = u.match(/^ipfs:\/\/([^/?#]+)/i) ?? u.match(/\/ipfs\/([^/?#]+)/);
  return m ? m[1]! : null;
}

interface Candidate {
  url: string | null;
  kind: ManifestSourceKind;
  /** Set when the candidate was refused without fetching (a wrong or invalid CID). */
  invalid?: string;
}

function manifestCandidates(input: ManifestSourceInput): Candidate[] {
  const out: Candidate[] = [];
  for (const u of input.hint?.manifestUrls ?? []) {
    const cid = cidInUrl(u);
    if (cid) {
      const check = cidMatchesPointer(cid, input.pointer.manifestSha256);
      if (!check.ok) {
        out.push({ url: null, kind: "hint", invalid: check.reason });
        continue;
      }
      if (/^ipfs:/i.test(u)) continue; // the CID derived below fetches exactly this block from the configured gateways
    }
    out.push({ url: safeUrl(u, input.origin), kind: "hint" });
  }
  out.push({ url: safeUrl("/.well-known/pramaan-manifest.json", input.origin), kind: "origin" });
  out.push({ url: githubReleaseAsset(input.repo, input.pointer.tag, "pramaan-manifest.json"), kind: "github" });
  const cid = rawCidFromSha256(input.pointer.manifestSha256);
  for (const gw of input.ipfsGateways ?? DEFAULT_IPFS_GATEWAYS) out.push({ url: safeUrl(`${gw.replace(/\/$/, "")}/ipfs/${cid}?format=raw`, input.origin), kind: "ipfs" });
  const seen = new Set<string>();
  return out.filter((c) => {
    if (c.url === null) return !!c.invalid;
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });
}

export function signatureCandidateUrls(input: ManifestSourceInput, mode: "github" | "key"): string[] {
  const file = mode === "github" ? "pramaan-manifest.sigstore.json" : "pramaan-manifest.dsse.json";
  const urls: (string | null)[] = [];
  for (const u of input.hint?.signatureUrls ?? []) urls.push(safeUrl(u, input.origin));
  urls.push(safeUrl(`/.well-known/${file}`, input.origin));
  urls.push(githubReleaseAsset(input.repo, input.pointer.tag, file));
  return [...new Set(urls.filter((u): u is string => !!u))];
}

export type ManifestFetch =
  | { ok: true; manifest: ManifestV1; bytes: Uint8Array; sha256: string; source: string; attempts: Attempt[] }
  | { ok: false; reason: string; tampered: boolean; attempts: Attempt[] };

export interface Attempt {
  url: string;
  outcome: "match" | "digest-mismatch" | "invalid" | "error";
  detail: string;
  /** Where the candidate came from (optional for backward compatibility). */
  kind?: ManifestSourceKind;
}

/**
 * Fetches the manifest from the candidates until one hashes to the pointer.
 *
 * `tampered` (a confirmed mismatch) is set only when a source the PUBLISHER controls (the site, a URL its hint names, the
 * repo's GitHub release) served different bytes. A public IPFS gateway answering with wrong bytes (an HTML error page
 * with HTTP 200, a truncated body) is a service failure like a timeout: "unverifiable", never "mismatch".
 */
export async function fetchVerifiedManifest(input: ManifestSourceInput, opts: FetchOptions = {}): Promise<ManifestFetch> {
  const attempts: Attempt[] = [];
  for (const c of manifestCandidates(input)) {
    if (c.url === null) {
      attempts.push({ url: "hint:manifestUrls", outcome: "invalid", detail: c.invalid ?? "invalid", kind: c.kind });
      continue;
    }
    const url = c.url;
    let bytes: Uint8Array;
    try {
      bytes = await fetchBytes(url, { ...opts, maxBytes: MAX_MANIFEST_BYTES });
    } catch (err) {
      attempts.push({ url, outcome: "error", detail: (err as Error).message, kind: c.kind });
      continue;
    }
    const actual = sha256Hex(bytes);
    if (actual !== input.pointer.manifestSha256) {
      const gateway = c.kind === "ipfs";
      attempts.push({
        url,
        outcome: gateway ? "error" : "digest-mismatch",
        detail: gateway ? `gateway returned bytes with sha256 ${actual} (gateway failure, not the publisher's file)` : `sha256 ${actual}`,
        kind: c.kind,
      });
      continue;
    }
    const parsed = parseManifestBytes(bytes, input.pointer.manifestSha256);
    if (!parsed.ok) {
      attempts.push({ url, outcome: "invalid", detail: parsed.reason, kind: c.kind });
      continue;
    }
    attempts.push({ url, outcome: "match", detail: "sha256 matches the ENS pointer", kind: c.kind });
    return { ok: true, manifest: parsed.manifest, bytes, sha256: actual, source: url, attempts };
  }
  const tampered = attempts.some((a) => a.outcome === "digest-mismatch");
  return {
    ok: false,
    tampered,
    attempts,
    reason: tampered
      ? "a manifest was served but its sha256 does not match the ENS pointer"
      : "no source served the manifest the ENS pointer commits to (sources failed or unavailable)",
  };
}

export async function fetchFirstJson(urls: string[], opts: FetchOptions = {}): Promise<{ url: string; json: unknown } | null> {
  for (const url of urls) {
    try {
      const bytes = await fetchBytes(url, { ...opts, maxBytes: MAX_BUNDLE_BYTES });
      return { url, json: JSON.parse(new TextDecoder().decode(bytes)) };
    } catch {
      // try the next source
    }
  }
  return null;
}

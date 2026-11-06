import { BaseError, HttpRequestError, TimeoutError, type PublicClient } from "viem";
import { normalize } from "viem/ens";
import { agreed, assertChainId, makeClients, requiredAgreement, type ChainConfig } from "./rpc.js";

/**
 * ENS text keys Pramaan reads. `pramaan.record` is writable only by the app's PramaanTimelock, `pramaan.revoked` only by
 * the guardian (both through key-scoped ENSv2 resolver roles); every other key is owner-only.
 */
export const PRAMAAN_KEYS = [
  "pramaan.record",
  "pramaan.domain",
  "pramaan.repo",
  "pramaan.attestation",
  "pramaan.signer",
  "pramaan.revoked",
  "pramaan.timelock",
] as const;
export type PramaanKey = (typeof PRAMAAN_KEYS)[number];
export type PramaanRecords = Record<PramaanKey, string | null>;

export function isTransportError(err: unknown): boolean {
  if (err instanceof BaseError) return err.walk((e) => e instanceof HttpRequestError || e instanceof TimeoutError) !== null;
  return err instanceof TypeError; // fetch() network failures
}

export type RecordsResult =
  | { status: "ok"; records: PramaanRecords; sources: number; singleSource: boolean }
  | { status: "disagree" | "error"; detail: string };

async function readAll(client: PublicClient, name: string, ur: `0x${string}` | undefined, chainId: number): Promise<PramaanRecords> {
  await assertChainId(client, chainId);
  const values = await Promise.all(
    PRAMAAN_KEYS.map((key) =>
      client.getEnsText({ name, key, universalResolverAddress: ur, strict: true }).catch((err: unknown) => {
        // A missing name, resolver or record reverts in the Universal Resolver and counts as "no record". A transport
        // failure (HTTP error, timeout) must surface so the agreement check reports "unknown" instead of "empty".
        if (isTransportError(err)) throw err;
        return null;
      }),
    ),
  );
  return Object.fromEntries(PRAMAAN_KEYS.map((k, i) => [k, values[i] ? String(values[i]) : null])) as PramaanRecords;
}

/** Reads every Pramaan key from each configured RPC; all answers must agree. */
export async function readPramaanRecords(cfg: ChainConfig, ensName: string, clients: PublicClient[] = makeClients(cfg)): Promise<RecordsResult> {
  let name: string;
  try {
    name = normalize(ensName);
  } catch {
    return { status: "error", detail: `"${ensName}" is not a valid ENS name` };
  }
  const result = await agreed(clients, requiredAgreement(cfg), (c) => readAll(c, name, cfg.universalResolver, cfg.chainId));
  if (result.status === "agreed") return { status: "ok", records: result.value, sources: result.sources, singleSource: result.singleSource };
  return { status: result.status === "disagree" ? "disagree" : "error", detail: result.detail };
}

/** DNS wire-format encoding of an ENS name, as ENSv2 resolvers take it (e.g. `\x07example\x03eth\x00`). */
export function dnsEncode(ensName: string): `0x${string}` {
  const name = normalize(ensName);
  const bytes: number[] = [];
  for (const label of name.split(".")) {
    const encoded = new TextEncoder().encode(label);
    if (encoded.length === 0 || encoded.length > 255) throw new Error(`invalid label length in ${ensName}`);
    bytes.push(encoded.length, ...encoded);
  }
  bytes.push(0);
  return `0x${bytes.map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Normalizes an origin for exact comparison with `pramaan.domain` (lowercase scheme/host, default ports dropped). */
export function normalizeOrigin(value: string): string | null {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * `pramaan.revoked` format (v1): zero or more manifest sha256 digests (64 hex), separated by single spaces, at most
 * MAX_REVOCATIONS entries, written by the guardian. Readers also accept commas/whitespace runs and upper-case hex, but
 * anything else (a tag, a CID, garbage, too many entries) makes the record MALFORMED: the verifier then refuses to call
 * the release verified, because a revocation it cannot read might be the one that matters.
 */
export const REVOKED_KEY = "pramaan.revoked";
export const MAX_REVOCATIONS = 16;
export const MAX_REVOKED_RECORD_LENGTH = MAX_REVOCATIONS * 65 - 1;

export type RevocationParse = { ok: true; revoked: string[] } | { ok: false; reason: string };

export function parseRevocations(value: string | null | undefined): RevocationParse {
  const raw = (value ?? "").trim();
  if (!raw) return { ok: true, revoked: [] };
  if (raw.length > MAX_REVOKED_RECORD_LENGTH + 64) return { ok: false, reason: `pramaan.revoked is longer than ${MAX_REVOKED_RECORD_LENGTH} characters` };
  const entries = raw.split(/[\s,]+/).filter(Boolean);
  const bad = entries.find((e) => !/^[0-9a-fA-F]{64}$/.test(e));
  if (bad !== undefined) return { ok: false, reason: `pramaan.revoked contains "${bad.slice(0, 24)}", which is not a manifest sha256` };
  const revoked = [...new Set(entries.map((e) => e.toLowerCase()))];
  if (revoked.length > MAX_REVOCATIONS) return { ok: false, reason: `pramaan.revoked lists ${revoked.length} entries (max ${MAX_REVOCATIONS})` };
  return { ok: true, revoked };
}

/** Canonical record value for a revocation list (deduplicated, order preserved). Throws if the list is invalid. */
export function formatRevocations(list: readonly string[]): string {
  const value = [...new Set(list.map((x) => x.toLowerCase()))].join(" ");
  const parsed = parseRevocations(value);
  if (!parsed.ok) throw new Error(parsed.reason);
  return value;
}

/** True for a 0x-prefixed 20-byte hex address (any case). */
export function isAddressRecord(value: string | null | undefined): value is `0x${string}` {
  return !!value && /^0x[0-9a-fA-F]{40}$/.test(value.trim());
}

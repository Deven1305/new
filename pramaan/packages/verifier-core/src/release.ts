import { parsePointer, WellKnownHint, WELL_KNOWN_PATH, type ManifestV1, type Pointer } from "@pramaan/manifest";
import { dnsEncode, isAddressRecord, normalizeOrigin, parseRevocations, readPramaanRecords, type PramaanRecords, type RecordsResult } from "./ens.js";
import { fetchBytes, fetchFirstJson, fetchVerifiedManifest, signatureCandidateUrls, type Attempt, type FetchOptions } from "./fetching.js";
import type { ChainConfig } from "./rpc.js";
import { attestationPolicy, verifyReleaseSignature, type SignatureResult, type SigstoreProvider } from "./signature.js";
import { assessTimelock, readTimelockState, type PendingRelease, type TimelockRead, type TimelockState } from "./timelock.js";

/** Unchanged six values (the extension's popup has a string for each). Finer detail is in `reason`. */
export type ReleaseStatus = "verified" | "missing" | "mismatch" | "invalid-signature" | "revoked" | "unverifiable";

/**
 * Machine-readable cause of a non-green result. Confirmed problems map to "mismatch"/"invalid-signature"/"revoked"
 * (red); unknowns and service failures map to "unverifiable" (amber); "update-pending" keeps "verified" but amber.
 */
export type ReleaseReason =
  | "not-an-origin"
  | "no-hint"
  | "pin-mismatch"
  | "no-chain-config"
  | "rpc-disagree"
  | "rpc-unavailable"
  | "domain-mismatch"
  | "domain-record-malformed"
  | "no-pointer"
  | "pointer-malformed"
  | "revoked"
  | "revocations-malformed"
  | "timelock-record-malformed"
  | "timelock-unreadable"
  | "timelock-mismatch"
  | "pointer-not-from-timelock"
  | "replayed-pointer"
  | "manifest-digest-mismatch"
  | "manifest-unavailable"
  | "binding-mismatch"
  | "signature-invalid"
  | "signature-missing"
  | "update-pending";

export interface Check {
  id: string;
  status: "pass" | "fail" | "warn" | "skip";
  detail: string;
}

export interface ReleaseVerification {
  status: ReleaseStatus;
  /** Why the status is not plain "verified" (null when verified with nothing pending). */
  reason: ReleaseReason | null;
  origin: string;
  ensName: string | null;
  chainId: number | null;
  pointer: Pointer | null;
  manifest: ManifestV1 | null;
  manifestSha256: string | null;
  manifestSource: string | null;
  signature: SignatureResult | null;
  records: PramaanRecords | null;
  singleSource: boolean;
  /** Manifest digests listed in `pramaan.revoked`. */
  revocations: string[];
  /** Release timelock state, when the name publishes `pramaan.timelock`. */
  timelock: Pick<TimelockState, "address" | "delay" | "lastExecutedId" | "operationCount"> | null;
  /** Newer pointers queued in the timelock that can still take effect (newest first). */
  pending: PendingRelease[];
  checks: Check[];
  attempts: Attempt[];
  verifiedAt: string;
}

/** First-seen binding of an origin to an ENS name (trust on first use). */
export interface PinStore {
  get(origin: string): Promise<string | null>;
  set(origin: string, ensName: string): Promise<void>;
}

export const memoryPinStore = (): PinStore => {
  const m = new Map<string, string>();
  return { get: async (o) => m.get(o) ?? null, set: async (o, n) => void m.set(o, n) };
};

export interface VerifySiteInput {
  origin: string;
  /** RPC configuration per chain id; the hint's chainId selects one. */
  chains: Record<number, ChainConfig>;
  pins?: PinStore;
  sigstore?: SigstoreProvider;
  ipfsGateways?: string[];
  fetchOptions?: FetchOptions;
  /** Pre-fetched hint (the extension may already have it); fetched from the origin otherwise. */
  hint?: unknown;
  /** Override for tests and alternative transports; defaults to reading ENS through the chain's RPCs. */
  recordsReader?: (chain: ChainConfig, ensName: string) => Promise<RecordsResult>;
  /** Override for tests; defaults to reading the PramaanTimelock through the chain's RPCs (all must agree). */
  timelockReader?: (chain: ChainConfig, address: `0x${string}`) => Promise<TimelockRead>;
}

/**
 * The full trust chain for a website, with nothing taken from the site on trust:
 * hint → ENS records (≥2 RPCs agree, each proven to serve the right chain) → pramaan.domain == origin → TOFU pin →
 * pointer → not revoked → pointer was activated by the release timelock (no replay, pending updates shown) →
 * manifest by hash → manifest binds the same name/origin/tag → signature under the owner's policy.
 */
export async function verifySiteRelease(input: VerifySiteInput): Promise<ReleaseVerification> {
  const origin = normalizeOrigin(input.origin);
  const checks: Check[] = [];
  const out: ReleaseVerification = {
    status: "unverifiable",
    reason: null,
    origin: origin ?? input.origin,
    ensName: null,
    chainId: null,
    pointer: null,
    manifest: null,
    manifestSha256: null,
    manifestSource: null,
    signature: null,
    records: null,
    singleSource: false,
    revocations: [],
    timelock: null,
    pending: [],
    checks,
    attempts: [],
    verifiedAt: new Date().toISOString(),
  };
  const finish = (status: ReleaseStatus, reason: ReleaseReason | null) => ({ ...out, status, reason });
  if (!origin) {
    checks.push({ id: "origin", status: "fail", detail: "not an http(s) origin" });
    return finish("unverifiable", "not-an-origin");
  }

  // 1. Hint (untrusted): which ENS name does the site claim?
  let hintJson = input.hint;
  if (hintJson === undefined) {
    try {
      hintJson = JSON.parse(new TextDecoder().decode(await fetchBytes(`${origin}${WELL_KNOWN_PATH}`, { ...input.fetchOptions, maxBytes: 16_384 })));
    } catch {
      hintJson = null;
    }
  }
  const hint = WellKnownHint.safeParse(hintJson);
  if (!hint.success) {
    checks.push({ id: "hint", status: "skip", detail: `no valid ${WELL_KNOWN_PATH}` });
    const pinned = await input.pins?.get(origin);
    if (pinned) {
      checks.push({ id: "pin", status: "fail", detail: `this site was previously bound to ${pinned} but no longer publishes a release` });
      return finish("mismatch", "pin-mismatch");
    }
    return finish("missing", "no-hint");
  }
  out.ensName = hint.data.ensName;
  out.chainId = hint.data.chainId;
  checks.push({ id: "hint", status: "pass", detail: `site claims ${hint.data.ensName} on chain ${hint.data.chainId}` });

  // 2. TOFU: the origin must keep pointing at the ENS name it pointed at the first time.
  const pinned = await input.pins?.get(origin);
  if (pinned && pinned !== hint.data.ensName) {
    checks.push({ id: "pin", status: "fail", detail: `first seen as ${pinned}, now claims ${hint.data.ensName}` });
    return finish("mismatch", "pin-mismatch");
  }
  checks.push({ id: "pin", status: pinned ? "pass" : "warn", detail: pinned ? `matches first-seen ${pinned}` : "first visit: binding will be pinned" });

  const chain = input.chains[hint.data.chainId];
  if (!chain) {
    checks.push({ id: "chain", status: "fail", detail: `no RPC configured for chain ${hint.data.chainId}` });
    return finish("unverifiable", "no-chain-config");
  }

  // 3. ENS records from independent RPCs.
  const rec = await (input.recordsReader ?? readPramaanRecords)(chain, hint.data.ensName);
  if (rec.status !== "ok") {
    checks.push({ id: "ens", status: "fail", detail: rec.status === "disagree" ? `RPCs disagree about the ENS records: ${rec.detail}` : `ENS records could not be read: ${rec.detail}` });
    return finish("unverifiable", rec.status === "disagree" ? "rpc-disagree" : "rpc-unavailable");
  }
  out.records = rec.records;
  out.singleSource = rec.singleSource;
  checks.push({
    id: "ens",
    status: rec.singleSource ? "warn" : "pass",
    detail: rec.singleSource ? "records read from a single RPC (development setting)" : `records agreed by ${rec.sources} RPCs`,
  });

  // 4. Two-way binding: the ENS name must claim this exact origin.
  const domainRecord = rec.records["pramaan.domain"];
  const claimed = domainRecord ? normalizeOrigin(domainRecord) : null;
  if (domainRecord && !claimed) {
    checks.push({ id: "domain", status: "fail", detail: `pramaan.domain "${domainRecord.slice(0, 80)}" is not an http(s) origin` });
    return finish("unverifiable", "domain-record-malformed");
  }
  if (claimed !== origin) {
    checks.push({ id: "domain", status: "fail", detail: `pramaan.domain is ${domainRecord ?? "empty"}, page is ${origin}` });
    return finish("mismatch", "domain-mismatch");
  }
  checks.push({ id: "domain", status: "pass", detail: `${hint.data.ensName} names ${origin}` });

  // 5. Pointer.
  const record = rec.records["pramaan.record"];
  const parsed = parsePointer(record);
  if (!parsed.ok) {
    checks.push({ id: "pointer", status: "fail", detail: parsed.reason });
    return record ? finish("unverifiable", "pointer-malformed") : finish("missing", "no-pointer");
  }
  out.pointer = parsed.pointer;
  checks.push({ id: "pointer", status: "pass", detail: `release ${parsed.pointer.tag}, manifest ${parsed.pointer.manifestSha256.slice(0, 16)}…` });

  // 6. Revocation (guardian-written, takes effect immediately).
  const revocations = parseRevocations(rec.records["pramaan.revoked"]);
  if (!revocations.ok) {
    checks.push({ id: "revocation", status: "fail", detail: `${revocations.reason}; a revocation that cannot be read is never ignored` });
    return finish("unverifiable", "revocations-malformed");
  }
  out.revocations = revocations.revoked;
  if (revocations.revoked.includes(parsed.pointer.manifestSha256)) {
    checks.push({ id: "revocation", status: "fail", detail: `release ${parsed.pointer.tag} (manifest ${parsed.pointer.manifestSha256.slice(0, 16)}…) is listed in pramaan.revoked` });
    return finish("revoked", "revoked");
  }
  checks.push({ id: "revocation", status: "pass", detail: revocations.revoked.length ? `${revocations.revoked.length} other release(s) revoked; this one is not` : "no release of this name is revoked" });

  // 7. Release timelock: the active pointer must be the one the timelock activated last (no replay, no bypass).
  const timelockRecord = rec.records["pramaan.timelock"];
  if (!timelockRecord) {
    checks.push({ id: "timelock", status: "warn", detail: "no pramaan.timelock record: pending updates and replay of older pointers cannot be checked" });
  } else if (!isAddressRecord(timelockRecord)) {
    checks.push({ id: "timelock", status: "fail", detail: `pramaan.timelock "${timelockRecord.slice(0, 60)}" is not an address` });
    return finish("unverifiable", "timelock-record-malformed");
  } else {
    const tl = await (input.timelockReader ?? readTimelockState)(chain, timelockRecord.trim() as `0x${string}`);
    if (tl.status !== "ok") {
      checks.push({ id: "timelock", status: "fail", detail: `release timelock could not be read: ${tl.detail}` });
      return finish("unverifiable", tl.status === "disagree" ? "rpc-disagree" : "timelock-unreadable");
    }
    out.timelock = { address: tl.state.address, delay: tl.state.delay, lastExecutedId: tl.state.lastExecutedId, operationCount: tl.state.operationCount };
    const a = assessTimelock(tl.state, record!, dnsEncode(hint.data.ensName));
    if (a.kind === "wrong-timelock") {
      checks.push({ id: "timelock", status: "fail", detail: a.detail });
      return finish("unverifiable", "timelock-mismatch");
    }
    out.pending = a.pending;
    if (a.kind === "replayed") {
      checks.push({ id: "timelock", status: "fail", detail: `${a.detail}: an older release was re-activated` });
      return finish("mismatch", "replayed-pointer");
    }
    if (a.kind === "not-from-timelock") {
      checks.push({ id: "timelock", status: "fail", detail: `${a.detail}: the release delay was bypassed` });
      return finish("mismatch", "pointer-not-from-timelock");
    }
    checks.push({ id: "timelock", status: "pass", detail: `activated by the release timelock (#${tl.state.lastExecutedId}, ${tl.state.delay}s delay)` });
    for (const p of a.pending) {
      const what = p.pointer ? `release ${p.pointer.tag}` : "a pointer";
      const revokedNote = p.pointer && revocations.revoked.includes(p.pointer.manifestSha256) ? " (already revoked)" : "";
      checks.push({
        id: "pending",
        status: "warn",
        detail: `${what}${revokedNote} is queued (#${p.id}) and ${p.ready ? "can be executed now" : `can take effect at ${new Date(p.eta * 1000).toISOString()}`}`,
      });
    }
  }

  // 8. Manifest, accepted only if it hashes to the pointer.
  const sourceInput = { pointer: parsed.pointer, origin, hint: hint.data, repo: rec.records["pramaan.repo"], ipfsGateways: input.ipfsGateways };
  const fetched = await fetchVerifiedManifest(sourceInput, input.fetchOptions);
  out.attempts = fetched.attempts;
  if (!fetched.ok) {
    checks.push({ id: "manifest", status: "fail", detail: fetched.reason });
    return fetched.tampered ? finish("mismatch", "manifest-digest-mismatch") : finish("unverifiable", "manifest-unavailable");
  }
  out.manifest = fetched.manifest;
  out.manifestSha256 = fetched.sha256;
  out.manifestSource = fetched.source;
  checks.push({ id: "manifest", status: "pass", detail: `sha256 matches the ENS pointer (from ${new URL(fetched.source).host})` });

  const m = fetched.manifest;
  if (m.app.ensName !== hint.data.ensName || normalizeOrigin(m.app.domain) !== origin || m.tag !== parsed.pointer.tag) {
    checks.push({ id: "binding", status: "fail", detail: "manifest names a different ENS name, domain or tag" });
    return finish("mismatch", "binding-mismatch");
  }
  checks.push({ id: "binding", status: "pass", detail: "manifest names this ENS name, origin and tag" });

  // 9. Signature under the owner's policy.
  const policy = attestationPolicy(rec.records);
  const signature = await verifyReleaseSignature({
    policy,
    manifest: m,
    manifestSha256: fetched.sha256,
    sigstore: input.sigstore,
    fetchSignature: async (mode) => (await fetchFirstJson(signatureCandidateUrls(sourceInput, mode), input.fetchOptions))?.json ?? null,
  });
  out.signature = signature;
  if (signature.status === "invalid") {
    checks.push({ id: "signature", status: "fail", detail: signature.reason });
    return finish("invalid-signature", "signature-invalid");
  }
  if (signature.status === "missing") {
    checks.push({ id: "signature", status: "fail", detail: signature.reason });
    return finish("unverifiable", "signature-missing");
  }
  checks.push({ id: "signature", status: "pass", detail: signature.detail });

  if (!pinned) await input.pins?.set(origin, hint.data.ensName);
  return finish("verified", out.pending.length > 0 ? "update-pending" : null);
}

import { base64Decode, base64Encode, base64UrlDecode, base64UrlEncode, bytesToHex, sha256Hex, utf8 } from "./hash.js";

/**
 * DSSE envelopes and in-toto statements.
 *
 * Both signing modes sign the same thing: an in-toto Statement whose subject is `pramaan-manifest.json` with the
 * manifest's sha256. GitHub Artifact Attestations (Sigstore) produce it in CI; the release-key mode below produces it
 * locally with an ECDSA P-256 key whose public half the ENS owner publishes in the `pramaan.signer` text record.
 */
export const IN_TOTO_PAYLOAD_TYPE = "application/vnd.in-toto+json";
export const IN_TOTO_STATEMENT_V1 = "https://in-toto.io/Statement/v1";
export const PRAMAAN_RELEASE_PREDICATE = "https://pramaan.dev/attestation/release/v1";
export const SLSA_PROVENANCE_V1 = "https://slsa.dev/provenance/v1";
export const MANIFEST_SUBJECT_NAME = "pramaan-manifest.json";
export const SIGNER_RECORD_PREFIX = "p256-spki:";

export interface DsseEnvelope {
  payloadType: string;
  payload: string; // base64
  signatures: { keyid?: string; sig: string }[];
}

export interface InTotoStatement {
  _type: string;
  subject: { name: string; digest: Record<string, string> }[];
  predicateType: string;
  predicate: unknown;
}

/** DSSE v1 pre-authentication encoding. */
export function preAuthEncoding(payloadType: string, payload: Uint8Array): Uint8Array {
  const typeBytes = utf8(payloadType);
  const head = utf8(`DSSEv1 ${typeBytes.length} ${payloadType} ${payload.length} `);
  const out = new Uint8Array(head.length + payload.length);
  out.set(head, 0);
  out.set(payload, head.length);
  return out;
}

export function releaseStatement(manifestSha256: string, predicate: Record<string, unknown>): InTotoStatement {
  return {
    _type: IN_TOTO_STATEMENT_V1,
    subject: [{ name: MANIFEST_SUBJECT_NAME, digest: { sha256: manifestSha256 } }],
    predicateType: PRAMAAN_RELEASE_PREDICATE,
    predicate,
  };
}

/** True when an in-toto statement names the manifest digest among its subjects. */
export function statementCoversDigest(statement: InTotoStatement, manifestSha256: string): boolean {
  return (
    statement._type === IN_TOTO_STATEMENT_V1 &&
    Array.isArray(statement.subject) &&
    statement.subject.some((s) => s && typeof s.digest === "object" && s.digest?.sha256 === manifestSha256)
  );
}

export function parseStatement(payload: Uint8Array): InTotoStatement {
  const parsed = JSON.parse(new TextDecoder().decode(payload)) as InTotoStatement;
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.subject)) throw new Error("payload is not an in-toto statement");
  return parsed;
}

// --- release-key mode (ECDSA P-256 via Web Crypto; works in Node >= 20, browsers and MV3 service workers) ---

const ALG = { name: "ECDSA", namedCurve: "P-256" } as const;

/** Web Crypto wants an ArrayBuffer-backed view; copy so SharedArrayBuffer-typed inputs are accepted too. */
function buf(view: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(view.byteLength);
  new Uint8Array(out).set(view);
  return out;
}
const SIGN_ALG = { name: "ECDSA", hash: "SHA-256" } as const;

export interface ReleaseKeyPair {
  privateKeyPkcs8Pem: string;
  publicKeySpki: Uint8Array;
  signerRecord: string;
  keyId: string;
}

function pem(label: string, der: Uint8Array): string {
  const b64 = base64Encode(der).replace(/(.{64})/g, "$1\n").trimEnd();
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}

function unpem(text: string, label: string): Uint8Array {
  const m = text.match(new RegExp(`-----BEGIN ${label}-----([\\s\\S]+?)-----END ${label}-----`));
  if (!m) throw new Error(`expected a PEM ${label}`);
  return base64Decode(m[1]!.replace(/\s+/g, ""));
}

export function keyIdForSpki(spki: Uint8Array): string {
  return `sha256:${sha256Hex(spki)}`;
}

export async function generateReleaseKey(): Promise<ReleaseKeyPair> {
  const pair = (await crypto.subtle.generateKey(ALG, true, ["sign", "verify"])) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  return {
    privateKeyPkcs8Pem: pem("PRIVATE KEY", pkcs8),
    publicKeySpki: spki,
    signerRecord: signerRecordForSpki(spki),
    keyId: keyIdForSpki(spki),
  };
}

export function signerRecordForSpki(spki: Uint8Array): string {
  return `${SIGNER_RECORD_PREFIX}${base64UrlEncode(spki)}`;
}

export function spkiFromSignerRecord(record: string): Uint8Array {
  if (!record.startsWith(SIGNER_RECORD_PREFIX)) throw new Error("pramaan.signer must start with p256-spki:");
  const spki = base64UrlDecode(record.slice(SIGNER_RECORD_PREFIX.length));
  if (spki.length < 59 || spki.length > 120) throw new Error("pramaan.signer does not hold a P-256 SPKI key");
  return spki;
}

export async function publicSpkiFromPrivatePem(privatePem: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("pkcs8", buf(unpem(privatePem, "PRIVATE KEY")), ALG, true, ["sign"]);
  const jwk = await crypto.subtle.exportKey("jwk", key);
  const pub = await crypto.subtle.importKey("jwk", { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true }, ALG, true, ["verify"]);
  return new Uint8Array(await crypto.subtle.exportKey("spki", pub));
}

export async function signStatementWithKey(statement: InTotoStatement, privatePem: string): Promise<DsseEnvelope> {
  const key = await crypto.subtle.importKey("pkcs8", buf(unpem(privatePem, "PRIVATE KEY")), ALG, false, ["sign"]);
  const payload = utf8(JSON.stringify(statement));
  const sig = new Uint8Array(await crypto.subtle.sign(SIGN_ALG, key, buf(preAuthEncoding(IN_TOTO_PAYLOAD_TYPE, payload))));
  const spki = await publicSpkiFromPrivatePem(privatePem);
  return {
    payloadType: IN_TOTO_PAYLOAD_TYPE,
    payload: base64Encode(payload),
    signatures: [{ keyid: keyIdForSpki(spki), sig: base64Encode(sig) }],
  };
}

export type KeyVerification =
  | { ok: true; statement: InTotoStatement; keyId: string }
  | { ok: false; reason: string };

/** Verifies a release-key DSSE envelope against the P-256 SPKI key published in ENS. Fails closed. */
export async function verifyEnvelopeWithKey(envelope: DsseEnvelope, spki: Uint8Array): Promise<KeyVerification> {
  try {
    if (envelope.payloadType !== IN_TOTO_PAYLOAD_TYPE) return { ok: false, reason: `unexpected payloadType ${envelope.payloadType}` };
    if (!Array.isArray(envelope.signatures) || envelope.signatures.length === 0) return { ok: false, reason: "no signatures" };
    const key = await crypto.subtle.importKey("spki", buf(spki), ALG, false, ["verify"]);
    const payload = base64Decode(envelope.payload);
    const pae = preAuthEncoding(envelope.payloadType, payload);
    const keyId = keyIdForSpki(spki);
    for (const s of envelope.signatures) {
      const valid = await crypto.subtle.verify(SIGN_ALG, key, buf(base64Decode(s.sig)), buf(pae));
      if (valid) return { ok: true, statement: parseStatement(payload), keyId };
    }
    return { ok: false, reason: `no signature verifies under ${keyId}` };
  } catch (err) {
    return { ok: false, reason: `signature check failed: ${(err as Error).message}` };
  }
}

export { bytesToHex };

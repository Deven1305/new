import {
  AllOf,
  GITHUB_OIDC_ISSUER,
  Identity,
  OIDCSourceRepositoryDigest,
  SigstoreVerifier,
  type SigstoreBundle,
  type TrustedRoot,
} from "@freedomofpress/sigstore-browser";
import {
  IN_TOTO_PAYLOAD_TYPE,
  parseStatement,
  spkiFromSignerRecord,
  statementCoversDigest,
  verifyEnvelopeWithKey,
  type DsseEnvelope,
  type ManifestV1,
} from "@pramaan/manifest";
import type { PramaanRecords } from "./ens.js";

export const DEFAULT_WORKFLOW = ".github/workflows/release.yml";
export const ACCEPTED_BUNDLE_MEDIA_TYPES = [
  "application/vnd.dev.sigstore.bundle.v0.3+json",
  "application/vnd.dev.sigstore.bundle+json;version=0.3",
  "application/vnd.dev.sigstore.bundle+json;version=0.2",
];

export type AttestationPolicy =
  | { mode: "github"; repo: string; workflow: string }
  | { mode: "key"; signerRecord: string }
  | { mode: "none"; reason: string };

/**
 * The owner decides how releases are signed, through owner-only ENS records:
 *   pramaan.attestation = "github" | "github:<workflow path>" | "key"
 *   pramaan.repo        = https://github.com/<owner>/<repo>   (github mode)
 *   pramaan.signer      = p256-spki:<base64url>               (key mode)
 */
export function attestationPolicy(records: PramaanRecords): AttestationPolicy {
  const raw = (records["pramaan.attestation"] ?? "").trim();
  const repo = records["pramaan.repo"];
  const signer = records["pramaan.signer"];
  if (raw === "key" || (!raw && signer && !repo)) {
    if (!signer) return { mode: "none", reason: "pramaan.attestation is key but pramaan.signer is empty" };
    // A malformed record is an owner misconfiguration ("unverifiable"), not evidence of a forged signature.
    try {
      spkiFromSignerRecord(signer);
    } catch (err) {
      return { mode: "none", reason: `pramaan.signer is malformed: ${(err as Error).message}` };
    }
    return { mode: "key", signerRecord: signer };
  }
  if (raw === "github" || raw.startsWith("github:") || (!raw && repo)) {
    if (!repo || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
      return { mode: "none", reason: "pramaan.repo must be https://github.com/<owner>/<repo> for GitHub attestations" };
    }
    const workflow = raw.startsWith("github:") ? raw.slice("github:".length) : DEFAULT_WORKFLOW;
    if (!/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(workflow)) return { mode: "none", reason: "invalid workflow path in pramaan.attestation" };
    return { mode: "github", repo, workflow };
  }
  return { mode: "none", reason: raw ? `unknown pramaan.attestation value "${raw}"` : "the ENS name declares no signing policy" };
}

/** The exact Fulcio certificate identity a genuine release run must have. */
export function githubIdentity(repo: string, workflow: string, tag: string): string {
  return `${repo}/${workflow}@refs/tags/${tag}`;
}

export type SignatureResult =
  | { status: "valid"; mode: "github" | "key"; signer: string; detail: string }
  | { status: "invalid"; mode: "github" | "key"; reason: string }
  | { status: "missing"; mode: "github" | "key" | "none"; reason: string };

export type SigstoreProvider = () => Promise<SigstoreVerifier>;

let cachedVerifier: Promise<SigstoreVerifier> | null = null;

/** Default provider: trusted root fetched and verified through Sigstore's TUF repository, cached per process. */
export const tufSigstoreProvider: SigstoreProvider = () => {
  cachedVerifier ??= (async () => {
    const v = new SigstoreVerifier();
    await v.loadSigstoreRootWithTUF();
    return v;
  })().catch((err) => {
    cachedVerifier = null;
    throw err;
  });
  return cachedVerifier;
};

export function fixedRootSigstoreProvider(root: TrustedRoot): SigstoreProvider {
  let p: Promise<SigstoreVerifier> | null = null;
  return () => {
    p ??= (async () => {
      const v = new SigstoreVerifier();
      await v.loadSigstoreRoot(root);
      return v;
    })();
    return p;
  };
}

export interface GithubCheckInput {
  bundle: unknown;
  repo: string;
  workflow: string;
  tag: string;
  commit: string;
  manifestSha256: string;
  sigstore: SigstoreProvider;
  /** Subject to require in the in-toto statement. Defaults to the manifest's sha256. */
  subject?: { algorithm: "sha256" | "sha512"; digest: string };
}

/** Verifies a GitHub Artifact Attestation (Sigstore DSSE + in-toto) for the manifest. */
export async function verifyGithubAttestation(input: GithubCheckInput): Promise<SignatureResult> {
  const bundle = input.bundle as SigstoreBundle & { mediaType?: string; dsseEnvelope?: unknown };
  if (!bundle || typeof bundle !== "object" || !ACCEPTED_BUNDLE_MEDIA_TYPES.includes(String(bundle.mediaType))) {
    return { status: "invalid", mode: "github", reason: `unsupported bundle media type ${String(bundle?.mediaType)}` };
  }
  if (!bundle.dsseEnvelope) return { status: "invalid", mode: "github", reason: "bundle has no DSSE envelope (expected an attestation)" };
  const identity = githubIdentity(input.repo, input.workflow, input.tag);
  try {
    const verifier = await input.sigstore();
    const policy = new AllOf([new Identity({ identity, issuer: GITHUB_OIDC_ISSUER }), new OIDCSourceRepositoryDigest(input.commit)]);
    const { payloadType, payload } = await verifier.verifyDsse(bundle, policy);
    if (payloadType !== IN_TOTO_PAYLOAD_TYPE) return { status: "invalid", mode: "github", reason: `unexpected payload type ${payloadType}` };
    const statement = parseStatement(payload);
    const subject = input.subject ?? { algorithm: "sha256", digest: input.manifestSha256 };
    const covered =
      subject.algorithm === "sha256"
        ? statementCoversDigest(statement, subject.digest)
        : statement.subject.some((s) => s?.digest?.[subject.algorithm] === subject.digest);
    if (!covered) {
      return { status: "invalid", mode: "github", reason: `the attestation does not cover this ${subject.algorithm} digest` };
    }
    return { status: "valid", mode: "github", signer: identity, detail: `Sigstore attestation by ${identity}, commit ${input.commit.slice(0, 12)}` };
  } catch (err) {
    return { status: "invalid", mode: "github", reason: `Sigstore verification failed: ${(err as Error).message}` };
  }
}

export async function verifyKeyEnvelope(envelope: unknown, signerRecord: string, manifestSha256: string): Promise<SignatureResult> {
  let spki: Uint8Array;
  try {
    spki = spkiFromSignerRecord(signerRecord);
  } catch (err) {
    return { status: "invalid", mode: "key", reason: (err as Error).message };
  }
  const result = await verifyEnvelopeWithKey(envelope as DsseEnvelope, spki);
  if (!result.ok) return { status: "invalid", mode: "key", reason: result.reason };
  if (!statementCoversDigest(result.statement, manifestSha256)) {
    return { status: "invalid", mode: "key", reason: "the signature does not cover this manifest's sha256" };
  }
  return { status: "valid", mode: "key", signer: `release key ${result.keyId.slice(0, 19)}…`, detail: `DSSE signature by the key published in pramaan.signer (${result.keyId})` };
}

export async function verifyReleaseSignature(args: {
  policy: AttestationPolicy;
  manifest: ManifestV1;
  manifestSha256: string;
  fetchSignature: (mode: "github" | "key") => Promise<unknown | null>;
  sigstore?: SigstoreProvider;
}): Promise<SignatureResult> {
  const { policy } = args;
  if (policy.mode === "none") return { status: "missing", mode: "none", reason: policy.reason };
  const sig = await args.fetchSignature(policy.mode);
  if (sig === null) return { status: "missing", mode: policy.mode, reason: `no ${policy.mode === "github" ? "Sigstore bundle" : "DSSE envelope"} could be fetched` };
  if (policy.mode === "key") return verifyKeyEnvelope(sig, policy.signerRecord, args.manifestSha256);
  if (args.manifest.repo !== policy.repo) {
    return { status: "invalid", mode: "github", reason: `manifest repo ${args.manifest.repo} differs from pramaan.repo ${policy.repo}` };
  }
  return verifyGithubAttestation({
    bundle: sig,
    repo: policy.repo,
    workflow: policy.workflow,
    tag: args.manifest.tag,
    commit: args.manifest.commit,
    manifestSha256: args.manifestSha256,
    sigstore: args.sigstore ?? tufSigstoreProvider,
  });
}

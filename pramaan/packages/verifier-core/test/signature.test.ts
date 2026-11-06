import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { generateReleaseKey, releaseStatement, signStatementWithKey } from "@pramaan/manifest";
import { attestationPolicy, tufSigstoreProvider, verifyGithubAttestation, verifyKeyEnvelope, type SigstoreProvider } from "../src/index.js";

/**
 * Real public test vector: the npm provenance attestation GitHub Actions produced when
 * @freedomofpress/sigstore-browser@0.3.0 was published. Same bundle shape actions/attest@v4 produces for a manifest:
 * Sigstore bundle v0.3, DSSE envelope, in-toto statement, Fulcio certificate for a workflow identity.
 */
const bundle = JSON.parse(readFileSync(join(__dirname, "fixtures", "sigstore-browser-0.3.0.provenance.json"), "utf8"));
const REPO = "https://github.com/freedomofpress/sigstore-browser";
const WORKFLOW = ".github/workflows/publish.yml";
const COMMIT = "b5635867c05642092f6142c8d10fe4f83ec15814";
const TARBALL_SHA512 = "8c54c4c9c035ff2cb715c0910065d509bfd85b0405b7672c9e52e4c22be648fb5530040ddca5abf71e6136eb2218bf826ccadcf66b5fa84169a38807259e4e62";

let sigstore: SigstoreProvider;
let online = true;

beforeAll(async () => {
  sigstore = tufSigstoreProvider;
  try {
    await sigstore(); // fetches and verifies Sigstore's trusted root through TUF
  } catch {
    online = false;
  }
}, 60_000);

const base = { bundle, repo: REPO, workflow: WORKFLOW, tag: "v0.3.0", commit: COMMIT, manifestSha256: "", subject: { algorithm: "sha512" as const, digest: TARBALL_SHA512 } };

describe("GitHub / Sigstore attestation", () => {
  it("accepts the genuine attestation for the expected workflow, tag and commit", async (ctx) => {
    if (!online) ctx.skip();
    const r = await verifyGithubAttestation({ ...base, sigstore });
    expect(r).toMatchObject({ status: "valid", signer: `${REPO}/${WORKFLOW}@refs/tags/v0.3.0` });
  });

  it("rejects the same bundle for a different tag, repo or commit", async (ctx) => {
    if (!online) ctx.skip();
    expect((await verifyGithubAttestation({ ...base, tag: "v0.2.0", sigstore })).status).toBe("invalid");
    expect((await verifyGithubAttestation({ ...base, repo: "https://github.com/attacker/sigstore-browser", sigstore })).status).toBe("invalid");
    expect((await verifyGithubAttestation({ ...base, commit: "0".repeat(40), sigstore })).status).toBe("invalid");
  });

  it("rejects a statement that does not cover the expected artifact", async (ctx) => {
    if (!online) ctx.skip();
    const r = await verifyGithubAttestation({ ...base, subject: { algorithm: "sha512", digest: "0".repeat(128) }, sigstore });
    expect(r).toMatchObject({ status: "invalid", reason: expect.stringContaining("does not cover") });
  });

  it("rejects a tampered DSSE payload", async (ctx) => {
    if (!online) ctx.skip();
    const statement = JSON.parse(Buffer.from(bundle.dsseEnvelope.payload, "base64").toString("utf8"));
    statement.subject[0].digest.sha512 = "1".repeat(128);
    const forged = { ...bundle, dsseEnvelope: { ...bundle.dsseEnvelope, payload: Buffer.from(JSON.stringify(statement)).toString("base64") } };
    const r = await verifyGithubAttestation({ ...base, bundle: forged, subject: { algorithm: "sha512", digest: "1".repeat(128) }, sigstore });
    expect(r.status).toBe("invalid");
  });

  it("rejects unknown bundle media types and message-signature bundles before any crypto", async () => {
    expect((await verifyGithubAttestation({ ...base, bundle: { ...bundle, mediaType: "application/x-unknown" }, sigstore })).status).toBe("invalid");
    const { dsseEnvelope: _drop, ...noDsse } = bundle;
    expect(await verifyGithubAttestation({ ...base, bundle: noDsse, sigstore })).toMatchObject({ status: "invalid", reason: expect.stringContaining("DSSE") });
  });
});

describe("release-key mode", () => {
  it("accepts a signature by the key published in pramaan.signer and nothing else", async () => {
    const key = await generateReleaseKey();
    const digest = "ab".repeat(32);
    const env = await signStatementWithKey(releaseStatement(digest, { tag: "v1.0.0" }), key.privateKeyPkcs8Pem);
    expect((await verifyKeyEnvelope(env, key.signerRecord, digest)).status).toBe("valid");
    expect((await verifyKeyEnvelope(env, key.signerRecord, "cd".repeat(32))).status).toBe("invalid");
    const other = await generateReleaseKey();
    expect((await verifyKeyEnvelope(env, other.signerRecord, digest)).status).toBe("invalid");
    expect((await verifyKeyEnvelope(env, "garbage", digest)).status).toBe("invalid");
  });
});

describe("attestation policy from ENS records", () => {
  const empty = { "pramaan.record": null, "pramaan.domain": null, "pramaan.repo": null, "pramaan.attestation": null, "pramaan.signer": null, "pramaan.revoked": null, "pramaan.timelock": null };
  it("reads the owner's choice", async () => {
    const real = (await generateReleaseKey()).signerRecord;
    expect(attestationPolicy({ ...empty, "pramaan.repo": "https://github.com/o/r" })).toEqual({ mode: "github", repo: "https://github.com/o/r", workflow: ".github/workflows/release.yml" });
    expect(attestationPolicy({ ...empty, "pramaan.repo": "https://github.com/o/r", "pramaan.attestation": "github:.github/workflows/ship.yml" })).toMatchObject({ workflow: ".github/workflows/ship.yml" });
    expect(attestationPolicy({ ...empty, "pramaan.attestation": "key", "pramaan.signer": real })).toEqual({ mode: "key", signerRecord: real });
    // A malformed signer record is a misconfiguration (unverifiable), not an invalid signature.
    expect(attestationPolicy({ ...empty, "pramaan.attestation": "key", "pramaan.signer": "p256-spki:abc" })).toMatchObject({ mode: "none", reason: expect.stringContaining("malformed") });
    expect(attestationPolicy({ ...empty, "pramaan.attestation": "github", "pramaan.repo": "https://evil.example/o/r" }).mode).toBe("none");
    expect(attestationPolicy(empty).mode).toBe("none");
  });
});

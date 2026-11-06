import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildManifest,
  canonicalize,
  encodePointer,
  generateReleaseKey,
  hashDirectory,
  manifestBytes,
  manifestDigest,
  parseManifestBytes,
  parsePointer,
  rawCidForBytes,
  rawCidFromSha256,
  releaseStatement,
  sha256FromRawCid,
  sha256Hex,
  signStatementWithKey,
  spkiFromSignerRecord,
  sriSha384,
  statementCoversDigest,
  verifyEnvelopeWithKey,
  ManifestV1,
} from "../src/node.js";

const sample = () =>
  buildManifest({
    app: { name: "Pramaan Vault", ensName: "pramaan-demo.eth", domain: "http://localhost:5180" },
    repo: "https://github.com/pramaan-dev/vault-app",
    commit: "0123456789abcdef0123456789abcdef01234567",
    tag: "v1.0.0",
    workflow: ".github/workflows/release.yml",
    builtAt: "2026-11-04T10:00:00Z",
    files: [
      { path: "/index.html", sha256: sha256Hex("<html></html>"), sri: sriSha384("<html></html>") },
      { path: "/assets/app.js", sha256: sha256Hex("console.log(1)"), sri: sriSha384("console.log(1)") },
    ],
    contracts: [
      {
        label: "VaultV2",
        chainId: 11155111,
        address: "0x1111111111111111111111111111111111111111",
        runtimeCodehash: `0x${"aa".repeat(32)}`,
        proxy: { type: "eip1967", implAddress: "0x2222222222222222222222222222222222222222", implCodehash: `0x${"bb".repeat(32)}` },
        sourcify: { status: "exact_match" },
      },
    ],
    findings: [
      {
        id: "PRM-1",
        title: "withdrawAll() has no access control",
        class: "access-control",
        severity: "critical",
        status: "fixed-verified",
        exploitTestSha256: "c".repeat(64),
        evidenceSha256: "d".repeat(64),
        fixCommit: "abcdef1",
      },
    ],
    thirdParties: [{ host: "api.example.com", purpose: "price feed", receivesAddress: false }],
    tools: [{ name: "slither", version: "0.11.6" }, { name: "forge", version: "1.8.7" }],
  });

describe("RFC 8785 canonical JSON", () => {
  it("matches the RFC's number and string vector", () => {
    const input = JSON.parse(
      '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/","literals":[null,true,false]}',
    );
    expect(canonicalize(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it("sorts keys by UTF-16 code units", () => {
    const input = {
      "€": 1,
      "\r": 2,
      "דּ": 3,
      "1": 4,
      "😀": 5,
      "\u0080": 6,
      "ö": 7,
    };
    // Object.keys() would hoist the integer-like key "1", so read the order from the canonical text itself.
    const valueOrder = [...canonicalize(input).matchAll(/":(\d)/g)].map((m) => Number(m[1]));
    expect(valueOrder).toEqual([2, 4, 6, 7, 1, 5, 3]); // "\r", "1", U+0080, ö, €, 😀, U+FB33
  });

  it("rejects values JSON cannot represent", () => {
    expect(() => canonicalize({ a: 1n })).toThrow();
    expect(() => canonicalize({ a: Number.NaN })).toThrow();
    expect(() => canonicalize(new Date())).toThrow();
  });
});

describe("manifest", () => {
  it("is deterministic regardless of input order", () => {
    const a = sample();
    const reordered = ManifestV1.parse(JSON.parse(JSON.stringify({ ...a, tools: [...a.tools].reverse() })));
    expect(manifestDigest(buildManifest({ ...reordered, files: [...reordered.files].reverse() }))).toBe(manifestDigest(a));
  });

  it("round-trips through bytes and checks the pointer digest first", () => {
    const m = sample();
    const bytes = manifestBytes(m);
    const ok = parseManifestBytes(bytes, sha256Hex(bytes));
    expect(ok.ok).toBe(true);
    const tampered = new Uint8Array(bytes);
    tampered[20] = tampered[20]! ^ 1;
    const bad = parseManifestBytes(tampered, sha256Hex(bytes));
    expect(bad).toEqual({ ok: false, reason: expect.stringContaining("does not match the ENS pointer") });
  });

  it("rejects path traversal, unknown fields and bad origins", () => {
    const m = sample();
    expect(ManifestV1.safeParse({ ...m, files: [{ ...m.files[0]!, path: "/../etc/passwd" }] }).success).toBe(false);
    expect(ManifestV1.safeParse({ ...m, extra: true }).success).toBe(false);
    expect(ManifestV1.safeParse({ ...m, app: { ...m.app, domain: "https://evil.example/path" } }).success).toBe(false);
  });
});

describe("pointer", () => {
  it("encodes and parses", () => {
    const digest = "e".repeat(64);
    const p = encodePointer("v1.2.3", digest);
    expect(p).toBe(`pramaan:v1:v1.2.3:${digest}`);
    expect(parsePointer(p)).toEqual({ ok: true, pointer: { version: 1, tag: "v1.2.3", manifestSha256: digest } });
  });

  it("rejects malformed records", () => {
    for (const bad of ["", "ipfs://x", "pramaan:v1:v1:ABC", `pramaan:v1::${"a".repeat(64)}`, `pramaan:v1:v 1:${"a".repeat(64)}`]) {
      expect(parsePointer(bad).ok).toBe(false);
    }
  });
});

describe("CID", () => {
  it("matches the well-known CID of the empty raw block", () => {
    expect(rawCidForBytes(new Uint8Array())).toBe("bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku");
  });

  it("round-trips the sha256 inside the CID", () => {
    const digest = sha256Hex("pramaan");
    expect(sha256FromRawCid(rawCidFromSha256(digest))).toBe(digest);
    expect(sha256FromRawCid("bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi")).toBeNull();
  });
});

describe("release-key DSSE signatures", () => {
  it("verifies a genuine signature and rejects tampering and the wrong key", async () => {
    const key = await generateReleaseKey();
    const digest = manifestDigest(sample());
    const envelope = await signStatementWithKey(releaseStatement(digest, { tag: "v1.0.0" }), key.privateKeyPkcs8Pem);

    const good = await verifyEnvelopeWithKey(envelope, spkiFromSignerRecord(key.signerRecord));
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(statementCoversDigest(good.statement, digest)).toBe(true);
      expect(statementCoversDigest(good.statement, "0".repeat(64))).toBe(false);
    }

    const forgedPayload = { ...envelope, payload: btoa(JSON.stringify(releaseStatement("f".repeat(64), {}))) };
    expect((await verifyEnvelopeWithKey(forgedPayload, key.publicKeySpki)).ok).toBe(false);

    const other = await generateReleaseKey();
    expect((await verifyEnvelopeWithKey(envelope, other.publicKeySpki)).ok).toBe(false);
  });
});

describe("hashDirectory", () => {
  it("hashes files with SRI and skips manifest sidecars", () => {
    const dir = mkdtempSync(join(tmpdir(), "pramaan-site-"));
    mkdirSync(join(dir, "assets"));
    mkdirSync(join(dir, ".well-known"));
    writeFileSync(join(dir, "index.html"), "<html></html>");
    writeFileSync(join(dir, "assets", "app.js"), "console.log(1)");
    writeFileSync(join(dir, ".well-known", "pramaan-manifest.json"), "{}");
    const files = hashDirectory(dir);
    expect(files.map((f) => f.path)).toEqual(["/assets/app.js", "/index.html"]);
    expect(files[1]!.sri).toBe(sriSha384("<html></html>"));
  });

  it("refuses symlinks", (ctx) => {
    const dir = mkdtempSync(join(tmpdir(), "pramaan-site-"));
    writeFileSync(join(dir, "real.js"), "x");
    try {
      symlinkSync(join(dir, "real.js"), join(dir, "link.js"));
    } catch {
      ctx.skip(); // creating symlinks needs Developer Mode or admin rights on Windows
    }
    expect(() => hashDirectory(dir)).toThrow(/symlink/);
  });
});

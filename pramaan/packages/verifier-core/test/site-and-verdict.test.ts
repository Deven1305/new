import { describe, expect, it } from "vitest";
import { MANIFEST_SCHEMA_V1, sha256Hex, sriSha384, type ManifestV1 } from "@pramaan/manifest";
import { checkSite, combine, contractRow, privacyRow, siteRow, sitePath, type ObservedResource, type ReleaseVerification } from "../src/index.js";

const ORIGIN = "http://localhost:5180";
const html = "<!doctype html><script type=module src=/assets/app.js></script>";
const js = "console.log('vault')";
const manifest: ManifestV1 = {
  schema: MANIFEST_SCHEMA_V1,
  app: { name: "Vault", ensName: "pramaan-demo.eth", domain: ORIGIN, spaFallback: "/index.html" },
  repo: "local:test",
  commit: "0".repeat(40),
  tag: "v1.0.0",
  workflow: null,
  builtAt: "2026-11-04T00:00:00Z",
  files: [
    { path: "/index.html", sha256: sha256Hex(html), sri: sriSha384(html) },
    { path: "/assets/app.js", sha256: sha256Hex(js), sri: sriSha384(js) },
    { path: "/assets/app.css", sha256: sha256Hex("body{}"), sri: sriSha384("body{}") },
  ],
  contracts: [],
  findings: [],
  descriptors: [],
  thirdParties: [{ host: "api.coingecko.com", purpose: "prices", receivesAddress: false }],
  tools: [],
};

const genuine: ObservedResource[] = [
  { url: `${ORIGIN}/`, type: "main_frame", sha256: sha256Hex(html) },
  { url: `${ORIGIN}/assets/app.js`, type: "script", sha256: sha256Hex(js) },
  { url: `${ORIGIN}/assets/app.css`, type: "stylesheet", sha256: sha256Hex("body{}") },
];

describe("site check", () => {
  it("maps URLs to manifest paths", () => {
    expect(sitePath(`${ORIGIN}/`, ORIGIN)).toBe("/index.html");
    expect(sitePath(`${ORIGIN}/assets/app.js?v=1`, ORIGIN)).toBe("/assets/app.js");
    expect(sitePath("https://cdn.example/x.js", ORIGIN)).toBeNull();
  });

  it("is green when every loaded file matches", () => {
    const r = checkSite(manifest, ORIGIN, genuine);
    expect(r).toMatchObject({ status: "verified", severity: "green" });
  });

  it("goes red when one byte of a script changes", () => {
    const tampered = genuine.map((g) => (g.type === "script" ? { ...g, sha256: sha256Hex(js.replace("vault", "vaulT")) } : g));
    expect(checkSite(manifest, ORIGIN, tampered)).toMatchObject({ status: "mismatch", severity: "red" });
  });

  it("goes red for an unlisted same-origin script or an undeclared third-party script", () => {
    expect(checkSite(manifest, ORIGIN, [...genuine, { url: `${ORIGIN}/assets/drainer.js`, type: "script", sha256: "a".repeat(64) }]).severity).toBe("red");
    expect(checkSite(manifest, ORIGIN, [...genuine, { url: "https://evil.example/x.js", type: "script", sha256: null }]).status).toBe("unlisted-script");
  });

  it("is amber for declared third parties, dynamic inline scripts and pending files", () => {
    expect(checkSite(manifest, ORIGIN, [...genuine, { url: "https://api.coingecko.com/widget.js", type: "script", sha256: null }]).severity).toBe("amber");
    expect(checkSite(manifest, ORIGIN, [...genuine, { url: "inline:abc", type: "inline_script", sha256: "b".repeat(64) }]).severity).toBe("amber");
    expect(checkSite(manifest, ORIGIN, [{ ...genuine[0]!, sha256: null }]).status).toBe("incomplete");
  });

  it("uses the SPA fallback only for navigations, never for scripts", () => {
    expect(checkSite(manifest, ORIGIN, [{ url: `${ORIGIN}/dashboard`, type: "main_frame", sha256: sha256Hex(html) }, genuine[1]!]).severity).toBe("green");
    expect(checkSite(manifest, ORIGIN, [genuine[0]!, { url: `${ORIGIN}/other`, type: "script", sha256: sha256Hex(html) }]).severity).toBe("red");
  });

  it("ignores other extensions' scripts", () => {
    expect(checkSite(manifest, ORIGIN, [...genuine, { url: "chrome-extension://abc/inject.js", type: "script", sha256: null }]).severity).toBe("green");
  });
});

describe("verdict", () => {
  const verified = { status: "verified", pointer: { version: 1, tag: "v1.0.0", manifestSha256: "x" }, signature: { status: "valid", mode: "key", signer: "release key", detail: "" }, checks: [], singleSource: false } as unknown as ReleaseVerification;

  it("blocks signing on a tampered site", () => {
    const tampered = checkSite(manifest, ORIGIN, genuine.map((g) => (g.type === "script" ? { ...g, sha256: "f".repeat(64) } : g)));
    const v = combine([siteRow(verified, tampered), privacyRow([])]);
    expect(v).toMatchObject({ color: "red", blocked: true });
  });

  it("is green only when every check passed, and amber for an unlisted contract", () => {
    const site = checkSite(manifest, ORIGIN, genuine);
    expect(combine([siteRow(verified, site), privacyRow([])]).color).toBe("green");
    const amber = combine([siteRow(verified, site), contractRow({ status: "unlisted", address: "0x1", chainId: 1, label: null, detail: "" })]);
    expect(amber).toMatchObject({ color: "amber", blocked: false });
  });

  it("reports an undeclared address leak as red but does not block", () => {
    const v = combine([privacyRow([{ host: "tracker.example", declared: false, purpose: null, blocked: false }])]);
    expect(v).toMatchObject({ color: "red", blocked: false });
    expect(v.rows[0]!.key).toBe("verify.privacy.undeclared");
  });

  it("treats a site without a release as amber", () => {
    expect(siteRow({ ...verified, status: "missing" } as ReleaseVerification, null).color).toBe("amber");
  });
});

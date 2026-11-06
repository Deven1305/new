import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderBundleReport, scanBundle } from "../src/index.js";

function site(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pramaan-scan-"));
  for (const [path, body] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return dir;
}

// Fake credentials are assembled at runtime so that this file itself never contains a secret-shaped literal.
const fake = {
  aws: "AKIA" + "ABCDEFGHIJKLMNOP",
  gh: "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8",
  pk: "0x" + "ab".repeat(32),
};

describe("bundle scan", () => {
  it("passes a clean bundle and lists the hosts it talks to", () => {
    const dir = site({
      "index.html": '<html xmlns="http://www.w3.org/1999/xhtml"><script src="/assets/app.js"></script></html>',
      "assets/app.js": 'fetch("https://api.prices.example/v1/eth"); const hash = "0x' + "cd".repeat(32) + '";',
    });
    const r = scanBundle(dir, { declaredHosts: ["api.prices.example"], ownHosts: ["vault.example"] });
    expect(r.ok).toBe(true);
    expect(r.findings).toEqual([]);
    expect(r.hosts).toEqual(["api.prices.example"]);
    expect(r.undeclared).toEqual([]);
  });

  it("flags shipped secrets without ever printing them in full", () => {
    const dir = site({
      "assets/app.js": `const k="${fake.aws}";\nconst t = "${fake.gh}";\nconst config = { privateKey: "${fake.pk}" };`,
      "assets/key.txt": "-----BEGIN " + "PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    });
    const r = scanBundle(dir);
    expect(r.ok).toBe(false);
    const rules = r.findings.map((f) => f.rule).sort();
    expect(rules).toEqual(["aws-access-key", "github-token", "private-key-block", "wallet-private-key"]);
    expect(r.findings.every((f) => f.severity === "critical")).toBe(true);
    const text = JSON.stringify(r) + renderBundleReport(r);
    for (const secret of [fake.aws, fake.gh, fake.pk]) expect(text).not.toContain(secret);
    expect(r.findings.find((f) => f.rule === "aws-access-key")).toMatchObject({ file: "/assets/app.js", line: 1 });
    expect(r.findings.find((f) => f.rule === "github-token")?.line).toBe(2);
  });

  it("does not treat an ordinary 32-byte hash as a private key", () => {
    const dir = site({ "a.js": `const codehash = "0x${"11".repeat(32)}"; const salt = "0x${"22".repeat(32)}";` });
    expect(scanBundle(dir).findings).toEqual([]);
  });

  it("fails on an undeclared tracker and downgrades a declared one", () => {
    const dir = site({ "assets/app.js": 'import("https://cdn.segment.com/analytics.js"); fetch("https://api.mixpanel.com/track");' });
    const undeclared = scanBundle(dir, { declaredHosts: [] });
    expect(undeclared.ok).toBe(false);
    expect(undeclared.findings.filter((f) => f.kind === "tracker").map((f) => [f.host, f.severity]).sort()).toEqual([
      ["api.mixpanel.com", "high"],
      ["cdn.segment.com", "high"],
    ]);
    const declared = scanBundle(dir, { declaredHosts: ["segment.com", "mixpanel.com"] });
    expect(declared.ok).toBe(true);
    expect(declared.findings.every((f) => f.severity === "medium")).toBe(true);
  });

  it("reports undeclared third-party hosts only when a declaration list is supplied", () => {
    const dir = site({ "a.js": 'fetch("https://rpc.some-node.io/x"); fetch("https://api.prices.example/y");' });
    expect(scanBundle(dir).undeclared).toEqual([]);
    const r = scanBundle(dir, { declaredHosts: ["api.prices.example"] });
    expect(r.undeclared).toEqual(["rpc.some-node.io"]);
    expect(r.findings.map((f) => [f.kind, f.severity, f.host])).toEqual([["undeclared-host", "info", "rpc.some-node.io"]]);
    expect(r.ok).toBe(true);
  });

  it("treats an undeclared IP-address endpoint as high severity and tells apart ports on the same IP", () => {
    const dir = site({ "a.js": 'fetch("http://127.0.0.1:8545"); fetch("http://127.0.0.1:5190/collect?addr=" + a);' });
    expect(scanBundle(dir).undeclared).toEqual([]); // nothing to compare against without a declaration list
    const r = scanBundle(dir, { declaredHosts: ["127.0.0.1:8545"] });
    expect(r.undeclared).toEqual(["127.0.0.1:5190"]);
    expect(r.findings).toMatchObject([{ kind: "undeclared-host", severity: "high", rule: "undeclared-ip-endpoint", host: "127.0.0.1:5190" }]);
    expect(r.ok).toBe(false);
    expect(scanBundle(dir, { declaredHosts: ["127.0.0.1:8545", "127.0.0.1:5190"] }).ok).toBe(true);
    expect(scanBundle(dir, { declaredHosts: ["127.0.0.1"] }).undeclared).toEqual([]); // a bare IP accepts any port
  });

  it("flags an RPC provider key embedded in a URL as a medium finding", () => {
    const dir = site({ "a.js": 'const rpc = "https://eth-sepolia.g.alchemy.com/v2/AbCdEfGhIjKlMnOpQrStUvWxYz012345";' });
    const r = scanBundle(dir);
    expect(r.findings).toMatchObject([{ kind: "rpc-key", severity: "medium" }]);
    expect(JSON.stringify(r)).not.toContain("AbCdEfGhIjKlMnOpQrStUvWxYz012345");
    expect(r.ok).toBe(true);
  });

  it("skips binary files and oversized files, and says so", () => {
    const dir = site({ "logo.png": fake.aws, "big.js": "x".repeat(100) });
    const r = scanBundle(dir, { maxFileBytes: 50 });
    expect(r.filesScanned).toBe(0);
    expect(r.skipped).toEqual([{ file: "/big.js", reason: "larger than 50 bytes" }]);
  });
});

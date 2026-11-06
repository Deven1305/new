import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MANIFEST_SCHEMA_V1 } from "@pramaan/manifest";
import { renderRecordPage } from "../src/record-page.js";

const h = (c: string) => c.repeat(64);
const manifest = (over: Record<string, unknown> = {}) => ({
  schema: MANIFEST_SCHEMA_V1,
  app: { name: "Vault <b>Lab</b>", ensName: "vault.example.eth", domain: "https://vault.example" },
  repo: "https://github.com/acme/vault",
  commit: "a".repeat(40),
  tag: "v1.2.3",
  workflow: null,
  builtAt: "2026-11-06T10:00:00Z",
  files: [{ path: "/index.html", sha256: h("1"), sri: "sha256-AAAA", size: 120 }, { path: "/app.js", sha256: h("2"), sri: "sha256-BBBB" }],
  contracts: [{ label: "Vault", chainId: 11155111, address: "0x" + "ab".repeat(20), runtimeCodehash: "0x" + h("3"), proxy: { type: "eip1967", implAddress: "0x" + "cd".repeat(20), implCodehash: "0x" + h("4") }, sourcify: { status: "exact_match" } }],
  findings: [{ id: "PRM-3", title: "Missing <script>alert(1)</script> access control", class: "access-control", severity: "critical", status: "fixed-verified", exploitTestSha256: h("5"), evidenceSha256: h("6"), fixCommit: null }],
  descriptors: [],
  thirdParties: [{ host: "rpc.example", purpose: "JSON-RPC reads", receivesAddress: true }],
  tools: [{ name: "slither", version: "0.11.6" }],
  ...over,
});
const bytes = (m: unknown) => new TextEncoder().encode(JSON.stringify(m));

describe("renderRecordPage", () => {
  it("states the manifest sha256 and the ENS pointer to compare with", () => {
    const b = bytes(manifest());
    const html = renderRecordPage(b);
    const sha = createHash("sha256").update(b).digest("hex");
    expect(html).toContain(sha);
    expect(html).toContain(`pramaan:v1:v1.2.3:${sha}`);
    expect(html).toContain("1 of 1");
    expect(html).toContain("0x" + "ab".repeat(20));
  });

  it("is inert: no scripts, no external loads, every value escaped", () => {
    const html = renderRecordPage(bytes(manifest()));
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/(?:src|href)=["']https?:/i);
    expect(html).toContain("default-src 'none'");
    expect(html).not.toContain("<b>Lab</b>");
    expect(html).toContain("Vault &lt;b&gt;Lab&lt;/b&gt;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("—"); // optional file size
  });

  it("shows a supplied signature envelope and says so when there is none", () => {
    expect(renderRecordPage(bytes(manifest()), { signatureEnvelope: '{"payloadType":"x"}' })).toContain("payloadType");
    expect(renderRecordPage(bytes(manifest()))).toContain("No signature envelope");
  });

  it("refuses data that is not a valid manifest", () => {
    expect(() => renderRecordPage(bytes(manifest({ tag: "bad tag!" })))).toThrow();
    expect(() => renderRecordPage(bytes({ ...manifest(), extra: 1 }))).toThrow();
    expect(() => renderRecordPage(new TextEncoder().encode("not json"))).toThrow();
  });
});

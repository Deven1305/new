import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildManifest,
  encodePointer,
  generateReleaseKey,
  manifestBytes,
  manifestDigest,
  releaseStatement,
  sha256Hex,
  signStatementWithKey,
  sriSha384,
  type DsseEnvelope,
} from "@pramaan/manifest/node";
import { rawCidFromSha256 } from "@pramaan/manifest";
import { checkSite, dnsEncode, memoryPinStore, siteRow, verifySiteRelease, type PramaanRecords, type RecordsResult, type TimelockRead, type TimelockState } from "../src/index.js";

let server: Server;
let origin = "";
const routes = new Map<string, { body: Uint8Array | string; type: string }>();
let key: Awaited<ReturnType<typeof generateReleaseKey>>;
let pointer = "";
let digest = "";
let manifestBody: Uint8Array;
let envelope: DsseEnvelope;

beforeAll(async () => {
  server = createServer((req, res) => {
    const route = routes.get(new URL(req.url ?? "/", "http://x").pathname);
    if (!route) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": route.type }).end(route.body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  key = await generateReleaseKey();
  const manifest = buildManifest({
    app: { name: "Vault", ensName: "pramaan-demo.eth", domain: origin },
    repo: "local:test",
    commit: "0".repeat(40),
    tag: "v1.0.0",
    workflow: null,
    builtAt: "2026-11-04T00:00:00Z",
    files: [{ path: "/index.html", sha256: sha256Hex("<html>"), sri: sriSha384("<html>") }],
  });
  digest = manifestDigest(manifest);
  manifestBody = manifestBytes(manifest);
  pointer = encodePointer("v1.0.0", digest);
  envelope = await signStatementWithKey(releaseStatement(digest, { tag: "v1.0.0" }), key.privateKeyPkcs8Pem);
  routes.set("/.well-known/pramaan.json", { body: JSON.stringify({ pramaan: 1, ensName: "pramaan-demo.eth", chainId: 31337 }), type: "application/json" });
  routes.set("/.well-known/pramaan-manifest.json", { body: manifestBytes(manifest), type: "application/json" });
  routes.set("/.well-known/pramaan-manifest.dsse.json", { body: JSON.stringify(envelope), type: "application/json" });
});

afterAll(() => server?.close());

function records(overrides: Partial<PramaanRecords> = {}): (chain: unknown, name: string) => Promise<RecordsResult> {
  return async () => ({
    status: "ok",
    sources: 2,
    singleSource: false,
    records: {
      "pramaan.record": pointer,
      "pramaan.domain": origin,
      "pramaan.repo": null,
      "pramaan.attestation": "key",
      "pramaan.signer": key.signerRecord,
      "pramaan.revoked": null,
      "pramaan.timelock": null,
      ...overrides,
    },
  });
}

const chains = { 31337: { chainId: 31337, rpcUrls: ["http://127.0.0.1:1"] } };
const base = () => ({ origin, chains, ipfsGateways: [] as string[], pins: memoryPinStore() });

describe("verifySiteRelease (release-key mode, local site)", () => {
  it("verifies the genuine release and pins the binding", async () => {
    const pins = memoryPinStore();
    const r = await verifySiteRelease({ ...base(), pins, recordsReader: records() });
    expect(r.status).toBe("verified");
    expect(r.signature).toMatchObject({ status: "valid", mode: "key" });
    expect(await pins.get(origin)).toBe("pramaan-demo.eth");
  });

  it("reports a missing release when the site publishes no hint", async () => {
    const saved = routes.get("/.well-known/pramaan.json")!;
    routes.delete("/.well-known/pramaan.json");
    try {
      expect((await verifySiteRelease({ ...base(), recordsReader: records() })).status).toBe("missing");
    } finally {
      routes.set("/.well-known/pramaan.json", saved);
    }
  });

  it("refuses an ENS name that does not claim this origin (lookalike domain)", async () => {
    const r = await verifySiteRelease({ ...base(), recordsReader: records({ "pramaan.domain": "https://real-vault.example" }) });
    expect(r.status).toBe("mismatch");
  });

  it("refuses a manifest whose bytes do not hash to the pointer", async () => {
    const r = await verifySiteRelease({ ...base(), recordsReader: records({ "pramaan.record": encodePointer("v1.0.0", "e".repeat(64)) }) });
    expect(r.status).toBe("mismatch");
    expect(r.attempts.some((a) => a.outcome === "digest-mismatch")).toBe(true);
  });

  it("rejects a signature by a key other than pramaan.signer", async () => {
    const other = await generateReleaseKey();
    const r = await verifySiteRelease({ ...base(), recordsReader: records({ "pramaan.signer": other.signerRecord }) });
    expect(r.status).toBe("invalid-signature");
  });

  it("reports a release whose manifest sha256 is listed in pramaan.revoked as revoked (red, blocking)", async () => {
    const r = await verifySiteRelease({ ...base(), recordsReader: records({ "pramaan.revoked": `${"1".repeat(64)} ${digest}` }) });
    expect(r).toMatchObject({ status: "revoked", reason: "revoked" });
    expect(siteRow(r, null)).toMatchObject({ color: "red", blocking: true, key: "verify.site.revoked" });
  });

  it("stays verified when only OTHER releases are revoked", async () => {
    const r = await verifySiteRelease({ ...base(), recordsReader: records({ "pramaan.revoked": "2".repeat(64) }) });
    expect(r.status).toBe("verified");
    expect(r.revocations).toEqual(["2".repeat(64)]);
  });

  it("never ignores a malformed revocation record (a tag instead of a digest, too many entries)", async () => {
    for (const bad of ["v1.0.0", Array.from({ length: 17 }, (_, i) => i.toString(16).padStart(64, "0")).join(" ")]) {
      const r = await verifySiteRelease({ ...base(), recordsReader: records({ "pramaan.revoked": bad }) });
      expect(r).toMatchObject({ status: "unverifiable", reason: "revocations-malformed" });
    }
  });

  it("treats malformed pointer, domain, signer and timelock records as unverifiable or missing, never verified", async () => {
    expect(await verifySiteRelease({ ...base(), recordsReader: records({ "pramaan.record": "pramaan:v1:bad tag:xyz" }) })).toMatchObject({ status: "unverifiable", reason: "pointer-malformed" });
    expect(await verifySiteRelease({ ...base(), recordsReader: records({ "pramaan.record": null }) })).toMatchObject({ status: "missing", reason: "no-pointer" });
    expect(await verifySiteRelease({ ...base(), recordsReader: records({ "pramaan.domain": "not a url" }) })).toMatchObject({ status: "unverifiable", reason: "domain-record-malformed" });
    expect(await verifySiteRelease({ ...base(), recordsReader: records({ "pramaan.signer": "p256-spki:garbage" }) })).toMatchObject({ status: "unverifiable", reason: "signature-missing" });
    expect(await verifySiteRelease({ ...base(), recordsReader: records({ "pramaan.timelock": "0x1234" }) })).toMatchObject({ status: "unverifiable", reason: "timelock-record-malformed" });
  });

  it("is unverifiable (never verified) when RPCs disagree or fail, with distinct reasons", async () => {
    const r = await verifySiteRelease({ ...base(), recordsReader: async () => ({ status: "disagree", detail: "RPC endpoints returned 2 different answers" }) });
    expect(r).toMatchObject({ status: "unverifiable", reason: "rpc-disagree" });
    const down = await verifySiteRelease({ ...base(), recordsReader: async () => ({ status: "error", detail: "0 of 2 required RPC answers" }) });
    expect(down).toMatchObject({ status: "unverifiable", reason: "rpc-unavailable" });
  });

  it("detects an origin re-bound to a different ENS name after first use", async () => {
    const pins = memoryPinStore();
    await pins.set(origin, "pramaan-demo.eth");
    routes.set("/.well-known/pramaan.json", { body: JSON.stringify({ pramaan: 1, ensName: "attacker-vault.eth", chainId: 31337 }), type: "application/json" });
    try {
      expect((await verifySiteRelease({ ...base(), pins, recordsReader: records() })).status).toBe("mismatch");
    } finally {
      routes.set("/.well-known/pramaan.json", { body: JSON.stringify({ pramaan: 1, ensName: "pramaan-demo.eth", chainId: 31337 }), type: "application/json" });
    }
  });
});

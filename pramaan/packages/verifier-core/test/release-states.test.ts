import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildManifest,
  encodePointer,
  generateReleaseKey,
  manifestBytes,
  manifestDigest,
  rawCidFromSha256,
  releaseStatement,
  sha256Hex,
  signStatementWithKey,
  sriSha384,
} from "@pramaan/manifest/node";
import {
  checkSite,
  dnsEncode,
  formatRevocations,
  memoryPinStore,
  parseRevocations,
  siteRow,
  verifySiteRelease,
  type PramaanRecords,
  type RecordsResult,
  type TimelockRead,
  type TimelockState,
} from "../src/index.js";

/** Non-green states that need a site: IPFS gateway failure vs mismatch, wrong/invalid CIDs, timelock pending/replay. */
const routes = new Map<string, { body: Uint8Array | string; type: string }>();
let site: Server;
let gw: Server;
let origin = "";
let gateway = "";
let gwMode: "garbage" | "genuine" | "down" = "garbage";
let digest = "";
let pointer = "";
let body: Uint8Array;
let signerRecord = "";
const HTML = "<html>states</html>";

function serve(handler: Parameters<typeof createServer>[1]): Promise<{ server: Server; url: string }> {
  const server = createServer(handler);
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })));
}

beforeAll(async () => {
  ({ server: site, url: origin } = await serve((req, res) => {
    const route = routes.get(new URL(req.url ?? "/", "http://x").pathname);
    if (!route) return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": route.type }).end(route.body);
  }));
  ({ server: gw, url: gateway } = await serve((req, res) => {
    if (gwMode === "down") return void res.writeHead(504).end("gateway timeout");
    if (!req.url?.startsWith(`/ipfs/${rawCidFromSha256(digest)}`)) return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": "application/vnd.ipld.raw" }).end(gwMode === "genuine" ? body : "<html>rate limited</html>");
  }));
  const key = await generateReleaseKey();
  signerRecord = key.signerRecord;
  const manifest = buildManifest({
    app: { name: "States", ensName: "vaultlab.pramaan-test.eth", domain: origin },
    repo: "local:test",
    commit: "0".repeat(40),
    tag: "v1.0.0",
    workflow: null,
    builtAt: "2026-11-04T00:00:00Z",
    files: [{ path: "/index.html", sha256: sha256Hex(HTML), sri: sriSha384(HTML) }],
  });
  body = manifestBytes(manifest);
  digest = manifestDigest(manifest);
  pointer = encodePointer("v1.0.0", digest);
  const envelope = await signStatementWithKey(releaseStatement(digest, { tag: "v1.0.0" }), key.privateKeyPkcs8Pem);
  routes.set("/.well-known/pramaan.json", { body: JSON.stringify({ pramaan: 1, ensName: "vaultlab.pramaan-test.eth", chainId: 31337 }), type: "application/json" });
  routes.set("/.well-known/pramaan-manifest.json", { body, type: "application/json" });
  routes.set("/.well-known/pramaan-manifest.dsse.json", { body: JSON.stringify(envelope), type: "application/json" });
});

afterAll(() => {
  site?.close();
  gw?.close();
});

const records =
  (overrides: Partial<PramaanRecords> = {}) =>
  async (): Promise<RecordsResult> => ({
    status: "ok",
    sources: 2,
    singleSource: false,
    records: {
      "pramaan.record": pointer,
      "pramaan.domain": origin,
      "pramaan.repo": null,
      "pramaan.attestation": "key",
      "pramaan.signer": signerRecord,
      "pramaan.revoked": null,
      "pramaan.timelock": null,
      ...overrides,
    },
  });
const base = () => ({ origin, chains: { 31337: { chainId: 31337, rpcUrls: ["http://127.0.0.1:1"] } }, ipfsGateways: [] as string[], pins: memoryPinStore() });

async function withoutOriginManifest<T>(fn: () => Promise<T>): Promise<T> {
  const saved = routes.get("/.well-known/pramaan-manifest.json")!;
  routes.delete("/.well-known/pramaan-manifest.json");
  try {
    return await fn();
  } finally {
    routes.set("/.well-known/pramaan-manifest.json", saved);
  }
}

describe("revocation record format", () => {
  it("parses, normalises and bounds pramaan.revoked", () => {
    expect(parseRevocations(null)).toEqual({ ok: true, revoked: [] });
    expect(parseRevocations(` ${"A".repeat(64)},${"b".repeat(64)}  ${"a".repeat(64)} `)).toEqual({ ok: true, revoked: ["a".repeat(64), "b".repeat(64)] });
    expect(parseRevocations("v1.0.0").ok).toBe(false);
    expect(parseRevocations(`bafkrei${"a".repeat(52)}`).ok).toBe(false);
    expect(formatRevocations(["c".repeat(64), "C".repeat(64)])).toBe("c".repeat(64));
    expect(() => formatRevocations(Array.from({ length: 17 }, (_, i) => i.toString(16).padStart(64, "0")))).toThrow(/max 16|longer than 1039/);
  });
});

describe("manifest availability", () => {
  it("an IPFS gateway answering 200 with wrong bytes, or failing, is a service failure: unverifiable, never mismatch", async () => {
    for (const mode of ["garbage", "down"] as const) {
      gwMode = mode;
      const r = await withoutOriginManifest(() => verifySiteRelease({ ...base(), ipfsGateways: [gateway], recordsReader: records() }));
      expect(r).toMatchObject({ status: "unverifiable", reason: "manifest-unavailable" });
      expect(r.attempts.some((a) => a.kind === "ipfs" && a.outcome === "error")).toBe(true);
    }
  });

  it("the site's own different manifest is a confirmed mismatch (red)", async () => {
    const saved = routes.get("/.well-known/pramaan-manifest.json")!;
    routes.set("/.well-known/pramaan-manifest.json", { body: "{}", type: "application/json" });
    try {
      const r = await verifySiteRelease({ ...base(), recordsReader: records() });
      expect(r).toMatchObject({ status: "mismatch", reason: "manifest-digest-mismatch" });
    } finally {
      routes.set("/.well-known/pramaan-manifest.json", saved);
    }
  });

  it("verifies from a gateway that serves the exact raw block", async () => {
    gwMode = "genuine";
    const r = await withoutOriginManifest(() => verifySiteRelease({ ...base(), ipfsGateways: [gateway], recordsReader: records() }));
    expect(r.status).toBe("verified");
    expect(r.manifestSource).toContain(`/ipfs/${rawCidFromSha256(digest)}`);
  });

  it("refuses hint CIDs that do not commit to the pointer (wrong CID, invalid CID) without fetching them", async () => {
    const hint = { pramaan: 1, ensName: "vaultlab.pramaan-test.eth", chainId: 31337, manifestUrls: [`ipfs://${rawCidFromSha256("e".repeat(64))}`, "ipfs://QmNotACidV1"] };
    const ok = await verifySiteRelease({ ...base(), hint, recordsReader: records() });
    expect(ok.status).toBe("verified"); // the origin still serves the committed manifest
    const invalid = ok.attempts.filter((a) => a.outcome === "invalid");
    expect(invalid.map((a) => a.detail)).toEqual([expect.stringMatching(/not the ENS pointer's digest/), expect.stringMatching(/not a base32 CIDv1/)]);
    const none = await withoutOriginManifest(() => verifySiteRelease({ ...base(), hint, recordsReader: records() }));
    expect(none).toMatchObject({ status: "unverifiable", reason: "manifest-unavailable" });
  });
});

describe("release timelock: pending updates, replayed and bypassed pointers", () => {
  const TL = "0x00000000000000000000000000000000000000aa" as const;
  const tl =
    (ops: TimelockState["ops"], lastExecutedId: number, over: Partial<TimelockState> = {}) =>
    async (): Promise<TimelockRead> => ({
      status: "ok",
      state: { address: TL, key: "pramaan.record", dnsName: dnsEncode("vaultlab.pramaan-test.eth"), delay: 120, gracePeriod: 14 * 86400, operationCount: ops.length, lastExecutedId, ops, now: 2_000_000_000, ...over },
    });
  const older = () => encodePointer("v0.9.0", "9".repeat(64));
  const newer = () => encodePointer("v1.1.0", "b".repeat(64));
  const verify = (reader: () => Promise<TimelockRead>) => verifySiteRelease({ ...base(), recordsReader: records({ "pramaan.timelock": TL }), timelockReader: reader });

  it("is verified when the record is the pointer the timelock executed last", async () => {
    const r = await verify(tl([{ id: 2, value: pointer, eta: 1, state: "Executed" }, { id: 1, value: older(), eta: 0, state: "Executed" }], 2));
    expect(r).toMatchObject({ status: "verified", reason: null, pending: [] });
    expect(r.timelock).toMatchObject({ address: TL, lastExecutedId: 2 });
  });

  it("shows a newer queued pointer as pending: still verified, but the site row is amber", async () => {
    const r = await verify(tl([{ id: 2, value: newer(), eta: 2_000_000_100, state: "Queued" }, { id: 1, value: pointer, eta: 1, state: "Executed" }], 1));
    expect(r).toMatchObject({ status: "verified", reason: "update-pending" });
    expect(r.pending[0]).toMatchObject({ id: 2, ready: false, pointer: { tag: "v1.1.0" } });
    const files = checkSite(r.manifest!, origin, [{ url: `${origin}/`, type: "main_frame", sha256: sha256Hex(HTML) }]);
    expect(files.severity).toBe("green");
    expect(siteRow(r, files)).toMatchObject({ color: "amber", blocking: false, detail: expect.stringContaining("update pending") });
  });

  it("ignores cancelled and expired queued pointers", async () => {
    const r = await verify(
      tl([{ id: 3, value: newer(), eta: 1_000_000_000, state: "Queued" }, { id: 2, value: older(), eta: 1_999_999_000, state: "Cancelled" }, { id: 1, value: pointer, eta: 1, state: "Executed" }], 1),
    );
    expect(r).toMatchObject({ status: "verified", reason: null, pending: [] });
  });

  it("goes red when the record holds an older, superseded release (replay)", async () => {
    expect(await verify(tl([{ id: 2, value: newer(), eta: 1, state: "Executed" }, { id: 1, value: pointer, eta: 0, state: "Executed" }], 2))).toMatchObject({ status: "mismatch", reason: "replayed-pointer" });
  });

  it("goes red when the record was not written by the timelock (delay bypassed)", async () => {
    expect(await verify(tl([{ id: 1, value: older(), eta: 0, state: "Executed" }], 1))).toMatchObject({ status: "mismatch", reason: "pointer-not-from-timelock" });
    expect(await verify(tl([{ id: 1, value: pointer, eta: 9, state: "Queued" }], 0))).toMatchObject({ status: "mismatch", reason: "pointer-not-from-timelock" });
  });

  it("is unverifiable when the timelock controls another name or cannot be read consistently", async () => {
    expect(await verify(tl([], 0, { dnsName: dnsEncode("other.eth") }))).toMatchObject({ status: "unverifiable", reason: "timelock-mismatch" });
    expect(await verify(async () => ({ status: "disagree", detail: "2 different answers" }))).toMatchObject({ status: "unverifiable", reason: "rpc-disagree" });
    expect(await verify(async () => ({ status: "error", detail: "no answer" }))).toMatchObject({ status: "unverifiable", reason: "timelock-unreadable" });
  });
});

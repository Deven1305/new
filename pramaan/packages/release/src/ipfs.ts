import { rawCidForBytes, sha256Hex } from "@pramaan/manifest";

/**
 * IPFS is an AVAILABILITY layer only: the manifest is trusted because its sha256 is in ENS, not because of where it
 * is stored. Uploads use raw leaves + CIDv1 so a small manifest's CID is exactly the raw-codec CID of its bytes, i.e.
 * derivable from the ENS pointer.
 */
export interface IpfsPublication {
  provider: "kubo" | "pinata";
  cid: string;
  expectedCid: string;
  matchesPointer: boolean;
  gateways: { url: string; ok: boolean; detail: string }[];
}

function blob(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: "application/json" });
}

export async function kuboAdd(apiUrl: string, bytes: Uint8Array, name = "pramaan-manifest.json"): Promise<string> {
  const form = new FormData();
  form.append("file", blob(bytes), name);
  const res = await fetch(`${apiUrl.replace(/\/$/, "")}/api/v0/add?cid-version=1&raw-leaves=true&pin=true&quieter=true`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Kubo add failed: HTTP ${res.status} ${await res.text()}`);
  const lines = (await res.text()).trim().split("\n");
  const last = JSON.parse(lines[lines.length - 1]!) as { Hash?: string };
  if (!last.Hash) throw new Error("Kubo add returned no CID");
  return last.Hash;
}

/** Pinata v3 Files API (public network). Requires a JWT with files:write. */
export async function pinataUpload(jwt: string, bytes: Uint8Array, name = "pramaan-manifest.json"): Promise<string> {
  const form = new FormData();
  form.append("file", blob(bytes), name);
  form.append("network", "public");
  form.append("name", name);
  const res = await fetch("https://uploads.pinata.cloud/v3/files", { method: "POST", headers: { authorization: `Bearer ${jwt}` }, body: form });
  if (!res.ok) throw new Error(`Pinata upload failed: HTTP ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { data?: { cid?: string } };
  if (!body.data?.cid) throw new Error("Pinata returned no CID");
  return body.data.cid;
}

/** Fetches the block from a gateway in trustless raw mode and checks it hashes to the expected digest. */
export async function verifyGateway(gateway: string, cid: string, expectedSha256: string, timeoutMs = 20_000): Promise<{ url: string; ok: boolean; detail: string }> {
  const url = `${gateway.replace(/\/$/, "")}/ipfs/${cid}?format=raw`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { accept: "application/vnd.ipld.raw" }, signal: controller.signal });
    if (!res.ok) return { url, ok: false, detail: `HTTP ${res.status}` };
    const bytes = new Uint8Array(await res.arrayBuffer());
    const actual = sha256Hex(bytes);
    return { url, ok: actual === expectedSha256, detail: actual === expectedSha256 ? "bytes hash to the manifest digest" : `sha256 ${actual} does not match` };
  } catch (err) {
    return { url, ok: false, detail: (err as Error).name === "AbortError" ? "timed out" : (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

export async function publishToIpfs(
  bytes: Uint8Array,
  opts: { kuboApi?: string; pinataJwt?: string; gateways?: string[] },
): Promise<IpfsPublication> {
  const expectedCid = rawCidForBytes(bytes);
  let provider: IpfsPublication["provider"];
  let cid: string;
  if (opts.pinataJwt) {
    provider = "pinata";
    cid = await pinataUpload(opts.pinataJwt, bytes);
  } else if (opts.kuboApi) {
    provider = "kubo";
    cid = await kuboAdd(opts.kuboApi, bytes);
  } else {
    throw new Error("no IPFS provider configured (set IPFS_API_URL for a Kubo node or PINATA_JWT)");
  }
  const digest = sha256Hex(bytes);
  const gateways = [];
  for (const gw of opts.gateways ?? []) gateways.push(await verifyGateway(gw, cid, digest));
  return { provider, cid, expectedCid, matchesPointer: cid === expectedCid, gateways };
}

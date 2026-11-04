import { getAddress } from "viem";
import { sha256Hex } from "./hash";
import type { Address, ManifestFacts, ManifestObservation } from "./types";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Reads only what monitoring needs from a Pramaan manifest v1 (packages/manifest/src/schema.ts): the app identity, the
 * tag, and every contract with its proxy implementation. The full strict schema is verified by the browser extension and
 * the server; here an unexpected shape yields facts=null (=> MANIFEST_MISMATCH / UNKNOWN), never a silent pass.
 */
export function extractManifestFacts(doc: unknown): { facts: ManifestFacts } | { error: string } {
  if (typeof doc !== "object" || doc === null) return { error: "manifest is not a JSON object" };
  const m = doc as Record<string, unknown>;
  if (m["schema"] !== "https://pramaan.dev/schemas/manifest/v1") return { error: "unsupported manifest schema" };
  const app = m["app"] as Record<string, unknown> | undefined;
  if (!app || typeof app["ensName"] !== "string") return { error: "manifest.app.ensName missing" };
  if (typeof m["tag"] !== "string") return { error: "manifest.tag missing" };
  if (!Array.isArray(m["contracts"])) return { error: "manifest.contracts missing" };
  const contracts: ManifestFacts["contracts"] = [];
  for (const raw of m["contracts"] as unknown[]) {
    const c = raw as Record<string, unknown>;
    if (typeof c !== "object" || c === null || typeof c["address"] !== "string" || !ADDRESS_RE.test(c["address"]) || typeof c["chainId"] !== "number") {
      return { error: "manifest.contracts has a malformed entry" };
    }
    const proxy = c["proxy"] as Record<string, unknown> | null | undefined;
    let implementation: Address | null = null;
    if (proxy) {
      if (typeof proxy["implAddress"] !== "string" || !ADDRESS_RE.test(proxy["implAddress"])) return { error: "manifest.contracts[].proxy.implAddress malformed" };
      implementation = getAddress(proxy["implAddress"]) as Address;
    }
    contracts.push({ address: getAddress(c["address"]) as Address, chainId: c["chainId"], label: typeof c["label"] === "string" ? c["label"] : "", implementation });
  }
  return { facts: { ensName: String(app["ensName"]), tag: m["tag"], contracts } };
}

/** Hashes the exact received bytes and extracts facts. Pure: no network. */
export function inspectManifestBytes(status: number, body: Uint8Array): ManifestObservation {
  if (status !== 200) return { status, sha256: "", size: body.length, facts: null, error: `HTTP ${status}` };
  const sha256 = sha256Hex(body);
  let doc: unknown;
  try {
    doc = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return { status, sha256, size: body.length, facts: null, error: "body is not valid JSON" };
  }
  const r = extractManifestFacts(doc);
  return "facts" in r ? { status, sha256, size: body.length, facts: r.facts, error: null } : { status, sha256, size: body.length, facts: null, error: r.error };
}

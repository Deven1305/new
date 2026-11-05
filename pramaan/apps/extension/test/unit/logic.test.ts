import { encodeAbiParameters, encodeFunctionData, getAddress, keccak256, namehash, parseAbi, toBytes, toFunctionSelector, toHex } from "viem";
import { packetToBytes } from "viem/ens";
import { describe, expect, it } from "vitest";
import { matchBody, matchHeaders, matchUrl, matchValue } from "../../src/shared/leaks.js";
import { decide, refineContractRow, refineSiteRow, timeoutRow } from "../../src/shared/policy.js";
import { describeRpc, dnsDecode } from "../../src/shared/rpc-log.js";
import type { ReleaseVerification, VerdictRow } from "@pramaan/verifier-core";

const ADDR = "0x173a8ce665789f4065ab3ef9f1d190bbcad834cc";
const CHECKSUM = getAddress(ADDR);
const accounts = [ADDR];
const raw = (text: string) => ({ raw: [{ bytes: new TextEncoder().encode(text).buffer as ArrayBuffer }] });
const b64 = (s: string) => Buffer.from(s).toString("base64");
const b64url = (s: string) => Buffer.from(s).toString("base64url");

describe("address leak matching (all PermitMarket fixture channels + encodings)", () => {
  it("query parameters: checksummed, lowercase without 0x, uppercase, URL-encoded", () => {
    expect(matchUrl(`http://127.0.0.1:5190/collect?addr=${CHECKSUM}`, accounts)).toMatchObject({ form: "checksummed address", where: "query ?addr=" });
    expect(matchUrl(`http://127.0.0.1:5190/collect?a=${ADDR.slice(2)}`, accounts)).toMatchObject({ form: "lowercase address without 0x", where: "query ?a=" });
    expect(matchUrl(`http://t.example/p?w=0x${ADDR.slice(2).toUpperCase()}`, accounts)?.form).toBe("uppercase hex address");
    // Double URL-encoding: URLSearchParams removes one layer, the matcher the second.
    expect(matchUrl(`http://t.example/p?d=${encodeURIComponent(encodeURIComponent(JSON.stringify({ w: ADDR })))}`, accounts)).toMatchObject({ where: "query ?d=" });
    // base64 inside a URL-encoded value (+, /, = escaped).
    expect(matchUrl(`http://t.example/p?d=${encodeURIComponent(b64(`{"w":"${CHECKSUM}"}`))}`, accounts)?.form).toMatch(/base64/);
    expect(matchUrl(`http://t.example/u/${ADDR}/pixel.gif`, accounts)?.where).toBe("URL path");
    expect(matchUrl("http://t.example/collect?x=1", accounts)).toBeNull();
  });

  it("bodies: JSON field, base64 text, form data, ABI hex inside JSON-RPC", () => {
    expect(matchBody(raw(JSON.stringify({ wallet: CHECKSUM })), accounts)).toMatchObject({ where: "JSON body field wallet", form: "checksummed address" });
    expect(matchBody(raw(b64(CHECKSUM)), accounts)).toMatchObject({ form: "base64(checksummed address)", where: "request body" });
    expect(matchBody(raw(b64url(JSON.stringify({ event: "connect", user: ADDR }))), accounts)?.form).toMatch(/^base64(url)?\(lowercase address\)$/);
    expect(matchBody({ formData: { who: [ADDR] } }, accounts)?.where).toBe("form field who");
    const calldata = encodeFunctionData({ abi: parseAbi(["function balanceOf(address)"]), functionName: "balanceOf", args: [ADDR] });
    expect(matchBody(raw(JSON.stringify({ method: "eth_call", params: [{ data: calldata }] })), accounts)?.form).toContain("inside hex data");
    expect(matchBody(raw("event=connect&a=" + encodeURIComponent(CHECKSUM)), accounts)?.where).toBe("form field a");
  });

  it("hashes and headers", () => {
    expect(matchValue(keccak256(toBytes(ADDR)), accounts)?.form).toBe("keccak256(address)");
    expect(matchHeaders([{ name: "X-Wallet", value: CHECKSUM }], accounts)?.where).toBe("header X-Wallet");
  });

  it("no false positive on other addresses or random base64", () => {
    expect(matchValue("0x" + "ab".repeat(20), accounts)).toBeNull();
    expect(matchValue(b64("hello world, nothing to see here at all"), accounts)).toBeNull();
  });
});

describe("Privacy panel read descriptions", () => {
  it("decodes Universal Resolver text reads, code and storage reads", () => {
    const name = "vaultlab.kosh.eth";
    const inner = encodeFunctionData({ abi: parseAbi(["function text(bytes32,string) view returns (string)"]), functionName: "text", args: [namehash(name), "pramaan.record"] });
    const data = `${toFunctionSelector("resolveWithGateways(bytes,bytes,string[])")}${encodeAbiParameters([{ type: "bytes" }, { type: "bytes" }, { type: "string[]" }], [toHex(packetToBytes(name)), inner, ["x-batch-gateway:true"]]).slice(2)}`;
    expect(dnsDecode(toHex(packetToBytes(name)))).toBe(name);
    expect(describeRpc(JSON.stringify({ method: "eth_call", params: [{ to: "0xeeee", data }, "latest"] })).what).toBe(`ENS text "pramaan.record" of ${name}`);
    expect(describeRpc({ method: "eth_getStorageAt", params: ["0xabc", "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"] }).what).toBe("EIP-1967 implementation slot of 0xabc");
    expect(describeRpc({ method: "eth_getCode", params: ["0xabc"] }).what).toBe("contract code of 0xabc");
    expect(describeRpc({ method: "eth_chainId", params: [] }).what).toBe("chain id of the endpoint");
  });
});

describe("fail-closed policy", () => {
  const green: VerdictRow = { id: "site", color: "green", key: "verify.site.verified", params: { tag: "v1", signer: "k" }, detail: "", blocking: false };
  const none = { level: "info" as const, findings: [] };

  it("green rows and a harmless action are not blocked", () => expect(decide([green], none)).toEqual({ blocked: false, reasons: [] }));
  it("red verification, unknown-after-timeout, release contradiction and critical actions block", () => {
    expect(decide([{ ...green, color: "red", blocking: true }], none).reasons).toEqual(["verification-red"]);
    expect(decide([timeoutRow(30_000)], none, { timedOut: true }).blocked).toBe(true);
    expect(decide([green], { level: "high", findings: [{ code: "SPENDER_NOT_IN_RELEASE", level: "high", params: {} }] }).reasons).toEqual(["release-contradiction"]);
    expect(decide([green], { level: "critical", findings: [{ code: "ETH_SIGN", level: "critical", params: {} }] }).reasons).toEqual(["critical-action"]);
    // High risk (unlimited approval) is red in the action row but the user may still choose: not blocked.
    expect(decide([green], { level: "high", findings: [{ code: "UNLIMITED_APPROVAL", level: "high", params: {} }] }).blocked).toBe(false);
  });

  it("pending update is amber with the ETA; revoked is red; wrong-chain contract is red and blocking", () => {
    const release = { status: "verified", pending: [{ id: 2, value: "", pointer: { version: 1, tag: "v2", manifestSha256: "0".repeat(64) }, eta: 1_800_000_000, ready: false }] } as unknown as ReleaseVerification;
    const pending = refineSiteRow(green, release);
    expect(pending).toMatchObject({ color: "amber", key: "verify.site.pending", params: { tag: "v1", next: "v2", when: "2027-01-15 08:00 UTC" } });
    expect(refineSiteRow(green, { status: "revoked" } as ReleaseVerification)).toMatchObject({ color: "red", key: "verify.site.revoked", blocking: true });
    const wc = refineContractRow({ ...green, id: "contract" }, { status: "wrong-chain", address: "0x0", chainId: 1, label: null, detail: "" });
    expect(wc).toMatchObject({ color: "red", key: "verify.contract.wrong-chain", blocking: true });
  });
});

import { describe, expect, it } from "bun:test";
import { decodeFunctionData, encodeFunctionResult, parseAbi } from "viem";
import {
  decodeEnsV1TextResult,
  decodeResolveTextResult,
  dnsEncode,
  encodeEnsV1Text,
  encodeResolveText,
  resolverAbi,
} from "../../src/abi";

describe("ENSv2 & ENSv1 Resolver Codec", () => {
  describe("dnsEncode", () => {
    it("encodes standard 2-level name to DNS wire format", () => {
      const encoded = dnsEncode("pramaan.eth");
      // \x07pramaan\x03eth\x00
      // 07 7072616d61616e 03 657468 00
      expect(encoded).toBe("0x077072616d61616e0365746800");
    });

    it("encodes subdomains to DNS wire format", () => {
      const encoded = dnsEncode("vaultlab.pramaan.eth");
      // \x08vaultlab\x07pramaan\x03eth\x00
      expect(encoded).toBe("0x087661756c746c6162077072616d61616e0365746800");
    });

    it("normalizes case before encoding", () => {
      const lower = dnsEncode("VaultLab.Pramaan.ETH");
      expect(lower).toBe(dnsEncode("vaultlab.pramaan.eth"));
    });

    it("throws on empty labels", () => {
      expect(() => dnsEncode("vaultlab..eth")).toThrow();
    });
  });

  describe("encodeResolveText", () => {
    it("encodes resolve(dnsName, text(bytes32(0), key))", () => {
      const ensName = "vaultlab.pramaan.eth";
      const key = "pramaan.record";
      const calldata = encodeResolveText(ensName, key);

      // Verify the outer call is resolve(bytes,bytes)
      const decodedOuter = decodeFunctionData({
        abi: resolverAbi,
        data: calldata,
      });
      expect(decodedOuter.functionName).toBe("resolve");
      expect(decodedOuter.args).toBeDefined();

      const [nameArg, innerCallData] = decodedOuter.args as [`0x${string}`, `0x${string}`];
      expect(nameArg).toBe(dnsEncode(ensName));

      // Verify the inner call is text(bytes32(0), "pramaan.record")
      const decodedInner = decodeFunctionData({
        abi: resolverAbi,
        data: innerCallData,
      });
      expect(decodedInner.functionName).toBe("text");
      const [nodeArg, keyArg] = decodedInner.args as [`0x${string}`, string];
      expect(nodeArg).toBe("0x0000000000000000000000000000000000000000000000000000000000000000");
      expect(keyArg).toBe(key);
    });
  });

  describe("decodeResolveTextResult", () => {
    it("decodes round-trip returned text profile bytes", () => {
      const expectedRecord = "pramaan:v1:v1.0.0:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

      // Inner result of text(bytes32,string) is ABI-encoded string
      const textResultBytes = encodeFunctionResult({
        abi: resolverAbi,
        functionName: "text",
        result: expectedRecord,
      });

      // Outer result of resolve(bytes,bytes) is ABI-encoded bytes containing textResultBytes
      const resolveReturnData = encodeFunctionResult({
        abi: resolverAbi,
        functionName: "resolve",
        result: textResultBytes,
      });

      const decoded = decodeResolveTextResult(resolveReturnData);
      expect(decoded).toBe(expectedRecord);
    });

    it("throws when nested profile bytes are empty", () => {
      const emptyResolveReturn = encodeFunctionResult({
        abi: resolverAbi,
        functionName: "resolve",
        result: "0x",
      });
      expect(() => decodeResolveTextResult(emptyResolveReturn)).toThrow("Resolver returned empty profile bytes");
    });

    it("decodes valid absent text (ABI-encoded empty string) as empty string", () => {
      const emptyTextResultBytes = encodeFunctionResult({
        abi: resolverAbi,
        functionName: "text",
        result: "",
      });
      const resolveReturnData = encodeFunctionResult({
        abi: resolverAbi,
        functionName: "resolve",
        result: emptyTextResultBytes,
      });
      expect(decodeResolveTextResult(resolveReturnData)).toBe("");
    });
  });

  describe("ENSv1 fallback", () => {
    it("encodes text(namehash, key) directly", () => {
      const calldata = encodeEnsV1Text("pramaan.eth", "pramaan.record");
      const decoded = decodeFunctionData({
        abi: resolverAbi,
        data: calldata,
      });
      expect(decoded.functionName).toBe("text");
      expect(decoded.args?.[1]).toBe("pramaan.record");
    });

    it("decodes direct text result", () => {
      const record = "pramaan:v1:v1.0.0:aabbcc";
      const data = encodeFunctionResult({
        abi: resolverAbi,
        functionName: "text",
        result: record,
      });
      expect(decodeEnsV1TextResult(data)).toBe(record);
    });
  });
});

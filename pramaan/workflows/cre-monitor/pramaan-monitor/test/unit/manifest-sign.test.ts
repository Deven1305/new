import { describe, expect, it } from "bun:test";
import { extractManifestFacts, inspectManifestBytes } from "../../src/manifest";
import { buildIngestPayload, idempotencyKey, runIdFor, signedRequest } from "../../src/sign";
import type { Decision } from "../../src/types";

describe("Manifest Inspection & Ingest Payload Signing", () => {
  const enc = new TextEncoder();

  describe("extractManifestFacts & inspectManifestBytes", () => {
    it("extracts facts from valid manifest v1 JSON bytes", () => {
      const manifest = {
        schema: "https://pramaan.dev/schemas/manifest/v1",
        app: {
          ensName: "vaultlab.pramaan.eth",
        },
        tag: "v1.0.0",
        contracts: [
          {
            address: "0x1111111111111111111111111111111111111111",
            chainId: 11155111,
            label: "vault",
            proxy: {
              implAddress: "0x2222222222222222222222222222222222222222",
            },
          },
        ],
      };

      const bytes = enc.encode(JSON.stringify(manifest));
      const obs = inspectManifestBytes(200, bytes);

      expect(obs.status).toBe(200);
      expect(obs.facts).not.toBeNull();
      expect(obs.facts?.ensName).toBe("vaultlab.pramaan.eth");
      expect(obs.facts?.tag).toBe("v1.0.0");
      expect(obs.facts?.contracts.length).toBe(1);
      expect(obs.facts?.contracts[0]?.implementation).toBe("0x2222222222222222222222222222222222222222");
    });

    it("returns error on invalid manifest schema", () => {
      const bad = { schema: "https://unknown.com/schema" };
      const obs = inspectManifestBytes(200, enc.encode(JSON.stringify(bad)));
      expect(obs.facts).toBeNull();
      expect(obs.error).toBe("unsupported manifest schema");
    });
  });

  describe("signedRequest & determinism", () => {
    it("generates deterministic runId and idempotencyKey", () => {
      const runId1 = runIdFor("vaultlab", "2026-11-05T00:00:00.000Z");
      const runId2 = runIdFor("vaultlab", "2026-11-05T00:00:00.000Z");
      expect(runId1).toBe(runId2);

      const key1 = idempotencyKey("vaultlab", "PENDING_RELEASE_CHANGE", "op:1:0123");
      const key2 = idempotencyKey("vaultlab", "PENDING_RELEASE_CHANGE", "op:1:0123");
      expect(key1).toBe(key2);
    });

    it("signs exact serialized body with HMAC-SHA256", () => {
      const secret = "test-secret-key-12345";
      const decision: Decision = {
        decision: "PENDING_RELEASE_CHANGE",
        severity: "medium",
        subject: "op:1",
        summary: "Release pointer change queued",
        details: { op: 1 },
        findings: [],
      };

      const payload = buildIngestPayload({
        workflow: "pramaan-monitor",
        observedAt: new Date("2026-11-05T00:00:00.000Z"),
        chainId: 11155111,
        app: "vaultlab",
        ensName: "vaultlab.pramaan.eth",
        decision,
      });

      const { body, signature } = signedRequest(secret, payload);
      expect(signature.startsWith("sha256=")).toBe(true);

      // Verify re-signing identical body matches
      const { signature: sig2 } = signedRequest(secret, payload);
      expect(signature).toBe(sig2);

      // Verify modifying secret produces different signature
      const { signature: sigDiff } = signedRequest("other-secret", payload);
      expect(signature).not.toBe(sigDiff);
    });
  });
});

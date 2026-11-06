import { describe, expect, it } from "bun:test";
import { decide } from "../../src/decide";
import type { Observation } from "../../src/types";

describe("decide() decision engine", () => {
  const validSha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const baseObs: Observation = {
    app: "vaultlab",
    ensName: "vaultlab.pramaan.eth",
    chainId: 11155111,
    now: 1710000000,
    headBlock: 5000000,
    record: `pramaan:v1:v1.0.0:${validSha256}`,
    revokedRaw: "",
    timelock: null,
    scheduledUpgrades: [],
    implementations: [],
    logsComplete: true,
    manifest: {
      status: 200,
      sha256: validSha256,
      size: 1024,
      facts: {
        ensName: "vaultlab.pramaan.eth",
        tag: "v1.0.0",
        contracts: [],
      },
      error: null,
    },
    gaps: [],
  };

  it("returns OK when observation is fully verified and clean", () => {
    const res = decide(baseObs);
    expect(res.decision).toBe("OK");
    expect(res.severity).toBe("info");
    expect(res.findings.length).toBe(0);
  });

  it("returns UNKNOWN when observation contains gaps", () => {
    const obs: Observation = {
      ...baseObs,
      gaps: ["pramaan.record could not be read from the resolver"],
    };
    const res = decide(obs);
    expect(res.decision).toBe("UNKNOWN");
    expect(res.findings.some((f) => f.decision === "UNKNOWN")).toBe(true);
  });

  it("returns RELEASE_REVOKED when active release is listed in revoked", () => {
    const obs: Observation = {
      ...baseObs,
      revokedRaw: validSha256,
    };
    const res = decide(obs);
    expect(res.decision).toBe("RELEASE_REVOKED");
    expect(res.severity).toBe("critical");
  });

  it("returns MANIFEST_MISMATCH when fetched manifest sha256 disagrees with pointer", () => {
    const obs: Observation = {
      ...baseObs,
      manifest: {
        ...baseObs.manifest!,
        sha256: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
      },
    };
    const res = decide(obs);
    expect(res.decision).toBe("MANIFEST_MISMATCH");
    expect(res.severity).toBe("critical");
  });

  it("returns PENDING_RELEASE_CHANGE when queued timelock op exists", () => {
    const obs: Observation = {
      ...baseObs,
      timelock: {
        operationCount: 1,
        lastExecutedId: 0,
        ops: [
          {
            id: "1",
            value: `pramaan:v1:v1.1.0:${validSha256}`,
            eta: 1710000600, // 600s in the future
            state: "Queued",
          },
        ],
      },
    };
    const res = decide(obs);
    expect(res.decision).toBe("PENDING_RELEASE_CHANGE");
    expect(res.severity).toBe("medium");
    expect(res.details["secondsUntilEta"]).toBe(600);
  });
});

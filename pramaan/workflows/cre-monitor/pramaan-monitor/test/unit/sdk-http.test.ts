import { describe, expect, it } from "bun:test";
import {
  HTTPClient,
  Value,
  type NodeRuntime,
  type Runtime,
} from "@chainlink/cre-sdk";
import type { HTTP_CLIENT_PB } from "@chainlink/cre-sdk/pb";
import { decide } from "../../src/decide";
import {
  deliverIngestInNodeMode,
  fetchManifestInNodeMode,
  INGEST_SECRET_ID,
  MAX_CONSENSUS_WIRE_BYTES,
  MAX_INGEST_PAYLOAD_BYTES,
  MAX_MANIFEST_RESPONSE_BYTES,
  resolveIngestUrl,
  type HTTPClientCapability,
} from "../../src/sdk-http";
import {
  configSchema,
  limitsSchema,
  validateCronSchedule,
  type AppConfig,
  type Config,
  type Decision,
  type Observation,
} from "../../src/types";
import {
  executeWorkflow,
  initWorkflow,
  type WorkflowExecutionSummary,
} from "../../src/workflow";

function mockHttpResponse(
  statusCode: number,
  body: Uint8Array = new Uint8Array(),
  headers: Record<string, string> = {},
): HTTP_CLIENT_PB.Response {
  return {
    $typeName: "capabilities.networking.http.v1alpha.Response",
    statusCode,
    headers,
    body,
    multiHeaders: {},
  } as HTTP_CLIENT_PB.Response;
}

describe("Pramaan CRE Runtime & HTTP Slice", () => {
  const enc = new TextEncoder();

  const sampleApp: AppConfig = {
    app: "vaultlab",
    ensName: "vaultlab.pramaan.eth",
    resolver: "0x1111111111111111111111111111111111111111",
    resolverMode: "ensv2",
    timelock: "0x2222222222222222222222222222222222222222",
    upgradeTimelock: "0x3333333333333333333333333333333333333333",
    proxies: [{ label: "VaultProxy", address: "0x4444444444444444444444444444444444444444" }],
    manifestUrlTemplate: "https://manifests.pramaan.dev/{sha256}.json",
    logsFromBlock: 5000000,
  };

  const sampleConfig: Config = {
    schedule: "0 */5 * * * *",
    workflowName: "pramaan-monitor",
    chainSelectorName: "ethereum-testnet-sepolia",
    chainId: 11155111,
    blockTag: "latest",
    ingestUrl: "",
    limits: {
      evmCalls: 15,
      maxPendingOps: 3,
      maxLogWindows: 4,
      windowBlocks: 99,
    },
    apps: [sampleApp],
  };

  describe("Single App & Limits & Supported Safe Cron Subset", () => {
    it("accepts valid config with exactly one app", () => {
      const parsed = configSchema.parse(sampleConfig);
      expect(parsed.apps.length).toBe(1);
      expect(parsed.apps[0]?.app).toBe("vaultlab");
    });

    it("rejects config with empty apps array", () => {
      expect(() =>
        configSchema.parse({
          ...sampleConfig,
          apps: [],
        }),
      ).toThrow();
    });

    it("rejects config with more than one app", () => {
      const app2: AppConfig = {
        ...sampleApp,
        app: "mirroryield",
        ensName: "mirroryield.pramaan.eth",
      };
      expect(() =>
        configSchema.parse({
          ...sampleConfig,
          apps: [sampleApp, app2],
        }),
      ).toThrow();
    });

    it("enforces EVM call limit <= 15", () => {
      expect(() =>
        limitsSchema.parse({
          evmCalls: 16,
        }),
      ).toThrow();

      const validLimits = limitsSchema.parse({ evmCalls: 15 });
      expect(validLimits.evmCalls).toBe(15);
    });

    it("accepts documented safe supported cron subset (>= 30s interval)", () => {
      // 30-second interval forms
      expect(validateCronSchedule("*/30 * * * * *")).toBe(true);
      expect(validateCronSchedule("0,30 * * * * *")).toBe(true);
      expect(validateCronSchedule("30,0 * * * * *")).toBe(true);

      // Once-per-minute or multi-minute forms (fixed second 0-59)
      expect(validateCronSchedule("0 */5 * * * *")).toBe(true);
      expect(validateCronSchedule("0 * * * * *")).toBe(true);
      expect(validateCronSchedule("15 * * * * *")).toBe(true);
      expect(validateCronSchedule("0 0 * * * *")).toBe(true);
      expect(validateCronSchedule("0 0 1 1 * *")).toBe(true);
    });

    it("rejects rollover gap steps like */45 and */59", () => {
      // */45 creates a 15-second gap from second 45 to second 0
      expect(validateCronSchedule("*/45 * * * * *")).toBe(false);
      // */59 creates a 1-second gap from second 59 to second 0
      expect(validateCronSchedule("*/59 * * * * *")).toBe(false);
      // Sub-30s steps
      expect(validateCronSchedule("*/10 * * * * *")).toBe(false);
      expect(validateCronSchedule("*/15 * * * * *")).toBe(false);
      expect(validateCronSchedule("* * * * * *")).toBe(false);
    });

    it("rejects cron expressions with invalid fields or non-6 field counts", () => {
      // Non-6-field counts
      expect(validateCronSchedule("0 */5 * * *")).toBe(false); // 5 fields
      expect(validateCronSchedule("0 */5 * * * * *")).toBe(false); // 7 fields

      // Invalid field values
      expect(validateCronSchedule("0 60 * * * *")).toBe(false); // minute > 59
      expect(validateCronSchedule("0 */5 24 * * *")).toBe(false); // hour > 23
      expect(validateCronSchedule("0 */5 * 32 * *")).toBe(false); // dom > 31
      expect(validateCronSchedule("0 */5 * * 13 *")).toBe(false); // month > 12
      expect(validateCronSchedule("0 */5 * * * 8")).toBe(false); // dow > 7
      expect(validateCronSchedule("0 */5 * * * invalid")).toBe(false);
    });

    it("rejects config schema with invalid cron schedule", () => {
      expect(() =>
        configSchema.parse({
          ...sampleConfig,
          schedule: "*/45 * * * * *",
        }),
      ).toThrow();
    });
  });

  describe("resolveIngestUrl Base URL Semantics", () => {
    it("appends /v1/ingest/cre exactly once across all URL variants", () => {
      expect(resolveIngestUrl("https://api.pramaan.dev")).toBe(
        "https://api.pramaan.dev/v1/ingest/cre",
      );
      expect(resolveIngestUrl("https://api.pramaan.dev/")).toBe(
        "https://api.pramaan.dev/v1/ingest/cre",
      );
      expect(resolveIngestUrl("https://api.pramaan.dev///")).toBe(
        "https://api.pramaan.dev/v1/ingest/cre",
      );
      expect(resolveIngestUrl("https://api.pramaan.dev/v1/ingest/cre")).toBe(
        "https://api.pramaan.dev/v1/ingest/cre",
      );
      expect(resolveIngestUrl("https://api.pramaan.dev/v1/ingest/cre/")).toBe(
        "https://api.pramaan.dev/v1/ingest/cre",
      );
    });
  });

  describe("fetchManifestInNodeMode Quotas & Decider UNKNOWN", () => {
    const validDigest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const validManifestJson = JSON.stringify({
      schema: "https://pramaan.dev/schemas/manifest/v1",
      app: { ensName: "vaultlab.pramaan.eth" },
      tag: "v1.0.0",
      contracts: [
        {
          address: "0x4444444444444444444444444444444444444444",
          chainId: 11155111,
          label: "VaultProxy",
          proxy: { implAddress: "0x5555555555555555555555555555555555555555" },
        },
      ],
    });

    const createMockRuntime = (
      response: HTTP_CLIENT_PB.Response,
    ): { rt: Runtime<Config>; mockClient: HTTPClientCapability } => {
      const mockClient: HTTPClientCapability = {
        sendRequest: () => ({
          result: () => response,
        }),
      };

      const rt: any = {
        config: sampleConfig,
        runInNodeMode: (fn: any) => {
          return () => ({
            result: () => fn({ _isNodeRuntime: true }),
          });
        },
      };
      return { rt, mockClient };
    };

    it("successfully fetches manifest within 250KB and aggregates compact wire observation", () => {
      const bytes = enc.encode(validManifestJson);
      const { rt, mockClient } = createMockRuntime(mockHttpResponse(200, bytes));

      const obs = fetchManifestInNodeMode(rt, "https://manifests.pramaan.dev/valid.json", mockClient);
      expect(obs.status).toBe(200);
      expect(obs.facts).not.toBeNull();
      expect(obs.facts?.ensName).toBe("vaultlab.pramaan.eth");
      expect(obs.error).toBeNull();
    });

    it("returns status 404 on failed HTTP request and preserves UNKNOWN in decider", () => {
      const { rt, mockClient } = createMockRuntime(mockHttpResponse(404, new Uint8Array()));

      const obs = fetchManifestInNodeMode(rt, "https://manifests.pramaan.dev/missing.json", mockClient);
      expect(obs.status).toBe(404);
      expect(obs.facts).toBeNull();
      expect(obs.error).toBe("HTTP 404");

      const baseObs: Observation = {
        app: "vaultlab",
        ensName: "vaultlab.pramaan.eth",
        chainId: 11155111,
        now: 1710000000,
        headBlock: 5000000,
        record: `pramaan:v1:v1.0.0:${validDigest}`,
        revokedRaw: "",
        timelock: null,
        scheduledUpgrades: [],
        implementations: [],
        logsComplete: true,
        manifest: obs,
        gaps: [],
      };

      const decision = decide(baseObs);
      expect(decision.decision).toBe("UNKNOWN");
      expect(decision.findings.some((f) => f.decision === "UNKNOWN")).toBe(true);
    });

    it("rejects oversized manifest exceeding 250KB response cap", () => {
      const oversizedBytes = new Uint8Array(MAX_MANIFEST_RESPONSE_BYTES + 10);
      const { rt, mockClient } = createMockRuntime(mockHttpResponse(200, oversizedBytes));

      const obs = fetchManifestInNodeMode(rt, "https://manifests.pramaan.dev/oversized.json", mockClient);
      expect(obs.status).toBe(200);
      expect(obs.facts).toBeNull();
      expect(obs.error).toContain("exceeds 250KB cap");
    });

    it("bounds full consensus wire observation under 20KB", () => {
      // Manifest within 250KB but whose full observation wire JSON exceeds 20KB
      const bigContracts = Array.from({ length: 400 }, (_, i) => ({
        address: "0x4444444444444444444444444444444444444444",
        chainId: 11155111,
        label: `BigContractLabel_${i}_long_identifier_padding_string`,
        proxy: { implAddress: "0x5555555555555555555555555555555555555555" },
      }));

      const bigManifest = JSON.stringify({
        schema: "https://pramaan.dev/schemas/manifest/v1",
        app: { ensName: "vaultlab.pramaan.eth" },
        tag: "v1.0.0",
        contracts: bigContracts,
      });

      const bytes = enc.encode(bigManifest);
      expect(bytes.length).toBeLessThan(MAX_MANIFEST_RESPONSE_BYTES); // below 250KB
      expect(bytes.length).toBeGreaterThan(MAX_CONSENSUS_WIRE_BYTES); // above 20KB

      const { rt, mockClient } = createMockRuntime(mockHttpResponse(200, bytes));
      const obs = fetchManifestInNodeMode(rt, "https://manifests.pramaan.dev/bigwire.json", mockClient);
      expect(obs.status).toBe(200);
      expect(obs.facts).toBeNull();
      expect(obs.error).toContain("exceeds 20KB limit");
    });

    it("catches network exception and returns stable generic error without leaking details", () => {
      const mockClient: HTTPClientCapability = {
        sendRequest: () => {
          throw new Error("DNS resolution failed with sensitive_header=SECRET_VALUE_123");
        },
      };

      const rt: any = {
        config: sampleConfig,
        runInNodeMode: (fn: any) => {
          return () => ({
            result: () => fn({ _isNodeRuntime: true }),
          });
        },
      };

      const obs = fetchManifestInNodeMode(rt, "https://manifests.pramaan.dev/broken.json", mockClient);
      expect(obs.status).toBe(0);
      expect(obs.facts).toBeNull();
      expect(obs.error).toBe("HTTP manifest request failed");
      expect(obs.error).not.toContain("SECRET_VALUE_123");
    });
  });

  describe("deliverIngestInNodeMode & Secrets Security & Clock Handling", () => {
    const mockDecisionNonOk: Decision = {
      decision: "PENDING_RELEASE_CHANGE",
      severity: "medium",
      subject: "op:1",
      summary: "Release pointer queued",
      details: {
        chainTime: 1710000000,
        chainTimeIso: "2024-03-09T18:40:00.000Z",
      },
      findings: [],
    };

    const mockDecisionOk: Decision = {
      decision: "OK",
      severity: "info",
      subject: "ok",
      summary: "All checks passed",
      details: {},
      findings: [],
    };

    it("no-secret-log-only: does NOT retrieve secret when ingestUrl is empty", () => {
      let secretCalls = 0;
      const fakeRuntime: any = {
        config: { ...sampleConfig, ingestUrl: "" },
        getSecret: () => {
          secretCalls++;
          return { result: () => ({ value: "secret" }) };
        },
      };

      const res = deliverIngestInNodeMode(fakeRuntime, {
        config: fakeRuntime.config,
        app: sampleApp,
        decision: mockDecisionNonOk,
      });

      expect(secretCalls).toBe(0);
      expect(res.attempted).toBe(false);
      expect(res.reason).toBe("log-only mode (ingestUrl empty)");
    });

    it("no-secret-log-only: does NOT retrieve secret when decision is OK", () => {
      let secretCalls = 0;
      const fakeRuntime: any = {
        config: { ...sampleConfig, ingestUrl: "https://api.pramaan.dev" },
        getSecret: () => {
          secretCalls++;
          return { result: () => ({ value: "secret" }) };
        },
      };

      const res = deliverIngestInNodeMode(fakeRuntime, {
        config: fakeRuntime.config,
        app: sampleApp,
        decision: mockDecisionOk,
      });

      expect(secretCalls).toBe(0);
      expect(res.attempted).toBe(false);
      expect(res.reason).toBe("decision is OK");
    });

    it("observedAt ALWAYS uses deterministic DON runtime.now regardless of shifted chain clock", () => {
      const donTime = new Date("2026-11-05T08:00:00.000Z");
      let capturedRequest: any = null;

      const mockClient: HTTPClientCapability = {
        sendRequest: (_rt: any, input: any) => {
          capturedRequest = input;
          return {
            result: () => mockHttpResponse(200),
          };
        },
      };

      const fakeRuntime: any = {
        config: { ...sampleConfig, ingestUrl: "https://api.pramaan.dev" },
        now: () => donTime,
        getSecret: (req: any) => {
          expect(req.id).toBe(INGEST_SECRET_ID);
          return { result: () => ({ value: "test-shared-secret" }) };
        },
        runInNodeMode: (fn: any) => {
          return () => ({
            result: () => fn({ _isNodeRuntime: true }),
          });
        },
      };

      // Decision with head block timestamp shifted 2 hours in the past
      const shiftedDecision: Decision = {
        ...mockDecisionNonOk,
        details: {
          chainTime: 1710000000 - 7200,
          chainTimeIso: "2024-03-09T16:40:00.000Z",
        },
      };

      const res = deliverIngestInNodeMode(
        fakeRuntime,
        {
          config: fakeRuntime.config,
          app: sampleApp,
          decision: shiftedDecision,
        },
        mockClient,
      );

      expect(res.attempted).toBe(true);
      expect(res.ok).toBe(true);

      // Verify transmitted payload body contains DON runtime.now() timestamp
      expect(capturedRequest).not.toBeNull();
      const bodyBytes = Buffer.from(capturedRequest.body, "base64");
      const parsedPayload = JSON.parse(new TextDecoder().decode(bodyBytes));
      expect(parsedPayload.observedAt).toBe(donTime.toISOString());
      // Chain time remains separately available in details for ETA arithmetic
      expect(parsedPayload.details.chainTime).toBe(1710000000 - 7200);
    });

    it("error redaction: injected getSecret error does NOT leak synthetic secret in result", () => {
      const fakeRuntime: any = {
        config: { ...sampleConfig, ingestUrl: "https://api.pramaan.dev" },
        getSecret: () => {
          throw new Error("Secret error with sensitive_key=MY_SYNTHETIC_SECRET_999 and HMAC=SIG_XYZ");
        },
      };

      const res = deliverIngestInNodeMode(fakeRuntime, {
        config: fakeRuntime.config,
        app: sampleApp,
        decision: mockDecisionNonOk,
      });

      expect(res.attempted).toBe(true);
      expect(res.ok).toBe(false);
      expect(res.error).toBe("failed to retrieve ingest secret");
      expect(res.error).not.toContain("MY_SYNTHETIC_SECRET_999");
      expect(res.error).not.toContain("SIG_XYZ");
    });

    it("error redaction: injected transport error does NOT leak synthetic signature in result", () => {
      const mockClient: HTTPClientCapability = {
        sendRequest: () => {
          throw new Error("Transport socket reset with auth header sha256=SYNTHETIC_HMAC_SIG_888");
        },
      };

      const fakeRuntime: any = {
        config: { ...sampleConfig, ingestUrl: "https://api.pramaan.dev" },
        now: () => new Date("2026-11-05T00:00:00.000Z"),
        getSecret: () => ({ result: () => ({ value: "test-secret" }) }),
        runInNodeMode: (fn: any) => () => ({ result: () => fn({ _isNodeRuntime: true }) }),
      };

      const res = deliverIngestInNodeMode(
        fakeRuntime,
        {
          config: fakeRuntime.config,
          app: sampleApp,
          decision: mockDecisionNonOk,
        },
        mockClient,
      );

      expect(res.attempted).toBe(true);
      expect(res.ok).toBe(false);
      expect(res.error).toBe("HTTP ingest delivery request failed");
      expect(res.error).not.toContain("SYNTHETIC_HMAC_SIG_888");
    });

    it("honestly exposes HTTP failure status without leaking secrets", () => {
      const mockClient: HTTPClientCapability = {
        sendRequest: () => ({
          result: () => mockHttpResponse(500),
        }),
      };

      const fakeRuntime: any = {
        config: { ...sampleConfig, ingestUrl: "https://api.pramaan.dev" },
        now: () => new Date("2026-11-05T00:00:00.000Z"),
        getSecret: () => ({ result: () => ({ value: "super-secret-hmac-key" }) }),
        runInNodeMode: (fn: any) => () => ({ result: () => fn({ _isNodeRuntime: true }) }),
      };

      const res = deliverIngestInNodeMode(
        fakeRuntime,
        {
          config: fakeRuntime.config,
          app: sampleApp,
          decision: mockDecisionNonOk,
        },
        mockClient,
      );

      expect(res.attempted).toBe(true);
      expect(res.ok).toBe(false);
      expect(res.status).toBe(500);
      expect(res.error).toBe("HTTP 500");
      expect(res.error).not.toContain("super-secret-hmac-key");
    });
  });

  describe("Real SDK HTTPClient Protobuf Marshalling Test", () => {
    it("real HTTPClient sends request where SDK fromJson decodes headers, body, and timeout into protobuf Request", () => {
      let capturedCapabilityParams: any = null;

      const fakeNodeRuntime: NodeRuntime<unknown> = {
        callCapability: (params: any) => {
          capturedCapabilityParams = params;
          return {
            result: () => mockHttpResponse(200),
          };
        },
      } as any;

      const testBodyBytes = enc.encode(JSON.stringify({ test: "payload-bytes", number: 42 }));
      const base64Body = Buffer.from(testBodyBytes).toString("base64");

      const realHttpClient = new HTTPClient();
      const sendRes = realHttpClient.sendRequest(fakeNodeRuntime, {
        url: "https://api.pramaan.dev/v1/ingest/cre",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-pramaan-signature": "sha256=1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        },
        body: base64Body,
        timeout: "10s",
      });

      const response = sendRes.result();
      expect(response.statusCode).toBe(200);

      // Verify real SDK capability parameters
      expect(capturedCapabilityParams).not.toBeNull();
      expect(capturedCapabilityParams.capabilityId).toBe(HTTPClient.CAPABILITY_ID);
      expect(capturedCapabilityParams.method).toBe("SendRequest");

      const payload = capturedCapabilityParams.payload;
      expect(payload.$typeName).toBe("capabilities.networking.http.v1alpha.Request");
      expect(payload.url).toBe("https://api.pramaan.dev/v1/ingest/cre");
      expect(payload.method).toBe("POST");

      // Verify headers
      expect(payload.headers["content-type"]).toBe("application/json");
      expect(payload.headers["x-pramaan-signature"]).toBe(
        "sha256=1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      );

      // Verify body was deserialized from base64 into exact Uint8Array bytes
      expect(payload.body).toEqual(testBodyBytes);

      // Verify timeout was deserialized from string "10s" into protobuf Duration
      expect(payload.timeout).toBeDefined();
      expect(payload.timeout.seconds).toBe(10n);
      expect(payload.timeout.nanos).toBe(0);
    });
  });

  describe("main.ts Workflow Handlers & Leak Prevention", () => {
    it("initWorkflow returns a valid workflow with cron trigger", () => {
      const handlers = initWorkflow(sampleConfig);
      expect(handlers.length).toBe(1);
      expect(handlers[0]?.trigger.capabilityId()).toBe("cron-trigger@1.0.0");
    });

    it("executeWorkflow executes cleanly with mock capabilities and produces expected summary", async () => {
      let loggedMessages: string[] = [];

      const fakeRuntime: any = {
        config: sampleConfig,
        now: () => new Date("2026-11-05T00:00:00.000Z"),
        log: (msg: string) => loggedMessages.push(msg),
        callCapability: (params: any) => {
          if (params.method === "HeaderByNumber") {
            return {
              result: () => ({
                $typeName: "capabilities.blockchain.evm.v1alpha.HeaderByNumberReply",
                header: {
                  $typeName: "capabilities.blockchain.evm.v1alpha.Header",
                  blockNumber: { $typeName: "values.v1.BigInt", sign: 1n, absVal: new Uint8Array([1]) },
                  timestamp: 1710000000n,
                },
              }),
            };
          }
          if (params.method === "CallContract") {
            return {
              result: () => ({
                $typeName: "capabilities.blockchain.evm.v1alpha.CallContractReply",
                data: new Uint8Array(),
              }),
            };
          }
          if (params.method === "FilterLogs") {
            return {
              result: () => ({
                $typeName: "capabilities.blockchain.evm.v1alpha.FilterLogsReply",
                logs: [],
              }),
            };
          }
          throw new Error(`Unhandled capability: ${params.method}`);
        },
        runInNodeMode: (fn: any) => () => ({
          result: () => fn({ _isNodeRuntime: true }),
        }),
      };

      const summary = await executeWorkflow(fakeRuntime);
      expect(summary.app).toBe("vaultlab");
      expect(summary.decision).toBe("UNKNOWN");
      expect(summary.headBlock).toBeGreaterThan(0);
      expect(summary.chainTime).toBe(1710000000);
      expect(summary.ingestDelivery.attempted).toBe(false);
      expect(loggedMessages.length).toBeGreaterThan(0);
      expect(loggedMessages[0]).toContain("[Pramaan Monitor] App: vaultlab");
    });

    it("executeWorkflow logs do NOT leak synthetic secrets or signatures on delivery failure", async () => {
      let loggedMessages: string[] = [];

      const fakeRuntime: any = {
        config: { ...sampleConfig, ingestUrl: "https://api.pramaan.dev" },
        now: () => new Date("2026-11-05T00:00:00.000Z"),
        log: (msg: string) => loggedMessages.push(msg),
        getSecret: () => {
          throw new Error("Secret fail with SYNTHETIC_LEAK_SECRET_777");
        },
        callCapability: (params: any) => {
          if (params.method === "HeaderByNumber") {
            return {
              result: () => ({
                $typeName: "capabilities.blockchain.evm.v1alpha.HeaderByNumberReply",
                header: {
                  $typeName: "capabilities.blockchain.evm.v1alpha.Header",
                  blockNumber: { $typeName: "values.v1.BigInt", sign: 1n, absVal: new Uint8Array([1]) },
                  timestamp: 1710000000n,
                },
              }),
            };
          }
          if (params.method === "CallContract") {
            return {
              result: () => ({
                $typeName: "capabilities.blockchain.evm.v1alpha.CallContractReply",
                data: new Uint8Array(),
              }),
            };
          }
          if (params.method === "FilterLogs") {
            return {
              result: () => ({
                $typeName: "capabilities.blockchain.evm.v1alpha.FilterLogsReply",
                logs: [],
              }),
            };
          }
          throw new Error(`Unhandled capability: ${params.method}`);
        },
        runInNodeMode: (fn: any) => () => ({
          result: () => fn({ _isNodeRuntime: true }),
        }),
      };

      const summary = await executeWorkflow(fakeRuntime);
      expect(summary.ingestDelivery.attempted).toBe(true);
      expect(summary.ingestDelivery.ok).toBe(false);
      expect(summary.ingestDelivery.reason).toBe("failed to retrieve ingest secret");

      // Verify no message logged contains the synthetic secret
      for (const msg of loggedMessages) {
        expect(msg).not.toContain("SYNTHETIC_LEAK_SECRET_777");
      }
    });

    it("passes successful-ingest handler summary through actual SDK Value.from with no any-cast", () => {
      const successfulSummary: WorkflowExecutionSummary = {
        app: "vaultlab",
        decision: "PENDING_RELEASE_CHANGE",
        severity: "medium",
        subject: "op:1",
        summary: "Release pointer queued",
        headBlock: 5000000,
        chainTime: 1710000000,
        ingestDelivery: {
          attempted: true,
          ok: true,
          status: 200,
          reason: "delivered",
        },
      };

      // Value.from enforces CreSerializable and rejects null/undefined
      const protoVal = Value.from(successfulSummary);
      expect(protoVal).toBeDefined();
    });

    it("executeWorkflow with successful delivery produces summary accepted by SDK Value.from", async () => {
      const fakeRuntime: any = {
        config: { ...sampleConfig, ingestUrl: "https://api.pramaan.dev" },
        now: () => new Date("2026-11-05T00:00:00.000Z"),
        log: () => {},
        getSecret: () => ({ result: () => ({ value: "test-secret" }) }),
        callCapability: (params: any) => {
          if (params.method === "HeaderByNumber") {
            return {
              result: () => ({
                $typeName: "capabilities.blockchain.evm.v1alpha.HeaderByNumberReply",
                header: {
                  $typeName: "capabilities.blockchain.evm.v1alpha.Header",
                  blockNumber: { $typeName: "values.v1.BigInt", sign: 1n, absVal: new Uint8Array([1]) },
                  timestamp: 1710000000n,
                },
              }),
            };
          }
          if (params.method === "CallContract") {
            return {
              result: () => ({
                $typeName: "capabilities.blockchain.evm.v1alpha.CallContractReply",
                data: new Uint8Array(),
              }),
            };
          }
          if (params.method === "FilterLogs") {
            return {
              result: () => ({
                $typeName: "capabilities.blockchain.evm.v1alpha.FilterLogsReply",
                logs: [],
              }),
            };
          }
          throw new Error(`Unhandled capability: ${params.method}`);
        },
        runInNodeMode: (fn: any) => () => ({
          result: () => {
            // Simulate successful node-mode deliver returning status 200
            return JSON.stringify({ status: 200, error: "" });
          },
        }),
      };

      const summary = await executeWorkflow(fakeRuntime);
      expect(summary.ingestDelivery.attempted).toBe(true);
      expect(summary.ingestDelivery.ok).toBe(true);
      expect(summary.ingestDelivery.reason).toBe("delivered");

      // Verify actual SDK Value.from accepts the returned summary directly with no casts
      const protoVal = Value.from(summary);
      expect(protoVal).toBeDefined();
    });

    it("executeWorkflow throws if apps array is missing or empty", async () => {
      const fakeRuntime: any = {
        config: { ...sampleConfig, apps: [] },
        log: () => {},
      };

      await expect(executeWorkflow(fakeRuntime)).rejects.toThrow(
        "Workflow execution configuration must contain exactly one app",
      );
    });
  });
});

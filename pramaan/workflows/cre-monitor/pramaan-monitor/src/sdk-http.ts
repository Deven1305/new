import {
  bytesToBase64,
  consensusIdenticalAggregation,
  HTTPClient,
  type NodeRuntime,
  type Runtime,
  type TeeRuntime,
} from "@chainlink/cre-sdk";
import type { HTTP_CLIENT_PB } from "@chainlink/cre-sdk/pb";
import { inspectManifestBytes } from "./manifest";
import {
  buildIngestPayload,
  SIGNATURE_HEADER,
  signedRequest,
} from "./sign";
import type {
  AppConfig,
  Config,
  Decision,
  ManifestObservation,
} from "./types";

/**
 * CRE Production Quota: HTTP response body cap = 250 KB (256,000 bytes).
 */
export const MAX_MANIFEST_RESPONSE_BYTES = 250 * 1024;

/**
 * CRE Consensus Limit: Consensus payload limit = 25 KB; full manifest observation
 * wire JSON aggregated across DON nodes must remain comfortably under 20 KB (20,480 bytes).
 */
export const MAX_CONSENSUS_WIRE_BYTES = 20 * 1024;

/**
 * Bound on the serialized ingest payload to ensure requests remain bounded and safe.
 */
export const MAX_INGEST_PAYLOAD_BYTES = 20 * 1024;

export const MANIFEST_REQUEST_TIMEOUT_SECONDS = 10;
export const INGEST_REQUEST_TIMEOUT_SECONDS = 10;
export const INGEST_SECRET_ID = "CRE_INGEST_SECRET";
export const INGEST_PATH = "/v1/ingest/cre";

/**
 * Narrowed HTTP capability interface for node-mode sendRequest execution.
 * Structurally matches real SDK HTTPClient node-mode method without requiring the unused DON overload.
 */
export interface HTTPClientCapability {
  sendRequest(
    runtime: NodeRuntime<unknown> | TeeRuntime<unknown>,
    input: HTTP_CLIENT_PB.Request | HTTP_CLIENT_PB.RequestJson,
  ): {
    result: () => HTTP_CLIENT_PB.Response;
  };
}

/**
 * Normalizes and appends /v1/ingest/cre exactly once to the configured ingest base URL.
 * Handles trailing slashes, clean base URLs, and paths where /v1/ingest/cre is already provided.
 */
export function resolveIngestUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith(INGEST_PATH)) {
    return trimmed;
  }
  return `${trimmed}${INGEST_PATH}`;
}

/**
 * Fetches release manifest bytes inside CRE Node mode and aggregates only compact facts.
 *
 * Requirements enforced:
 * - Operates in node mode; each node fetches the manifest bytes independently.
 * - HTTP response body is bounded to 250 KB (MAX_MANIFEST_RESPONSE_BYTES).
 * - Exact received bytes are hashed (SHA-256) and inspected for compact ManifestFacts.
 * - Returns a bounded serialized JSON string across the consensus boundary via
 *   consensusIdenticalAggregation<string>(). The string primitive type ensures CreSerializable
 *   compatibility (since CreSerializable excludes null, which ManifestObservation fields contain).
 * - Full consensus wire JSON is bounded under 20 KB (MAX_CONSENSUS_WIRE_BYTES). Raw manifest
 *   and asset bytes are NEVER returned or aggregated into DON consensus.
 * - Oversized wire observations return facts=null with an explicit error, preserving UNKNOWN in decider.
 * - Transport/network errors expose stable generic messages without echoing raw exception messages
 *   that could leak sensitive transport or header information.
 */
export function fetchManifestInNodeMode(
  runtime: Runtime<unknown>,
  url: string,
  httpClient?: HTTPClientCapability,
): ManifestObservation {
  const client = httpClient ?? new HTTPClient();

  const nodeModeFetch = (nodeRuntime: NodeRuntime<unknown>): string => {
    try {
      const response = client
        .sendRequest(nodeRuntime, {
          url,
          method: "GET",
          timeout: `${MANIFEST_REQUEST_TIMEOUT_SECONDS}s`,
          cacheSettings: { store: true, maxAge: "30s" },
        })
        .result();

      if (response.statusCode !== 200) {
        return JSON.stringify({
          status: response.statusCode,
          sha256: "",
          size: response.body ? response.body.length : 0,
          facts: null,
          error: `HTTP ${response.statusCode}`,
        });
      }

      const body = response.body ?? new Uint8Array();
      if (body.length > MAX_MANIFEST_RESPONSE_BYTES) {
        return JSON.stringify({
          status: response.statusCode,
          sha256: "",
          size: body.length,
          facts: null,
          error: `manifest body size ${body.length} exceeds 250KB cap`,
        });
      }

      const observation = inspectManifestBytes(response.statusCode, body);
      const wireJson = JSON.stringify(observation);
      const wireByteLength = new TextEncoder().encode(wireJson).length;

      if (wireByteLength > MAX_CONSENSUS_WIRE_BYTES) {
        return JSON.stringify({
          status: response.statusCode,
          sha256: observation.sha256,
          size: observation.size,
          facts: null,
          error: `manifest consensus wire size ${wireByteLength} exceeds 20KB limit`,
        });
      }

      return wireJson;
    } catch {
      // Expose stable generic transport error, never arbitrary exception messages
      return JSON.stringify({
        status: 0,
        sha256: "",
        size: 0,
        facts: null,
        error: "HTTP manifest request failed",
      });
    }
  };

  try {
    const runFetch = runtime.runInNodeMode(
      nodeModeFetch,
      consensusIdenticalAggregation<string>(),
    );
    const wireJson = runFetch().result();
    return JSON.parse(wireJson) as ManifestObservation;
  } catch {
    return {
      status: 0,
      sha256: "",
      size: 0,
      facts: null,
      error: "manifest fetch consensus failed",
    };
  }
}

export interface DeliverIngestArgs {
  config: Config;
  app: AppConfig;
  decision: Decision;
}

export interface IngestDeliveryResult {
  attempted: boolean;
  ok: boolean;
  status: number;
  error?: string;
  reason?: string;
}

/**
 * Optionally reports non-OK decisions to the Pramaan server via signed HTTP POST.
 *
 * Architecture and security properties:
 * - In log-only mode (ingestUrl is empty) or when decision is OK, this returns immediately
 *   without calling runtime.getSecret.
 * - In non-OK ingest mode, retrieves the logical secret CRE_INGEST_SECRET from runtime.getSecret.
 * - Transport/getSecret errors NEVER echo raw error.message; stable generic messages are returned
 *   to guarantee synthetic or real secrets/signatures are never leaked in results or logs.
 * - Payload timestamps use deterministic DON runtime.now() ALWAYS (finalized blocks can be >10min old
 *   and local forks future-dated, while ingest server rejects stale/future observedAt).
 *   Agreed chain time is kept separately in decision details for ETA arithmetic.
 * - Exact serialized bytes generated by signedRequest are what get signed and transmitted.
 * - Payload size is strictly bounded to MAX_INGEST_PAYLOAD_BYTES before delivery.
 * - Delivery executes through the HTTP capability in node mode and exposes honest status codes.
 * - Node mode consensus uses consensusIdenticalAggregation<string>() for non-null serializability.
 * - Note on Trust & Idempotency: HMAC-SHA256 authentication is a shared-secret transport authentication
 *   mechanism between the workflow and the ingest server; it is NOT a cryptographic DON consensus proof.
 *   HTTP caching on nodes is best-effort optimization only; database-level deduplication via
 *   idempotencyKey is authoritative on the server.
 */
export function deliverIngestInNodeMode(
  runtime: Runtime<unknown>,
  args: DeliverIngestArgs,
  httpClient?: HTTPClientCapability,
): IngestDeliveryResult {
  const { config, app, decision } = args;

  // Log-only mode check: empty ingestUrl never retrieves secrets or attempts network POST.
  if (!config.ingestUrl || config.ingestUrl.trim() === "") {
    return {
      attempted: false,
      ok: false,
      status: 0,
      reason: "log-only mode (ingestUrl empty)",
    };
  }

  // Decision OK check: healthy states are not reported to ingest.
  if (decision.decision === "OK") {
    return {
      attempted: false,
      ok: false,
      status: 0,
      reason: "decision is OK",
    };
  }

  // Retrieve shared ingest secret from runtime using logical secret ID.
  let secret: string;
  try {
    const secretRes = runtime.getSecret({ id: INGEST_SECRET_ID }).result();
    secret = secretRes.value;
    if (!secret) {
      return {
        attempted: true,
        ok: false,
        status: 0,
        error: "ingest secret is empty",
      };
    }
  } catch {
    // Expose stable generic error, never raw exception message
    return {
      attempted: true,
      ok: false,
      status: 0,
      error: "failed to retrieve ingest secret",
    };
  }

  // Deterministic timestamp: ALWAYS use DON runtime.now() for server ingest freshness.
  const observedAt = runtime.now();

  const payload = buildIngestPayload({
    workflow: config.workflowName,
    observedAt,
    chainId: config.chainId,
    app: app.app,
    ensName: app.ensName,
    decision,
  });

  // Byte-for-byte serialization and signing.
  const { body, signature } = signedRequest(secret, payload);
  const bodyBytes = new TextEncoder().encode(body);

  if (bodyBytes.length > MAX_INGEST_PAYLOAD_BYTES) {
    return {
      attempted: true,
      ok: false,
      status: 0,
      error: `ingest payload size ${bodyBytes.length} exceeds ${MAX_INGEST_PAYLOAD_BYTES} bytes cap`,
    };
  }

  const targetUrl = resolveIngestUrl(config.ingestUrl);
  const client = httpClient ?? new HTTPClient();

  const nodeModeDeliver = (nodeRuntime: NodeRuntime<unknown>): string => {
    try {
      const response = client
        .sendRequest(nodeRuntime, {
          url: targetUrl,
          method: "POST",
          headers: {
            "content-type": "application/json",
            [SIGNATURE_HEADER]: signature,
          },
          body: bytesToBase64(bodyBytes),
          timeout: `${INGEST_REQUEST_TIMEOUT_SECONDS}s`,
        })
        .result();

      const isSuccess = response.statusCode >= 200 && response.statusCode < 300;
      return JSON.stringify({
        status: response.statusCode,
        error: isSuccess ? "" : `HTTP ${response.statusCode}`,
      });
    } catch {
      // Expose stable generic error, never raw exception message
      return JSON.stringify({
        status: 0,
        error: "HTTP ingest delivery request failed",
      });
    }
  };

  try {
    const runDeliver = runtime.runInNodeMode(
      nodeModeDeliver,
      consensusIdenticalAggregation<string>(),
    );
    const wire = JSON.parse(runDeliver().result()) as { status: number; error: string };
    const ok = wire.error === "" && wire.status >= 200 && wire.status < 300;
    return {
      attempted: true,
      ok,
      status: wire.status,
      error: wire.error === "" ? undefined : wire.error,
    };
  } catch {
    return {
      attempted: true,
      ok: false,
      status: 0,
      error: "ingest delivery consensus failed",
    };
  }
}

import { hmacSha256Hex, sha256Hex } from "./hash";
import type { Decision, DecisionKind, Severity } from "./types";

export const INGEST_PATH = "/v1/ingest/cre";
export const SIGNATURE_HEADER = "x-pramaan-signature";

export interface IngestPayload {
  workflow: string;
  runId: string;
  observedAt: string;
  chainId: number;
  app: string;
  ensName: string;
  decision: DecisionKind;
  severity: Severity;
  details: Record<string, unknown>;
  idempotencyKey: string;
}

/** hash(app, decision, subject): the same fact re-reported on every cron tick maps to ONE server-side alert. */
export function idempotencyKey(app: string, decision: string, subject: string): string {
  return sha256Hex(`${app}\n${decision}\n${subject}`);
}

/** Deterministic across DON nodes (derived from the consensus time), unique per app and tick. */
export function runIdFor(app: string, observedAtIso: string): string {
  return sha256Hex(`pramaan-monitor\n${app}\n${observedAtIso}`).slice(0, 24);
}

export function buildIngestPayload(args: {
  workflow: string;
  observedAt: Date;
  chainId: number;
  app: string;
  ensName: string;
  decision: Decision;
}): IngestPayload {
  const observedAt = args.observedAt.toISOString();
  const d = args.decision;
  return {
    workflow: args.workflow,
    runId: runIdFor(args.app, observedAt),
    observedAt,
    chainId: args.chainId,
    app: args.app,
    ensName: args.ensName,
    decision: d.decision,
    severity: d.severity,
    details: { summary: d.summary, subject: d.subject, ...d.details, findings: d.findings },
    idempotencyKey: idempotencyKey(args.app, d.decision, d.subject),
  };
}

/** `sha256=<hex HMAC-SHA256(secret, raw body)>`, the scheme of docs/API_CONTRACT.md POST /v1/ingest/cre. */
export function signBody(secret: string, rawBody: string): string {
  return `sha256=${hmacSha256Hex(secret, rawBody)}`;
}

/** Serializes ONCE: the string that is signed is byte-for-byte the string that is sent. */
export function signedRequest(secret: string, payload: IngestPayload): { body: string; signature: string } {
  const body = JSON.stringify(payload);
  return { body, signature: signBody(secret, body) };
}

import {
  CronCapability,
  handler,
  type Runtime,
  type Workflow,
} from "@chainlink/cre-sdk";
import { decide } from "./decide";
import { collectObservation } from "./reads";
import { createEvmClient, SdkChainPort } from "./sdk-chain";
import { deliverIngestInNodeMode, fetchManifestInNodeMode } from "./sdk-http";
import type { Config } from "./types";

/**
 * Summary result returned by the workflow execution handler.
 * All fields are required non-null primitives so SDK Value.from can serialize without error.
 */
export interface WorkflowExecutionSummary {
  app: string;
  decision: string;
  severity: string;
  subject: string;
  summary: string;
  headBlock: number;
  chainTime: number;
  ingestDelivery: {
    attempted: boolean;
    ok: boolean;
    status: number;
    reason: string;
  };
}

/**
 * Executes a single Pramaan monitoring workflow tick in DON mode.
 * Enforces single-app budget limits, pins chain header block, fetches manifest in node mode,
 * evaluates decisions deterministically, and optionally reports non-OK decisions to ingest.
 */
export async function executeWorkflow(
  runtime: Runtime<Config>,
): Promise<WorkflowExecutionSummary> {
  const config = runtime.config;

  // Enforce exactly one app per workflow execution budget
  if (!config.apps || config.apps.length !== 1) {
    throw new Error(
      `Workflow execution configuration must contain exactly one app, got ${config.apps?.length ?? 0}`,
    );
  }
  const app = config.apps[0]!;

  // DON mode EVM client with block pinning via SdkChainPort
  const evmClient = createEvmClient(config.chainSelectorName);
  const port = new SdkChainPort({
    client: evmClient,
    runtime,
    blockTag: config.blockTag,
  });

  // Manifest fetcher runs in node mode and aggregates compact facts under 20KB
  const fetchManifest = (url: string) => fetchManifestInNodeMode(runtime, url);

  // Collect observation within the 15-read EVM budget
  const observation = collectObservation(config, app, port, fetchManifest);

  // Pure deterministic decision engine
  const decision = decide(observation);

  runtime.log(
    `[Pramaan Monitor] App: ${app.app} | Decision: ${decision.decision} (${decision.severity}) | ${decision.summary}`,
  );

  let deliverySummary: WorkflowExecutionSummary["ingestDelivery"] = {
    attempted: false,
    ok: false,
    status: 0,
    reason: "not attempted",
  };

  // Optional non-OK ingest delivery
  if (decision.decision !== "OK" && config.ingestUrl && config.ingestUrl.trim() !== "") {
    const ingestResult = deliverIngestInNodeMode(runtime, {
      config,
      app,
      decision,
    });

    deliverySummary = {
      attempted: ingestResult.attempted,
      ok: ingestResult.ok,
      status: ingestResult.status,
      // Provide stable non-null reason for SDK Value.from serialization
      reason: ingestResult.ok
        ? "delivered"
        : (ingestResult.error ?? ingestResult.reason ?? "delivery failed"),
    };

    if (ingestResult.ok) {
      runtime.log(
        `[Pramaan Monitor] Ingest delivery succeeded (HTTP ${ingestResult.status})`,
      );
    } else {
      runtime.log(
        `[Pramaan Monitor] Ingest delivery failed (HTTP ${ingestResult.status}): ${deliverySummary.reason}`,
      );
    }
  } else if (decision.decision === "OK") {
    deliverySummary = {
      attempted: false,
      ok: false,
      status: 0,
      reason: "decision is OK",
    };
  } else {
    deliverySummary = {
      attempted: false,
      ok: false,
      status: 0,
      reason: "log-only mode (ingestUrl empty)",
    };
  }

  return {
    app: app.app,
    decision: decision.decision,
    severity: decision.severity,
    subject: decision.subject,
    summary: decision.summary,
    headBlock: observation.headBlock,
    chainTime: observation.now,
    ingestDelivery: deliverySummary,
  };
}

/**
 * Initializes workflow handlers for CRE runtime.
 */
export function initWorkflow(config: Config): Workflow<Config> {
  const cron = new CronCapability();
  return [
    handler(
      cron.trigger({ schedule: config.schedule }),
      async (runtime: Runtime<Config>) => {
        return await executeWorkflow(runtime);
      },
    ),
  ];
}

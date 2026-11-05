import { Runner } from "@chainlink/cre-sdk";
import type { z } from "zod";
import { configSchema, type Config } from "./src/types";
import { initWorkflow } from "./src/workflow";

/**
 * Main entrypoint exported for CRE SDK compilation and runtime execution.
 * Must be a zero-argument function as required by Javy / CRE CLI compiler.
 * Testable helpers (executeWorkflow, initWorkflow) reside in src/workflow.ts.
 */
export async function main(): Promise<void> {
  const runner = await Runner.newRunner<Config, z.input<typeof configSchema>>({
    configSchema,
  });
  await runner.run(initWorkflow);
}

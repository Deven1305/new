import type { ForgeTestResult, SuiteSummary } from "./types.js";

interface ForgeTestJson {
  status?: string;
  reason?: string | null;
  decoded_logs?: string[];
  duration?: { secs?: number; nanos?: number } | string | number;
}

function durationMs(d: ForgeTestJson["duration"]): number | null {
  if (d && typeof d === "object" && typeof d.secs === "number") return d.secs * 1000 + Math.round((d.nanos ?? 0) / 1e6);
  if (typeof d === "number") return d;
  return null;
}

/** Flattens `forge test --json` output: { "<file>:<Contract>": { test_results: { "<test>()": {...} } } }. */
export function parseForgeJson(json: unknown): ForgeTestResult[] {
  if (!json || typeof json !== "object") return [];
  const out: ForgeTestResult[] = [];
  for (const [suite, value] of Object.entries(json as Record<string, unknown>)) {
    const results = (value as { test_results?: Record<string, ForgeTestJson> })?.test_results;
    if (!results || typeof results !== "object") continue;
    const [file, contract] = suite.includes(":") ? [suite.slice(0, suite.lastIndexOf(":")), suite.slice(suite.lastIndexOf(":") + 1)] : [suite, suite];
    for (const [test, r] of Object.entries(results)) {
      const status = r.status === "Success" || r.status === "Failure" || r.status === "Skipped" ? r.status : "Failure";
      out.push({
        suite,
        file: file.replace(/\\/g, "/"),
        contract,
        test,
        status,
        reason: typeof r.reason === "string" ? r.reason : null,
        logs: Array.isArray(r.decoded_logs) ? r.decoded_logs.map(String).slice(0, 200) : [],
        durationMs: durationMs(r.duration),
      });
    }
  }
  return out;
}

export function summarizeSuite(results: ForgeTestResult[], ran: boolean): SuiteSummary {
  return {
    ran,
    passed: results.filter((r) => r.status === "Success").length,
    failed: results.filter((r) => r.status === "Failure").length,
    skipped: results.filter((r) => r.status === "Skipped").length,
    failures: results.filter((r) => r.status === "Failure").map((r) => ({ test: `${r.contract}.${r.test}`, reason: r.reason })),
  };
}

/**
 * How an exploit test ended on code that is supposed to be FIXED. Only a revert inside the attack, or the exploit's
 * own property assertion failing, counts as "the exploit no longer works". A failing setUp or a compile error is
 * inconclusive, not a fix.
 */
export type FixedOutcome =
  | { kind: "reverted"; reason: string }
  | { kind: "assertion-failed"; reason: string }
  | { kind: "setup-failed"; reason: string }
  | { kind: "passed" }
  | { kind: "missing" };

export function classifyFixedRun(result: ForgeTestResult | undefined): FixedOutcome {
  if (!result) return { kind: "missing" };
  if (result.status === "Success") return { kind: "passed" };
  const reason = result.reason ?? "";
  if (result.test.startsWith("setUp") || /setUp\(\) failed|failed to deploy/i.test(reason)) return { kind: "setup-failed", reason };
  if (/^Pramaan:|assertion failed|^assert/i.test(reason)) return { kind: "assertion-failed", reason };
  return { kind: "reverted", reason: reason || "reverted" };
}

/**
 * Status → tone mapping. One rule runs through all of it: green ("good") is used ONLY for a check that was actually
 * performed and passed (a verified signature, a fix whose re-proof passed, a verdict row the verifier marked green).
 * Anything unknown, unsupported, not checked or unrecognised maps to grey ("unknown"), never to green.
 */

export type Tone = "good" | "warning" | "serious" | "critical" | "unknown" | "info" | "neutral";

export interface StatusMeta {
  tone: Tone;
  label: string;
  description?: string;
}

const norm = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");

/** Verifier verdict colours (green / amber / red / neutral|grey). Unknown input is grey. */
export function verdictColorTone(color: unknown): Tone {
  switch (norm(color)) {
    case "green":
      return "good";
    case "amber":
    case "yellow":
    case "orange":
      return "warning";
    case "red":
      return "critical";
    default:
      return "unknown";
  }
}

/** Individual trust-chain checks ({status: pass | warn | fail | skip}). */
export function checkStatusTone(status: unknown): Tone {
  switch (norm(status)) {
    case "pass":
    case "passed":
      return "good";
    case "warn":
    case "warning":
      return "warning";
    case "fail":
    case "failed":
      return "critical";
    default:
      return "unknown";
  }
}

export const TONE_LABEL: Record<Tone, string> = {
  good: "Passed",
  warning: "Needs attention",
  serious: "Serious",
  critical: "Failed",
  unknown: "Unknown / not checked",
  info: "Info",
  neutral: "—",
};

/**
 * Overall verdict across rows. Green only when EVERY row is green; any row that could not be checked keeps the
 * overall verdict grey. (verifier-core's combine() treats all-neutral as green for the extension window; the
 * dashboard deliberately does not.)
 */
export function overallTone(tones: Tone[]): Tone {
  if (tones.length === 0) return "unknown";
  if (tones.includes("critical")) return "critical";
  if (tones.includes("serious")) return "serious";
  if (tones.includes("warning")) return "warning";
  if (tones.every((t) => t === "good")) return "good";
  return "unknown";
}

export function jobStatusMeta(status: unknown): StatusMeta {
  switch (String(status ?? "").toUpperCase()) {
    case "QUEUED":
      return { tone: "unknown", label: "Queued", description: "Waiting for a worker" };
    case "RUNNING":
      return { tone: "info", label: "Running", description: "Running in the sandbox" };
    case "COMPLETED":
      return { tone: "neutral", label: "Completed", description: "The job finished; see its findings for what was proven" };
    case "FAILED":
      return { tone: "critical", label: "Failed" };
    case "CANCELLED":
      return { tone: "unknown", label: "Cancelled" };
    default:
      return { tone: "unknown", label: String(status ?? "Unknown") || "Unknown" };
  }
}

export function findingStatusMeta(status: unknown): StatusMeta {
  switch (norm(status)) {
    case "reproduced":
      return { tone: "critical", label: "Reproduced", description: "A Foundry exploit test succeeded against this code in the sandbox" };
    case "fixed-verified":
      return { tone: "good", label: "Fixed · verified", description: "The exploit fails on the fixed code and the regression suite passes" };
    case "not-reproduced":
      return { tone: "unknown", label: "Not reproduced", description: "The exploit template did not succeed; this is not proof the code is safe" };
    case "candidate":
      return { tone: "unknown", label: "Candidate", description: "Static-analysis lead only; no exploit test was run" };
    case "false-positive":
      return { tone: "neutral", label: "False positive", description: "Marked as a false positive by a human reviewer" };
    case "inconclusive":
      return { tone: "warning", label: "Inconclusive", description: "The exploit run errored or was inconclusive" };
    case "accepted-risk":
      return { tone: "warning", label: "Accepted risk" };
    default:
      return { tone: "unknown", label: String(status ?? "Unknown") || "Unknown" };
  }
}

export function severityMeta(severity: unknown): StatusMeta {
  switch (norm(severity)) {
    case "critical":
      return { tone: "critical", label: "Critical" };
    case "high":
      return { tone: "serious", label: "High" };
    case "medium":
      return { tone: "warning", label: "Medium" };
    case "low":
      return { tone: "neutral", label: "Low" };
    case "info":
    case "informational":
      return { tone: "neutral", label: "Info" };
    default:
      return { tone: "unknown", label: String(severity ?? "Unknown") || "Unknown" };
  }
}

export const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

export function releaseStatusMeta(status: unknown): StatusMeta {
  switch (norm(status)) {
    case "draft":
      return { tone: "unknown", label: "Draft", description: "Registered; not queued in the timelock" };
    case "signed":
      return { tone: "info", label: "Signed", description: "Signature recorded; not queued yet" };
    case "queued":
      return { tone: "info", label: "Queued", description: "Pointer queued in PramaanTimelock; executable after the ETA" };
    case "active":
      return { tone: "info", label: "Active", description: "This pointer is the ENS pramaan.record" };
    case "superseded":
      return { tone: "neutral", label: "Superseded" };
    case "cancelled":
      return { tone: "unknown", label: "Cancelled" };
    case "revoked":
      return { tone: "critical", label: "Revoked" };
    default:
      return { tone: "unknown", label: String(status ?? "Unknown") || "Unknown" };
  }
}

export function signatureStatusMeta(status: unknown): StatusMeta {
  switch (norm(status)) {
    case "verified":
      return { tone: "good", label: "Signature verified" };
    case "invalid":
      return { tone: "critical", label: "Signature invalid" };
    case "unsigned":
      return { tone: "unknown", label: "Unsigned" };
    default:
      return { tone: "unknown", label: "Signature unknown" };
  }
}

export function fixStatusMeta(status: unknown): StatusMeta {
  switch (norm(status)) {
    case "verified":
      return { tone: "good", label: "Re-proof passed", description: "Exploit fails on the patched copy and the regression suite passes" };
    case "verifying":
      return { tone: "info", label: "Verifying" };
    case "proposed":
      return { tone: "unknown", label: "Proposed (not verified)" };
    case "failed":
      return { tone: "critical", label: "Re-proof failed" };
    case "rejected":
      return { tone: "neutral", label: "Rejected" };
    default:
      return { tone: "unknown", label: String(status ?? "Unknown") || "Unknown" };
  }
}

/** Decoder risk levels. No level maps to green: a decoded request is explained, never declared safe. */
export function riskLevelMeta(level: unknown): StatusMeta {
  switch (norm(level)) {
    case "critical":
      return { tone: "critical", label: "Critical risk" };
    case "high":
      return { tone: "serious", label: "High risk" };
    case "medium":
      return { tone: "warning", label: "Medium risk" };
    case "low":
      return { tone: "info", label: "Low risk" };
    case "info":
      return { tone: "neutral", label: "Informational" };
    default:
      return { tone: "unknown", label: "Unknown risk" };
  }
}

export function monitorStatusMeta(status: unknown): StatusMeta {
  switch (norm(status)) {
    case "active":
      return { tone: "info", label: "Watching" };
    case "paused":
      return { tone: "unknown", label: "Paused" };
    case "error":
      return { tone: "critical", label: "Error" };
    default:
      return { tone: "unknown", label: String(status ?? "Unknown") || "Unknown" };
  }
}

export function eventAssessmentMeta(assessment: unknown): StatusMeta {
  switch (norm(assessment)) {
    case "ok":
      return { tone: "good", label: "Matches release" };
    case "alert":
      return { tone: "critical", label: "Alert" };
    case "info":
      return { tone: "neutral", label: "Info" };
    default:
      return { tone: "unknown", label: String(assessment ?? "Unknown") || "Unknown" };
  }
}

/** Job progress step statuses from the engine: started | completed | failed | info. */
export function stepStatusMeta(status: unknown): StatusMeta {
  switch (norm(status)) {
    case "started":
      return { tone: "info", label: "Running" };
    case "completed":
      return { tone: "neutral", label: "Done" };
    case "failed":
      return { tone: "critical", label: "Failed" };
    case "info":
      return { tone: "neutral", label: "Info" };
    default:
      return { tone: "unknown", label: String(status ?? "") || "Unknown" };
  }
}

import { BLOCKING_CODES, type Assessment, type RiskLevel } from "@pramaan/decoder";
import type { ContractCheck, ReleaseVerification, VerdictRow } from "@pramaan/verifier-core";

/**
 * Pure decision logic for the review window (unit-tested). Colours: red = confirmed problem or mismatch,
 * amber = unknown / unsupported / pending, grey ("neutral") = not applicable. Never green for something unchecked.
 */

export function formatEta(eta: number): string {
  return new Date(eta * 1000).toISOString().replace("T", " ").replace(/:\d{2}\.\d{3}Z$/, " UTC");
}

/** A verified release with a newer pointer queued in its timelock is amber with the ETA, never plain green. */
export function refineSiteRow(row: VerdictRow, release: ReleaseVerification | null): VerdictRow {
  const next = release?.status === "verified" ? release.pending?.[0] : undefined;
  if (next && row.key === "verify.site.verified" && row.color !== "red") {
    return {
      ...row,
      color: "amber",
      key: "verify.site.pending",
      params: { ...row.params, next: next.pointer?.tag ?? "?", when: formatEta(next.eta) },
    };
  }
  if (release?.status === "revoked") return { ...row, color: "red", key: "verify.site.revoked", blocking: true };
  return row;
}

/** A contract the release lists for another chain is red and blocking. */
export function refineContractRow(row: VerdictRow, check: ContractCheck | null): VerdictRow {
  if (check?.status === "wrong-chain") return { ...row, color: "red", key: "verify.contract.wrong-chain", params: {}, blocking: true };
  return row;
}

/** The site row used while verification did not finish within the bounded wait: fail closed as "unknown". */
export function timeoutRow(waitedMs: number): VerdictRow {
  return { id: "site", color: "amber", key: "verify.site.timeout", params: {}, detail: `no result after ${Math.round(waitedMs / 1000)} s`, blocking: true };
}

export type BlockReason = "verification-red" | "verification-unknown" | "release-contradiction" | "critical-action";

export interface Decision {
  /** Signing is held: Continue needs an explicit override with a warning. */
  blocked: boolean;
  reasons: BlockReason[];
}

/**
 * Fail closed: red verification rows, verification still unknown after the bounded wait, or an action that
 * contradicts the signed release (spender outside it, wrong chain) block signing. A critical action (eth_sign,
 * EIP-7702 delegation, DELEGATECALL into unknown code) also needs the explicit override.
 */
export function decide(rows: VerdictRow[], assessment: Pick<Assessment, "findings" | "level">, opts: { timedOut?: boolean } = {}): Decision {
  const reasons: BlockReason[] = [];
  if (opts.timedOut) reasons.push("verification-unknown");
  if (rows.some((r) => r.blocking && r.color === "red")) reasons.push("verification-red");
  if (assessment.findings.some((f) => BLOCKING_CODES.has(f.code))) reasons.push("release-contradiction");
  if ((assessment.level as RiskLevel) === "critical") reasons.push("critical-action");
  return { blocked: reasons.length > 0, reasons };
}

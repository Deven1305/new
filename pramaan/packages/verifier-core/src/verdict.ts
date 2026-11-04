import type { ContractCheck } from "./contracts.js";
import type { ReleaseVerification } from "./release.js";
import type { SiteCheck } from "./site.js";

export type Color = "green" | "amber" | "red" | "neutral";

/** One line of the verdict window. `key`/`params` are looked up in the decoder's en/hi/mr catalog. */
export interface VerdictRow {
  id: "site" | "contract" | "action" | "privacy";
  color: Color;
  key: string;
  params: Record<string, string>;
  detail: string;
  blocking: boolean;
}

export interface Verdict {
  color: Exclude<Color, "neutral">;
  blocked: boolean;
  rows: VerdictRow[];
}

const ORDER: Record<Color, number> = { neutral: 0, green: 1, amber: 2, red: 3 };

/**
 * `acceptSingleSource` is for chains the user marked as a local development chain: one RPC is all there is, so a
 * single-source read is not downgraded (the UI still says it was single-source).
 */
export function siteRow(release: ReleaseVerification | null, site: SiteCheck | null, opts: { acceptSingleSource?: boolean } = {}): VerdictRow {
  if (!release) return { id: "site", color: "amber", key: "verify.site.unverifiable", params: { reason: "not checked yet" }, detail: "", blocking: false };
  const reason = release.checks.find((c) => c.status === "fail")?.detail ?? release.status;
  switch (release.status) {
    case "missing":
      return { id: "site", color: "amber", key: "verify.site.no-release", params: {}, detail: reason, blocking: false };
    case "mismatch":
      return { id: "site", color: "red", key: "verify.site.mismatch", params: {}, detail: reason, blocking: true };
    case "invalid-signature":
      return { id: "site", color: "red", key: "verify.site.unverifiable", params: { reason }, detail: reason, blocking: true };
    case "revoked":
      return { id: "site", color: "red", key: "verify.site.revoked", params: {}, detail: reason, blocking: true };
    case "unverifiable":
      return { id: "site", color: "amber", key: "verify.site.unverifiable", params: { reason }, detail: reason, blocking: false };
    case "verified": {
      const params = { tag: release.pointer?.tag ?? "?", signer: release.signature?.status === "valid" ? release.signature.signer : "?" };
      if (!site) return { id: "site", color: "amber", key: "verify.site.unverifiable", params: { reason: "page files not checked yet" }, detail: "", blocking: false };
      if (site.severity === "red") {
        const key = site.status === "unlisted-script" ? "verify.site.unlisted-script" : "verify.site.mismatch";
        return { id: "site", color: "red", key, params, detail: site.summary, blocking: true };
      }
      const pending = release.pending?.[0];
      if (pending && site.severity === "green") {
        const what = pending.pointer ? `release ${pending.pointer.tag}` : "a new release pointer";
        const when = pending.ready ? "can be executed now" : `can take effect at ${new Date(pending.eta * 1000).toISOString()}`;
        return { id: "site", color: "amber", key: "verify.site.verified", params, detail: `${site.summary}; update pending: ${what} is queued and ${when}`, blocking: false };
      }
      if (release.singleSource && !opts.acceptSingleSource && site.severity === "green") {
        return { id: "site", color: "amber", key: "verify.site.verified", params, detail: `${site.summary}; ENS read from a single RPC`, blocking: false };
      }
      return { id: "site", color: site.severity, key: "verify.site.verified", params, detail: site.summary, blocking: false };
    }
  }
}

export function contractRow(check: ContractCheck | null, unknownDetail?: string): VerdictRow {
  if (!check) {
    return { id: "contract", color: "amber", key: "verify.site.unverifiable", params: { reason: unknownDetail ?? "contract not checked" }, detail: unknownDetail ?? "", blocking: false };
  }
  const label = check.label ?? check.address;
  switch (check.status) {
    case "verified":
      return { id: "contract", color: "green", key: "verify.contract.verified", params: { label }, detail: check.detail, blocking: false };
    case "unlisted":
      return { id: "contract", color: "amber", key: "verify.contract.unlisted", params: {}, detail: check.detail, blocking: false };
    case "code-mismatch":
      return { id: "contract", color: "red", key: "verify.contract.mismatch", params: {}, detail: check.detail, blocking: true };
    case "impl-mismatch":
      return { id: "contract", color: "red", key: "verify.contract.impl-mismatch", params: {}, detail: check.detail, blocking: true };
    case "impl-not-covered":
      return { id: "contract", color: "amber", key: "verify.contract.unsupported-proxy", params: { type: check.actual?.proxyType ?? "proxy" }, detail: check.detail, blocking: false };
    case "unsupported-proxy":
      return { id: "contract", color: "amber", key: "verify.contract.unsupported-proxy", params: { type: check.detail }, detail: check.detail, blocking: false };
    case "wrong-chain":
      return { id: "contract", color: "red", key: "verify.site.unverifiable", params: { reason: check.detail }, detail: check.detail, blocking: true };
    case "eoa":
      return { id: "contract", color: "neutral", key: "verify.contract.eoa", params: {}, detail: check.detail, blocking: false };
    case "unknown":
      return { id: "contract", color: "amber", key: "verify.site.unverifiable", params: { reason: check.detail }, detail: check.detail, blocking: false };
  }
}

export function actionRow(level: "info" | "low" | "medium" | "high" | "critical", headlineKey = "action"): VerdictRow {
  const color: Color = level === "high" || level === "critical" ? "red" : level === "medium" ? "amber" : "green";
  return { id: "action", color, key: headlineKey, params: {}, detail: level, blocking: false };
}

export interface ObservedLeak {
  host: string;
  declared: boolean;
  purpose: string | null;
  blocked: boolean;
}

export function privacyRow(leaks: ObservedLeak[]): VerdictRow {
  const undeclared = leaks.find((l) => !l.declared && !l.blocked);
  if (undeclared) return { id: "privacy", color: "red", key: "verify.privacy.undeclared", params: { host: undeclared.host }, detail: "", blocking: false };
  const declared = leaks.find((l) => l.declared);
  if (declared) return { id: "privacy", color: "amber", key: "verify.privacy.declared", params: { host: declared.host, purpose: declared.purpose ?? "" }, detail: "", blocking: false };
  const blocked = leaks.find((l) => l.blocked);
  if (blocked) return { id: "privacy", color: "green", key: "verify.privacy.blocked", params: { host: blocked.host }, detail: "", blocking: false };
  return { id: "privacy", color: "green", key: "verify.privacy.none-observed", params: {}, detail: "", blocking: false };
}

/** The overall colour is the worst row. Pramaan never says "safe": a green verdict means the listed checks passed. */
export function combine(rows: VerdictRow[]): Verdict {
  const worst = rows.reduce<Color>((acc, r) => (ORDER[r.color] > ORDER[acc] ? r.color : acc), "neutral");
  return { color: worst === "neutral" ? "green" : worst, blocked: rows.some((r) => r.blocking), rows };
}

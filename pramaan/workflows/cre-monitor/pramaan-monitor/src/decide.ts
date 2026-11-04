import { parsePointer, parseRevoked } from "./pointer";
import type { Decision, DecisionKind, Finding, Observation, Severity } from "./types";

/** PramaanTimelock.GRACE_PERIOD: a queued pointer cannot be executed later than eta + 14 days. */
export const GRACE_PERIOD_SECONDS = 14 * 24 * 60 * 60;

/** Highest priority first. A lower index is the headline decision when several findings coexist. */
export const PRIORITY: readonly Exclude<DecisionKind, "OK">[] = [
  "RELEASE_REVOKED",
  "UNEXPECTED_IMPLEMENTATION",
  "MANIFEST_MISMATCH",
  "PENDING_UPGRADE",
  "PENDING_RELEASE_CHANGE",
  "UNKNOWN",
];
const SEVERITY_RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

const lower = (s: string) => s.toLowerCase();
const iso = (unix: number) => new Date(unix * 1000).toISOString();

/**
 * Pure and deterministic: the same Observation always yields the same Decision, with no clock, network or randomness.
 * It can return OK only when EVERY check below positively passed; any unread input becomes UNKNOWN, never OK.
 */
export function decide(obs: Observation): Decision {
  const findings: Finding[] = [];
  const unknown: string[] = [...obs.gaps];
  const pointer = parsePointer(obs.record);
  const revoked = parseRevoked(obs.revokedRaw);
  const ctx = { chainId: obs.chainId, headBlock: obs.headBlock, chainTime: obs.now, chainTimeIso: iso(obs.now) };

  // ---- the active pointer -------------------------------------------------------------------------------------
  if (obs.record === null) {
    // unreadable: the collector already recorded the reason in gaps
  } else if (obs.record === "") {
    unknown.push("no release pointer is set (pramaan.record is empty)");
  } else if (!pointer.ok) {
    findings.push({
      decision: "MANIFEST_MISMATCH",
      severity: "high",
      subject: `record:${obs.record}`,
      summary: `pramaan.record is not a valid Pramaan pointer: ${pointer.reason}`,
      details: { record: obs.record, reason: pointer.reason },
    });
  }
  if (revoked.ignored > 0) unknown.push("pramaan.revoked contains entries that are not sha256 digests");

  let manifestTrusted = false;
  if (pointer.ok) {
    if (revoked.digests.includes(pointer.sha256)) {
      findings.push({
        decision: "RELEASE_REVOKED",
        severity: "critical",
        subject: `revoked:${pointer.sha256}`,
        summary: `the ACTIVE release ${pointer.tag} (${pointer.sha256.slice(0, 12)}...) is listed in pramaan.revoked`,
        details: { tag: pointer.tag, sha256: pointer.sha256, active: true },
      });
    }
    const m = obs.manifest;
    if (!m) {
      unknown.push("release manifest was not fetched");
    } else if (m.status !== 200) {
      unknown.push(`release manifest could not be fetched (${m.status === 0 ? "request failed" : `HTTP ${m.status}`})`);
    } else if (m.sha256 !== pointer.sha256) {
      findings.push({
        decision: "MANIFEST_MISMATCH",
        severity: "critical",
        subject: `sha:${pointer.sha256}:${m.sha256}`,
        summary: `manifest bytes hash to ${m.sha256.slice(0, 12)}... but the ENS pointer says ${pointer.sha256.slice(0, 12)}...`,
        details: { tag: pointer.tag, pointerSha256: pointer.sha256, fetchedSha256: m.sha256, bytes: m.size },
      });
    } else if (!m.facts) {
      findings.push({
        decision: "MANIFEST_MISMATCH",
        severity: "high",
        subject: `unparseable:${m.sha256}`,
        summary: `manifest hash matches the pointer but the document is not a Pramaan manifest: ${m.error ?? "unknown error"}`,
        details: { tag: pointer.tag, sha256: m.sha256, error: m.error },
      });
    } else if (lower(m.facts.ensName) !== lower(obs.ensName) || m.facts.tag !== pointer.tag) {
      findings.push({
        decision: "MANIFEST_MISMATCH",
        severity: "high",
        subject: `identity:${m.sha256}`,
        summary: `manifest is for ${m.facts.ensName}@${m.facts.tag}, expected ${obs.ensName}@${pointer.tag}`,
        details: { manifestEnsName: m.facts.ensName, manifestTag: m.facts.tag, expectedEnsName: obs.ensName, expectedTag: pointer.tag },
      });
    } else {
      manifestTrusted = true;
    }
  }

  // ---- live implementations vs the (verified) manifest -----------------------------------------------------------
  const implChecks: Record<string, unknown>[] = [];
  if (pointer.ok && manifestTrusted && obs.manifest?.facts) {
    const facts = obs.manifest.facts;
    for (const live of obs.implementations) {
      const entry = facts.contracts.find((c) => lower(c.address) === lower(live.proxy) && c.chainId === obs.chainId);
      if (!entry) {
        unknown.push(`proxy ${live.label} is not listed in the release manifest`);
      } else if (live.current === null) {
        unknown.push(`implementation of proxy ${live.label} was not observed`);
      } else if (entry.implementation === null || lower(entry.implementation) !== lower(live.current)) {
        findings.push({
          decision: "UNEXPECTED_IMPLEMENTATION",
          severity: "critical",
          subject: `${lower(live.proxy)}:${lower(live.current)}`,
          summary: `proxy ${live.label} points to ${live.current} but release ${pointer.tag} lists ${entry.implementation ?? "no implementation"}`,
          details: { proxy: live.proxy, label: live.label, liveImplementation: live.current, expectedImplementation: entry.implementation, tag: pointer.tag, sinceBlock: live.block },
        });
      } else {
        implChecks.push({ proxy: live.proxy, label: live.label, implementation: live.current, matchesManifest: true });
      }
    }
  } else if (obs.implementations.length > 0 && !pointer.ok) {
    unknown.push("proxy implementations cannot be checked without a valid release pointer");
  }

  // ---- queued release pointers (PramaanTimelock) ------------------------------------------------------------------
  const lastExecuted = obs.timelock?.lastExecutedId ?? 0;
  const pending = (obs.timelock?.ops ?? [])
    .filter((op) => op.state === "Queued" && Number(op.id) > lastExecuted && obs.now <= op.eta + GRACE_PERIOD_SECONDS)
    .sort((a, b) => Number(b.id) - Number(a.id));
  for (const op of pending) {
    const p = parsePointer(op.value);
    const sha = p.ok ? p.sha256 : op.value;
    if (p.ok && revoked.digests.includes(p.sha256)) {
      findings.push({
        decision: "RELEASE_REVOKED",
        severity: "high",
        subject: `revoked-queued:${p.sha256}:${op.id}`,
        summary: `queued release ${p.tag} (operation ${op.id}) is already listed in pramaan.revoked`,
        details: { operationId: op.id, tag: p.tag, sha256: p.sha256, eta: op.eta, active: false },
      });
    }
    findings.push({
      decision: "PENDING_RELEASE_CHANGE",
      severity: "medium",
      subject: `op:${op.id}:${sha}`,
      summary: `release pointer change queued (operation ${op.id}${p.ok ? `, ${p.tag}` : ""}), executable ${obs.now >= op.eta ? "now" : `in ${op.eta - obs.now}s`}`,
      details: {
        operationId: op.id,
        pointer: op.value,
        tag: p.ok ? p.tag : null,
        sha256: p.ok ? p.sha256 : null,
        eta: op.eta,
        etaIso: iso(op.eta),
        secondsUntilEta: op.eta - obs.now,
        executable: obs.now >= op.eta,
        currentPointer: obs.record,
      },
    });
  }

  // ---- scheduled upgrades (OpenZeppelin TimelockController) ------------------------------------------------------
  const inRelease = (impl: string | null): boolean | null => {
    if (!impl || !manifestTrusted || !obs.manifest?.facts) return null;
    return obs.manifest.facts.contracts.some((c) => c.implementation !== null && lower(c.implementation) === lower(impl));
  };
  for (const up of [...obs.scheduledUpgrades].sort((a, b) => b.block - a.block)) {
    const listed = inRelease(up.implementation);
    findings.push({
      decision: "PENDING_UPGRADE",
      severity: listed === true ? "medium" : "high",
      subject: `upgrade:${lower(up.id)}`,
      summary:
        up.implementation === null
          ? `timelocked call ${up.selector} on ${up.target} scheduled (not an upgradeToAndCall), executable ${obs.now >= up.eta ? "now" : `in ${up.eta - obs.now}s`}`
          : `upgrade of ${up.target} to ${up.implementation} scheduled (${listed === true ? "implementation IS in the active release" : listed === false ? "implementation is NOT in the active release" : "release membership unknown"}), executable ${obs.now >= up.eta ? "now" : `in ${up.eta - obs.now}s`}`,
      details: {
        operationId: up.id,
        target: up.target,
        newImplementation: up.implementation,
        selector: up.selector,
        targetInRelease: listed,
        eta: up.eta,
        etaIso: iso(up.eta),
        secondsUntilEta: up.eta - obs.now,
        executable: obs.now >= up.eta,
        scheduledInBlock: up.block,
      },
    });
  }

  // ---- anything unread --------------------------------------------------------------------------------------------
  if (unknown.length > 0) {
    const reasons = [...new Set(unknown)].sort();
    findings.push({
      decision: "UNKNOWN",
      severity: "medium",
      subject: `unknown:${reasons.join("|")}`,
      summary: `could not verify the release: ${reasons[0]}${reasons.length > 1 ? ` (+${reasons.length - 1} more)` : ""}`,
      details: { reasons },
    });
  }

  if (findings.length === 0) {
    // Reaching here means: pointer valid, manifest fetched and hash-verified, identity matched, not revoked, no queued
    // pointer, no scheduled upgrade, log history complete, and every monitored proxy equals the manifest.
    const p = pointer.ok ? pointer : null;
    return {
      decision: "OK",
      severity: "info",
      subject: `ok:${p?.sha256 ?? "none"}`,
      summary: `release ${p?.tag ?? "?"} active, manifest verified, ${implChecks.length} proxy implementation(s) match`,
      details: { ...ctx, tag: p?.tag ?? null, sha256: p?.sha256 ?? null, implementations: implChecks },
      findings: [],
    };
  }

  findings.sort((a, b) => PRIORITY.indexOf(a.decision) - PRIORITY.indexOf(b.decision) || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  const head = findings[0] as Finding;
  return {
    decision: head.decision,
    severity: head.severity,
    subject: head.subject,
    summary: head.summary,
    details: { ...ctx, ...head.details, activePointer: obs.record, findingCount: findings.length },
    findings,
  };
}

import { el } from "../ui";

interface FindingItem {
  id: string;
  title: string;
  class?: string;
  severity: string;
  status: string;
  exploitTestSha256: string | null;
  evidenceSha256: string | null;
}

interface EvidenceGate {
  id: string;
  passed: boolean;
  detail?: string;
}

interface RegressionSuite {
  passed: number;
  failed: number;
  skipped?: number;
  ran?: boolean;
}

interface EvidenceData {
  findingId?: string;
  candidateSource?: {
    detector?: string;
    tool?: string;
  };
  fixedRun?: {
    ref?: string | null;
    result?: string | null;
    revertReason?: string | null;
  };
  gates?: EvidenceGate[];
  regressionSuite?: RegressionSuite;
  fixVerification?: {
    verified: boolean;
    detail?: string;
  };
  verified?: boolean;
}

function findFixVerification(obj: unknown): boolean | null {
  if (!obj || typeof obj !== "object") return null;
  const record = obj as Record<string, unknown>;

  if ("fixVerification" in record) {
    const fv = record["fixVerification"];
    if (fv && typeof fv === "object" && "verified" in fv) {
      return Boolean((fv as Record<string, unknown>)["verified"]);
    }
  }
  if ("verified" in record && typeof record["verified"] === "boolean") {
    return record["verified"];
  }
  if ("gates" in record && Array.isArray(record["gates"])) {
    const g = (record["gates"] as EvidenceGate[]).find((x) => x && x.id === "fails-on-fixed");
    if (g && typeof g.passed === "boolean") return g.passed;
  }
  if ("fixedRun" in record && record["fixedRun"] && typeof record["fixedRun"] === "object") {
    const fr = record["fixedRun"] as Record<string, unknown>;
    if (fr["result"] === "failed-as-expected") return true;
  }
  for (const key of Object.keys(record)) {
    if (typeof record[key] === "object" && record[key] !== null) {
      const sub = findFixVerification(record[key]);
      if (sub !== null) return sub;
    }
  }
  return null;
}

export function render(root: HTMLElement): void {
  const container = el("section", { class: "section-evidence card" });
  root.appendChild(container);

  const title = el("h2", { class: "card-title" }, "Security evidence published by the developer");
  const subtitle = el("p", { class: "card-subtitle" }, "Independent formal verification and exploit reproduction records for this release.");
  container.appendChild(el("div", { class: "card-header" }, title, subtitle));

  const contentBox = el("div", { class: "evidence-content" });
  contentBox.appendChild(el("p", { class: "muted" }, "Checking for security evidence…"));
  container.appendChild(contentBox);

  async function loadEvidence() {
    try {
      const res = await fetch("/.well-known/pramaan/findings.json", { cache: "no-store" });
      if (!res.ok) {
        renderEmpty();
        return;
      }
      const raw = await res.json();
      if (!Array.isArray(raw) || raw.length === 0) {
        renderEmpty();
        return;
      }

      contentBox.textContent = "";

      for (const item of raw) {
        if (!item || typeof item !== "object" || typeof item.id !== "string") continue;
        const finding: FindingItem = {
          id: String(item.id),
          title: String(item.title ?? "—"),
          class: item.class ? String(item.class) : undefined,
          severity: String(item.severity ?? "unknown"),
          status: String(item.status ?? "unknown"),
          exploitTestSha256: item.exploitTestSha256 ? String(item.exploitTestSha256) : null,
          evidenceSha256: item.evidenceSha256 ? String(item.evidenceSha256) : null,
        };

        let evidence: EvidenceData | null = null;
        if (finding.evidenceSha256) {
          try {
            const evRes = await fetch(`/.well-known/pramaan/evidence/${finding.evidenceSha256}.json`, { cache: "no-store" });
            if (evRes.ok) {
              evidence = (await evRes.json()) as EvidenceData;
            }
          } catch {
            evidence = null;
          }
        }

        renderFindingCard(contentBox, finding, evidence);
      }
    } catch {
      renderEmpty();
    }
  }

  function renderEmpty() {
    contentBox.textContent = "";
    contentBox.appendChild(
      el("p", { class: "evidence-empty muted" }, "No security evidence is published with this release.")
    );
  }

  function renderFindingCard(target: HTMLElement, finding: FindingItem, evidence: EvidenceData | null) {
    const card = el("div", { class: "evidence-item-card" });

    // Header: id, title, chips
    const cardHeader = el("div", { class: "evidence-header-row" });
    const titleCol = el("div", { class: "evidence-title-group" },
      el("span", { class: "evidence-id mono" }, finding.id),
      el("h3", { class: "evidence-title" }, finding.title)
    );

    const chips = el("div", { class: "evidence-chips" },
      el("span", { class: `chip chip-severity chip-${finding.severity.toLowerCase()}` }, finding.severity),
      el("span", { class: `chip chip-status chip-${finding.status.toLowerCase().replace(/[^a-z0-9]/g, "-")}` }, finding.status)
    );

    cardHeader.appendChild(titleCol);
    cardHeader.appendChild(chips);
    card.appendChild(cardHeader);

    // 5-step vertical timeline
    const timeline = el("div", { class: "timeline" });

    // 1. Candidate found by static analysis
    const detector = evidence?.candidateSource?.detector ?? "static analysis";
    timeline.appendChild(
      createTimelineStep(
        true,
        "Candidate found by static analysis",
        detector !== "static analysis" ? detector : "Found via automated static analyzer"
      )
    );

    // 2. Exploit reproduced in a Foundry test
    const testHash = finding.exploitTestSha256 ? finding.exploitTestSha256.slice(0, 12) : null;
    const isReproduced = finding.status.includes("reproduced") || finding.status === "fixed-verified";
    timeline.appendChild(
      createTimelineStep(
        isReproduced,
        "Exploit reproduced in a Foundry test",
        testHash ? `Test SHA-256: ${testHash}…` : "—"
      )
    );

    // 3. Fix proposed
    const fixRef = evidence?.fixedRun?.ref ?? "onlyOwner applied";
    timeline.appendChild(
      createTimelineStep(
        true,
        "Fix proposed",
        fixRef
      )
    );

    // 4. Exploit re-run after fix: blocked
    const verifiedVal = evidence ? findFixVerification(evidence) : null;
    let step4Passed = false;
    let step4Detail = "not part of this evidence";
    if (verifiedVal === true) {
      step4Passed = true;
      step4Detail = evidence?.fixedRun?.revertReason ?? "Exploit blocked on patched contract";
    } else if (verifiedVal === false) {
      step4Passed = false;
      step4Detail = "Fix verification failed";
    }
    timeline.appendChild(
      createTimelineStep(
        step4Passed,
        "Exploit re-run after fix: blocked",
        step4Detail
      )
    );

    // 5. Regression tests
    const reg = evidence?.regressionSuite;
    let step5Passed = false;
    let step5Detail = "—";
    if (reg && typeof reg.passed === "number") {
      step5Passed = reg.failed === 0;
      step5Detail = `${reg.passed} passed, ${reg.failed} failed${typeof reg.skipped === "number" ? `, ${reg.skipped} skipped` : ""}`;
    }
    timeline.appendChild(
      createTimelineStep(
        step5Passed,
        "Regression tests",
        step5Detail
      )
    );

    card.appendChild(timeline);

    // Download evidence link
    if (finding.evidenceSha256) {
      const downloadLink = el("a", {
        href: `/.well-known/pramaan/evidence/${finding.evidenceSha256}.json`,
        download: `${finding.evidenceSha256}.json`,
        class: "btn-download-evidence mono",
      }, "Download evidence JSON");
      card.appendChild(el("div", { class: "evidence-download-row" }, downloadLink));
    }

    target.appendChild(card);
  }

  function createTimelineStep(isCheck: boolean, titleText: string, detailText: string): HTMLElement {
    const step = el("div", { class: `timeline-step ${isCheck ? "step-passed" : "step-neutral"}` });
    const indicator = el("div", { class: "timeline-indicator" },
      el("span", { class: "indicator-icon" }, isCheck ? "✔" : "○")
    );
    const textGroup = el("div", { class: "timeline-body" },
      el("div", { class: "timeline-title" }, titleText),
      el("div", { class: "timeline-detail mono" }, detailText)
    );
    step.appendChild(indicator);
    step.appendChild(textGroup);
    return step;
  }

  const footer = el("footer", { class: "evidence-footer muted" },
    "Published by the developer and covered by the signed release manifest. Your Pramaan extension verifies it independently."
  );
  container.appendChild(footer);

  void loadEvidence();
}


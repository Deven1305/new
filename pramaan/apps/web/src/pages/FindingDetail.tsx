import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, GitPullRequest, Wrench } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";
import { CodeView, DiffView } from "../components/Code";
import { JobProgress } from "../components/JobProgress";
import { Btn, Card, ErrorPanel, Facts, Field, GatedButton, Loading, Mono, Notice, PageHeader, Pill, Section, StatusChip, ToneChip } from "../components/ui";
import { api } from "../lib/client";
import { checkDigest, type DigestCheck } from "../lib/digest";
import { formatDateTime, formatDuration } from "../lib/format";
import { UNSUPPORTED_REASON, useConfig, useGet } from "../lib/hooks";
import { findingStatusMeta, fixStatusMeta, severityMeta, type StatusMeta } from "../lib/tone";
import type { FindingDetail, FixProposal, Job, RunRecord } from "../lib/types";

/** Never show a fix as verified unless its verification record says so. */
export function effectiveFixStatus(fix: Pick<FixProposal, "status" | "verification">): string {
  if (fix.status === "verified") {
    if (!fix.verification) return "proposed";
    if (fix.verification.verified !== true) return "failed";
  }
  return fix.status;
}

export function runRecordMeta(run: RunRecord | null): StatusMeta {
  switch (run?.result) {
    case "passed":
      return { tone: "critical", label: "Exploit succeeded", description: "The exploit test passed, which means the vulnerable code was exploited" };
    case "failed":
      return { tone: "unknown", label: "Exploit did not succeed", description: "The exploit test failed; this is not proof the code is safe" };
    case "error":
      return { tone: "warning", label: "Run errored" };
    default:
      return { tone: "unknown", label: "Not run" };
  }
}

function download(name: string, bytes: BlobPart, type = "application/octet-stream") {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function EvidenceRow({ findingId, sha256, createdAt }: { findingId: string; sha256: string; createdAt: string }) {
  const [check, setCheck] = useState<DigestCheck | null>(null);
  const fetchIt = useMutation({
    mutationFn: async () => {
      const bytes = await api.get<Uint8Array>(`/v1/findings/${encodeURIComponent(findingId)}/evidence/${encodeURIComponent(sha256)}`, { responseType: "bytes" });
      const result = await checkDigest(bytes, sha256);
      setCheck(result);
      if (result.status !== "mismatch") download(`evidence-${sha256.slice(0, 12)}.json`, bytes as BlobPart, "application/json");
      return result;
    },
  });
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm">
      <span className="min-w-0">
        <Mono value={sha256} head={14} tail={8} />
        <span className="block text-xs text-ink-2">{formatDateTime(createdAt)}</span>
      </span>
      <span className="flex flex-wrap items-center gap-2">
        {check?.status === "match" ? <ToneChip tone="good">sha256 matches (checked in your browser)</ToneChip> : null}
        {check?.status === "mismatch" ? <ToneChip tone="critical">sha256 does NOT match; file not saved</ToneChip> : null}
        {check?.status === "unavailable" ? <ToneChip tone="unknown">Could not verify: {check.reason}</ToneChip> : null}
        <Btn size="sm" variant="secondary" busy={fetchIt.isPending} onClick={() => fetchIt.mutate()}>
          <Download size={14} aria-hidden="true" /> Download
        </Btn>
      </span>
      {fetchIt.isError ? (
        <span className="w-full">
          <ErrorPanel error={fetchIt.error} />
        </span>
      ) : null}
    </li>
  );
}

function FixCard({ fix, canPr, prReason }: { fix: FixProposal; canPr: boolean; prReason: string | null }) {
  const [prUrl, setPrUrl] = useState<string | null>(fix.prUrl ?? null);
  const pr = useMutation({ mutationFn: () => api.post<{ url: string }>(`/v1/fixes/${encodeURIComponent(fix.id)}/pull-request`), onSuccess: (r) => setPrUrl(r.url) });
  const status = effectiveFixStatus(fix);
  const meta = fixStatusMeta(status);
  const v = fix.verification;
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">Proposed fix</h3>
        <StatusChip meta={meta} />
        <Pill>{fix.generator === "ai" ? "AI-drafted" : fix.generator === "deterministic" ? "Deterministic rule" : fix.generator}</Pill>
        <code className="text-xs text-ink-2">{fix.file}</code>
      </div>
      <Notice tone="warning" title="A proposal, not a patch to trust">
        Review this diff yourself. A passing re-proof shows the known exploit stops working and the existing tests still pass; it does not show the contract is free of other bugs.
      </Notice>
      {fix.explanation ? <p className="text-sm whitespace-pre-wrap break-words">{fix.explanation}</p> : null}
      <DiffView diff={fix.diff} />
      <div>
        <h4 className="mb-1 text-sm font-semibold">Re-verification</h4>
        {v ? (
          <div className="space-y-1.5 text-sm">
            <ToneChip tone={v.verified ? "good" : "critical"}>{v.verified ? "Exploit blocked and regression suite passed" : "Re-proof did not pass"}</ToneChip>
            <p className="text-ink-2 break-words">{v.detail}</p>
            <p className="flex flex-wrap gap-2 text-xs text-ink-2">
              {v.exploit ? <Pill>exploit on fixed code: {v.exploit.kind}</Pill> : null}
              {v.regression?.ran ? (
                <Pill>
                  regression: {v.regression.passed} passed, {v.regression.failed} failed, {v.regression.skipped} skipped
                </Pill>
              ) : v.regression ? (
                <Pill>regression suite not run</Pill>
              ) : null}
              {v.durationMs ? <Pill>{formatDuration(v.durationMs)}</Pill> : null}
            </p>
          </div>
        ) : (
          <p className="text-sm text-ink-2">Not verified yet. A fix that has not been re-proved in the sandbox is shown as unverified.</p>
        )}
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <GatedButton variant="secondary" size="sm" busy={pr.isPending} reason={prUrl ? null : prReason} disabled={!canPr || !!prUrl} onClick={() => pr.mutate()}>
          <GitPullRequest size={14} aria-hidden="true" /> Open pull request
        </GatedButton>
        {prUrl ? (
          <a className="link self-center text-sm break-all" href={prUrl} target="_blank" rel="noreferrer">
            {prUrl}
          </a>
        ) : null}
      </div>
      <p className="text-xs text-muted">Opening a pull request never merges anything.</p>
      {pr.isError ? <ErrorPanel error={pr.error} /> : null}
    </Card>
  );
}

export function FindingDetailPage() {
  const { findingId = "" } = useParams();
  const qc = useQueryClient();
  const q = useGet<FindingDetail>(["finding", findingId], `/v1/findings/${encodeURIComponent(findingId)}`);
  const config = useConfig();
  const [note, setNote] = useState("");
  const [useAi, setUseAi] = useState(false);
  const [fixJob, setFixJob] = useState<Job | null>(null);

  const review = useMutation({
    mutationFn: (decision: "confirmed" | "false-positive") => api.post(`/v1/findings/${encodeURIComponent(findingId)}/review`, { decision, ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: () => {
      setNote("");
      void qc.invalidateQueries({ queryKey: ["finding", findingId] });
      void qc.invalidateQueries({ queryKey: ["findings"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
  const requestFix = useMutation({
    mutationFn: () => api.post<{ job: Job }>(`/v1/findings/${encodeURIComponent(findingId)}/fix`, { ai: useAi && !!config.data?.ai }),
    onSuccess: (r) => {
      setFixJob(r.job);
      void qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });

  if (q.isPending) return <Loading label="Loading finding…" />;
  if (q.isError) return <ErrorPanel error={q.error} onRetry={() => void q.refetch()} />;
  const f = q.data;
  const back = f.projectId ? { to: `/projects/${f.projectId}/findings`, label: "Findings" } : { to: "/dashboard", label: "Dashboard" };
  const statusMeta = findingStatusMeta(f.status);
  const aiReason = config.isSuccess && !config.data.ai ? UNSUPPORTED_REASON.ai : null;
  const ghReason = config.isSuccess ? (config.data.github ? null : UNSUPPORTED_REASON.github) : "Checking what this backend supports…";
  const fixReason = f.status === "reproduced" || f.status === "fixed-verified" ? null : "Only a reproduced finding can get a proposed fix: the fix is judged by re-running the exploit.";
  const run = f.vulnerableRun;
  const runMeta = runRecordMeta(run);

  return (
    <div>
      <PageHeader
        back={back}
        title={f.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <code>{f.label}</code>
            <span>{f.vulnClass}</span>
            <StatusChip meta={severityMeta(f.severity)} />
            <StatusChip meta={statusMeta} />
            <Pill>confidence: {f.confidence}</Pill>
          </span>
        }
      />
      {statusMeta.description ? <p className="mb-4 -mt-2 text-sm text-ink-2">{statusMeta.description}.</p> : null}

      <Section title="Where">
        <Card>
          <Facts
            items={[
              { label: "Contract", value: <code>{f.contract}</code> },
              { label: "Function", value: f.functionSig ? <code>{f.functionSig}</code> : "—" },
              { label: "File", value: f.file ? <code className="break-all">{f.file}</code> : "—" },
              { label: "Lines", value: f.lines?.length ? f.lines.join(", ") : "—" },
              { label: "Exploit template", value: f.templateId ?? "none matched" },
            ]}
          />
          <h3 className="mt-4 mb-1 text-sm font-semibold">Detected by</h3>
          {f.sources.length === 0 ? (
            <p className="text-sm text-ink-2">No scanner source recorded.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {f.sources.map((s, i) => (
                <li key={i}>
                  <Pill>{s.tool}</Pill> <code>{s.detector}</code>
                  {s.description ? <span className="block text-ink-2 break-words">{s.description}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>

      <Section title="Exploit test" description="Generated Foundry test. It ran in a sandbox with no network access. Shown read-only.">
        {f.exploitTest ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                <code>{f.exploitTest.fileName}</code> · sha256 <Mono value={f.exploitTest.sha256} head={12} tail={6} />
              </span>
              <Btn size="sm" variant="secondary" onClick={() => download(f.exploitTest!.fileName.split("/").pop() ?? "exploit.t.sol", f.exploitTest!.source, "text/plain")}>
                <Download size={14} aria-hidden="true" /> Download test
              </Btn>
            </div>
            <CodeView source={f.exploitTest.source} label={`Exploit test ${f.exploitTest.fileName}`} />
          </div>
        ) : (
          <Notice tone="unknown" title="No exploit test was generated">
            Without one this finding is only a static-analysis lead. It is not evidence either way.
          </Notice>
        )}
      </Section>

      <Section title="Proof gates and vulnerable run">
        <div className="grid gap-3 md:grid-cols-2">
          <Card>
            <h3 className="mb-2 font-semibold">Gates</h3>
            {f.gates.length === 0 ? (
              <p className="text-sm text-ink-2">No gates recorded.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {f.gates.map((g) => (
                  <li key={g.id} className="flex flex-wrap items-start gap-2">
                    <ToneChip tone={g.passed ? "good" : "critical"}>{g.passed ? "Passed" : "Failed"}</ToneChip>
                    <span className="min-w-0 flex-1">
                      <code>{g.id}</code>
                      <span className="block text-ink-2 break-words">{g.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h3 className="mb-2 font-semibold">Run against the vulnerable code</h3>
            {run ? (
              <div className="space-y-2 text-sm">
                <StatusChip meta={runMeta} />
                {run.reason ? <p className="text-ink-2 break-words">{run.reason}</p> : null}
                {run.durationMs ? <p className="text-xs text-muted">Took {formatDuration(run.durationMs)}</p> : null}
                {run.logs?.length ? (
                  <details>
                    <summary className="cursor-pointer text-ink-2">Sandbox log ({run.logs.length} lines)</summary>
                    <pre className="code-block mt-1 max-h-64 overflow-auto p-2 text-xs whitespace-pre-wrap">{run.logs.join("\n")}</pre>
                  </details>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-ink-2">No sandbox run was recorded for this finding.</p>
            )}
          </Card>
        </div>
        {f.plan ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-ink-2">Exploit plan (template parameters)</summary>
            <pre className="code-block mt-1 max-h-72 overflow-auto p-3 text-xs">{JSON.stringify(f.plan, null, 2)}</pre>
          </details>
        ) : null}
      </Section>

      <Section title="Evidence" description="Each file is addressed by its sha256. The download is hashed again in your browser before it is saved.">
        {f.evidence.length === 0 ? <p className="text-sm text-ink-2">No evidence bundle has been stored for this finding.</p> : <ul className="space-y-2">{f.evidence.map((e) => <EvidenceRow key={e.sha256} findingId={f.id} {...e} />)}</ul>}
      </Section>

      <Section title="Fixes">
        <Notice tone="warning" title="Fixes are proposals that need human review" className="mb-3">
          Pramaan never applies or merges a fix by itself. Every change below must be read and approved by a person.
        </Notice>
        {f.fixes.length === 0 ? (
          <p className="mb-3 text-sm text-ink-2">No fix has been proposed yet.</p>
        ) : (
          <div className="mb-3 space-y-4">
            {f.fixes.map((fx) => (
              <FixCard key={fx.id} fix={fx} canPr={!ghReason} prReason={ghReason} />
            ))}
          </div>
        )}
        <Card>
          <h3 className="font-semibold">Request a fix</h3>
          <p className="mt-0.5 text-sm text-ink-2">Starts a job that proposes a patch and re-runs the exploit and the regression suite against it.</p>
          <label className="mt-2 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={useAi && !aiReason} disabled={!!aiReason} onChange={(e) => setUseAi(e.target.checked)} />
            <span>
              Let AI draft the fix if the rules cannot
              {aiReason ? <span className="block text-xs text-muted">{aiReason}</span> : null}
            </span>
          </label>
          <div className="mt-3">
            <GatedButton variant="primary" busy={requestFix.isPending} reason={fixReason} onClick={() => requestFix.mutate()}>
              <Wrench size={15} aria-hidden="true" /> Request fix
            </GatedButton>
          </div>
          {requestFix.isError ? (
            <div className="mt-3">
              <ErrorPanel error={requestFix.error} />
            </div>
          ) : null}
        </Card>
        {fixJob ? (
          <div className="mt-3">
            <JobProgress key={fixJob.id} jobId={fixJob.id} projectId={fixJob.projectId} />
          </div>
        ) : null}
      </Section>

      <Section title="Human review">
        {f.review ? (
          <Notice tone={f.review.decision === "confirmed" ? "info" : "neutral"} title={f.review.decision === "confirmed" ? "Confirmed by a reviewer" : "Marked as a false positive"}>
            {f.review.note ? <span className="block whitespace-pre-wrap">{f.review.note}</span> : null}
            <span className="block text-xs">
              {f.review.reviewedBy ? `by ${f.review.reviewedBy} ` : ""}
              {f.review.reviewedAt ? formatDateTime(f.review.reviewedAt) : ""}
            </span>
          </Notice>
        ) : (
          <p className="mb-2 text-sm text-ink-2">Not reviewed yet.</p>
        )}
        <Card className="mt-3">
          <Field label="Note (optional)" htmlFor="review-note">
            <textarea id="review-note" className="field" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
          </Field>
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn variant="primary" busy={review.isPending && review.variables === "confirmed"} disabled={review.isPending} onClick={() => review.mutate("confirmed")}>
              Confirm finding
            </Btn>
            <Btn variant="secondary" busy={review.isPending && review.variables === "false-positive"} disabled={review.isPending} onClick={() => review.mutate("false-positive")}>
              Mark false positive
            </Btn>
          </div>
          {review.isError ? (
            <div className="mt-3">
              <ErrorPanel error={review.error} />
            </div>
          ) : null}
        </Card>
      </Section>
    </div>
  );
}

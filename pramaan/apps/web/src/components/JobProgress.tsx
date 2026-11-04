import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { api } from "../lib/client";
import { durationBetween, formatDateTime, formatDuration, formatTime, sourceLabel } from "../lib/format";
import { useGet } from "../lib/hooks";
import { isTerminal, mergeEvents, watchJob, type StreamMode } from "../lib/jobStream";
import { jobStatusMeta, stepStatusMeta } from "../lib/tone";
import type { Job, JobEvent, JobStatus } from "../lib/types";
import { useNow } from "../lib/useNow";
import { Btn, Card, ErrorPanel, Facts, Notice, Pill, Spinner, StatusChip, ToneChip } from "./ui";

export interface StepRow {
  step: string;
  status: string;
  message: string;
  firstAt: string;
  lastAt: string;
  count: number;
}

/** Collapses the event log into one row per step (in order of first appearance) showing its latest state. */
export function summarizeSteps(events: JobEvent[]): StepRow[] {
  const rows = new Map<string, StepRow>();
  for (const e of events) {
    const row = rows.get(e.step);
    if (!row) {
      rows.set(e.step, { step: e.step, status: e.status, message: e.message, firstAt: e.createdAt, lastAt: e.createdAt, count: 1 });
    } else {
      row.status = e.status;
      if (e.message) row.message = e.message;
      row.lastAt = e.createdAt;
      row.count++;
    }
  }
  return [...rows.values()];
}

const MODE_TEXT: Record<StreamMode, string> = {
  connecting: "Connecting…",
  sse: "Live (server-sent events)",
  polling: "Live (polling every few seconds)",
  done: "Finished",
  stopped: "Not streaming",
};

export function JobProgress({ jobId, projectId }: { jobId: string; projectId: string }) {
  const qc = useQueryClient();
  const jobQuery = useGet<Job>(["job", jobId], `/v1/jobs/${encodeURIComponent(jobId)}`);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [liveStatus, setLiveStatus] = useState<JobStatus | null>(null);
  const [mode, setMode] = useState<StreamMode>("connecting");
  const [streamError, setStreamError] = useState<string | null>(null);

  useEffect(() => {
    setEvents([]);
    setLiveStatus(null);
    setStreamError(null);
    const stop = watchJob({
      jobId,
      client: api,
      preferSse: api.authMode() === "cookie",
      onEvents: (incoming) => setEvents((prev) => mergeEvents(prev, incoming)),
      onStatus: (status) => {
        setLiveStatus(status);
        if (isTerminal(status)) {
          void qc.invalidateQueries({ queryKey: ["job", jobId] });
          void qc.invalidateQueries({ queryKey: ["jobs"] });
          void qc.invalidateQueries({ queryKey: ["findings"] });
          void qc.invalidateQueries({ queryKey: ["finding"] });
          void qc.invalidateQueries({ queryKey: ["stats"] });
          void qc.invalidateQueries({ queryKey: ["project", projectId] });
        }
      },
      onMode: setMode,
      onError: (err) => setStreamError(err.message),
    });
    return stop;
  }, [jobId, projectId, qc]);

  const job = jobQuery.data;
  const status: JobStatus | null = job && isTerminal(job.status) ? job.status : (liveStatus ?? job?.status ?? null);
  const terminal = isTerminal(status);
  const now = useNow(1000, !terminal);
  const steps = useMemo(() => summarizeSteps(events), [events]);

  const cancel = useMutation({
    mutationFn: () => api.post(`/v1/jobs/${encodeURIComponent(jobId)}/cancel`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["job", jobId] });
      void qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });

  if (jobQuery.isPending) return <Spinner label="Loading job…" />;
  if (jobQuery.isError) return <ErrorPanel error={jobQuery.error} onRetry={() => void jobQuery.refetch()} />;
  const meta = jobStatusMeta(status);
  const elapsed = durationBetween(job!.startedAt ?? job!.createdAt, job!.finishedAt, now);

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold">
            {job!.kind === "fix" ? "Fix job" : "Analysis job"} <code className="text-sm text-ink-2">{jobId.slice(0, 8)}</code>
          </h3>
          <StatusChip meta={meta} />
          {!terminal ? <span className="text-xs text-ink-2">{MODE_TEXT[mode]}</span> : null}
        </div>
        {!terminal ? (
          <Btn variant="danger" size="sm" busy={cancel.isPending} onClick={() => cancel.mutate()}>
            Cancel job
          </Btn>
        ) : null}
      </div>
      {cancel.isError ? (
        <div className="mt-2">
          <ErrorPanel error={cancel.error} />
        </div>
      ) : null}
      <div className="mt-3">
        <Facts
          items={[
            { label: "Source", value: <span className="break-all">{sourceLabel(job!.source)}</span> },
            { label: "Options", value: [job!.params.fix ? "propose fixes" : null, job!.params.ai ? "AI assistance" : null].filter(Boolean).join(", ") || "none" },
            { label: "Created", value: formatDateTime(job!.createdAt) },
            { label: terminal ? "Duration" : "Elapsed", value: formatDuration(elapsed) },
            { label: "Commit", value: job!.commitSha ? <code>{job!.commitSha.slice(0, 12)}</code> : "—" },
            { label: "Attempts", value: job!.attempts },
          ]}
        />
      </div>

      <h4 className="mt-4 mb-2 text-sm font-semibold">Steps</h4>
      {steps.length === 0 ? (
        <p className="text-sm text-ink-2">{terminal ? "This job recorded no progress events." : "Waiting for the first step…"}</p>
      ) : (
        <ol className="space-y-1.5" aria-live="polite" aria-label="Job steps">
          {steps.map((s) => {
            const m = stepStatusMeta(s.status);
            return (
              <li key={s.step} className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-lg border border-line px-3 py-2 text-sm">
                <StatusChip meta={m} />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{s.step}</span>
                  {s.message ? <span className="block text-ink-2 break-words">{s.message}</span> : null}
                </span>
                <time className="text-xs text-muted" dateTime={s.lastAt}>
                  {formatTime(s.lastAt)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
      {streamError && !terminal ? <p className="mt-2 text-xs text-muted">Last connection problem: {streamError}. Retrying.</p> : null}

      {events.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-ink-2">Full event log ({events.length})</summary>
          <ol className="code-block mt-2 max-h-72 overflow-auto p-2 text-xs">
            {events.map((e) => (
              <li key={e.seq} className="whitespace-pre-wrap break-words">
                <span className="text-muted">
                  #{e.seq} {formatTime(e.createdAt)}
                </span>{" "}
                [{e.step}] {e.status}: {e.message}
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      {terminal ? <JobOutcome job={job!} status={status!} projectId={projectId} /> : null}
    </Card>
  );
}

function JobOutcome({ job, status, projectId }: { job: Job; status: JobStatus; projectId: string }) {
  if (status === "FAILED") {
    return (
      <div className="mt-4">
        <Notice tone="critical" title="The job failed">
          {job.error ?? "No error message was recorded."}
        </Notice>
      </div>
    );
  }
  if (status === "CANCELLED") {
    return (
      <div className="mt-4">
        <Notice tone="unknown" title="The job was cancelled">
          No results were recorded from this run.
        </Notice>
      </div>
    );
  }
  const r = job.result;
  if (!r) return null;
  const c = r.counts;
  return (
    <div className="mt-4 space-y-3">
      <h4 className="text-sm font-semibold">Result</h4>
      {c ? (
        <div className="flex flex-wrap gap-2">
          <ToneChip tone="neutral">{c.candidates} candidates</ToneChip>
          <ToneChip tone={c.reproduced > 0 ? "critical" : "neutral"}>{c.reproduced} reproduced</ToneChip>
          <ToneChip tone="unknown">{c.notReproduced} not reproduced</ToneChip>
          <ToneChip tone="unknown">{c.candidatesOnly} candidate only</ToneChip>
          <ToneChip tone={c.fixesVerified > 0 ? "good" : "neutral"}>{c.fixesVerified} fixes verified</ToneChip>
        </div>
      ) : null}
      {r.verified !== undefined ? (
        <Notice tone={r.verified ? "good" : "critical"} title={r.verified ? "Fix re-proof passed" : "Fix re-proof did not pass"}>
          {r.detail}
        </Notice>
      ) : null}
      <div className="flex flex-wrap gap-2 text-sm text-ink-2">
        {r.scanners?.slither ? <Pill>Slither: {r.scanners.slither.ok ? `${r.scanners.slither.results} results` : `failed${r.scanners.slither.error ? ` (${r.scanners.slither.error})` : ""}`}</Pill> : null}
        {r.scanners?.aderyn ? <Pill>Aderyn: {r.scanners.aderyn.ok ? `${r.scanners.aderyn.results} results` : `failed${r.scanners.aderyn.error ? ` (${r.scanners.aderyn.error})` : ""}`}</Pill> : null}
        {r.regression?.ran ? <Pill>Regression: {r.regression.passed} passed, {r.regression.failed} failed</Pill> : r.regression ? <Pill>Regression suite not run</Pill> : null}
        {r.build === false ? <Pill>Build failed</Pill> : null}
      </div>
      <p className="text-sm">
        <Link className="link" to={`/projects/${projectId}/findings`}>
          Open the findings
        </Link>
      </p>
      {r.reportMarkdown ? (
        <details>
          <summary className="cursor-pointer text-sm text-ink-2">Markdown report</summary>
          <pre className="code-block mt-2 max-h-96 overflow-auto p-3 text-xs whitespace-pre-wrap">{r.reportMarkdown}</pre>
        </details>
      ) : null}
    </div>
  );
}

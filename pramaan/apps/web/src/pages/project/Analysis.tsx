import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { JobProgress } from "../../components/JobProgress";
import { Card, EmptyState, ErrorPanel, Field, GatedButton, Notice, QueryView, Section, StatusChip, Tabs } from "../../components/ui";
import { api } from "../../lib/client";
import { formatDateTime, relativeTime, sourceLabel } from "../../lib/format";
import { UNSUPPORTED_REASON, useConfig, useGet } from "../../lib/hooks";
import { jobStatusMeta } from "../../lib/tone";
import type { CreateJobResponse, Job, JobSource, UploadResult } from "../../lib/types";
import { useProject } from "./ProjectLayout";

const EXAMPLES = [
  { name: "contracts", label: "contracts", text: "the demo project's contract set" },
  { name: "reentrancy-bank", label: "reentrancy-bank", text: "a bank with a classic reentrancy hole" },
  { name: "initializer-takeover", label: "initializer-takeover", text: "an upgradeable contract with an unprotected initializer" },
  { name: "oracle-lending", label: "oracle-lending", text: "a lending pool that uses a price-feed answer without checking it is positive" },
] as const;

type SourceKind = "example" | "github" | "upload";

export function AnalysisPage() {
  const project = useProject();
  const qc = useQueryClient();
  const config = useConfig();
  const [params, setParams] = useSearchParams();
  const activeJob = params.get("job");
  const jobs = useGet<Job[]>(["jobs", project.id], `/v1/projects/${encodeURIComponent(project.id)}/jobs`, { refetchInterval: 8_000 });

  const [kind, setKind] = useState<SourceKind>("example");
  const [example, setExample] = useState<string>(EXAMPLES[0].name);
  const [url, setUrl] = useState(project.repoUrl ?? "");
  const [ref, setRef] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fix, setFix] = useState(true);
  const [ai, setAi] = useState(false);
  const [force, setForce] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const aiReason = config.isSuccess && !config.data.ai ? UNSUPPORTED_REASON.ai : config.isPending ? "Checking what this backend supports…" : null;
  const viewer = project.role === "viewer";

  const start = useMutation({
    mutationFn: async (): Promise<CreateJobResponse> => {
      let source: JobSource;
      if (kind === "example") source = { type: "example", name: example };
      else if (kind === "github") source = { type: "github", url: url.trim(), ...(ref.trim() ? { ref: ref.trim() } : {}) };
      else {
        if (!file) throw new Error("Choose a .zip file first.");
        const form = new FormData();
        form.append("file", file);
        const up = await api.request<UploadResult>("POST", `/v1/projects/${encodeURIComponent(project.id)}/uploads`, { form });
        source = { type: "upload", uploadId: up.uploadId };
      }
      return api.post<CreateJobResponse>(`/v1/projects/${encodeURIComponent(project.id)}/jobs`, { source, params: { fix, ai: ai && !aiReason }, ...(force ? { force: true } : {}) });
    },
    onSuccess: (res) => {
      setNote(res.deduplicated ? "An identical job already exists, so no new run was started. Showing that one. Tick “Re-run even if identical” to force a fresh run." : null);
      setParams({ job: res.job.id }, { replace: true });
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  const canSubmit = !viewer && (kind === "example" || (kind === "github" && /^https?:\/\/\S+$/.test(url.trim())) || (kind === "upload" && !!file));

  return (
    <div>
      <Section title="Start an analysis" description="Slither and Aderyn propose candidates; a Foundry exploit test then tries to prove each one inside a Docker sandbox with no network.">
        <Card>
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              start.mutate();
            }}
            className="space-y-4"
          >
            <Tabs
              label="Source"
              value={kind}
              onChange={setKind}
              tabs={[
                { id: "example", label: "Example project" },
                { id: "github", label: "GitHub repository" },
                { id: "upload", label: "Zip upload" },
              ]}
            />
            <div role="tabpanel" id={`panel-${kind}`} aria-labelledby={`tab-${kind}`}>
              {kind === "example" ? (
                <fieldset>
                  <legend className="mb-1 text-sm font-medium">Bundled example</legend>
                  <div className="space-y-1.5">
                    {EXAMPLES.map((ex) => (
                      <label key={ex.name} className="flex cursor-pointer items-start gap-2 rounded-lg border border-line px-3 py-2 text-sm has-[:checked]:border-accent">
                        <input type="radio" name="example" className="mt-1" checked={example === ex.name} onChange={() => setExample(ex.name)} />
                        <span>
                          <code className="font-medium">{ex.label}</code>
                          <span className="block text-ink-2">{ex.text}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}
              {kind === "github" ? (
                <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
                  <Field label="Repository URL" htmlFor="gh-url" hint="A public repository the backend can clone.">
                    <input id="gh-url" className="field" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/org/repo" />
                  </Field>
                  <Field label="Branch, tag or commit (optional)" htmlFor="gh-ref">
                    <input id="gh-ref" className="field" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="main" />
                  </Field>
                </div>
              ) : null}
              {kind === "upload" ? (
                <Field label="Foundry project as .zip" htmlFor="zip" hint="The backend enforces MAX_UPLOAD_MB and unpacks the archive inside the sandbox.">
                  <input id="zip" className="field" type="file" accept=".zip,application/zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </Field>
              ) : null}
            </div>

            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-sm font-medium">Options</legend>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={fix} onChange={(e) => setFix(e.target.checked)} />
                <span>
                  Propose a fix for each reproduced finding and re-prove it
                  <span className="block text-xs text-muted">Fixes are proposals. A human must review every one before it is merged.</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={ai && !aiReason} disabled={!!aiReason} onChange={(e) => setAi(e.target.checked)} />
                <span>
                  Allow AI to fill exploit-template slots and draft fixes
                  <span className="block text-xs text-muted">{aiReason ?? "Uses the backend's Anthropic key. AI output is always re-verified by the sandbox."}</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={force} onChange={(e) => setForce(e.target.checked)} />
                <span>Re-run even if an identical job already exists</span>
              </label>
            </fieldset>

            <div className="flex flex-wrap items-center gap-3">
              <GatedButton type="submit" variant="primary" busy={start.isPending} disabled={!canSubmit} reason={viewer ? "Your role on this project is viewer; ask an owner for maintainer access." : null}>
                <Play size={15} aria-hidden="true" /> Start analysis
              </GatedButton>
              {start.isPending && kind === "upload" ? <span className="text-sm text-ink-2">Uploading, then queuing…</span> : null}
            </div>
            {start.isError ? <ErrorPanel error={start.error} /> : null}
          </form>
        </Card>
      </Section>

      {note ? (
        <div className="mb-4">
          <Notice tone="info">{note}</Notice>
        </div>
      ) : null}

      {activeJob ? (
        <Section title="Live progress">
          <JobProgress key={activeJob} jobId={activeJob} projectId={project.id} />
        </Section>
      ) : null}

      <Section title="Jobs in this project">
        <QueryView query={jobs} isEmpty={(j) => j.length === 0} empty={<EmptyState title="No jobs yet">Start an analysis above and its progress will stream here.</EmptyState>}>
          {(list) => (
            <Card className="!p-0">
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Job</th>
                      <th>Status</th>
                      <th>Source</th>
                      <th>Result</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((j) => (
                      <tr key={j.id} className={j.id === activeJob ? "bg-inset" : undefined}>
                        <td>
                          <Link className="link" to={`?job=${j.id}`} replace>
                            {j.kind} · <code>{j.id.slice(0, 8)}</code>
                          </Link>
                        </td>
                        <td>
                          <StatusChip meta={jobStatusMeta(j.status)} />
                        </td>
                        <td className="max-w-[18rem] truncate" title={sourceLabel(j.source)}>
                          {sourceLabel(j.source)}
                        </td>
                        <td>{j.result?.counts ? `${j.result.counts.reproduced} reproduced / ${j.result.counts.candidates} candidates` : j.error ? <span className="text-critical-ink">error</span> : "—"}</td>
                        <td title={formatDateTime(j.createdAt)}>{relativeTime(j.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </QueryView>
      </Section>
    </div>
  );
}

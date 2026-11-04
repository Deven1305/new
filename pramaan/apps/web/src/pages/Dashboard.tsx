import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { SegmentedBar, StatTile } from "../components/Stats";
import { Btn, Card, EmptyState, ErrorPanel, Field, Loading, Mono, PageHeader, Pill, QueryView, Section, StatusChip } from "../components/ui";
import { api } from "../lib/client";
import { formatDateTime, relativeTime, sourceLabel } from "../lib/format";
import { retryPolicy, useAuthMode, useGet } from "../lib/hooks";
import { jobStatusMeta, releaseStatusMeta } from "../lib/tone";
import type { Job, ProjectSummary, Stats } from "../lib/types";

function StatsSection() {
  const stats = useGet<Stats>(["stats"], "/v1/stats", { refetchInterval: 10_000 });
  return (
    <Section title="Overview">
      <QueryView query={stats}>
        {(s) => {
          const active = (s.jobs.RUNNING ?? 0) + (s.jobs.QUEUED ?? 0);
          return (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                <StatTile label="Projects" value={s.projects} />
                <StatTile label="Jobs in flight" value={active} note={`${s.jobs.RUNNING ?? 0} running · ${s.jobs.QUEUED ?? 0} queued`} />
                <StatTile label="Exploits reproduced" value={s.findings.reproduced} tone={s.findings.reproduced > 0 ? "critical" : undefined} note="proved in the sandbox" />
                <StatTile label="Fixes verified" value={s.findings.fixedVerified} tone={s.findings.fixedVerified > 0 ? "good" : undefined} note="re-proof passed" />
                <StatTile label="Active releases" value={s.releases.active} note={`${s.releases.queued} queued in the timelock`} />
                <StatTile label="Open alerts" value={s.alerts.open} tone={s.alerts.critical > 0 ? "critical" : undefined} note={`${s.alerts.critical} critical`} />
              </div>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <SegmentedBar
                  title="Findings by status"
                  emptyText="No findings yet. Run an analysis on a project."
                  parts={[
                    { id: "reproduced", label: "Reproduced", value: s.findings.reproduced, tone: "critical" },
                    { id: "fixed", label: "Fixed and verified", value: s.findings.fixedVerified, tone: "good" },
                    { id: "notRepro", label: "Not reproduced", value: s.findings.notReproduced, tone: "unknown" },
                    { id: "candidate", label: "Candidate only", value: s.findings.candidate, tone: "unknown", hatch: true },
                    { id: "fp", label: "False positive", value: s.findings.falsePositive, tone: "neutral" },
                  ]}
                />
                <SegmentedBar
                  title="Jobs by status"
                  emptyText="No analysis jobs yet."
                  parts={[
                    { id: "COMPLETED", label: "Completed", value: s.jobs.COMPLETED ?? 0, tone: "neutral" },
                    { id: "RUNNING", label: "Running", value: s.jobs.RUNNING ?? 0, tone: "info" },
                    { id: "QUEUED", label: "Queued", value: s.jobs.QUEUED ?? 0, tone: "unknown" },
                    { id: "FAILED", label: "Failed", value: s.jobs.FAILED ?? 0, tone: "critical" },
                    { id: "CANCELLED", label: "Cancelled", value: s.jobs.CANCELLED ?? 0, tone: "unknown", hatch: true },
                  ]}
                />
              </div>
            </>
          );
        }}
      </QueryView>
    </Section>
  );
}

function NewProject({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", ensName: "", domain: "", repoUrl: "", chainId: "", rpcUrl: "" });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const create = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { name: form.name.trim() };
      for (const k of ["ensName", "domain", "repoUrl", "rpcUrl"] as const) if (form[k].trim()) body[k] = form[k].trim();
      if (form.chainId.trim()) body["chainId"] = Number(form.chainId);
      return api.post<ProjectSummary>("/v1/projects", body);
    },
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ["projects"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
      onDone();
      navigate(`/projects/${p.id}`);
    },
  });
  return (
    <Card className="mb-4">
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field label="Project name" htmlFor="np-name">
          <input id="np-name" className="field" value={form.name} onChange={set("name")} required maxLength={80} />
        </Field>
        <Field label="ENS name (optional)" htmlFor="np-ens" hint="For example vaultlab.eth">
          <input id="np-ens" className="field" value={form.ensName} onChange={set("ensName")} />
        </Field>
        <Field label="Website domain (optional)" htmlFor="np-domain" hint="For example localhost:5180">
          <input id="np-domain" className="field" value={form.domain} onChange={set("domain")} />
        </Field>
        <Field label="Repository URL (optional)" htmlFor="np-repo">
          <input id="np-repo" className="field" type="url" value={form.repoUrl} onChange={set("repoUrl")} placeholder="https://github.com/org/repo" />
        </Field>
        <Field label="Chain id (optional)" htmlFor="np-chain">
          <input id="np-chain" className="field" inputMode="numeric" pattern="[0-9]*" value={form.chainId} onChange={set("chainId")} placeholder="11155111" />
        </Field>
        <Field label="RPC URL (optional)" htmlFor="np-rpc" hint="Used by the monitors for this project">
          <input id="np-rpc" className="field" type="url" value={form.rpcUrl} onChange={set("rpcUrl")} />
        </Field>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Btn type="submit" variant="primary" busy={create.isPending} disabled={!form.name.trim()}>
            Create project
          </Btn>
          <Btn variant="ghost" onClick={onDone}>
            Cancel
          </Btn>
        </div>
        {create.isError ? (
          <div className="sm:col-span-2">
            <ErrorPanel error={create.error} />
          </div>
        ) : null}
      </form>
    </Card>
  );
}

function RecentJobs({ projects }: { projects: ProjectSummary[] }) {
  const mode = useAuthMode();
  const subset = projects.slice(0, 8);
  const results = useQueries({
    queries: subset.map((p) => ({
      queryKey: ["jobs", p.id, mode],
      queryFn: () => api.get<Job[]>(`/v1/projects/${encodeURIComponent(p.id)}/jobs`),
      retry: retryPolicy,
      refetchInterval: 10_000,
    })),
  });
  if (results.some((r) => r.isPending)) return <Loading />;
  const failed = results.find((r) => r.isError);
  const jobs = results
    .flatMap((r, i) => (r.data ?? []).map((j) => ({ job: j, project: subset[i]! })))
    .sort((a, b) => b.job.createdAt.localeCompare(a.job.createdAt))
    .slice(0, 8);
  return (
    <>
      {failed?.error ? <ErrorPanel error={failed.error} /> : null}
      {jobs.length === 0 && !failed ? (
        <EmptyState title="No analysis jobs yet">Open a project and start an analysis to see live progress here.</EmptyState>
      ) : jobs.length > 0 ? (
        <Card className="!p-0">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Job</th>
                  <th>Status</th>
                  <th>Source</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map(({ job, project }) => (
                  <tr key={job.id}>
                    <td>
                      <Link className="link" to={`/projects/${project.id}`}>
                        {project.name}
                      </Link>
                    </td>
                    <td>
                      <Link className="link" to={`/projects/${project.id}/analysis?job=${job.id}`}>
                        {job.kind} · <code>{job.id.slice(0, 8)}</code>
                      </Link>
                    </td>
                    <td>
                      <StatusChip meta={jobStatusMeta(job.status)} />
                    </td>
                    <td className="max-w-[16rem] truncate" title={sourceLabel(job.source)}>
                      {sourceLabel(job.source)}
                    </td>
                    <td title={formatDateTime(job.createdAt)}>{relativeTime(job.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </>
  );
}

export function Dashboard() {
  const projects = useGet<ProjectSummary[]>(["projects"], "/v1/projects", { refetchInterval: 15_000 });
  const [creating, setCreating] = useState(false);
  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Your projects, what the sandbox proved, and what is published."
        actions={
          <Btn variant="primary" onClick={() => setCreating((c) => !c)} aria-expanded={creating}>
            <Plus size={16} aria-hidden="true" /> New project
          </Btn>
        }
      />
      {creating ? <NewProject onDone={() => setCreating(false)} /> : null}
      <StatsSection />
      <Section title="Projects">
        <QueryView
          query={projects}
          isEmpty={(p) => p.length === 0}
          empty={
            <EmptyState title="No projects yet" action={<Btn variant="primary" onClick={() => setCreating(true)}>Create your first project</Btn>}>
              A project ties together a repository, its contracts, its releases and its monitors.
            </EmptyState>
          }
        >
          {(list) => (
            <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {list.map((p) => (
                <li key={p.id} className="card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link to={`/projects/${p.id}`} className="link min-w-0 break-words text-base font-semibold">
                      {p.name}
                    </Link>
                    {p.isDemo ? <Pill>demo</Pill> : null}
                  </div>
                  <p className="mt-0.5 truncate text-sm text-ink-2">{p.ensName ?? p.domain ?? p.repoUrl ?? "No ENS name or domain yet"}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                    {p.activeRelease ? (
                      <>
                        <StatusChip meta={releaseStatusMeta(p.activeRelease.status)} />
                        <span className="text-ink-2">{p.activeRelease.tag}</span>
                        <Mono value={p.activeRelease.sha256} head={8} tail={4} />
                      </>
                    ) : (
                      <span className="text-ink-2">No active release</span>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-ink-2">
                    {p.counts.findings} {p.counts.findings === 1 ? "finding" : "findings"} · {p.counts.openAlerts} open {p.counts.openAlerts === 1 ? "alert" : "alerts"}
                    {p.role ? ` · ${p.role}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </QueryView>
      </Section>
      <Section title="Recent jobs">{projects.isSuccess ? <RecentJobs projects={projects.data} /> : projects.isPending ? <Loading /> : null}</Section>
    </div>
  );
}

import { Link, useSearchParams } from "react-router";
import { Card, EmptyState, Field, Pill, QueryView, Section, StatusChip } from "../../components/ui";
import { useGet } from "../../lib/hooks";
import { FINDING_STATUSES, type FindingSummary } from "../../lib/types";
import { findingStatusMeta, SEVERITY_RANK, severityMeta } from "../../lib/tone";
import { useProject } from "./ProjectLayout";

export function sortFindings(list: FindingSummary[]): FindingSummary[] {
  return [...list].sort((a, b) => (SEVERITY_RANK[String(b.severity)] ?? -1) - (SEVERITY_RANK[String(a.severity)] ?? -1) || a.label.localeCompare(b.label));
}

export function FindingsPage() {
  const project = useProject();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const q = useGet<FindingSummary[]>(["findings", project.id, status], `/v1/projects/${encodeURIComponent(project.id)}/findings`, { query: { status } });
  return (
    <div>
      <Section
        title="Findings"
        description="A finding is only called reproduced when a Foundry exploit test succeeded against the code in the sandbox. Candidates and non-reproduced results are leads, not proof either way."
        actions={
          <Field label="Status" htmlFor="f-status">
            <select
              id="f-status"
              className="field !w-auto"
              value={status}
              onChange={(e) => {
                const next = new URLSearchParams(params);
                if (e.target.value) next.set("status", e.target.value);
                else next.delete("status");
                setParams(next, { replace: true });
              }}
            >
              <option value="">All statuses</option>
              {FINDING_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {findingStatusMeta(s).label}
                </option>
              ))}
            </select>
          </Field>
        }
      >
        <QueryView
          query={q}
          isEmpty={(l) => l.length === 0}
          empty={
            <EmptyState
              title={status ? "No findings with this status" : "No findings yet"}
              action={
                <Link to={`/projects/${project.id}/analysis`} className="btn btn-primary btn-sm">
                  Run an analysis
                </Link>
              }
            >
              Findings appear after an analysis job completes.
            </EmptyState>
          }
        >
          {(list) => (
            <Card className="!p-0">
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Finding</th>
                      <th>Severity</th>
                      <th>Status</th>
                      <th>Where</th>
                      <th>Found by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortFindings(list).map((f) => (
                      <tr key={f.id}>
                        <td className="min-w-[14rem]">
                          <Link className="link font-medium" to={`/findings/${f.id}`}>
                            {f.title}
                          </Link>
                          <span className="block text-xs text-ink-2">
                            {f.label} · {f.vulnClass}
                          </span>
                        </td>
                        <td>
                          <StatusChip meta={severityMeta(f.severity)} />
                        </td>
                        <td>
                          <StatusChip meta={findingStatusMeta(f.status)} />
                        </td>
                        <td className="min-w-[10rem]">
                          <code className="text-xs">
                            {f.contract}
                            {f.functionSig ? `.${f.functionSig}` : ""}
                          </code>
                          {f.file ? (
                            <span className="block text-xs text-ink-2 break-all">
                              {f.file}
                              {f.lines?.length ? `:${f.lines[0]}${f.lines.length > 1 ? `-${f.lines[f.lines.length - 1]}` : ""}` : ""}
                            </span>
                          ) : null}
                        </td>
                        <td>
                          <span className="flex flex-wrap gap-1">
                            {[...new Set((f.sources ?? []).map((s) => s.tool))].map((t) => (
                              <Pill key={t}>{t}</Pill>
                            ))}
                          </span>
                        </td>
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

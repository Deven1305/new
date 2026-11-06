import { NavLink, Outlet, useOutletContext, useParams } from "react-router";
import { cx, ErrorPanel, Loading, PageHeader, Pill } from "../../components/ui";
import { useGet } from "../../lib/hooks";
import type { ProjectDetail } from "../../lib/types";

export interface ProjectContext {
  project: ProjectDetail;
}

export function useProject(): ProjectDetail {
  return useOutletContext<ProjectContext>().project;
}

const tabClass = ({ isActive }: { isActive: boolean }) =>
  cx("whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", isActive ? "border-accent text-ink" : "border-transparent text-ink-2 hover:text-ink");

export function ProjectLayout() {
  const { projectId = "" } = useParams();
  const q = useGet<ProjectDetail>(["project", projectId], `/v1/projects/${encodeURIComponent(projectId)}`);
  if (q.isPending) return <Loading label="Loading project…" />;
  if (q.isError) return <ErrorPanel error={q.error} onRetry={() => void q.refetch()} />;
  const p = q.data;
  const base = `/projects/${p.id}`;
  return (
    <div>
      <PageHeader
        back={{ to: "/dashboard", label: "Dashboard" }}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {p.name}
            {p.isDemo ? <Pill>demo</Pill> : null}
          </span>
        }
        subtitle={p.ensName ?? p.domain ?? p.repoUrl ?? undefined}
      />
      <nav aria-label="Project sections" className="-mx-4 mb-5 flex overflow-x-auto border-b border-line px-4">
        <NavLink end to={base} className={tabClass}>
          Overview
        </NavLink>
        <NavLink to={`${base}/analysis`} className={tabClass}>
          Analysis
        </NavLink>
        <NavLink to={`${base}/findings`} className={tabClass}>
          Findings{p.counts.findings ? ` (${p.counts.findings})` : ""}
        </NavLink>
        <NavLink to={`${base}/releases`} className={tabClass}>
          Releases
        </NavLink>
        <NavLink to={`${base}/monitoring`} className={tabClass}>
          Monitoring{p.counts.openAlerts ? ` (${p.counts.openAlerts})` : ""}
        </NavLink>
      </nav>
      <Outlet context={{ project: p } satisfies ProjectContext} />
    </div>
  );
}

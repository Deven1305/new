import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Btn, Card, CopyButton, EmptyState, ErrorPanel, Facts, Field, Notice, PageHeader, QueryView, Section } from "../components/ui";
import { api } from "../lib/client";
import { formatDateTime, relativeTime } from "../lib/format";
import { useAuthMode, useGet, useMe } from "../lib/hooks";
import type { ApiToken, CreatedToken, ProjectSummary } from "../lib/types";

export function Settings() {
  const me = useMe();
  const mode = useAuthMode();
  const qc = useQueryClient();
  const tokens = useGet<ApiToken[]>(["tokens"], "/v1/tokens");
  const projects = useGet<ProjectSummary[]>(["projects"], "/v1/projects");
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [created, setCreated] = useState<CreatedToken | null>(null);

  const create = useMutation({
    mutationFn: () => api.post<CreatedToken>("/v1/tokens", { name: name.trim(), ...(projectId ? { projectId } : {}) }),
    onSuccess: (t) => {
      setCreated(t);
      setName("");
      void qc.invalidateQueries({ queryKey: ["tokens"] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/v1/tokens/${encodeURIComponent(id)}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tokens"] }),
  });

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Account and API tokens" />
      {me.isSuccess ? (
        <Card className="mb-6">
          <Facts
            items={[
              { label: "Signed in as", value: me.data.user.address ?? me.data.user.displayName ?? me.data.user.id },
              { label: "Method", value: mode === "token" ? "API token (sessionStorage, this tab only)" : "Wallet session (httpOnly cookie)" },
              { label: "Role", value: me.data.user.isAdmin ? "Administrator" : "Member" },
            ]}
          />
        </Card>
      ) : null}

      <Section title="Create a token" description="Tokens act as you and need no CSRF header, so keep them secret. A token scoped to one project cannot touch the others.">
        <Card>
          <form
            className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Field label="Name" htmlFor="tok-name">
              <input id="tok-name" className="field" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="ci-github-actions" required />
            </Field>
            <Field label="Scope" htmlFor="tok-scope">
              <select id="tok-scope" className="field" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">All my projects</option>
                {(projects.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Btn type="submit" variant="primary" busy={create.isPending} disabled={!name.trim()}>
              Create token
            </Btn>
          </form>
          {create.isError ? (
            <div className="mt-3">
              <ErrorPanel error={create.error} />
            </div>
          ) : null}
          {created ? (
            <div className="mt-3">
              <Notice tone="warning" title="Copy this token now. It is shown only once.">
                <span className="flex flex-wrap items-center gap-1">
                  <code className="kbd-cmd">{created.token}</code>
                  <CopyButton value={created.token} label="Copy token" />
                </span>
              </Notice>
            </div>
          ) : null}
        </Card>
      </Section>

      <Section title="Your tokens">
        <QueryView query={tokens} isEmpty={(t) => t.length === 0} empty={<EmptyState title="No API tokens yet">Create one above to call the API from CI or a script.</EmptyState>}>
          {(list) => (
            <Card className="!p-0">
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Scope</th>
                      <th>Created</th>
                      <th>Last used</th>
                      <th>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((t) => (
                      <tr key={t.id}>
                        <td className="font-medium">{t.name}</td>
                        <td>{t.projectId ? (projects.data?.find((p) => p.id === t.projectId)?.name ?? t.projectId) : "All projects"}</td>
                        <td title={formatDateTime(t.createdAt)}>{relativeTime(t.createdAt)}</td>
                        <td>{t.revokedAt ? "Revoked" : t.lastUsedAt ? relativeTime(t.lastUsedAt) : "Never"}</td>
                        <td className="text-right">
                          {t.revokedAt ? null : (
                            <Btn variant="danger" size="sm" busy={revoke.isPending && revoke.variables === t.id} onClick={() => revoke.mutate(t.id)}>
                              Revoke
                            </Btn>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </QueryView>
        {revoke.isError ? (
          <div className="mt-3">
            <ErrorPanel error={revoke.error} />
          </div>
        ) : null}
      </Section>
    </div>
  );
}

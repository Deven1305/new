import { Link } from "react-router";
import { Card, EmptyState, Facts, Mono, Pill, Section, StatusChip } from "../../components/ui";
import { shortAddress } from "../../lib/format";
import { monitorStatusMeta, releaseStatusMeta } from "../../lib/tone";
import { useProject } from "./ProjectLayout";

export function Overview() {
  const p = useProject();
  const base = `/projects/${p.id}`;
  return (
    <div>
      <Section title="Project">
        <Card>
          <Facts
            items={[
              { label: "ENS name", value: p.ensName ?? "Not set" },
              { label: "Website domain", value: p.domain ?? "Not set" },
              {
                label: "Repository",
                value: p.repoUrl ? (
                  <a className="link break-all" href={p.repoUrl} target="_blank" rel="noreferrer">
                    {p.repoUrl}
                  </a>
                ) : (
                  "Not set"
                ),
              },
              { label: "Chain id", value: p.chainId ?? "Not set" },
              { label: "Your role", value: p.role ?? "—" },
              {
                label: "Active release",
                value: p.activeRelease ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusChip meta={releaseStatusMeta(p.activeRelease.status)} />
                    <Link className="link" to={`/releases/${p.activeRelease.id}`}>
                      {p.activeRelease.tag}
                    </Link>
                    <Mono value={p.activeRelease.sha256} head={8} tail={4} />
                  </span>
                ) : (
                  "None yet"
                ),
              },
            ]}
          />
        </Card>
      </Section>

      <Section title="Next steps">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { to: `${base}/analysis`, title: "Prove", text: "Run Slither, Aderyn and the sandboxed exploit tests." },
            { to: `${base}/findings`, title: "Review findings", text: `${p.counts.findings} recorded. Confirm, dismiss or request a fix.` },
            { to: `${base}/releases`, title: "Publish", text: "Register a signed manifest and follow it through the timelock." },
            { to: `${base}/monitoring`, title: "Watch", text: `${p.monitors.length} monitor${p.monitors.length === 1 ? "" : "s"}, ${p.counts.openAlerts} open alert${p.counts.openAlerts === 1 ? "" : "s"}.` },
          ].map((c) => (
            <Link key={c.to} to={c.to} className="card block p-4 hover:bg-hover">
              <p className="font-semibold">{c.title}</p>
              <p className="mt-1 text-sm text-ink-2">{c.text}</p>
            </Link>
          ))}
        </div>
      </Section>

      <Section title="Contracts">
        {p.contracts.length === 0 ? (
          <EmptyState title="No contracts recorded">Contracts appear here after a release manifest that lists them is registered.</EmptyState>
        ) : (
          <Card className="!p-0">
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Chain</th>
                    <th>Address</th>
                    <th>Proxy</th>
                    <th>Runtime codehash</th>
                  </tr>
                </thead>
                <tbody>
                  {p.contracts.map((c) => (
                    <tr key={`${c.chainId}-${c.address}`}>
                      <td className="font-medium">{c.label}</td>
                      <td>{c.chainId}</td>
                      <td>
                        <Mono value={c.address} head={8} tail={6} />
                      </td>
                      <td>{c.proxyType ? `${c.proxyType} → ${shortAddress(c.implAddress)}` : "—"}</td>
                      <td>
                        <Mono value={c.runtimeCodehash ?? null} head={10} tail={6} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </Section>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Monitors">
          {p.monitors.length === 0 ? (
            <EmptyState
              title="Nothing is being watched"
              action={
                <Link className="btn btn-secondary btn-sm" to={`${base}/monitoring`}>
                  Add a monitor
                </Link>
              }
            />
          ) : (
            <ul className="space-y-2">
              {p.monitors.map((m) => (
                <li key={m.id} className="card flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{m.label || m.kind}</span> <Pill>{m.kind}</Pill>
                    <span className="mt-0.5 block text-ink-2">
                      chain {m.chainId} · {shortAddress(m.address)}
                    </span>
                  </span>
                  <StatusChip meta={monitorStatusMeta(m.status)} />
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Members">
          {p.members.length === 0 ? (
            <EmptyState title="No members listed" />
          ) : (
            <ul className="space-y-2">
              {p.members.map((m, i) => (
                <li key={m.userId ?? m.id ?? i} className="card flex items-center justify-between gap-2 p-3 text-sm">
                  <span className="min-w-0 truncate">{m.address ? shortAddress(m.address) : (m.displayName ?? m.userId ?? "member")}</span>
                  <Pill>{String(m.role)}</Pill>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

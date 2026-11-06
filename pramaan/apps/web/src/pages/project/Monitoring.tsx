import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { useState, type FormEvent } from "react";
import { isAddress } from "viem";
import { Btn, Card, EmptyState, ErrorPanel, Field, GatedButton, Mono, Notice, Pill, QueryView, Section, StatusChip } from "../../components/ui";
import { api } from "../../lib/client";
import { formatDateTime, relativeTime } from "../../lib/format";
import { UNSUPPORTED_REASON, useConfig, useGet } from "../../lib/hooks";
import { eventAssessmentMeta, monitorStatusMeta, severityMeta } from "../../lib/tone";
import { MONITOR_KINDS, type Alert, type Monitor, type MonitorEvent, type MonitorKind } from "../../lib/types";
import { useProject } from "./ProjectLayout";

const KIND_HELP: Record<MonitorKind, string> = {
  timelock: "PramaanTimelock: queued, executed and cancelled operations",
  resolver: "The ENSv2 resolver: changes to pramaan.record",
  registry: "The ENS registry entry for your name",
  proxy: "An upgradeable proxy: implementation changes",
  "upgrade-timelock": "A timelock that guards proxy upgrades",
};

function AddMonitor({ projectId, defaultChain }: { projectId: string; defaultChain: number | null }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<MonitorKind>("timelock");
  const [address, setAddress] = useState("");
  const [chainId, setChainId] = useState(defaultChain ? String(defaultChain) : "");
  const [rpcUrl, setRpcUrl] = useState("");
  const [label, setLabel] = useState("");
  const valid = isAddress(address.trim(), { strict: false });
  const add = useMutation({
    mutationFn: () =>
      api.post<Monitor>(`/v1/projects/${encodeURIComponent(projectId)}/monitors`, {
        kind,
        address: address.trim(),
        ...(chainId.trim() ? { chainId: Number(chainId) } : {}),
        ...(rpcUrl.trim() ? { rpcUrl: rpcUrl.trim() } : {}),
        ...(label.trim() ? { label: label.trim() } : {}),
      }),
    onSuccess: () => {
      setAddress("");
      setLabel("");
      void qc.invalidateQueries({ queryKey: ["monitors"] });
      void qc.invalidateQueries({ queryKey: ["project", projectId] });
    },
  });
  return (
    <Card>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Field label="What to watch" htmlFor="mon-kind" hint={KIND_HELP[kind]}>
          <select id="mon-kind" className="field" value={kind} onChange={(e) => setKind(e.target.value as MonitorKind)}>
            {MONITOR_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Contract address" htmlFor="mon-addr" hint={address && !valid ? "That is not a valid 20-byte address." : undefined}>
          <input id="mon-addr" className="field font-mono" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x…" spellCheck={false} aria-invalid={!!address && !valid} required />
        </Field>
        <Field label="Chain id" htmlFor="mon-chain" hint="Defaults to the project's chain.">
          <input id="mon-chain" className="field" inputMode="numeric" pattern="[0-9]*" value={chainId} onChange={(e) => setChainId(e.target.value)} />
        </Field>
        <Field label="RPC URL (optional)" htmlFor="mon-rpc" hint="Defaults to the project's RPC.">
          <input id="mon-rpc" className="field" type="url" value={rpcUrl} onChange={(e) => setRpcUrl(e.target.value)} />
        </Field>
        <Field label="Label (optional)" htmlFor="mon-label">
          <input id="mon-label" className="field" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} />
        </Field>
        <div className="flex items-end">
          <Btn type="submit" variant="primary" busy={add.isPending} disabled={!valid}>
            Add monitor
          </Btn>
        </div>
        {add.isError ? (
          <div className="sm:col-span-2">
            <ErrorPanel error={add.error} />
          </div>
        ) : null}
      </form>
    </Card>
  );
}

export function MonitoringPage() {
  const project = useProject();
  const qc = useQueryClient();
  const config = useConfig();
  const [alertFilter, setAlertFilter] = useState<"open" | "acked" | "all">("open");
  const [limit, setLimit] = useState(50);
  const monitors = useGet<Monitor[]>(["monitors", project.id], `/v1/projects/${encodeURIComponent(project.id)}/monitors`, { refetchInterval: 15_000 });
  const events = useGet<MonitorEvent[]>(["events", project.id, limit], `/v1/projects/${encodeURIComponent(project.id)}/events`, { query: { limit }, refetchInterval: 15_000 });
  const alerts = useGet<Alert[]>(["alerts", project.id, alertFilter], `/v1/projects/${encodeURIComponent(project.id)}/alerts`, {
    query: { status: alertFilter === "all" ? undefined : alertFilter },
    refetchInterval: 15_000,
  });
  const ack = useMutation({
    mutationFn: (id: string) => api.post(`/v1/alerts/${encodeURIComponent(id)}/ack`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["alerts", project.id] });
      void qc.invalidateQueries({ queryKey: ["project", project.id] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
  const telegram = useMutation({ mutationFn: () => api.post<unknown>(`/v1/projects/${encodeURIComponent(project.id)}/alerts/test-telegram`) });
  const telegramReason = config.isPending ? "Checking what this backend supports…" : config.data?.telegram ? null : UNSUPPORTED_REASON.telegram;

  return (
    <div>
      <Section title="Alerts" description="Raised by the chain monitor (source: monitor) and by the Chainlink CRE workflow (source: cre).">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <Field label="Show" htmlFor="alert-filter">
            <select id="alert-filter" className="field !w-auto" value={alertFilter} onChange={(e) => setAlertFilter(e.target.value as typeof alertFilter)}>
              <option value="open">Open</option>
              <option value="acked">Acknowledged</option>
              <option value="all">All</option>
            </select>
          </Field>
          <div className="flex flex-col items-end gap-1">
            <GatedButton variant="secondary" size="sm" busy={telegram.isPending} reason={telegramReason} onClick={() => telegram.mutate()}>
              <Send size={14} aria-hidden="true" /> Send a test Telegram message
            </GatedButton>
          </div>
        </div>
        {telegram.isSuccess ? <Notice tone="info" title="Test alert sent">Check the Telegram chat. The test also appears in the list below with source “test”.</Notice> : null}
        {telegram.isError ? <ErrorPanel error={telegram.error} /> : null}
        {ack.isError ? <ErrorPanel error={ack.error} /> : null}
        <QueryView query={alerts} isEmpty={(l) => l.length === 0} empty={<EmptyState title={alertFilter === "open" ? "No open alerts" : "No alerts here"}>Alerts appear when a monitor sees something that disagrees with the active release.</EmptyState>}>
          {(list) => (
            <ul className="space-y-2">
              {list.map((a) => {
                const open = (a.status ?? (a.ackedAt ? "acked" : "open")) === "open";
                return (
                  <li key={a.id} className="card p-3" data-tone={severityMeta(a.severity).tone}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusChip meta={severityMeta(a.severity)} />
                          <Pill>source: {a.source}</Pill>
                          {!open ? <Pill>acknowledged</Pill> : null}
                          <span className="text-xs text-ink-2" title={formatDateTime(a.createdAt)}>
                            {relativeTime(a.createdAt)}
                          </span>
                        </div>
                        <p className="mt-1 font-medium break-words">{a.title}</p>
                        {a.body ? <p className="text-sm text-ink-2 whitespace-pre-wrap break-words">{a.body}</p> : null}
                      </div>
                      {open ? (
                        <Btn size="sm" variant="secondary" busy={ack.isPending && ack.variables === a.id} onClick={() => ack.mutate(a.id)}>
                          Acknowledge
                        </Btn>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </QueryView>
      </Section>

      <Section title="Monitors">
        <QueryView query={monitors} isEmpty={(l) => l.length === 0} empty={<EmptyState title="Nothing is being watched yet">Add a monitor below to start recording events and raising alerts.</EmptyState>}>
          {(list) => (
            <Card className="!p-0">
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Monitor</th>
                      <th>Address</th>
                      <th>Chain</th>
                      <th>Status</th>
                      <th>Last block</th>
                      <th>Last checked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((m) => (
                      <tr key={m.id}>
                        <td>
                          <span className="font-medium">{m.label || m.kind}</span> <Pill>{m.kind}</Pill>
                        </td>
                        <td>
                          <Mono value={m.address} head={8} tail={6} />
                        </td>
                        <td>{m.chainId}</td>
                        <td>
                          <StatusChip meta={monitorStatusMeta(m.status)} />
                          {m.lastError ? <span className="mt-1 block max-w-[16rem] text-xs text-critical-ink break-words">{m.lastError}</span> : null}
                        </td>
                        <td className="tabular-nums">{m.lastBlock ?? "—"}</td>
                        <td title={m.lastCheckedAt ? formatDateTime(m.lastCheckedAt) : undefined}>{m.lastCheckedAt ? relativeTime(m.lastCheckedAt) : "never"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </QueryView>
        <h3 className="mt-5 mb-2 font-semibold">Add a monitor</h3>
        <AddMonitor projectId={project.id} defaultChain={project.chainId} />
      </Section>

      <Section
        title="Events"
        description="On-chain events the monitors recorded, each compared with the active release."
        actions={
          <Field label="Show last" htmlFor="ev-limit">
            <select id="ev-limit" className="field !w-auto" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              {[25, 50, 100, 200].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
        }
      >
        <QueryView query={events} isEmpty={(l) => l.length === 0} empty={<EmptyState title="No events recorded yet">Events show up once a monitor sees activity on its contract.</EmptyState>}>
          {(list) => (
            <ol className="relative space-y-2 border-l-2 border-line pl-4">
              {list.map((e) => {
                const meta = eventAssessmentMeta(e.assessment);
                return (
                  <li key={e.id} className="card p-3" data-tone={meta.tone}>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusChip meta={meta} />
                      <span className="font-medium">{e.eventName}</span>
                      {e.monitorLabel || e.monitorKind ? <Pill>{e.monitorLabel ?? e.monitorKind}</Pill> : null}
                      <span className="text-xs text-ink-2" title={formatDateTime(e.createdAt)}>
                        {relativeTime(e.createdAt)}
                      </span>
                    </div>
                    {e.detail ? <p className="mt-1 text-sm text-ink-2 break-words">{e.detail}</p> : null}
                    <p className="mt-1 text-xs text-muted">
                      chain {e.chainId} · block {String(e.blockNumber)} · tx <Mono value={e.txHash} head={10} tail={6} />
                    </p>
                  </li>
                );
              })}
            </ol>
          )}
        </QueryView>
      </Section>
    </div>
  );
}

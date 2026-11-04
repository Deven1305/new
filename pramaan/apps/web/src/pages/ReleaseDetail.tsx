import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink, RefreshCw } from "lucide-react";
import { useParams } from "react-router";
import { Btn, Card, CopyButton, ErrorPanel, Facts, GatedButton, Loading, Mono, Notice, PageHeader, Pill, Section, StatusChip, ToneChip } from "../components/ui";
import { api } from "../lib/client";
import { IPFS_GATEWAY_URL } from "../lib/config";
import { checkDigest, type DigestCheck } from "../lib/digest";
import { countdown, formatBytes, formatDateTime } from "../lib/format";
import { retryPolicy, UNSUPPORTED_REASON, useAuthMode, useConfig, useGet } from "../lib/hooks";
import { releaseStatusMeta, severityMeta, signatureStatusMeta } from "../lib/tone";
import type { ReleaseDetail } from "../lib/types";
import { useNow } from "../lib/useNow";

export function expectedPointer(tag: string, sha256: string): string {
  return `pramaan:v1:${tag}:${sha256}`;
}

export function ipfsUrl(cid: string, storage: Record<string, unknown> | null): string {
  const gw = storage && typeof storage["gateway"] === "string" && /^https?:\/\//.test(storage["gateway"]) ? storage["gateway"].replace(/\/+$/, "") : IPFS_GATEWAY_URL;
  return `${gw}/ipfs/${encodeURIComponent(cid)}`;
}

function ManifestViewer({ release }: { release: ReleaseDetail }) {
  const mode = useAuthMode();
  const q = useQuery({
    queryKey: ["release-manifest", release.id, mode],
    queryFn: async () => {
      const bytes = await api.get<Uint8Array>(`/v1/releases/${encodeURIComponent(release.id)}/manifest`, { responseType: "bytes" });
      const check: DigestCheck = await checkDigest(bytes, release.sha256);
      return { text: new TextDecoder().decode(bytes), bytes, check };
    },
    retry: retryPolicy,
  });
  const m = release.manifest;
  return (
    <Section title="Manifest" description="The canonical bytes the sha256 is computed over. Your browser re-hashes what the backend served.">
      {q.isPending ? <Loading label="Fetching manifest…" /> : null}
      {q.isError ? <ErrorPanel error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.isSuccess ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {q.data.check.status === "match" ? <ToneChip tone="good">Recomputed sha256 matches the release</ToneChip> : null}
            {q.data.check.status === "mismatch" ? <ToneChip tone="critical">Recomputed sha256 differs: {q.data.check.actual.slice(0, 16)}…</ToneChip> : null}
            {q.data.check.status === "unavailable" ? <ToneChip tone="unknown">Not re-hashed: {q.data.check.reason}</ToneChip> : null}
            <Pill>{formatBytes(q.data.bytes.byteLength)}</Pill>
            <Btn
              size="sm"
              variant="secondary"
              onClick={() => {
                const url = URL.createObjectURL(new Blob([q.data.bytes as BlobPart], { type: "application/json" }));
                const a = document.createElement("a");
                a.href = url;
                a.download = `pramaan-manifest-${release.sha256.slice(0, 12)}.json`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 2000);
              }}
            >
              <Download size={14} aria-hidden="true" /> Download
            </Btn>
          </div>
          {m ? (
            <Card>
              <Facts
                items={[
                  { label: "App", value: `${m.app.name} (${m.app.ensName})` },
                  { label: "Domain", value: m.app.domain },
                  { label: "Repository", value: <span className="break-all">{m.repo}</span> },
                  { label: "Commit", value: <Mono value={m.commit} head={12} tail={4} /> },
                  { label: "Built", value: formatDateTime(m.builtAt) },
                  { label: "Tools", value: m.tools.map((t) => `${t.name} ${t.version}`).join(", ") || "—" },
                ]}
              />
            </Card>
          ) : null}
          {m ? (
            <div className="grid gap-3 lg:grid-cols-2">
              <Card className="!p-0">
                <h3 className="px-4 pt-3 font-semibold">Files ({m.files.length})</h3>
                <div className="table-wrap max-h-72 overflow-y-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Path</th>
                        <th>sha256</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.files.map((f) => (
                        <tr key={f.path}>
                          <td className="break-all">
                            <code className="text-xs">{f.path}</code>
                          </td>
                          <td>
                            <Mono value={f.sha256} head={8} tail={4} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
              <div className="space-y-3">
                <Card className="!p-0">
                  <h3 className="px-4 pt-3 font-semibold">Contracts ({m.contracts.length})</h3>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Label</th>
                          <th>Chain</th>
                          <th>Address</th>
                          <th>Sourcify</th>
                        </tr>
                      </thead>
                      <tbody>
                        {m.contracts.map((c) => (
                          <tr key={`${c.chainId}-${c.address}`}>
                            <td>{c.label}</td>
                            <td>{c.chainId}</td>
                            <td>
                              <Mono value={c.address} head={8} tail={6} />
                            </td>
                            <td>{c.sourcify.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
                <Card>
                  <h3 className="font-semibold">Findings recorded ({m.findings.length})</h3>
                  {m.findings.length === 0 ? (
                    <p className="mt-1 text-sm text-ink-2">The manifest lists no findings.</p>
                  ) : (
                    <ul className="mt-1 space-y-1 text-sm">
                      {m.findings.map((f) => (
                        <li key={f.id} className="flex flex-wrap items-center gap-2">
                          <StatusChip meta={severityMeta(f.severity)} /> <span>{f.title ?? f.class}</span> <Pill>{f.status}</Pill>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
                <Card>
                  <h3 className="font-semibold">Declared third parties ({m.thirdParties.length})</h3>
                  {m.thirdParties.length === 0 ? (
                    <p className="mt-1 text-sm text-ink-2">The site declares none.</p>
                  ) : (
                    <ul className="mt-1 space-y-1 text-sm">
                      {m.thirdParties.map((t) => (
                        <li key={t.host}>
                          <code>{t.host}</code> · {t.purpose} {t.receivesAddress ? <ToneChip tone="warning">receives your address</ToneChip> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
            </div>
          ) : null}
          <details>
            <summary className="cursor-pointer text-sm text-ink-2">Canonical manifest bytes</summary>
            <pre className="code-block mt-2 max-h-96 overflow-auto p-3 text-xs whitespace-pre-wrap break-all">{q.data.text}</pre>
          </details>
        </div>
      ) : null}
    </Section>
  );
}

export function ReleaseDetailPage() {
  const { releaseId = "" } = useParams();
  const qc = useQueryClient();
  const q = useGet<ReleaseDetail>(["release", releaseId], `/v1/releases/${encodeURIComponent(releaseId)}`, { refetchInterval: 15_000 });
  const config = useConfig();
  const r = q.data;
  const eta = r?.eta ?? null;
  const now = useNow(1000, !!eta && r?.status === "queued");

  const act = useMutation({
    mutationFn: (action: "refresh" | "ipfs" | "queue" | "execute") => api.post<unknown>(`/v1/releases/${encodeURIComponent(releaseId)}/${action}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["release", releaseId] });
      void qc.invalidateQueries({ queryKey: ["releases"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  if (q.isPending) return <Loading label="Loading release…" />;
  if (q.isError) return <ErrorPanel error={q.error} onRetry={() => void q.refetch()} />;
  const rel = q.data;
  const cd = countdown(rel.eta, now);
  const cfgPending = config.isPending ? "Checking what this backend supports…" : null;
  const proposerReason = cfgPending ?? (config.data?.proposer ? null : UNSUPPORTED_REASON.proposer);
  const ipfsReason = cfgPending ?? (config.data?.ipfs ? null : UNSUPPORTED_REASON.ipfs);
  const queueReason = proposerReason ?? (rel.status === "draft" || rel.status === "signed" ? (rel.signatureStatus === "verified" ? null : "Only a release with a verified signature can be queued.") : "This release is already queued, active or closed.");
  const executeReason = proposerReason ?? (rel.status !== "queued" ? "Only a queued release can be executed." : cd && !cd.passed ? `The timelock delay has not elapsed (${cd.text} left).` : null);
  const refreshReason = proposerReason;
  const pointerOk = rel.pointer === expectedPointer(rel.tag, rel.sha256);

  return (
    <div>
      <PageHeader
        back={{ to: `/projects/${rel.projectId}/releases`, label: "Releases" }}
        title={
          <span className="flex flex-wrap items-center gap-2">
            Release {rel.tag}
            <StatusChip meta={releaseStatusMeta(rel.status)} />
            <StatusChip meta={signatureStatusMeta(rel.signatureStatus)} />
          </span>
        }
        subtitle={releaseStatusMeta(rel.status).description}
      />

      {rel.signatureStatus !== "verified" ? (
        <Notice tone={rel.signatureStatus === "invalid" ? "critical" : "unknown"} title={rel.signatureStatus === "invalid" ? "The signature does not verify" : "This release is not signed"} className="mb-4">
          {rel.signatureDetail ?? "The extension will not treat an unsigned or invalid release as verified."}
        </Notice>
      ) : null}

      <Section title="Identity">
        <Card>
          <Facts
            items={[
              { label: "Manifest sha256", value: <Mono value={rel.sha256} full /> },
              {
                label: "ENS record value (pointer)",
                value: (
                  <span className="block">
                    <code className="break-all text-[0.8125rem]">{rel.pointer}</code> <CopyButton value={rel.pointer} />
                    <span className="mt-0.5 block text-xs text-ink-2">{pointerOk ? "Matches the tag and sha256 above." : "Does not match pramaan:v1:<tag>:<sha256> for this release."}</span>
                  </span>
                ),
              },
              {
                label: "IPFS CID",
                value: rel.cid ? (
                  <span className="flex flex-wrap items-center gap-1">
                    <Mono value={rel.cid} head={12} tail={6} />
                    <a className="link inline-flex items-center gap-1 text-sm" href={ipfsUrl(rel.cid, rel.storage)} target="_blank" rel="noreferrer">
                      open in gateway <ExternalLink size={12} aria-hidden="true" />
                    </a>
                  </span>
                ) : (
                  "Not pinned"
                ),
              },
              { label: "Registered", value: formatDateTime(rel.createdAt) },
              { label: "Commit", value: rel.commitSha ? <Mono value={rel.commitSha} head={12} tail={4} /> : "—" },
            ]}
          />
        </Card>
      </Section>

      <Section title="Timelock" description="PramaanTimelock holds the pointer for a delay before it can become the ENS record, so a stolen key cannot change it instantly.">
        <Card>
          <Facts
            items={[
              { label: "Operation id", value: rel.timelockOpId ? <Mono value={rel.timelockOpId} head={12} tail={6} /> : "Not queued" },
              { label: "Earliest execution (ETA)", value: rel.eta ? formatDateTime(rel.eta) : "—" },
              {
                label: "Countdown",
                value:
                  rel.status === "queued" && cd ? (
                    cd.passed ? (
                      <ToneChip tone="info">ETA reached: can be executed now</ToneChip>
                    ) : (
                      <span className="text-lg font-semibold tabular-nums" aria-live="off">
                        {cd.text}
                      </span>
                    )
                  ) : (
                    "—"
                  ),
              },
              { label: "Queue transaction", value: rel.queueTx ? <Mono value={rel.queueTx} head={12} tail={6} /> : "—" },
              { label: "Execute transaction", value: rel.executeTx ? <Mono value={rel.executeTx} head={12} tail={6} /> : "—" },
              { label: "Storage", value: rel.storage ? <code className="text-xs break-all">{JSON.stringify(rel.storage)}</code> : "—" },
            ]}
          />
          <div className="mt-4 flex flex-wrap items-start gap-3">
            <GatedButton size="sm" variant="secondary" busy={act.isPending && act.variables === "refresh"} reason={refreshReason} onClick={() => act.mutate("refresh")}>
              <RefreshCw size={14} aria-hidden="true" /> Refresh from chain
            </GatedButton>
            <GatedButton size="sm" variant="secondary" busy={act.isPending && act.variables === "ipfs"} reason={ipfsReason ?? (rel.cid ? "Already pinned." : null)} onClick={() => act.mutate("ipfs")}>
              Pin to IPFS
            </GatedButton>
            <GatedButton size="sm" variant="primary" busy={act.isPending && act.variables === "queue"} reason={queueReason} onClick={() => act.mutate("queue")}>
              Queue in timelock
            </GatedButton>
            <GatedButton size="sm" variant="primary" busy={act.isPending && act.variables === "execute"} reason={executeReason} onClick={() => act.mutate("execute")}>
              Execute
            </GatedButton>
          </div>
          <p className="mt-2 text-xs text-muted">Queue and execute are signed by the backend&apos;s proposer key. Without one, run them from the CLI: <code>pnpm pramaan publish queue</code> and <code>pnpm ens:execute</code>.</p>
          {act.isError ? (
            <div className="mt-3">
              <ErrorPanel error={act.error} />
            </div>
          ) : null}
          {act.isSuccess ? (
            <p className="mt-3 text-sm text-ink-2" role="status">
              Done. The release was refreshed from the backend.
            </p>
          ) : null}
        </Card>
      </Section>

      <ManifestViewer release={rel} />
    </div>
  );
}

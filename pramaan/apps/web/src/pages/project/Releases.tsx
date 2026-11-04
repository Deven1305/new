import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Btn, Card, EmptyState, ErrorPanel, Field, Mono, Notice, QueryView, Section, StatusChip } from "../../components/ui";
import { api } from "../../lib/client";
import { relativeTime, formatDateTime } from "../../lib/format";
import { useGet } from "../../lib/hooks";
import { releaseStatusMeta, signatureStatusMeta } from "../../lib/tone";
import type { Release } from "../../lib/types";
import { useProject } from "./ProjectLayout";

/** Parses the register form's text fields into the request body. Throws a readable Error on bad JSON. */
export function buildReleaseBody(manifestText: string, signatureText: string, signerSpki: string): { manifest: unknown; signature?: unknown; signerSpki?: string } {
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    throw new Error("The manifest is not valid JSON.");
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("The manifest must be a JSON object.");
  const body: { manifest: unknown; signature?: unknown; signerSpki?: string } = { manifest };
  const sig = signatureText.trim();
  if (sig) {
    try {
      body.signature = JSON.parse(sig);
    } catch {
      body.signature = sig;
    }
  }
  if (signerSpki.trim()) body.signerSpki = signerSpki.trim();
  return body;
}

function readFile(file: File, set: (text: string) => void) {
  void file.text().then(set);
}

export function ReleasesPage() {
  const project = useProject();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useGet<Release[]>(["releases", project.id], `/v1/projects/${encodeURIComponent(project.id)}/releases`, { refetchInterval: 15_000 });
  const [manifest, setManifest] = useState("");
  const [signature, setSignature] = useState("");
  const [spki, setSpki] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const register = useMutation({
    mutationFn: () => api.post<Release>(`/v1/projects/${encodeURIComponent(project.id)}/releases`, buildReleaseBody(manifest, signature, spki)),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["releases"] });
      void qc.invalidateQueries({ queryKey: ["project", project.id] });
      navigate(`/releases/${r.id}`);
    },
  });
  const onFile = (set: (t: string) => void) => (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) readFile(f, set);
  };

  return (
    <div>
      <Section title="Releases" description="A release is a canonical manifest, its signature, and where its pointer is in the timelock. The ENS record only changes after the timelock delay.">
        <QueryView
          query={q}
          isEmpty={(l) => l.length === 0}
          empty={<EmptyState title="No releases registered">Register a manifest below. Build one with <code>pnpm pramaan manifest</code> and sign it with <code>pnpm pramaan sign</code>.</EmptyState>}
        >
          {(list) => (
            <Card className="!p-0">
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Tag</th>
                      <th>Status</th>
                      <th>Signature</th>
                      <th>Manifest sha256</th>
                      <th>Registered</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <Link className="link font-medium" to={`/releases/${r.id}`}>
                            {r.tag}
                          </Link>
                        </td>
                        <td>
                          <StatusChip meta={releaseStatusMeta(r.status)} />
                        </td>
                        <td>
                          <StatusChip meta={signatureStatusMeta(r.signatureStatus)} />
                        </td>
                        <td>
                          <Mono value={r.sha256} head={10} tail={6} />
                        </td>
                        <td title={formatDateTime(r.createdAt)}>{relativeTime(r.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </QueryView>
      </Section>

      <Section title="Register a release" description="The backend canonicalizes the manifest, hashes it and checks the DSSE signature. An invalid manifest or signature is rejected.">
        <Card>
          <form
            className="space-y-3"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              setLocalError(null);
              try {
                buildReleaseBody(manifest, signature, spki);
              } catch (err) {
                setLocalError((err as Error).message);
                return;
              }
              register.mutate();
            }}
          >
            <Field label="Manifest (JSON)" htmlFor="rel-manifest" hint="Schema pramaan.manifest/v1, as written by `pnpm pramaan manifest`.">
              <textarea id="rel-manifest" className="field" rows={8} value={manifest} onChange={(e) => setManifest(e.target.value)} spellCheck={false} required />
            </Field>
            <input type="file" accept=".json,application/json" aria-label="Load manifest from a file" className="text-sm" onChange={onFile(setManifest)} />
            <Field label="Signature (DSSE envelope JSON, optional)" htmlFor="rel-sig" hint="Leave empty to register an unsigned draft.">
              <textarea id="rel-sig" className="field" rows={4} value={signature} onChange={(e) => setSignature(e.target.value)} spellCheck={false} />
            </Field>
            <input type="file" accept=".json,application/json" aria-label="Load signature from a file" className="text-sm" onChange={onFile(setSignature)} />
            <Field label="Signer public key (SPKI, optional)" htmlFor="rel-spki" hint="Base64 or hex SPKI. Needed when the signature is not tied to a key the backend already knows.">
              <input id="rel-spki" className="field font-mono" value={spki} onChange={(e) => setSpki(e.target.value)} spellCheck={false} />
            </Field>
            <Btn type="submit" variant="primary" busy={register.isPending} disabled={!manifest.trim()}>
              Register release
            </Btn>
            {localError ? <Notice tone="critical" title={localError} /> : null}
            {register.isError && !localError ? <ErrorPanel error={register.error} /> : null}
          </form>
        </Card>
      </Section>
    </div>
  );
}

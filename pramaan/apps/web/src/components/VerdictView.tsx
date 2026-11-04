import { Card, Notice, StatusChip, ToneChip, ToneIcon } from "./ui";
import { checkStatusTone, TONE_LABEL, type Tone } from "../lib/tone";
import type { SiteVerdictView, VerdictRowView } from "../lib/verdict";

/** The four rows every Pramaan verdict has, in the extension's order. */
export const VERDICT_ROWS: { id: string; title: string; missing: string }[] = [
  { id: "site", title: "Website and release", missing: "The backend did not report on the website's files." },
  { id: "contract", title: "Contracts", missing: "Contracts are checked against the signed release when a page talks to one. This check did not include any." },
  { id: "action", title: "Wallet request", missing: "Only the extension sees the actual transaction or signature request. Use the decoder below for a pasted one." },
  { id: "privacy", title: "Privacy", missing: "Only the extension can observe which third parties receive your address while you browse." },
];

export interface DisplayRow extends VerdictRowView {
  evaluated: boolean;
}

/** Always four rows; one that was not evaluated is grey and says why. It is never green. */
export function fourRows(view: SiteVerdictView): DisplayRow[] {
  return VERDICT_ROWS.map((def) => {
    const found = view.rows.find((r) => r.id === def.id);
    if (found) return { ...found, title: def.title, evaluated: true };
    return { id: def.id, title: def.title, tone: "unknown" as Tone, statusLabel: "Not checked here", summary: def.missing, reasons: [], blocking: false, evaluated: false };
  });
}

const OVERALL: Record<Tone, { title: string; text: string }> = {
  good: { title: "Every check that ran passed", text: "That is not a guarantee the site is safe. It means the checks listed below succeeded." },
  warning: { title: "Some checks need attention", text: "Read the rows below before you sign anything." },
  serious: { title: "A serious problem was found", text: "Read the rows below before you sign anything." },
  critical: { title: "A check failed", text: "Do not sign anything on this site until the problem is explained." },
  unknown: { title: "Could not be verified", text: "Unknown is not safe. Nothing here is shown as passed." },
  info: { title: "Information", text: "" },
  neutral: { title: "No result", text: "" },
};

export function VerdictView({ view }: { view: SiteVerdictView }) {
  const rows = fourRows(view);
  const overall = OVERALL[view.overall];
  return (
    <div className="space-y-4">
      <div className="tone-wash tone-bar rounded-lg px-4 py-3" data-tone={view.overall} role="status">
        <p className="flex items-center gap-2 text-lg font-semibold">
          <span className="tone-ink">
            <ToneIcon tone={view.overall} size={20} />
          </span>
          {overall.title}
        </p>
        {overall.text ? <p className="mt-0.5 text-sm text-ink-2">{overall.text}</p> : null}
        {view.blocked ? <p className="mt-1 text-sm font-semibold">Signing is blocked by the extension for this result.</p> : null}
        <p className="mt-1 text-xs text-muted">Overall colour: {TONE_LABEL[view.overall]}</p>
      </div>

      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="card tone-bar p-3" data-tone={r.tone}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">{r.title}</h3>
              <ToneChip tone={r.tone}>{r.statusLabel}</ToneChip>
            </div>
            {r.summary ? <p className="mt-1 text-sm break-words">{r.summary}</p> : null}
            {r.reasons.map((reason, i) => (
              <p key={i} className="mt-0.5 text-sm text-ink-2 break-words">
                {reason}
              </p>
            ))}
            {r.blocking ? <p className="mt-1 text-sm font-semibold text-critical-ink">Blocks signing</p> : null}
          </li>
        ))}
      </ul>

      {view.facts.length > 0 ? (
        <Card>
          <h3 className="mb-2 font-semibold">What was read</h3>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {view.facts.map((f) => (
              <div key={f.label} className="min-w-0">
                <dt className="text-xs font-medium text-muted">{f.label}</dt>
                <dd className={`mt-0.5 text-sm break-all ${f.mono ? "font-mono" : ""}`}>{f.value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      ) : null}

      {view.checks.length > 0 ? (
        <Card>
          <h3 className="mb-2 font-semibold">Trust chain</h3>
          <ul className="space-y-1.5 text-sm">
            {view.checks.map((c, i) => (
              <li key={`${c.id}-${i}`} className="flex flex-wrap items-start gap-2">
                <StatusChip meta={{ tone: checkStatusTone(c.status), label: c.status === "skip" ? "Skipped" : c.status === "pass" ? "Pass" : c.status === "warn" ? "Warn" : c.status === "fail" ? "Fail" : c.status }} />
                <span className="min-w-0 flex-1">
                  <code>{c.id}</code>
                  {c.detail ? <span className="block text-ink-2 break-words">{c.detail}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {view.rows.length === 0 ? (
        <Notice tone="unknown" title="The backend returned no verdict rows">
          Nothing was verified. This is shown as unknown, not as a pass.
        </Notice>
      ) : null}
    </div>
  );
}

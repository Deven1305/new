import type { ReactNode } from "react";
import { compactNumber } from "../lib/format";
import type { Tone } from "../lib/tone";
import { ToneIcon } from "./ui";

/** Stat tile: sentence-case label, compact value, optional context line. A tone is shown only when it means something. */
export function StatTile({ label, value, note, tone, to }: { label: string; value: number | null | undefined; note?: ReactNode; tone?: Tone; to?: ReactNode }) {
  return (
    <div className={`card p-4 ${tone ? "tone-bar" : ""}`} data-tone={tone}>
      <p className="text-xs font-medium text-ink-2">{label}</p>
      <p className="mt-1 flex items-center gap-2 text-3xl font-semibold tabular-nums tracking-tight" title={value === null || value === undefined ? undefined : String(value)}>
        {compactNumber(value)}
        {tone && value ? (
          <span className="tone-ink">
            <ToneIcon tone={tone} size={18} />
          </span>
        ) : null}
      </p>
      {note ? <p className="mt-0.5 text-xs text-ink-2">{note}</p> : null}
      {to}
    </div>
  );
}

export interface BarPart {
  id: string;
  label: string;
  value: number;
  tone: Tone;
  /** Diagonal texture so two grey parts stay distinguishable without colour. */
  hatch?: boolean;
}

const HATCH = "repeating-linear-gradient(135deg, transparent 0 3px, color-mix(in oklab, var(--surface) 70%, transparent) 3px 5px)";

function swatchStyle(p: BarPart) {
  return { background: p.tone === "neutral" ? "var(--line-strong)" : `var(--${p.tone})`, backgroundImage: p.hatch ? HATCH : undefined } as const;
}

/** One whole split into parts (widths proportional, 2px gaps, zero parts draw nothing) with a legend that carries every number. */
export function SegmentedBar({ title, parts, emptyText }: { title: string; parts: BarPart[]; emptyText: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const summary = parts.map((p) => `${p.label} ${p.value}`).join(", ");
  return (
    <figure className="card p-4" aria-label={`${title}: ${summary}`}>
      <figcaption className="text-sm font-semibold">
        {title} <span className="font-normal text-ink-2">· {compactNumber(total)} total</span>
      </figcaption>
      {total === 0 ? (
        <p className="mt-3 text-sm text-ink-2">{emptyText}</p>
      ) : (
        <div className="mt-3 flex h-7 w-full gap-0.5" role="img" aria-label={summary}>
          {parts
            .filter((p) => p.value > 0)
            .map((p) => (
              <div key={p.id} className="h-full rounded" style={{ ...swatchStyle(p), flexGrow: p.value, flexBasis: 0, minWidth: 6 }} title={`${p.label}: ${p.value} (${Math.round((p.value / total) * 100)}%)`} />
            ))}
        </div>
      )}
      <ul className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        {parts.map((p) => (
          <li key={p.id} className="flex items-center gap-2">
            <span aria-hidden="true" className="inline-block size-3 flex-none rounded-sm" style={swatchStyle(p)} />
            <span className="min-w-0 flex-1 truncate">{p.label}</span>
            <span className="tabular-nums font-medium">{p.value.toLocaleString("en-US")}</span>
            <span className="w-10 text-right text-xs tabular-nums text-muted">{total ? `${Math.round((p.value / total) * 100)}%` : "—"}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

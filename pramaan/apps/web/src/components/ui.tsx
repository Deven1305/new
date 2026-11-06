import type { UseQueryResult } from "@tanstack/react-query";
import { CircleCheck, CircleHelp, CircleX, Copy, Check, Info, LoaderCircle, Minus, OctagonAlert, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router";
import { describeError, isApiError } from "../lib/api";
import { API_BASE_URL } from "../lib/config";
import { shortHash } from "../lib/format";
import { TONE_LABEL, type StatusMeta, type Tone } from "../lib/tone";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

const TONE_ICON: Record<Tone, typeof Info> = {
  good: CircleCheck,
  warning: TriangleAlert,
  serious: OctagonAlert,
  critical: CircleX,
  unknown: CircleHelp,
  info: Info,
  neutral: Minus,
};

export function ToneIcon({ tone, size = 14 }: { tone: Tone; size?: number }) {
  const Icon = TONE_ICON[tone];
  return <Icon size={size} aria-hidden="true" strokeWidth={2.25} />;
}

/** Status chip: colour + icon + text, never colour alone. */
export function StatusChip({ meta, label, title }: { meta: StatusMeta; label?: string; title?: string }) {
  return (
    <span className="chip" data-tone={meta.tone} title={title ?? meta.description ?? TONE_LABEL[meta.tone]}>
      <ToneIcon tone={meta.tone} />
      <span className="truncate">{label ?? meta.label}</span>
    </span>
  );
}

export function ToneChip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="chip" data-tone={tone}>
      <ToneIcon tone={tone} />
      <span className="truncate">{children}</span>
    </span>
  );
}

export function Spinner({ size = 16, label }: { size?: number; label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-ink-2">
      <LoaderCircle size={size} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
      {label ? <span className="text-sm">{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-12" aria-busy="true">
      <Spinner size={20} label={label} />
    </div>
  );
}

export function Notice({ tone = "info", title, children, className }: { tone?: Tone; title?: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cx("tone-wash tone-bar rounded-lg px-3.5 py-3 text-sm", className)} data-tone={tone} role={tone === "critical" || tone === "serious" ? "alert" : "note"}>
      <div className="flex items-start gap-2.5">
        <span className="tone-ink mt-0.5 flex-none">
          <ToneIcon tone={tone} size={16} />
        </span>
        <div className="min-w-0 flex-1">
          {title ? <p className="font-semibold">{title}</p> : null}
          {children ? <div className={cx("text-ink-2", title && "mt-0.5")}>{children}</div> : null}
        </div>
      </div>
    </div>
  );
}

export function ErrorPanel({ error, onRetry, title }: { error: unknown; onRetry?: () => void; title?: string }) {
  const d = describeError(error, API_BASE_URL);
  const needsSignIn = isApiError(error) && error.kind === "unauthorized";
  return (
    <div className="tone-wash tone-bar rounded-lg px-4 py-3" data-tone={needsSignIn ? "warning" : "critical"} role="alert">
      <p className="text-sm font-semibold">{title ?? d.title}</p>
      <p className="mt-0.5 text-sm text-ink-2 break-words">{d.detail}</p>
      {d.hint ? <p className="mt-1 text-sm text-ink-2">{d.hint}</p> : null}
      <div className="mt-2.5 flex flex-wrap gap-2">
        {needsSignIn ? (
          <Link to="/signin" className="btn btn-primary btn-sm">
            Sign in
          </Link>
        ) : null}
        {onRetry ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong px-4 py-8 text-center">
      <p className="font-semibold">{title}</p>
      {children ? <div className="mx-auto mt-1 max-w-prose text-sm text-ink-2">{children}</div> : null}
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** Renders the loading, error, empty and data states of a query. */
export function QueryView<T>({
  query,
  children,
  isEmpty,
  empty,
  loadingLabel,
}: {
  query: UseQueryResult<T, Error>;
  children: (data: T) => ReactNode;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  loadingLabel?: string;
}) {
  if (query.isPending) return <Loading label={loadingLabel} />;
  if (query.isError) return <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />;
  if (isEmpty?.(query.data)) return <>{empty}</>;
  return <>{children(query.data)}</>;
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <header className="mb-5">
      {back ? (
        <Link to={back.to} className="link mb-1 inline-block text-sm">
          ← {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight break-words">{title}</h1>
          {subtitle ? <div className="mt-1 text-sm text-ink-2">{subtitle}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function Section({ title, description, actions, children, id }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; id?: string }) {
  const headingId = useId();
  return (
    <section className="mb-6" aria-labelledby={headingId} id={id}>
      <div className="mb-2.5 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id={headingId} className="text-lg font-semibold">
            {title}
          </h2>
          {description ? <p className="text-sm text-ink-2">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Card({ children, className, as: Tag = "div" }: { children: ReactNode; className?: string; as?: "div" | "li" | "article" }) {
  return <Tag className={cx("card p-4", className)}>{children}</Tag>;
}

export function Field({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Btn({
  variant = "secondary",
  size,
  busy,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm"; busy?: boolean }) {
  return (
    <button type="button" {...rest} disabled={rest.disabled || busy} aria-busy={busy || undefined} className={cx("btn", `btn-${variant}`, size === "sm" && "btn-sm", className)}>
      {busy ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

/** A button that may be unavailable. The reason is printed beside it, never only in a tooltip. */
export function GatedButton({
  reason,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm"; busy?: boolean; reason?: string | null }) {
  const id = useId();
  return (
    <div className="inline-flex max-w-full flex-col items-start gap-1">
      <Btn {...props} disabled={props.disabled || !!reason} aria-describedby={reason ? id : undefined}>
        {children}
      </Btn>
      {reason ? (
        <p id={id} className="max-w-xs text-xs text-muted">
          {reason}
        </p>
      ) : null}
    </div>
  );
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm !min-h-7 !px-1.5"
      aria-label={done ? "Copied" : `${label} to clipboard`}
      title={label}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(value)
          .then(() => {
            setDone(true);
            timer.current = setTimeout(() => setDone(false), 1500);
          })
          .catch(() => undefined);
      }}
    >
      {done ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
    </button>
  );
}

/** A hash / address / id in monospace, shortened on screen but complete for copy and assistive tech. */
export function Mono({ value, head = 10, tail = 6, copy = true, full = false }: { value: string | null | undefined; head?: number; tail?: number; copy?: boolean; full?: boolean }) {
  if (!value) return <span className="text-muted">—</span>;
  return (
    <span className="inline-flex max-w-full items-center gap-0.5 align-middle">
      <code className="min-w-0 text-[0.8125rem] break-all" title={value}>
        {full ? value : shortHash(value, head, tail)}
      </code>
      {copy ? <CopyButton value={value} /> : null}
    </span>
  );
}

export function Facts({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-xs font-medium text-muted">{it.label}</dt>
          <dd className="mt-0.5 text-sm break-words">{it.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: ReactNode; lang?: string }[]; value: T; onChange: (id: T) => void; label: string }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  return (
    <div role="tablist" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-lg border border-line-strong bg-inset p-0.5">
      {tabs.map((t, i) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => void (refs.current[t.id] = el)}
            type="button"
            role="tab"
            lang={t.lang}
            id={`tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`panel-${t.id}`}
            tabIndex={selected ? 0 : -1}
            className={cx("rounded-md px-3 py-1 text-sm font-medium whitespace-nowrap", selected ? "bg-surface shadow-sm text-ink" : "text-ink-2 hover:text-ink")}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => {
              const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
              if (!dir) return;
              const next = tabs[(i + dir + tabs.length) % tabs.length]!;
              onChange(next.id);
              refs.current[next.id]?.focus();
              e.preventDefault();
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function Pill({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center rounded-full border border-line bg-inset px-2 py-0.5 text-xs font-medium text-ink-2">{children}</span>;
}

export function shortHash(value: string | null | undefined, head = 10, tail = 6): string {
  if (!value) return "—";
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function shortAddress(value: string | null | undefined): string {
  if (!value) return "—";
  return /^0x[0-9a-fA-F]{40}$/.test(value) ? `${value.slice(0, 6)}…${value.slice(-4)}` : shortHash(value);
}

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDateTime(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatTime(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function relativeTime(value: string | number | Date | null | undefined, now: number = Date.now()): string {
  const d = toDate(value);
  if (!d) return "—";
  const s = Math.round((d.getTime() - now) / 1000);
  const abs = Math.abs(s);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (abs < 45) return rtf.format(s, "second");
  if (abs < 45 * 60) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 22 * 3600) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
}

/** "1 h 02 m 05 s" style duration from milliseconds. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total} s`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} m ${String(s).padStart(2, "0")} s`;
  return `${m} m ${String(s).padStart(2, "0")} s`;
}

export function durationBetween(start: string | null | undefined, end: string | null | undefined, now: number = Date.now()): number | null {
  const a = toDate(start);
  if (!a) return null;
  const b = toDate(end);
  return (b ? b.getTime() : now) - a.getTime();
}

/** Countdown parts until a target time (all zero once it has passed). */
export function countdown(target: string | number | Date | null | undefined, now: number = Date.now()): { remainingMs: number; passed: boolean; text: string } | null {
  const d = toDate(target);
  if (!d) return null;
  const remainingMs = Math.max(0, d.getTime() - now);
  const passed = remainingMs === 0;
  const total = Math.ceil(remainingMs / 1000);
  const days = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const text = days > 0 ? `${days} d ${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;
  return { remainingMs, passed, text };
}

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Stat-tile values: 1,284 / 12.9K / 4.2M. */
export function compactNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (Math.abs(n) < 10_000) return n.toLocaleString("en-US");
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function sourceLabel(source: { type: string; [k: string]: unknown } | null | undefined): string {
  if (!source) return "—";
  switch (source.type) {
    case "example":
      return `example: ${String(source["name"] ?? "?")}`;
    case "github":
      return `${String(source["url"] ?? "?")}${source["ref"] ? ` @ ${String(source["ref"])}` : ""}`;
    case "upload":
      return `upload ${shortHash(String(source["uploadId"] ?? ""), 8, 4)}`;
    case "finding":
      return `re-prove finding ${shortHash(String(source["findingId"] ?? ""), 8, 4)}`;
    default:
      return source.type;
  }
}

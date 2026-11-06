import { useMemo } from "react";
import { diffStats, parseUnifiedDiff } from "../lib/diff";
import { tokenizeLines } from "../lib/highlight";
import { CopyButton } from "./ui";

/** Read-only source view. Tokens are rendered as text nodes, never as HTML. */
export function CodeView({ source, label, maxHeight = "28rem" }: { source: string; label: string; maxHeight?: string }) {
  const lines = useMemo(() => tokenizeLines(source), [source]);
  return (
    <div className="code-block relative">
      <div className="absolute top-1 right-1 z-10">
        <CopyButton value={source} label="Copy code" />
      </div>
      <pre className="overflow-auto py-2" style={{ maxHeight }} tabIndex={0} aria-label={label}>
        <code>
          {lines.map((tokens, i) => (
            <span key={i} className="flex">
              <span aria-hidden="true" className="w-10 flex-none select-none pr-2 text-right text-muted">
                {i + 1}
              </span>
              <span className="min-w-0 pr-8 whitespace-pre">
                {tokens.length === 0 ? "​" : tokens.map((t, j) => (t.kind === "plain" ? t.text : <span key={j} className={`tok-${t.kind}`}>{t.text}</span>))}
              </span>
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

/** Unified diff viewer with old/new line numbers; additions and deletions carry a +/− sign as well as a tint. */
export function DiffView({ diff }: { diff: string }) {
  const files = useMemo(() => parseUnifiedDiff(diff), [diff]);
  if (files.length === 0 || files.every((f) => f.hunks.length === 0)) {
    return (
      <div>
        <p className="mb-1 text-xs text-muted">This diff could not be parsed; showing it as plain text.</p>
        <pre className="code-block max-h-96 overflow-auto p-3 text-xs whitespace-pre-wrap">{diff}</pre>
      </div>
    );
  }
  const total = diffStats(files);
  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-2">
        {files.length} {files.length === 1 ? "file" : "files"} changed, <span className="text-good-ink">+{total.additions}</span> <span className="text-critical-ink">−{total.deletions}</span>
      </p>
      {files.map((f, fi) => (
        <div key={fi} className="code-block overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-3 py-1.5 text-xs">
            <code className="break-all font-semibold">{f.newPath ?? f.oldPath ?? "(unnamed file)"}</code>
            <span className="text-ink-2">
              +{f.additions} −{f.deletions}
            </span>
          </div>
          <div className="overflow-x-auto" tabIndex={0} aria-label={`Diff of ${f.newPath ?? f.oldPath ?? "file"}`}>
            <table className="w-full border-collapse text-xs">
              <tbody>
                {f.hunks.map((h, hi) => (
                  <HunkRows key={hi} hunk={h} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function HunkRows({ hunk }: { hunk: ReturnType<typeof parseUnifiedDiff>[number]["hunks"][number] }) {
  return (
    <>
      <tr>
        <td colSpan={4} className="bg-hover px-3 py-0.5 text-muted">
          {hunk.header}
        </td>
      </tr>
      {hunk.lines.map((l, i) => {
        const sign = l.type === "add" ? "+" : l.type === "del" ? "−" : l.type === "note" ? "\\" : " ";
        return (
          <tr key={i} className={l.type === "add" ? "diff-add" : l.type === "del" ? "diff-del" : undefined}>
            <td className="w-10 min-w-10 select-none px-1 text-right text-muted tabular-nums">{l.oldLine ?? ""}</td>
            <td className="w-10 min-w-10 select-none px-1 text-right text-muted tabular-nums">{l.newLine ?? ""}</td>
            <td className="w-5 select-none px-1 text-center font-bold" aria-label={l.type === "add" ? "added" : l.type === "del" ? "removed" : undefined}>
              {sign}
            </td>
            <td className="whitespace-pre pr-3">{l.text || "​"}</td>
          </tr>
        );
      })}
    </>
  );
}

/**
 * Unified diff parser for fix proposals. Handles `git diff` output and jsdiff's createTwoFilesPatch output
 * ("Index:" / "====" separator lines, tab-suffixed file names), several files, CRLF line endings and
 * "\ No newline at end of file" markers.
 */

export type DiffLineType = "add" | "del" | "context" | "note";

export interface DiffLine {
  type: DiffLineType;
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  section: string;
  lines: DiffLine[];
}

export interface DiffFile {
  oldPath: string | null;
  newPath: string | null;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

function cleanPath(raw: string): string | null {
  // "a/src/Vault.sol\t2024-01-01 ..." → "src/Vault.sol"; "/dev/null" → null
  const p = raw.split("\t")[0]!.trim();
  if (!p || p === "/dev/null") return null;
  return p.replace(/^[ab]\//, "");
}

export function parseUnifiedDiff(input: string): DiffFile[] {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  let oldLeft = 0;
  let newLeft = 0;

  const newFile = (): DiffFile => {
    const f: DiffFile = { oldPath: null, newPath: null, hunks: [], additions: 0, deletions: 0 };
    files.push(f);
    return f;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const inHunk = hunk !== null && (oldLeft > 0 || newLeft > 0);

    if (inHunk && hunk && file) {
      const marker = line[0];
      if (marker === "+" ) {
        hunk.lines.push({ type: "add", text: line.slice(1), oldLine: null, newLine: newNo++ });
        file.additions++;
        newLeft--;
        continue;
      }
      if (marker === "-") {
        hunk.lines.push({ type: "del", text: line.slice(1), oldLine: oldNo++, newLine: null });
        file.deletions++;
        oldLeft--;
        continue;
      }
      if (marker === " " || line === "") {
        hunk.lines.push({ type: "context", text: line.slice(1), oldLine: oldNo++, newLine: newNo++ });
        oldLeft--;
        newLeft--;
        continue;
      }
      if (marker === "\\") {
        hunk.lines.push({ type: "note", text: line.slice(1).trim(), oldLine: null, newLine: null });
        continue;
      }
      // Anything else ends the hunk early (malformed counts); fall through to header handling.
      oldLeft = 0;
      newLeft = 0;
    }

    if (line.startsWith("\\") && hunk) {
      hunk.lines.push({ type: "note", text: line.slice(1).trim(), oldLine: null, newLine: null });
      continue;
    }
    if (line.startsWith("diff --git ")) {
      file = newFile();
      hunk = null;
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      if (m) {
        file.oldPath = m[1]!;
        file.newPath = m[2]!;
      }
      continue;
    }
    if (line.startsWith("Index: ")) {
      file = newFile();
      hunk = null;
      continue;
    }
    if (/^={20,}$/.test(line)) continue;
    if (line.startsWith("--- ") && lines[i + 1]?.startsWith("+++ ")) {
      if (!file || file.hunks.length > 0) file = newFile();
      file.oldPath = cleanPath(line.slice(4));
      file.newPath = cleanPath(lines[i + 1]!.slice(4));
      hunk = null;
      i++;
      continue;
    }
    const h = HUNK_RE.exec(line);
    if (h) {
      if (!file) file = newFile();
      hunk = {
        header: line,
        oldStart: Number(h[1]),
        oldLines: h[2] === undefined ? 1 : Number(h[2]),
        newStart: Number(h[3]),
        newLines: h[4] === undefined ? 1 : Number(h[4]),
        section: (h[5] ?? "").trim(),
        lines: [],
      };
      file.hunks.push(hunk);
      oldNo = hunk.oldStart;
      newNo = hunk.newStart;
      oldLeft = hunk.oldLines;
      newLeft = hunk.newLines;
      continue;
    }
    // index lines, mode lines, similarity headers, etc. carry nothing the viewer needs.
  }
  return files.filter((f) => f.hunks.length > 0 || f.oldPath || f.newPath);
}

export function diffStats(files: DiffFile[]): { additions: number; deletions: number } {
  return files.reduce((acc, f) => ({ additions: acc.additions + f.additions, deletions: acc.deletions + f.deletions }), { additions: 0, deletions: 0 });
}

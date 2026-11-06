/**
 * Minimal syntax highlighter for read-only Solidity / TypeScript-like code. It only classifies characters into token
 * kinds; the view renders them as text nodes (never as HTML), so code from the backend cannot inject markup.
 * Multi-line block comments are tracked across lines.
 */

export type TokenKind = "keyword" | "type" | "string" | "number" | "comment" | "plain";

export interface Token {
  kind: TokenKind;
  text: string;
}

const KEYWORDS = new Set(
  (
    "pragma solidity import from as contract interface library abstract is function modifier event error struct enum mapping " +
    "returns return if else for while do break continue new delete emit revert require assert try catch using unchecked " +
    "public private internal external pure view payable constant immutable override virtual memory storage calldata indexed " +
    "constructor receive fallback assembly let true false this super type anonymous"
  ).split(" "),
);

const TYPE_RE = /^(address|bool|string|bytes\d{0,2}|u?int\d{0,3}|u?fixed[\dx]*|Test|Vm|console2?|msg|block|tx|abi)$/;

/** Tokenizes one line. `inBlock` says whether the line starts inside a block comment; the result says where it ends. */
export function tokenizeLine(line: string, inBlock: boolean): { tokens: Token[]; inBlock: boolean } {
  const tokens: Token[] = [];
  let i = 0;
  let plain = "";
  const flush = () => {
    if (plain) {
      tokens.push({ kind: "plain", text: plain });
      plain = "";
    }
  };
  const push = (kind: TokenKind, text: string) => {
    flush();
    tokens.push({ kind, text });
  };

  if (inBlock) {
    const end = line.indexOf("*/");
    if (end < 0) return { tokens: line ? [{ kind: "comment", text: line }] : [], inBlock: true };
    push("comment", line.slice(0, end + 2));
    i = end + 2;
  }

  while (i < line.length) {
    const ch = line[i]!;
    const rest = line.slice(i);
    if (rest.startsWith("//")) {
      push("comment", rest);
      return { tokens, inBlock: false };
    }
    if (rest.startsWith("/*")) {
      const end = line.indexOf("*/", i + 2);
      if (end < 0) {
        push("comment", rest);
        return { tokens, inBlock: true };
      }
      push("comment", line.slice(i, end + 2));
      i = end + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < line.length && line[j] !== ch) j += line[j] === "\\" ? 2 : 1;
      push("string", line.slice(i, Math.min(j + 1, line.length)));
      i = j + 1;
      continue;
    }
    const num = /^(0x[0-9a-fA-F_]+|\d[\d_]*(\.\d+)?(e\d+)?)/.exec(rest);
    if (num && !/[A-Za-z0-9_$]/.test(line[i - 1] ?? "")) {
      push("number", num[0]);
      i += num[0].length;
      continue;
    }
    const word = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(rest);
    if (word) {
      const w = word[0];
      if (KEYWORDS.has(w)) push("keyword", w);
      else if (TYPE_RE.test(w) || /^[A-Z][A-Za-z0-9_]*$/.test(w)) push("type", w);
      else plain += w;
      i += w.length;
      continue;
    }
    plain += ch;
    i++;
  }
  flush();
  return { tokens, inBlock: false };
}

export function tokenizeLines(source: string): Token[][] {
  const out: Token[][] = [];
  let inBlock = false;
  for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
    const r = tokenizeLine(line, inBlock);
    out.push(r.tokens);
    inBlock = r.inBlock;
  }
  return out;
}

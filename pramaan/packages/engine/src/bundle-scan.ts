import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

/**
 * Build-time scan of a built frontend (the directory that gets hashed into the release manifest). Two jobs from the
 * Pramaan design: (1) find secrets that would ship to every visitor, and (2) find third parties the bundle talks to -
 * analytics/tracker services in particular, which are the usual way a wallet address leaves the page - and compare
 * them with what the app declares in the manifest's `thirdParties[]`. It reads bytes and matches patterns; it never
 * executes anything from the bundle. A clean result means "none of these patterns were found", not "no leaks".
 */
export type BundleFindingKind = "secret" | "rpc-key" | "tracker" | "undeclared-host";
export type BundleSeverity = "critical" | "high" | "medium" | "info";

export interface BundleFinding {
  kind: BundleFindingKind;
  severity: BundleSeverity;
  rule: string;
  file: string;
  line: number;
  /** Redacted evidence: secrets are never printed in full. */
  detail: string;
  host?: string;
}

export interface BundleScanResult {
  filesScanned: number;
  skipped: { file: string; reason: string }[];
  findings: BundleFinding[];
  /** Every external host the bundle references. */
  hosts: string[];
  /** Referenced hosts that are neither the app's own nor declared. Only meaningful when `declaredHosts` was passed. */
  undeclared: string[];
  /** false when a critical/high secret or an undeclared tracker was found. */
  ok: boolean;
}

export interface BundleScanOptions {
  /** Hosts the app declares in the manifest (`thirdParties[].host`). Enables undeclared-host reporting. */
  declaredHosts?: string[];
  /** The app's own hosts (e.g. "vault.example"). */
  ownHosts?: string[];
  maxFileBytes?: number;
  maxFiles?: number;
}

const BINARY = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".eot", ".mp3", ".mp4", ".webm", ".zip", ".gz", ".wasm", ".pdf"]);

const SECRET_RULES: { rule: string; re: RegExp; severity: BundleSeverity }[] = [
  { rule: "private-key-block", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g, severity: "critical" },
  { rule: "wallet-private-key", re: /(?:private[_-]?key|secret[_-]?key|mnemonic|seed[_-]?phrase|deployer[_-]?key)["'`\s:=]{1,6}["'`]?0x[0-9a-fA-F]{64}\b/gi, severity: "critical" },
  { rule: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/g, severity: "critical" },
  { rule: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{50,}\b/g, severity: "critical" },
  { rule: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, severity: "high" },
  { rule: "telegram-bot-token", re: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g, severity: "high" },
  { rule: "anthropic-api-key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, severity: "critical" },
  { rule: "openai-api-key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g, severity: "critical" },
  { rule: "stripe-live-key", re: /\b[sr]k_live_[A-Za-z0-9]{16,}\b/g, severity: "critical" },
  { rule: "jwt", re: /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{20,}\b/g, severity: "medium" },
];

/** RPC URLs with the provider key in the path: the key is public to every visitor and can be abused for quota or billing. */
const RPC_KEY_RE = /https?:\/\/[a-z0-9.-]*(?:alchemy\.com\/v2|infura\.io\/v3|quiknode\.pro|blastapi\.io|ankr\.com\/[a-z_]+)\/[A-Za-z0-9_-]{16,}/gi;

/** Services that exist to receive page events. Wallet addresses leak to them when the app reports user or account data. */
export const TRACKER_HOSTS = [
  "google-analytics.com",
  "analytics.google.com",
  "googletagmanager.com",
  "doubleclick.net",
  "segment.io",
  "segment.com",
  "mixpanel.com",
  "amplitude.com",
  "hotjar.com",
  "fullstory.com",
  "logrocket.com",
  "posthog.com",
  "clarity.ms",
  "heap.io",
  "heapanalytics.com",
  "sentry.io",
  "datadoghq.com",
  "facebook.net",
  "connect.facebook.com",
  "ads-twitter.com",
];

const HOST_RE = /(?:https?:)?\/\/((?:[a-z0-9-]+\.)+[a-z]{2,24})(?::\d{1,5})?(?=[/"'`\s)?#,;]|$)/gi;
/** URLs whose host is an IPv4 literal, port kept: `http://127.0.0.1:5190/collect` is a different endpoint from `http://127.0.0.1:8545`. */
const IP_URL_RE = /(?:https?:)?\/\/((?:\d{1,3}\.){3}\d{1,3})(?::(\d{1,5}))?(?=[/"'`\s)?#,;]|$)/g;
/** Namespace/documentation URIs that appear in nearly every bundle and are never fetched. */
const IGNORED_HOSTS = new Set([
  "www.w3.org",
  "w3.org",
  "schema.org",
  "reactjs.org",
  "react.dev",
  "localhost",
  "example.com",
  "www.example.com",
  "json-schema.org",
  "xmlns.com",
  "purl.org",
  "mozilla.org",
  "developer.mozilla.org",
  "github.com",
  "fb.me",
  "nodejs.org",
  "tc39.es",
  "ietf.org",
  "www.ietf.org",
  "eips.ethereum.org",
  "docs.metamask.io",
  "ens.domains",
  "ethereum.org",
]);

const redact = (s: string) => (s.length <= 10 ? "[redacted]" : `${s.slice(0, 4)}…${s.slice(-2)} (${s.length} chars)`);
const hostMatchesList = (host: string, list: string[]) => list.some((h) => host === h || host.endsWith(`.${h}`));
const SEV_RANK: Record<BundleSeverity, number> = { critical: 0, high: 1, medium: 2, info: 3 };

function* walk(root: string, limit: number): Generator<{ full: string; rel: string }> {
  let count = 0;
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of readdirSync(cur, { withFileTypes: true })) {
      const full = join(cur, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git") continue;
        stack.push(full);
      } else if (e.isFile()) {
        if (++count > limit) throw new Error(`more than ${limit} files under ${root}`);
        yield { full, rel: "/" + relative(root, full).split(sep).join("/") };
      }
    }
  }
}

function lineOf(text: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

export function scanBundle(dir: string, options: BundleScanOptions = {}): BundleScanResult {
  const maxBytes = options.maxFileBytes ?? 8 * 1024 * 1024;
  const declared = (options.declaredHosts ?? []).map((h) => h.toLowerCase().replace(/:\d+$/, ""));
  const declaredRaw = (options.declaredHosts ?? []).map((h) => h.toLowerCase());
  const own = (options.ownHosts ?? []).map((h) => h.toLowerCase().replace(/:\d+$/, ""));
  const result: BundleScanResult = { filesScanned: 0, skipped: [], findings: [], hosts: [], undeclared: [], ok: true };
  const hosts = new Set<string>();
  const ipHosts = new Map<string, { file: string; line: number }>();

  for (const { full, rel } of walk(dir, options.maxFiles ?? 20_000)) {
    if (BINARY.has(extname(full).toLowerCase())) continue;
    if (lstatSync(full).size > maxBytes) {
      result.skipped.push({ file: rel, reason: `larger than ${maxBytes} bytes` });
      continue;
    }
    const text = readFileSync(full, "utf8");
    result.filesScanned++;

    for (const { rule, re, severity } of SECRET_RULES) {
      for (const m of text.matchAll(re)) {
        result.findings.push({ kind: "secret", severity, rule, file: rel, line: lineOf(text, m.index ?? 0), detail: redact(m[0]) });
      }
    }
    for (const m of text.matchAll(RPC_KEY_RE)) {
      result.findings.push({ kind: "rpc-key", severity: "medium", rule: "rpc-provider-key", file: rel, line: lineOf(text, m.index ?? 0), detail: redact(m[0]) });
    }
    for (const m of text.matchAll(IP_URL_RE)) {
      const ip = m[1]!;
      if (ip === "0.0.0.0" || hostMatchesList(ip, own)) continue;
      const host = m[2] ? `${ip}:${m[2]}` : ip;
      hosts.add(host);
      if (!ipHosts.has(host)) ipHosts.set(host, { file: rel, line: lineOf(text, m.index ?? 0) });
    }
    const seenInFile = new Set<string>();
    for (const m of text.matchAll(HOST_RE)) {
      const host = m[1]!.toLowerCase();
      if (IGNORED_HOSTS.has(host) || hostMatchesList(host, own) || seenInFile.has(host)) continue;
      seenInFile.add(host);
      hosts.add(host);
      if (hostMatchesList(host, TRACKER_HOSTS)) {
        const isDeclared = hostMatchesList(host, declared);
        result.findings.push({
          kind: "tracker",
          severity: isDeclared ? "medium" : "high",
          rule: "tracker-host",
          file: rel,
          line: lineOf(text, m.index ?? 0),
          detail: `${host} is an analytics/tracking service${isDeclared ? " (declared in thirdParties[])" : " and is NOT declared"}; confirm it never receives the wallet address`,
          host,
        });
      }
    }
  }

  result.hosts = [...hosts].sort();
  if (options.declaredHosts) {
    const isIp = (h: string) => /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(h);
    // An IP endpoint is declared only by its exact host:port (or by the bare IP, which accepts any port).
    const ipDeclared = (h: string) => declaredRaw.includes(h) || (!h.includes(":") ? false : declaredRaw.includes(h.replace(/:\d+$/, "")));
    result.undeclared = result.hosts.filter((h) => (isIp(h) ? !ipDeclared(h) : !hostMatchesList(h, declared)));
    for (const h of result.undeclared) {
      if (isIp(h)) {
        const at = ipHosts.get(h);
        result.findings.push({ kind: "undeclared-host", severity: "high", rule: "undeclared-ip-endpoint", file: at?.file ?? "(bundle)", line: at?.line ?? 0, detail: `${h} is an IP-address endpoint the bundle talks to and the release does not declare; an undeclared endpoint can receive the wallet address`, host: h });
        continue;
      }
      if (hostMatchesList(h, TRACKER_HOSTS)) continue; // already reported, with higher severity
      result.findings.push({ kind: "undeclared-host", severity: "info", rule: "undeclared-third-party", file: "(bundle)", line: 0, detail: `${h} is referenced but not listed in the release's thirdParties[]`, host: h });
    }
  }
  result.findings.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
  result.ok = !result.findings.some((f) => (f.kind === "secret" && (f.severity === "critical" || f.severity === "high")) || (f.kind === "tracker" && f.severity === "high") || (f.kind === "undeclared-host" && f.severity === "high"));
  return result;
}

export function renderBundleReport(r: BundleScanResult): string {
  const lines = [`Scanned ${r.filesScanned} files; ${r.findings.length} finding(s); ${r.hosts.length} external host(s).`];
  for (const f of r.findings) lines.push(`${f.severity.toUpperCase().padEnd(8)} ${f.rule.padEnd(24)} ${f.file}${f.line ? `:${f.line}` : ""}  ${f.detail}`);
  if (r.skipped.length) lines.push(`Skipped ${r.skipped.length} oversized file(s): ${r.skipped.map((s) => s.file).join(", ")}`);
  lines.push(r.ok ? "Result: none of the secret or undeclared-tracker patterns were found (this is not a guarantee of no leaks)." : "Result: FAILED - a secret or an undeclared tracker is in the bundle.");
  return lines.join("\n");
}

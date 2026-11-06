import { createHash } from "node:crypto";
import { ManifestV1 } from "@pramaan/manifest";

/**
 * A static, self-contained "public record" page for one release: what was shipped (files), which contracts it
 * talks to, what PROVE found and how the proof is recorded. The page contains no script, loads nothing from any
 * other host and escapes every value, so it is safe to pin on IPFS and open from any gateway.
 *
 * The page itself is NOT a trust anchor. It states the manifest's sha256 and tells the reader to compare it with the
 * `pramaan.record` text record of the app's ENS name (or run `pnpm pramaan verify`), because whoever hosts a page
 * can write anything on it.
 */
export interface RecordPageOptions {
  /** DSSE envelope JSON that signs this manifest, shown as-is if present. */
  signatureEnvelope?: string | null;
  /** Where the raw manifest can be fetched (e.g. an IPFS gateway URL or `./pramaan-manifest.json`). */
  manifestHref?: string;
}

const esc = (v: unknown): string =>
  String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const short = (hex: string, head = 10, tail = 6): string => (hex.length > head + tail + 3 ? `${hex.slice(0, head)}…${hex.slice(-tail)}` : hex);

const CSS = `
:root{color-scheme:light dark;--bg:#fff;--fg:#14161a;--muted:#5c6470;--line:#d9dde3;--card:#f6f7f9;--ok:#146c2e;--warn:#8a5a00;--bad:#a4262c}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--fg:#e8eaee;--muted:#98a1ae;--line:#2a2f38;--card:#171a20;--ok:#58c27a;--warn:#e0b04a;--bad:#f0787d}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:980px;margin:0 auto;padding:24px 16px 64px}h1{font-size:1.6rem;margin:0 0 4px}h2{font-size:1.15rem;margin:32px 0 8px}
.muted{color:var(--muted)}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:12px 0}
code,.mono{font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-all}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600}
.tbl{overflow-x:auto}.pill{display:inline-block;padding:1px 8px;border-radius:99px;border:1px solid var(--line);font-size:12px}
.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}details summary{cursor:pointer}
`;

function table(head: string[], rows: string[][]): string {
  if (rows.length === 0) return `<p class="muted">None.</p>`;
  return `<div class="tbl"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;
}

const statusClass = (s: string): string => (s === "fixed-verified" ? "ok" : s === "reproduced" ? "bad" : s === "accepted-risk" ? "warn" : "muted");

/** Throws if `manifestBytes` is not a valid manifest: the page never renders data that did not pass the schema. */
export function renderRecordPage(manifestBytes: Uint8Array, options: RecordPageOptions = {}): string {
  const manifest = ManifestV1.parse(JSON.parse(Buffer.from(manifestBytes).toString("utf8")));
  const sha256 = createHash("sha256").update(manifestBytes).digest("hex");
  const m = manifest;
  const href = options.manifestHref ? ` · <a href="${esc(options.manifestHref)}">raw manifest</a>` : "";
  const proven = m.findings.filter((f) => f.status === "fixed-verified").length;

  const findings = table(
    ["ID", "Class", "Severity", "Status", "Exploit test sha256", "Evidence sha256", "Fix commit"],
    m.findings.map((f) => [
      `${esc(f.id)}${f.title ? `<br><span class="muted">${esc(f.title)}</span>` : ""}`,
      esc(f.class),
      esc(f.severity),
      `<span class="${statusClass(f.status)}">${esc(f.status)}</span>`,
      f.exploitTestSha256 ? `<code>${esc(short(f.exploitTestSha256, 12, 8))}</code>` : "—",
      f.evidenceSha256 ? `<code>${esc(short(f.evidenceSha256, 12, 8))}</code>` : "—",
      f.fixCommit ? `<code>${esc(short(f.fixCommit, 10, 0))}</code>` : "—",
    ]),
  );
  const contracts = table(
    ["Label", "Chain", "Address", "Proxy", "Runtime codehash"],
    m.contracts.map((c) => [
      esc(c.label),
      esc(c.chainId),
      `<code>${esc(c.address)}</code>`,
      c.proxy ? `${esc(c.proxy.type)} → <code>${esc(c.proxy.implAddress)}</code>` : "—",
      `<code>${esc(short(c.runtimeCodehash, 12, 8))}</code>`,
    ]),
  );
  const files = table(
    ["Path", "Bytes", "sha256"],
    m.files.map((f) => [`<code>${esc(f.path)}</code>`, esc(f.size ?? "—"), `<code>${esc(short(f.sha256, 12, 8))}</code>`]),
  );
  const thirdParties = table(
    ["Host", "Purpose", "Receives the wallet address"],
    m.thirdParties.map((t) => [`<code>${esc(t.host)}</code>`, esc(t.purpose), t.receivesAddress ? `<span class="warn">yes</span>` : "no"]),
  );
  const tools = table(["Tool", "Version"], m.tools.map((t) => [esc(t.name), esc(t.version)]));
  const signature = options.signatureEnvelope
    ? `<details class="card"><summary>Signature envelope (DSSE)</summary><pre class="mono">${esc(options.signatureEnvelope)}</pre></details>`
    : `<p class="muted">No signature envelope was supplied to this page.</p>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<title>${esc(m.app.name)} ${esc(m.tag)} — Pramaan release record</title><style>${CSS}</style></head>
<body><main>
<h1>${esc(m.app.name)} <span class="muted">${esc(m.tag)}</span></h1>
<p class="muted">Pramaan release record for <code>${esc(m.app.ensName)}</code> · served from <code>${esc(m.app.domain)}</code></p>

<div class="card">
<strong>Check this page against ENS before you rely on it.</strong>
<p>Manifest sha256 (what this page was built from):</p>
<p><code>${esc(sha256)}</code></p>
<p class="muted">The ENS text record <code>pramaan.record</code> of <code>${esc(m.app.ensName)}</code> must read
<code>pramaan:v1:${esc(m.tag)}:${esc(sha256)}</code> and its timelock must have activated it. If it does not, this page is not the
release the name points to. Run <code>pnpm pramaan verify ${esc(m.app.domain)}</code> for the full check${href}.</p>
</div>

<h2>Summary</h2>
<div class="card">
<table><tbody>
<tr><th>Repository</th><td><code>${esc(m.repo)}</code></td></tr>
<tr><th>Commit</th><td><code>${esc(m.commit)}</code></td></tr>
<tr><th>Built at</th><td>${esc(m.builtAt)}</td></tr>
<tr><th>Workflow</th><td>${m.workflow ? `<code>${esc(m.workflow)}</code>` : "none recorded"}</td></tr>
<tr><th>Files</th><td>${m.files.length}</td></tr>
<tr><th>Contracts</th><td>${m.contracts.length}</td></tr>
<tr><th>Findings with a verified fix</th><td>${proven} of ${m.findings.length}</td></tr>
</tbody></table>
</div>

<h2>PROVE findings</h2>
<p class="muted">A finding is listed only when a Foundry exploit test reproduced it. “fixed-verified” means the exploit stops working on the patched code and the project's own tests still pass.</p>
${findings}

<h2>Contracts this release talks to</h2>
${contracts}

<h2>Third parties the app contacts</h2>
${thirdParties}

<h2>Files</h2>
<details><summary>${m.files.length} files</summary>${files}</details>

<h2>Signature</h2>
${signature}

<h2>Tools</h2>
${tools}
</main></body></html>
`;
}

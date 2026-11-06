import { checkStatusTone, overallTone, riskLevelMeta, type Tone } from "./tone";

/**
 * Normalises the backend's site-verification and decode results for display. The shapes come from
 * packages/verifier-core (VerdictRow {id, color, key, params, detail, blocking}; Check {id, status, detail}) and
 * packages/decoder (RequestAnalysis). Unknown or missing colours and statuses always become grey ("unknown").
 */

export interface VerdictRowView {
  id: string;
  title: string;
  tone: Tone;
  statusLabel: string;
  summary: string;
  reasons: string[];
  blocking: boolean;
}

export interface CheckView {
  id: string;
  tone: Tone;
  status: string;
  detail: string;
}

export interface SiteVerdictView {
  rows: VerdictRowView[];
  overall: Tone;
  blocked: boolean;
  checks: CheckView[];
  facts: { label: string; value: string; mono?: boolean }[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

const GOOD = new Set(["green", "pass", "passed", "ok", "verified", "match"]);
const WARN = new Set(["amber", "yellow", "warn", "warning", "attention", "missing", "partial"]);
const BAD = new Set(["red", "fail", "failed", "mismatch", "invalid", "revoked", "tampered", "blocked", "invalid-signature"]);

/** Row colour/status → tone. Anything not explicitly recognised is grey. */
export function rowTone(row: Obj): Tone {
  for (const field of ["color", "colour", "status", "result", "state", "verdict"]) {
    const v = str(row[field])?.toLowerCase();
    if (!v) continue;
    if (GOOD.has(v)) return "good";
    if (WARN.has(v)) return "warning";
    if (BAD.has(v)) return "critical";
    return "unknown";
  }
  return "unknown";
}

const ROW_TITLES: [RegExp, string][] = [
  [/^(release|record|ens|pointer|release-record)$/i, "Release record"],
  [/^(site|files|site-files|sitefiles|page)$/i, "Site files"],
  [/^(contract|contracts)$/i, "Contracts"],
  [/^(privacy|third-?parties|third_parties|thirdparties|leaks?)$/i, "Privacy & third parties"],
  [/^(action|transaction|tx)$/i, "Transaction"],
];

export function rowTitle(id: string, explicit?: string | null): string {
  if (explicit) return explicit;
  for (const [re, title] of ROW_TITLES) if (re.test(id)) return title;
  return id ? id.charAt(0).toUpperCase() + id.slice(1).replace(/[-_]/g, " ") : "Check";
}

const STATUS_LABEL: Record<Tone, string> = {
  good: "Pass",
  warning: "Attention",
  serious: "Serious",
  critical: "Fail",
  unknown: "Not verified",
  info: "Info",
  neutral: "Not verified",
};

function reasonText(v: unknown): string | null {
  if (typeof v === "string") return str(v);
  if (isObj(v)) return str(v["text"]) ?? str(v["message"]) ?? str(v["detail"]) ?? str(v["reason"]);
  return null;
}

/** English text of the verifier's message keys (packages/decoder i18n catalog), so rows read as sentences. */
const KEY_TEXT_EN: Record<string, string> = {
  "verify.site.verified": "This site matches release {tag}, signed by {signer}.",
  "verify.site.mismatch": "A file on this site does not match the published release. Signing is blocked.",
  "verify.site.unlisted-script": "This page runs a script that is not in the published release. Signing is blocked.",
  "verify.site.no-release": "This site publishes no Pramaan release, so its code cannot be checked.",
  "verify.site.unverifiable": "The release could not be verified: {reason}",
  "verify.site.revoked": "The publisher has withdrawn this release.",
  "verify.contract.verified": "{label}: the deployed code matches the release.",
  "verify.contract.unlisted": "This contract is not part of the site's published release.",
  "verify.contract.mismatch": "This contract's code differs from the published release.",
  "verify.contract.impl-mismatch": "The proxy now points to code that is not in the release (implementation changed).",
  "verify.contract.unsupported-proxy": "This proxy type cannot be verified ({type}).",
  "verify.contract.eoa": "The recipient is a wallet, not a contract.",
  "verify.privacy.none-observed": "No third party was seen receiving your address on this page (observed, not proven).",
  "verify.privacy.undeclared": "{host} received your wallet address and is not declared by the site.",
  "verify.privacy.declared": "{host} received your wallet address (declared by the site: {purpose}).",
  "verify.privacy.blocked": "Requests to {host} are blocked on this site.",
};

export function fillTemplate(key: string, params: unknown): string {
  const p: Record<string, unknown> = isObj(params) ? params : {};
  const template = KEY_TEXT_EN[key];
  if (template) return template.replace(/\{(\w+)\}/g, (_, name: string) => (p[name] !== undefined && p[name] !== "" ? String(p[name]) : "?"));
  if (Object.keys(p).length === 0) return key;
  return `${key} (${Object.entries(p)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(", ")})`;
}

export function normalizeRow(raw: unknown, index: number): VerdictRowView {
  const row = isObj(raw) ? raw : {};
  const id = str(row["id"]) ?? str(row["kind"]) ?? `row-${index + 1}`;
  const tone = rowTone(row);
  const reasons: string[] = [];
  const list = row["reasons"];
  if (Array.isArray(list)) for (const r of list) {
    const t = reasonText(r);
    if (t) reasons.push(t);
  }
  const summary =
    str(row["text"]) ??
    str(row["message"]) ??
    str(row["summary"]) ??
    (isObj(row["text"]) ? str((row["text"] as Obj)["en"]) : null) ??
    (str(row["key"]) ? fillTemplate(String(row["key"]), row["params"]) : null) ??
    reasons.shift() ??
    "";
  for (const field of ["detail", "reason"]) {
    const t = str(row[field]);
    if (t && t !== summary && !reasons.includes(t)) reasons.push(t);
  }
  return {
    id,
    title: rowTitle(id, str(row["title"]) ?? str(row["label"])),
    tone,
    statusLabel: STATUS_LABEL[tone],
    summary,
    reasons,
    blocking: row["blocking"] === true,
  };
}

function findRows(raw: Obj): unknown[] | null {
  for (const candidate of [raw["rows"], isObj(raw["verdict"]) ? (raw["verdict"] as Obj)["rows"] : null, isObj(raw["result"]) ? (raw["result"] as Obj)["rows"] : null]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return null;
}

export function normalizeSiteVerdict(raw: unknown): SiteVerdictView {
  const root = isObj(raw) ? (isObj(raw["result"]) && !findRowsShallow(raw) ? (raw["result"] as Obj) : raw) : {};
  const rows = (findRows(root) ?? []).map(normalizeRow);
  const release = isObj(root["release"]) ? (root["release"] as Obj) : null;
  const checksRaw = Array.isArray(release?.["checks"]) ? (release!["checks"] as unknown[]) : Array.isArray(root["checks"]) ? (root["checks"] as unknown[]) : [];
  const checks: CheckView[] = checksRaw.filter(isObj).map((c) => ({
    id: str(c["id"]) ?? "check",
    status: str(c["status"]) ?? "unknown",
    tone: checkStatusTone(c["status"]),
    detail: str(c["detail"]) ?? "",
  }));

  const facts: SiteVerdictView["facts"] = [];
  const add = (label: string, value: unknown, mono = false) => {
    const v = typeof value === "number" ? String(value) : str(value);
    if (v) facts.push({ label, value: v, mono });
  };
  add("Origin", root["origin"] ?? release?.["origin"]);
  add("ENS name", root["ensName"] ?? release?.["ensName"]);
  add("Chain", root["chainId"] ?? release?.["chainId"]);
  const pointer = isObj(release?.["pointer"]) ? (release!["pointer"] as Obj) : null;
  add("Release tag", pointer?.["tag"]);
  add("Manifest sha256", release?.["manifestSha256"] ?? pointer?.["manifestSha256"], true);
  add("Manifest source", release?.["manifestSource"]);
  const sig = isObj(release?.["signature"]) ? (release!["signature"] as Obj) : null;
  add("Signer", sig?.["signer"]);
  add("Release status", release?.["status"]);
  if (release?.["singleSource"] === true) facts.push({ label: "ENS reads", value: "single RPC (not independently confirmed)" });

  const verdict = isObj(root["verdict"]) ? (root["verdict"] as Obj) : null;
  const blocked = rows.some((r) => r.blocking) || verdict?.["blocked"] === true || root["blocked"] === true;
  return { rows, overall: overallTone(rows.map((r) => r.tone)), blocked, checks, facts };
}

function findRowsShallow(raw: Obj): boolean {
  return Array.isArray(raw["rows"]) || (isObj(raw["verdict"]) && Array.isArray((raw["verdict"] as Obj)["rows"]));
}

// ---------------------------------------------------------------------------------------------------------------
// Decode

export type Lang = "en" | "hi" | "mr";
export const LANGS: { id: Lang; label: string; native: string }[] = [
  { id: "en", label: "English", native: "English" },
  { id: "hi", label: "Hindi", native: "हिन्दी" },
  { id: "mr", label: "Marathi", native: "मराठी" },
];

export interface ExplanationView {
  headline: string;
  details: string[];
  risks: { level: string; code: string; text: string; tone: Tone }[];
}

export interface DecodeView {
  method: string | null;
  level: string | null;
  tone: Tone;
  levelLabel: string;
  interpreted: boolean;
  actionKind: string | null;
  findings: { code: string; level: string; tone: Tone; params: Record<string, string> }[];
  explanations: Partial<Record<Lang, ExplanationView>>;
  target: string | null;
  action: unknown;
}

function explanationFrom(raw: unknown): ExplanationView | null {
  if (!isObj(raw)) return null;
  const headline = str(raw["headline"]) ?? str(raw["title"]) ?? "";
  const details = Array.isArray(raw["details"]) ? (raw["details"] as unknown[]).map(reasonText).filter((x): x is string => !!x) : [];
  const risks = Array.isArray(raw["risks"])
    ? (raw["risks"] as unknown[]).filter(isObj).map((r) => ({
        level: str(r["level"]) ?? "unknown",
        code: str(r["code"]) ?? "",
        text: str(r["text"]) ?? "",
        tone: riskLevelMeta(r["level"]).tone,
      }))
    : [];
  if (!headline && details.length === 0 && risks.length === 0) return null;
  return { headline, details, risks };
}

export function normalizeDecode(raw: unknown): DecodeView {
  let root: Obj = isObj(raw) ? raw : {};
  for (const wrap of ["analysis", "result", "decoded"]) {
    if (isObj(root[wrap]) && !isObj(root["assessment"])) root = root[wrap] as Obj;
  }
  const assessment = isObj(root["assessment"]) ? (root["assessment"] as Obj) : {};
  const level = str(assessment["level"]) ?? str(root["level"]);
  const action = root["action"] ?? null;
  const actionKind = isObj(action) ? str(action["kind"]) : null;
  const meta = riskLevelMeta(level);
  const findingsRaw = Array.isArray(assessment["findings"]) ? assessment["findings"] : Array.isArray(assessment["reasons"]) ? assessment["reasons"] : [];
  const findings = (findingsRaw as unknown[]).map((f) => {
    if (typeof f === "string") return { code: f, level: "unknown", tone: "unknown" as Tone, params: {} };
    const o = isObj(f) ? f : {};
    const params: Record<string, string> = {};
    if (isObj(o["params"])) for (const [k, v] of Object.entries(o["params"] as Obj)) params[k] = String(v);
    return { code: str(o["code"]) ?? str(o["text"]) ?? "?", level: str(o["level"]) ?? "unknown", tone: riskLevelMeta(o["level"]).tone, params };
  });
  const interpreted = actionKind !== null ? actionKind !== "unknown" : level !== null && !findings.some((f) => f.code === "UNKNOWN_ACTION");
  const explanations: Partial<Record<Lang, ExplanationView>> = {};
  const ex = isObj(root["explanations"]) ? (root["explanations"] as Obj) : {};
  for (const l of LANGS) {
    const e = explanationFrom(ex[l.id]);
    if (e) explanations[l.id] = e;
  }
  return {
    method: str(root["method"]),
    level,
    // A request the decoder could not interpret is grey whatever its level says.
    tone: interpreted ? meta.tone : "unknown",
    levelLabel: interpreted ? meta.label : "Cannot confidently interpret",
    interpreted,
    actionKind,
    findings,
    explanations,
    target: str(root["target"]),
    action,
  };
}

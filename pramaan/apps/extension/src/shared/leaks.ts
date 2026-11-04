import { getAddress, keccak256, sha256, toBytes } from "viem";

/**
 * Finding the user's wallet address in what a page sends to third parties. Pure functions (unit-tested in Node).
 *
 * Detected encodings: checksummed, lowercase and uppercase hex, with or without 0x, URL-encoded (also twice),
 * base64 / base64url of any string that contains the address (e.g. base64 of a JSON payload), the address inside
 * JSON values or ABI-encoded hex, and keccak256 / sha256 of the address.
 * NOT detected (documented in the UI): encrypted or custom-obfuscated payloads, data split across requests,
 * compressed bodies, and anything MV3's webRequest does not expose (WebSocket frames, streamed bodies, requests made
 * by the page's own service worker, other extensions).
 */
export interface LeakMatch {
  account: string;
  /** Which encoding matched, e.g. "checksummed address", "base64url(...)". */
  form: string;
  /** Where in the request, e.g. "query ?addr=", "JSON body field wallet", "URL path". */
  where: string;
}

const MAX_SCAN = 65_536;

interface Needle {
  account: string;
  lower: string;
  checksum: string;
  bare: string;
  hashes: { form: string; hex: string }[];
}

const needleCache = new Map<string, Needle>();
function needle(account: string): Needle | null {
  const lower = account.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(lower)) return null;
  let n = needleCache.get(lower);
  if (!n) {
    const checksum = getAddress(lower);
    n = {
      account: lower,
      lower,
      checksum,
      bare: lower.slice(2),
      hashes: [
        { form: "keccak256(address)", hex: keccak256(toBytes(lower)).slice(2) },
        { form: "keccak256(checksummed address)", hex: keccak256(toBytes(checksum)).slice(2) },
        { form: "sha256(address)", hex: sha256(toBytes(lower)).slice(2) },
      ],
    };
    needleCache.set(lower, n);
  }
  return n;
}

/** Plain-text forms (no decoding). Returns the most specific description. */
function plainForm(text: string, n: Needle): string | null {
  const hay = text.toLowerCase();
  const at = hay.indexOf(n.bare);
  if (at < 0) {
    const h = n.hashes.find((x) => hay.includes(x.hex));
    return h ? h.form : null;
  }
  const prefixed = at >= 2 && hay.slice(at - 2, at) === "0x";
  const raw = text.slice(at, at + 40);
  const caseForm = raw === n.checksum.slice(2) ? "checksummed" : raw === n.bare ? "lowercase" : raw === n.bare.toUpperCase() ? "uppercase hex" : "mixed-case";
  if (!prefixed) {
    // 40 hex chars inside a longer hex run is typically ABI-encoded call data.
    const before = hay[at - 1] ?? "";
    return /[0-9a-f]/.test(before) ? `address inside hex data (${caseForm})` : `${caseForm} address without 0x`;
  }
  return `${caseForm} address`;
}

function tryUrlDecode(text: string): string | null {
  if (!/%[0-9a-fA-F]{2}|\+/.test(text)) return null;
  try {
    const out = decodeURIComponent(text.replace(/\+/g, " "));
    return out !== text ? out : null;
  } catch {
    return null;
  }
}

const B64_TOKEN = /[A-Za-z0-9+/_-]{24,}={0,2}/g;

function decodeBase64(token: string): { text: string; url: boolean } | null {
  const url = /[-_]/.test(token);
  const std = token.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (std.length % 4 === 1) return null;
  try {
    const bin = atob(std + "=".repeat((4 - (std.length % 4)) % 4));
    // Only keep decodings that are mostly printable text (a payload, not random bytes).
    let printable = 0;
    for (let i = 0; i < bin.length; i++) {
      const c = bin.charCodeAt(i);
      if (c >= 32 && c < 127) printable++;
    }
    return printable / Math.max(1, bin.length) > 0.85 ? { text: bin, url } : null;
  } catch {
    return null;
  }
}

/** Searches one string value, decoding URL-encoding and base64 layers (bounded depth). */
export function matchValue(value: string, accounts: string[], depth = 0): { account: string; form: string } | null {
  if (!value || depth > 3) return null;
  const text = value.length > MAX_SCAN ? value.slice(0, MAX_SCAN) : value;
  for (const a of accounts) {
    const n = needle(a);
    if (!n) continue;
    const f = plainForm(text, n);
    if (f) return { account: n.account, form: f };
  }
  const decoded = tryUrlDecode(text);
  if (decoded) {
    const inner = matchValue(decoded, accounts, depth + 1);
    if (inner) return { account: inner.account, form: `URL-encoded ${inner.form}` };
  }
  for (const token of text.match(B64_TOKEN) ?? []) {
    // A long hex string is also valid base64; it was already searched as hex.
    if (/^[0-9a-fA-F]+$/.test(token)) continue;
    const d = decodeBase64(token);
    if (!d) continue;
    const inner = matchValue(d.text, accounts, depth + 1);
    if (inner) return { account: inner.account, form: `${d.url ? "base64url" : "base64"}(${inner.form})` };
  }
  return null;
}

/** Walks a parsed JSON value and reports the first field that carries the address. */
function matchJson(value: unknown, accounts: string[], path: string, depth = 0): LeakMatch | null {
  if (depth > 12) return null;
  if (typeof value === "string") {
    const m = matchValue(value, accounts);
    return m ? { ...m, where: path ? `JSON body field ${path}` : "JSON body" } : null;
  }
  if (Array.isArray(value)) {
    for (const [i, v] of value.slice(0, 500).entries()) {
      const m = matchJson(v, accounts, `${path}[${i}]`, depth + 1);
      if (m) return m;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value).slice(0, 500)) {
      const keyHit = matchValue(k, accounts);
      if (keyHit) return { ...keyHit, where: `JSON body key at ${path || "top level"}` };
      const m = matchJson(v, accounts, path ? `${path}.${k}` : k, depth + 1);
      if (m) return m;
    }
  }
  return null;
}

/** URL: query parameters by name, then the path, then the whole URL (e.g. the address as a subdomain). */
export function matchUrl(rawUrl: string, accounts: string[]): LeakMatch | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    const m = matchValue(rawUrl, accounts);
    return m ? { ...m, where: "URL" } : null;
  }
  for (const [k, v] of u.searchParams) {
    const m = matchValue(v, accounts) ?? matchValue(k, accounts);
    if (m) return { ...m, where: `query ?${k.slice(0, 40)}=` };
  }
  const path = matchValue(u.pathname, accounts);
  if (path) return { ...path, where: "URL path" };
  const host = matchValue(u.hostname, accounts);
  if (host) return { ...host, where: "host name" };
  return null;
}

export type RequestBody = { formData?: Record<string, (string | ArrayBuffer)[]>; raw?: { bytes?: ArrayBuffer; file?: string }[]; error?: string } | null | undefined;

/** Bodies as webRequest exposes them: parsed form fields, or raw bytes (JSON, text, beacons). */
export function matchBody(body: RequestBody, accounts: string[]): LeakMatch | null {
  if (!body) return null;
  if (body.formData) {
    for (const [k, values] of Object.entries(body.formData)) {
      for (const v of values ?? []) {
        const m = matchValue(typeof v === "string" ? v : new TextDecoder().decode(v), accounts) ?? matchValue(k, accounts);
        if (m) return { ...m, where: `form field ${k.slice(0, 40)}` };
      }
    }
    return null;
  }
  const text = rawText(body);
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const m = matchJson(JSON.parse(trimmed), accounts, "");
      if (m) return m;
    } catch {
      // not JSON after all; scan as text
    }
  }
  if (/^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(trimmed)) {
    for (const pair of trimmed.split("&")) {
      const [k = "", v = ""] = pair.split("=");
      const m = matchValue(v, accounts);
      if (m) return { ...m, where: `form field ${k.slice(0, 40)}` };
    }
  }
  const m = matchValue(text, accounts);
  return m ? { ...m, where: "request body" } : null;
}

export function rawText(body: RequestBody, max = MAX_SCAN): string {
  const parts: string[] = [];
  let total = 0;
  for (const chunk of body?.raw ?? []) {
    if (!chunk.bytes || total >= max) continue;
    const bytes = new Uint8Array(chunk.bytes).slice(0, max - total);
    total += bytes.length;
    parts.push(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
  }
  return parts.join("");
}

/** Request headers (cookies, custom X-Wallet headers, Referer). */
export function matchHeaders(headers: { name: string; value?: string }[] | undefined, accounts: string[]): LeakMatch | null {
  for (const h of headers ?? []) {
    const m = matchValue(h.value ?? "", accounts);
    if (m) return { ...m, where: `header ${h.name}` };
  }
  return null;
}

export function originOf(url: string): string | null {
  try {
    const o = new URL(url).origin;
    return o === "null" ? null : o;
  } catch {
    return null;
  }
}

/** host[:port], lowercase: the unit a block applies to (all schemes: http, https, ws, wss). */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** Channel as the user should read it. */
export function channelOf(type: string, method: string, keepalive = false): string {
  if (type === "ping") return "sendBeacon / ping";
  if (type === "websocket") return "WebSocket";
  if (type === "image") return "image (pixel)";
  if (type === "xmlhttprequest") return keepalive ? "fetch (keepalive)" : "fetch / XHR";
  if (type === "main_frame" || type === "sub_frame") return method === "POST" ? "form submission" : "navigation";
  return type;
}

/** What Chrome MV3 does not let an extension observe. Shown verbatim in the popup's privacy section. */
export const MV3_BLIND_SPOTS = [
  "WebSocket messages after the connection opens (only the connection URL is visible)",
  "streamed request bodies (fetch with a ReadableStream body) and file uploads",
  "requests made by the page's own service worker or by other extensions",
  "WebRTC data channels and DNS lookups",
  "encrypted or custom-obfuscated payloads, compressed bodies, and data split across several requests",
  "what a third party already received before Pramaan learned your address on this page",
] as const;

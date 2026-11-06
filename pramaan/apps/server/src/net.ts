import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { HttpError } from "./errors.js";

/** True for loopback, private, link-local, unique-local, unspecified and IPv4-mapped versions of those. */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase();
  if (isIP(v) === 4) {
    const [a, b] = v.split(".").map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (isIP(v) === 6) {
    if (v === "::" || v === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPrivateAddress(mapped[1]!);
    // Node may expose IPv4-mapped addresses in hexadecimal form, including
    // the fully expanded IPv6 spelling, rather than dotted decimal.
    const mappedHex = /^(?:::ffff:|(?:0{1,4}:){5}ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1]!, 16), lo = parseInt(mappedHex[2]!, 16);
      return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith("ff");
  }
  return false;
}

/**
 * Parses an http(s) URL that the server is about to contact on behalf of a user and, unless private networks are
 * allowed, refuses hosts that resolve to loopback/private ranges (SSRF). DNS rebinding between this check and the
 * request is not prevented; production deployments should also restrict egress at the network level.
 */
export async function assertSafeHttpUrl(raw: string, allowPrivate: boolean, what = "URL"): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new HttpError(400, "VALIDATION_FAILED", `${what} is not a valid URL`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new HttpError(400, "VALIDATION_FAILED", `${what} must be http(s)`);
  if (u.username || u.password) throw new HttpError(400, "VALIDATION_FAILED", `${what} must not contain credentials`);
  if (allowPrivate) return u;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new HttpError(400, "PRIVATE_ADDRESS", `${what} points at a private host`);
  }
  const addresses = isIP(host) ? [host] : await lookup(host, { all: true }).then((r) => r.map((x) => x.address)).catch(() => []);
  if (addresses.length === 0) throw new HttpError(400, "VALIDATION_FAILED", `${what} host does not resolve`);
  if (addresses.some(isPrivateAddress)) throw new HttpError(400, "PRIVATE_ADDRESS", `${what} resolves to a private address`);
  return u;
}

/** An RPC URL as it may be shown to clients: origin only, because provider API keys usually live in the path or query. */
export function publicRpcOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

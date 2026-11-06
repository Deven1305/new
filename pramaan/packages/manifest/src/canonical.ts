/**
 * RFC 8785 JSON Canonicalization Scheme (JCS).
 *
 * The manifest digest is taken over these bytes, so two parties that hold the same manifest object always compute the
 * same sha256. Only JSON-compatible values are accepted: anything else throws instead of being silently dropped.
 */
export function canonicalize(value: unknown): string {
  return serialize(value, new Set());
}

export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalize(value));
}

function serialize(value: unknown, seen: Set<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("canonicalize: non-finite number");
      // ECMAScript Number::toString is exactly the RFC 8785 number serialization.
      return JSON.stringify(value);
    case "string":
      // JSON.stringify escapes only '"', '\\' and control characters, as RFC 8785 requires.
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new TypeError(`canonicalize: unsupported type ${typeof value}`);
  }
  const obj = value as object;
  if (seen.has(obj)) throw new TypeError("canonicalize: cyclic structure");
  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      return `[${obj.map((v) => (v === undefined ? "null" : serialize(v, seen))).join(",")}]`;
    }
    if (Object.getPrototypeOf(obj) !== Object.prototype && Object.getPrototypeOf(obj) !== null) {
      throw new TypeError("canonicalize: only plain objects are allowed");
    }
    const entries = Object.entries(obj as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      // Default sort compares UTF-16 code units, which is the ordering RFC 8785 specifies.
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${serialize(v, seen)}`).join(",")}}`;
  } finally {
    seen.delete(obj);
  }
}

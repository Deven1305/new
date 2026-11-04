import { z } from "zod";

/** An error whose code and message are safe to show to the client. Anything else becomes a generic 500. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = "BAD_REQUEST") => new HttpError(400, code, message);
export const unauthorized = (message = "sign in required", code = "UNAUTHORIZED") => new HttpError(401, code, message);
export const forbidden = (message = "forbidden", code = "FORBIDDEN") => new HttpError(403, code, message);
export const notFound = (what = "resource") => new HttpError(404, "NOT_FOUND", `${what} not found`);
export const conflict = (message: string, code = "CONFLICT", extra: Record<string, unknown> = {}) => new HttpError(409, code, message, extra);
export const unprocessable = (message: string, code = "UNPROCESSABLE") => new HttpError(422, code, message);
/** A feature that needs configuration the operator has not provided. Never a fake success. */
export const notConfigured = (code: string, message: string) => new HttpError(501, code, message);

/** Validates untrusted input with zod; failures become 400 VALIDATION_FAILED with the first issue. */
export function parse<T extends z.ZodType>(schema: T, value: unknown, what = "request"): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) {
    const issue = r.error.issues[0];
    const path = issue?.path.length ? issue.path.join(".") : what;
    throw new HttpError(400, "VALIDATION_FAILED", `${path}: ${issue?.message ?? "invalid"}`);
  }
  return r.data;
}

/** Message for logs and job errors: never includes stack traces, and strips anything that looks like a secret. */
export function safeMessage(err: unknown, secrets: (string | undefined)[] = []): string {
  let msg = err instanceof Error ? err.message : String(err);
  for (const s of secrets) if (s && s.length >= 6) msg = msg.split(s).join("[redacted]");
  msg = msg.replace(/bot\d+:[A-Za-z0-9_-]{20,}/g, "bot[redacted]").replace(/\b(pat|ses)_[A-Za-z0-9_-]{20,}/g, "$1_[redacted]");
  return msg.slice(0, 4000);
}

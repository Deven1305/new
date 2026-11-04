/**
 * Pramaan backend API client.
 *
 * - Every request uses `credentials: "include"` so the SIWE session cookie travels with it.
 * - With a pasted API token the request carries `Authorization: Bearer <token>` (token mode needs no CSRF header).
 * - Cookie-authenticated POST/PATCH/DELETE requests carry `x-pramaan-csrf`. A 403 that names CSRF triggers one
 *   refresh of the token (GET /v1/me) and a single retry.
 * - Failures become an ApiError with a `kind` the UI can explain ("backend unreachable at …", "sign in required", …).
 */

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export type ApiErrorKind =
  | "unreachable"
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "conflict"
  | "invalid"
  | "too-large"
  | "rate-limited"
  | "unavailable"
  | "server"
  | "bad-response"
  | "unexpected";

export class ApiError extends Error {
  override readonly name = "ApiError";
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly url: string;
  readonly body: unknown;
  readonly retryAfterSeconds: number | null;

  constructor(kind: ApiErrorKind, message: string, init: { status: number; url: string; body?: unknown; retryAfterSeconds?: number | null }) {
    super(message);
    this.kind = kind;
    this.status = init.status;
    this.url = init.url;
    this.body = init.body;
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

export function errorKindForStatus(status: number): ApiErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 409) return "conflict";
  if (status === 413) return "too-large";
  if (status === 429) return "rate-limited";
  if (status === 400 || status === 422) return "invalid";
  if (status === 501 || status === 503) return "unavailable";
  if (status >= 500) return "server";
  return "unexpected";
}

/** Pulls a human message out of the backend's error body ({message}, {error}, {error:{message}}, or text). */
export function messageFromBody(body: unknown): string | null {
  if (typeof body === "string") {
    const t = body.trim();
    return t ? t.slice(0, 400) : null;
  }
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (typeof b["message"] === "string" && b["message"].trim()) return b["message"].trim();
    const e = b["error"];
    if (typeof e === "string" && e.trim()) return e.trim();
    if (e && typeof e === "object" && typeof (e as Record<string, unknown>)["message"] === "string") return String((e as Record<string, unknown>)["message"]);
    if (typeof b["detail"] === "string" && b["detail"].trim()) return b["detail"].trim();
  }
  return null;
}

const STATUS_TEXT: Partial<Record<ApiErrorKind, string>> = {
  unauthorized: "Sign in required",
  forbidden: "You do not have access to this",
  "not-found": "Not found",
  conflict: "Conflict with the current state",
  invalid: "The backend rejected the request",
  "too-large": "The upload is too large",
  "rate-limited": "Too many requests",
  unavailable: "Not available on this backend",
  server: "The backend reported an error",
};

export function toApiError(status: number, body: unknown, url: string, headers?: Headers): ApiError {
  const kind = errorKindForStatus(status);
  const retry = headers?.get("retry-after");
  const retryAfterSeconds = retry && /^\d+$/.test(retry) ? Number(retry) : null;
  const message = messageFromBody(body) ?? STATUS_TEXT[kind] ?? `HTTP ${status}`;
  return new ApiError(kind, message, { status, url, body, retryAfterSeconds });
}

function looksLikeCsrfFailure(err: ApiError): boolean {
  return err.status === 403 && /csrf/i.test(`${err.message} ${JSON.stringify(err.body ?? "")}`);
}

function isAbortError(err: unknown): boolean {
  return (err instanceof DOMException && err.name === "AbortError") || (err instanceof Error && err.name === "AbortError");
}

export interface AuthMaterial {
  /** API token pasted by the user (kept in sessionStorage only). */
  bearer: string | null;
  /** CSRF token from GET /v1/me or the SIWE response (memory only). */
  csrf: string | null;
}

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  /** JSON body. */
  body?: unknown;
  /** Multipart body (the browser sets the boundary). */
  form?: FormData;
  signal?: AbortSignal;
  responseType?: "json" | "text" | "bytes";
}

export interface ApiClientOptions {
  baseUrl: string;
  fetchFn?: typeof fetch;
  auth?: () => AuthMaterial;
  /** Called once when a cookie-authenticated mutation fails CSRF; returns the new token (or null). */
  refreshCsrf?: () => Promise<string | null>;
}

async function readBody(res: Response): Promise<unknown> {
  const type = res.headers.get("content-type") ?? "";
  const text = await res.text().catch(() => "");
  if (!text) return null;
  if (type.includes("json")) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}

export class ApiClient {
  readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly auth: () => AuthMaterial;
  private readonly refreshCsrf?: () => Promise<string | null>;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.fetchFn = opts.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
    this.auth = opts.auth ?? (() => ({ bearer: null, csrf: null }));
    this.refreshCsrf = opts.refreshCsrf;
  }

  /** The auth mode requests currently use. EventSource cannot send headers, so token mode streams by polling. */
  authMode(): "token" | "cookie" {
    return this.auth().bearer ? "token" : "cookie";
  }

  url(path: string, query?: Record<string, QueryValue>): string {
    const p = path.startsWith("/") ? path : `/${path}`;
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v === undefined || v === null || v === "") continue;
      qs.set(k, String(v));
    }
    const s = qs.toString();
    return `${this.baseUrl}${p}${s ? `?${s}` : ""}`;
  }

  get<T>(path: string, opts: Omit<RequestOptions, "body" | "form"> = {}): Promise<T> {
    return this.request<T>("GET", path, opts);
  }
  post<T>(path: string, body?: unknown, opts: Omit<RequestOptions, "body"> = {}): Promise<T> {
    return this.request<T>("POST", path, { ...opts, body });
  }
  patch<T>(path: string, body?: unknown, opts: Omit<RequestOptions, "body"> = {}): Promise<T> {
    return this.request<T>("PATCH", path, { ...opts, body });
  }
  delete<T>(path: string, opts: Omit<RequestOptions, "body"> = {}): Promise<T> {
    return this.request<T>("DELETE", path, opts);
  }

  request<T>(method: HttpMethod, path: string, opts: RequestOptions = {}): Promise<T> {
    return this.send<T>(method, path, opts, true);
  }

  private async send<T>(method: HttpMethod, path: string, opts: RequestOptions, allowCsrfRetry: boolean): Promise<T> {
    const url = this.url(path, opts.query);
    const { bearer, csrf } = this.auth();
    const mutating = method !== "GET";
    const headers: Record<string, string> = { accept: "application/json" };
    if (bearer) headers["authorization"] = `Bearer ${bearer}`;
    else if (mutating && csrf) headers["x-pramaan-csrf"] = csrf;

    let body: BodyInit | undefined;
    if (opts.form) {
      body = opts.form;
    } else if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(opts.body);
    }

    let res: Response;
    try {
      res = await this.fetchFn(url, { method, headers, body, credentials: "include", signal: opts.signal, cache: "no-store" });
    } catch (err) {
      if (isAbortError(err)) throw err;
      throw new ApiError("unreachable", `Backend unreachable at ${this.baseUrl}`, { status: 0, url });
    }

    if (!res.ok) {
      const parsed = await readBody(res);
      const error = toApiError(res.status, parsed, url, res.headers);
      if (mutating && !bearer && allowCsrfRetry && this.refreshCsrf && looksLikeCsrfFailure(error)) {
        const fresh = await this.refreshCsrf().catch(() => null);
        if (fresh) return this.send<T>(method, path, opts, false);
      }
      throw error;
    }

    if (res.status === 204 || res.status === 205) return undefined as T;
    if (opts.responseType === "bytes") return new Uint8Array(await res.arrayBuffer()) as T;
    const text = await res.text();
    if (opts.responseType === "text") return text as T;
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError("bad-response", "The backend sent a response that is not valid JSON", { status: res.status, url, body: text.slice(0, 400) });
    }
  }
}

export interface ErrorDescription {
  title: string;
  detail: string;
  hint: string | null;
}

/** Plain-language explanation of any error for the UI. */
export function describeError(err: unknown, baseUrl: string): ErrorDescription {
  if (isApiError(err)) {
    switch (err.kind) {
      case "unreachable":
        return {
          title: "Backend unreachable",
          detail: `Could not reach the Pramaan backend at ${baseUrl}.`,
          hint: "Start it with `pnpm server` (or `pnpm dev:server`), or point VITE_API_URL at a running backend. Verification in the browser extension does not need it.",
        };
      case "unauthorized":
        return { title: "Sign in required", detail: err.message, hint: "Sign in with your wallet or paste an API token." };
      case "forbidden":
        return { title: "Not allowed", detail: err.message, hint: null };
      case "not-found":
        return { title: "Not found", detail: err.message, hint: null };
      case "rate-limited":
        return { title: "Too many requests", detail: err.message, hint: err.retryAfterSeconds ? `Try again in ${err.retryAfterSeconds} s.` : "Wait a moment and try again." };
      case "unavailable":
        return { title: "Not available on this backend", detail: err.message, hint: null };
      case "too-large":
        return { title: "Upload too large", detail: err.message, hint: "The backend limits upload size (MAX_UPLOAD_MB)." };
      case "invalid":
        return { title: "Request rejected", detail: err.message, hint: null };
      case "conflict":
        return { title: "Conflict", detail: err.message, hint: null };
      case "server":
        return { title: `Backend error (HTTP ${err.status})`, detail: err.message, hint: null };
      case "bad-response":
        return { title: "Unexpected response", detail: err.message, hint: null };
      default:
        return { title: `Request failed (HTTP ${err.status})`, detail: err.message, hint: null };
    }
  }
  if (err instanceof Error) return { title: "Something went wrong", detail: err.message, hint: null };
  return { title: "Something went wrong", detail: String(err), hint: null };
}

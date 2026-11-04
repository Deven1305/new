import { isApiError, type ApiClient, type ApiError } from "./api";
import { TERMINAL_JOB_STATUSES, type Job, type JobEvent, type JobStatus } from "./types";

/**
 * Live job progress. Cookie sessions use Server-Sent Events (GET /v1/jobs/:id/stream with credentials); if the stream
 * cannot be opened or drops, or when the user is authenticated with an API token (EventSource cannot send an
 * Authorization header), it falls back to polling GET /v1/jobs/:id/events?after=<seq> plus GET /v1/jobs/:id.
 */

export type StreamMode = "connecting" | "sse" | "polling" | "done" | "stopped";

const STATUSES = new Set<string>(["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"]);

function asEvent(value: unknown): JobEvent | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const seq = typeof v["seq"] === "number" ? v["seq"] : typeof v["seq"] === "string" && /^\d+$/.test(v["seq"]) ? Number(v["seq"]) : NaN;
  if (!Number.isFinite(seq)) return null;
  const step = typeof v["step"] === "string" ? v["step"] : null;
  const status = typeof v["status"] === "string" ? v["status"] : null;
  if (!step || !status) return null;
  const message = typeof v["message"] === "string" ? v["message"] : "";
  const createdAt = typeof v["createdAt"] === "string" ? v["createdAt"] : typeof v["at"] === "string" ? (v["at"] as string) : "";
  return { seq, step, status, message, createdAt };
}

/** Parses the `data:` payload of an SSE "progress" event. Returns null for anything malformed. */
export function parseProgressData(data: string): JobEvent | null {
  try {
    return asEvent(JSON.parse(data));
  } catch {
    return null;
  }
}

/** Parses the `data:` payload of an SSE "status" event ({status}). */
export function parseStatusData(data: string): JobStatus | null {
  try {
    const v = JSON.parse(data) as unknown;
    const s = typeof v === "string" ? v : v && typeof v === "object" ? (v as Record<string, unknown>)["status"] : null;
    return typeof s === "string" && STATUSES.has(s.toUpperCase()) ? (s.toUpperCase() as JobStatus) : null;
  } catch {
    return null;
  }
}

/** Normalises an events response (array, or {events:[...]}) into valid events. */
export function parseEventsResponse(body: unknown): JobEvent[] {
  const list = Array.isArray(body) ? body : body && typeof body === "object" && Array.isArray((body as Record<string, unknown>)["events"]) ? ((body as Record<string, unknown>)["events"] as unknown[]) : [];
  return list.map(asEvent).filter((e): e is JobEvent => e !== null);
}

/** Merges new events into the list: de-duplicated by seq, ascending. Returns the same array when nothing changed. */
export function mergeEvents(existing: JobEvent[], incoming: JobEvent[]): JobEvent[] {
  if (incoming.length === 0) return existing;
  const bySeq = new Map<number, JobEvent>();
  for (const e of existing) bySeq.set(e.seq, e);
  let changed = false;
  for (const e of incoming) {
    if (!bySeq.has(e.seq)) {
      bySeq.set(e.seq, e);
      changed = true;
    }
  }
  if (!changed) return existing;
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

export const isTerminal = (status: string | null | undefined) => !!status && TERMINAL_JOB_STATUSES.has(status);

export interface EventSourceLike {
  readonly readyState: number;
  addEventListener(type: string, listener: (ev: MessageEvent) => void): void;
  close(): void;
  onerror: ((ev: Event) => unknown) | null;
  onopen: ((ev: Event) => unknown) | null;
}

export type EventSourceFactory = (url: string, init: { withCredentials: boolean }) => EventSourceLike;

export interface WatchJobOptions {
  jobId: string;
  client: ApiClient;
  /** Server-Sent Events are attempted only when true (cookie session) and a factory is available. */
  preferSse: boolean;
  onEvents: (events: JobEvent[]) => void;
  onStatus: (status: JobStatus, job?: Job) => void;
  onMode?: (mode: StreamMode) => void;
  onError?: (error: ApiError | Error) => void;
  eventSourceFactory?: EventSourceFactory | null;
  pollIntervalMs?: number;
  maxPollIntervalMs?: number;
  /** Interval of the background status check while streaming (default 10 s). */
  sseStatusCheckMs?: number;
}

export function defaultEventSourceFactory(): EventSourceFactory | null {
  if (typeof globalThis.EventSource !== "function") return null;
  return (url, init) => new globalThis.EventSource(url, init) as unknown as EventSourceLike;
}

/** Starts watching a job; returns a stop function. */
export function watchJob(opts: WatchJobOptions): () => void {
  const pollMs = opts.pollIntervalMs ?? 2000;
  const maxPollMs = opts.maxPollIntervalMs ?? 15000;
  let stopped = false;
  let lastSeq = 0;
  let es: EventSourceLike | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let polling = false;
  let currentDelay = pollMs;
  let finished = false;

  const setMode = (m: StreamMode) => {
    if (!stopped || m === "stopped") opts.onMode?.(m);
  };

  const deliver = (events: JobEvent[]) => {
    if (stopped || events.length === 0) return;
    for (const e of events) if (e.seq > lastSeq) lastSeq = e.seq;
    opts.onEvents(events);
  };

  const fetchEvents = async () => {
    const body = await opts.client.get<unknown>(`/v1/jobs/${encodeURIComponent(opts.jobId)}/events`, { query: { after: lastSeq } });
    deliver(parseEventsResponse(body));
  };

  const finish = async (status: JobStatus, job?: Job) => {
    if (finished) return;
    finished = true;
    closeStream();
    if (timer) clearTimeout(timer);
    try {
      await fetchEvents();
    } catch {
      // the final catch-up is best effort; the status is already known
    }
    if (stopped) return;
    opts.onStatus(status, job);
    setMode("done");
  };

  const closeStream = () => {
    if (es) {
      es.onerror = null;
      es.onopen = null;
      es.close();
      es = null;
    }
  };

  const pollOnce = async () => {
    if (stopped || finished) return;
    try {
      await fetchEvents();
      const job = await opts.client.get<Job>(`/v1/jobs/${encodeURIComponent(opts.jobId)}`);
      if (stopped) return;
      currentDelay = pollMs;
      if (job && isTerminal(job.status)) {
        await finish(job.status, job);
        return;
      }
      if (job?.status) opts.onStatus(job.status, job);
    } catch (err) {
      if (stopped) return;
      opts.onError?.(err as Error);
      // Access problems will not fix themselves by polling harder.
      if (isApiError(err) && (err.kind === "unauthorized" || err.kind === "forbidden" || err.kind === "not-found")) {
        setMode("stopped");
        return;
      }
      currentDelay = Math.min(currentDelay * 2, maxPollMs);
    }
    if (!stopped && !finished) timer = setTimeout(() => void pollOnce(), currentDelay);
  };

  const startPolling = () => {
    if (stopped || finished || polling) return;
    polling = true;
    closeStream();
    if (timer) clearTimeout(timer);
    setMode("polling");
    void pollOnce();
  };

  const factory = opts.eventSourceFactory === undefined ? defaultEventSourceFactory() : opts.eventSourceFactory;

  // While streaming, a slow status check catches a stream that stalls or never sends a terminal "status" event.
  const statusCheckMs = opts.sseStatusCheckMs ?? 10_000;
  const scheduleStatusCheck = () => {
    if (stopped || finished || polling) return;
    timer = setTimeout(async () => {
      if (stopped || finished || polling) return;
      try {
        const job = await opts.client.get<Job>(`/v1/jobs/${encodeURIComponent(opts.jobId)}`);
        if (job && isTerminal(job.status)) {
          await finish(job.status, job);
          return;
        }
      } catch (err) {
        opts.onError?.(err as Error);
      }
      scheduleStatusCheck();
    }, statusCheckMs);
  };

  if (opts.preferSse && factory) {
    setMode("connecting");
    try {
      const source = factory(opts.client.url(`/v1/jobs/${encodeURIComponent(opts.jobId)}/stream`), { withCredentials: true });
      es = source;
      scheduleStatusCheck();
      source.onopen = () => {
        if (!stopped && !finished) setMode("sse");
      };
      source.addEventListener("progress", (ev) => {
        const e = parseProgressData(String(ev.data));
        if (e) deliver([e]);
      });
      source.addEventListener("status", (ev) => {
        const s = parseStatusData(String(ev.data));
        if (!s || stopped) return;
        if (isTerminal(s)) void finish(s);
        else opts.onStatus(s);
      });
      // Any stream error (refused, dropped, auth) hands over to polling, which resumes after the last seq seen.
      source.onerror = () => {
        if (!stopped && !finished) startPolling();
      };
      // History the stream may not replay.
      void fetchEvents().catch((err: unknown) => opts.onError?.(err as Error));
    } catch {
      startPolling();
    }
  } else {
    startPolling();
  }

  return () => {
    stopped = true;
    closeStream();
    if (timer) clearTimeout(timer);
    opts.onMode?.("stopped");
  };
}

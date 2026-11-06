import type { Config } from "./config.js";
import type { Ctx } from "./context.js";
import type { Db } from "./db.js";
import { safeMessage } from "./errors.js";

export type AlertSeverity = "critical" | "warning" | "info";

export interface AlertInput {
  projectId: string;
  monitorEventId?: string | null;
  source: "monitor" | "cre";
  severity: AlertSeverity;
  kind: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  eta?: Date | null;
  /** Identity of the thing being alerted about; the same key can never produce a second alert. */
  key: string;

}

export interface AlertRow {
  id: string;
  project_id: string;
  monitor_event_id: string | null;
  source: string;
  severity: AlertSeverity;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  eta: Date | null;
  status: "open" | "acked";
  acked_at: Date | null;
  acked_by: string | null;
  delivery: Record<string, unknown>;
  created_at: Date;
}

export const telegramConfigured = (cfg: Config): boolean => Boolean(cfg.TELEGRAM_BOT_TOKEN && cfg.TELEGRAM_CHAT_ID);

/** Inserts the alert unless one with the same key exists. Returns the new row, or null for a duplicate. */
export async function insertAlert(db: Db, a: AlertInput): Promise<AlertRow | null> {
  return db.one<AlertRow>(
    `INSERT INTO alerts (project_id, monitor_event_id, source, severity, kind, title, body, data, eta, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`,
    [a.projectId, a.monitorEventId ?? null, a.source, a.severity, a.kind, a.title.slice(0, 300), a.body.slice(0, 4000), JSON.stringify(a.data ?? {}, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), a.eta ?? null, a.key],
  );
}

export interface TelegramResult {
  status: "sent" | "failed" | "disabled";
  attempts: number;
  error?: string;
}

/**
 * Sends one plain-text message through the Telegram Bot API. Retries network errors, 429 and 5xx up to three times;
 * other 4xx answers (bad token, bad chat id) fail immediately. Disabled = no request is made at all.
 */
export async function sendTelegram(ctx: Ctx, text: string): Promise<TelegramResult> {
  const { cfg, deps } = ctx;
  const token = cfg.TELEGRAM_BOT_TOKEN;
  const chat = cfg.TELEGRAM_CHAT_ID;
  if (!token || !chat) return { status: "disabled", attempts: 0, error: "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are not set" };
  const url = `${cfg.TELEGRAM_API_URL.replace(/\/$/, "")}/bot${token}/sendMessage`;
  let lastError = "";
  const max = 3;
  for (let attempt = 1; attempt <= max; attempt++) {
    let retryAfterMs = 500 * 2 ** (attempt - 1);
    try {
      const res = await deps.fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text: text.slice(0, 4000), disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; description?: string; parameters?: { retry_after?: number } } | null;
      if (res.ok && body?.ok === true) return { status: "sent", attempts: attempt };
      lastError = `HTTP ${res.status}${body?.description ? `: ${body.description}` : ""}`;
      if (res.status === 429 && body?.parameters?.retry_after) retryAfterMs = Math.min(body.parameters.retry_after * 1000, 10_000);
      else if (res.status < 500 && res.status !== 429) return { status: "failed", attempts: attempt, error: safeMessage(lastError, [token, chat]) };
    } catch (err) {
      lastError = safeMessage(err, [token, chat]);
    }
    if (attempt < max) await deps.sleep(retryAfterMs);
  }
  return { status: "failed", attempts: max, error: safeMessage(lastError, [token, chat]) };
}

export function formatAlertText(projectName: string, a: Pick<AlertInput, "severity" | "title" | "body" | "eta">): string {
  const eta = a.eta ? `\nETA: ${a.eta.toISOString()}` : "";
  return `[${a.severity.toUpperCase()}] ${projectName}\n${a.title}\n${a.body}${eta}`;
}

/** Records how an alert was delivered. "disabled" and "failed" are stored as such; nothing is ever marked sent unless Telegram said ok. */
export async function deliverAlert(ctx: Ctx, row: AlertRow): Promise<TelegramResult> {
  const project = await ctx.db.one<{ name: string }>("SELECT name FROM projects WHERE id = $1", [row.project_id]);
  const result = await sendTelegram(ctx, formatAlertText(project?.name ?? "project", { severity: row.severity, title: row.title, body: row.body, eta: row.eta }));
  const delivery = { telegram: { ...result, at: ctx.deps.now().toISOString() } };
  await ctx.db.query("UPDATE alerts SET delivery = $2 WHERE id = $1", [row.id, JSON.stringify(delivery)]);
  row.delivery = delivery;
  if (result.status === "failed") ctx.log.warn({ alert: row.id, error: result.error }, "telegram delivery failed");
  return result;
}

/** Idempotent create + deliver. */
export async function raiseAlert(ctx: Ctx, a: AlertInput): Promise<{ alert: AlertRow | null; created: boolean }> {
  const row = await insertAlert(ctx.db, a);
  if (!row) return { alert: null, created: false };
  await deliverAlert(ctx, row);
  return { alert: row, created: true };
}

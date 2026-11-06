import type { CheckRow, Level } from "./index.js";

/** HexFence recipient verdicts (GREEN/RED/AMBER/GREY) as a `recipient` or `action` row. */
export type HexFenceVerdict = "GREEN" | "RED" | "AMBER" | "GREY";

const levelOf: Record<HexFenceVerdict, Level> = { GREEN: "green", RED: "red", AMBER: "amber", GREY: "grey" };

export function recipientRow(verdict: HexFenceVerdict, code: string, params: Record<string, string> = {}, evidence?: string[]): CheckRow {
  return { kind: verdict === "GREY" ? "action" : "recipient", level: levelOf[verdict], code, params, ...(evidence ? { evidence } : {}) };
}

/** Pramaan severities: info/low -> green, medium -> amber, high/critical -> red. */
export type PramaanSeverity = "info" | "low" | "medium" | "high" | "critical";

export function actionRow(sev: PramaanSeverity, code: string, params: Record<string, string> = {}): CheckRow {
  const level: Level = sev === "info" || sev === "low" ? "green" : sev === "medium" ? "amber" : "red";
  return { kind: "action", level, code, params };
}

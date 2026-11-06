export type Level = "green" | "amber" | "red" | "grey";
export type RowKind = "app" | "contract" | "action" | "recipient" | "privacy";

export interface CheckRow {
  kind: RowKind;
  level: Level;
  code: string;
  params: Record<string, string>;
  evidence?: string[];
}

export type Hold = "pass" | "confirm" | "block";
export interface Policy {
  onRed: "block" | "typed-override";
  onAmber: "confirm" | "pass";
  onGrey: "confirm";
}
export interface CheckResult {
  rows: CheckRow[];
  overall: Level;
  hold: Hold;
  checkedAt: string;
}

export const defaultPolicy: Policy = { onRed: "typed-override", onAmber: "confirm", onGrey: "confirm" };

const rank: Record<Level, number> = { green: 0, grey: 1, amber: 2, red: 3 };

/** Worst row wins; grey is never upgraded to green. No rows means grey (nothing was checked). */
export function combine(rows: CheckRow[], policy: Policy = defaultPolicy, now = new Date()): CheckResult {
  let overall: Level = rows.length === 0 ? "grey" : "green";
  for (const r of rows) if (rank[r.level] > rank[overall]) overall = r.level;
  const hold: Hold =
    overall === "red" ? (policy.onRed === "block" ? "block" : "confirm")
    : overall === "amber" ? policy.onAmber
    : overall === "grey" ? policy.onGrey
    : "pass";
  return { rows, overall, hold, checkedAt: now.toISOString() };
}
export * from "./adapters.js";

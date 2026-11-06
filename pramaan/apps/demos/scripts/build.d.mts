export interface BuildResult {
  appId: string;
  dist: string;
  fixtures: string | null;
  findings: number;
}
export function appConfigJson(state: unknown, appId: string): string;
export function buildApp(state: unknown, appId: string, opts?: { out?: string; fixtures?: boolean; appsRoot?: string }): Promise<BuildResult>;
export function buildAll(statePath: string, opts?: { only?: string; out?: string; fixtures?: boolean; appsRoot?: string }): Promise<BuildResult[]>;

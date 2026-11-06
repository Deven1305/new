export const DEFAULT_PORTS: { vaultlab: number; mirroryield: number; lookalike: number; permitmarket: number; admin: number; tracker: number };
export function resolveStaticFile(root: string, urlPath: string): string | null;
export interface RunningDemoServers {
  ports: typeof DEFAULT_PORTS;
  urls: Record<string, string>;
  trackerLog: Record<string, unknown>[];
  state: any;
  close(): Promise<unknown>;
}
export function startDemoServers(opts?: { statePath?: string; fixtures?: boolean; out?: string; ports?: Partial<typeof DEFAULT_PORTS>; quiet?: boolean }): Promise<RunningDemoServers>;

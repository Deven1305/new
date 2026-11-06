export const DEMOS_ROOT: string;
export const REPO_ROOT: string;
export const APP_IDS: readonly ["vaultlab", "mirroryield", "permitmarket"];
export function repoPath(p: string): string;
export function defaultStatePath(): string;
export function loadState(path: string): any;
export function outputDirs(state: unknown, appId: string, out?: string): { dist: string; fixtures: string };

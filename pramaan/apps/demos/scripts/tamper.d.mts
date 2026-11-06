export interface TamperFile {
  path: string;
  replacements: number;
  originalSha256: string;
  patchedSha256: string;
}
export interface TamperResult {
  replacements: number;
  files: TamperFile[];
}
export interface StatusFile {
  path: string;
  originalSha256: string;
  currentSha256: string | null;
}
export interface TamperStatus {
  tampered: boolean;
  from: string | null;
  to: string | null;
  originalSha256: string | null;
  currentSha256: string | null;
  changed?: boolean;
  files: StatusFile[];
}
export function replaceAddress(text: string, from: string, to: string): { text: string; count: number };
export function tamper(opts: { distDir: string; backupDir: string; from: string; to: string }): TamperResult;
export function restore(opts: { distDir: string; backupDir: string }): { files: { path: string; sha256: string }[] };
export function status(opts: { distDir: string; backupDir: string; address?: string }): TamperStatus;
export function backupDirFor(distDir: string): string;

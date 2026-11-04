// Shared by build.mjs, server/serve.mjs and the tests: paths and demo-state loading (no heavy imports here).
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const DEMOS_ROOT = resolve(here, "..");
export const REPO_ROOT = resolve(DEMOS_ROOT, "../..");
export const APP_IDS = ["vaultlab", "mirroryield", "permitmarket"];
export const repoPath = (p) => (isAbsolute(p) ? p : join(REPO_ROOT, p));
export const defaultStatePath = () => resolve(process.env["PRAMAAN_DEMO_STATE"] ?? join(REPO_ROOT, ".pramaan", "demo", "state.json"));

export function loadState(path) {
  if (!existsSync(path)) throw new Error(`missing demo state ${path}: run \`pnpm demo:up\` first`);
  const state = JSON.parse(readFileSync(path, "utf8"));
  if (state.version !== 2 || !state.apps || !state.network) throw new Error(`${path} is not a DemoStateV2 file (version 2 expected)`);
  for (const id of APP_IDS) {
    const app = state.apps[id];
    if (!app || typeof app.contracts !== "object") throw new Error(`demo state has no app "${id}"`);
    if (!/^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/.test(app.origin)) throw new Error(`apps.${id}.origin must be an origin without a path (got ${app.origin})`);
  }
  return state;
}

/** Where an app's production build and PermitMarket's fixture build live. `out` (a root dir) overrides the state's distDir. */
export function outputDirs(state, appId, out) {
  if (out) return { dist: join(resolve(out), "dist", appId), fixtures: join(resolve(out), "dist-fixtures", appId) };
  return { dist: repoPath(state.apps[appId].distDir), fixtures: join(DEMOS_ROOT, "dist-fixtures", appId) };
}

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { cloneRepository, copyProject, extractZip, findFoundryRoot, treeDigest } from "@pramaan/engine";
import { REPO_ROOT } from "@pramaan/release";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import type { JobSource } from "./queue.js";

export const EXAMPLES: Record<string, { dir: string; label: string }> = {
  contracts: { dir: join(REPO_ROOT, "contracts"), label: "local:pramaan/contracts (Kosh Vault demo)" },
  "reentrancy-bank": { dir: join(REPO_ROOT, "examples", "reentrancy-bank"), label: "local:pramaan/examples/reentrancy-bank" },
  "initializer-takeover": { dir: join(REPO_ROOT, "examples", "initializer-takeover"), label: "local:pramaan/examples/initializer-takeover" },
  "oracle-lending": { dir: join(REPO_ROOT, "examples", "oracle-lending"), label: "local:pramaan/examples/oracle-lending" },
};

export interface Workspace {
  dir: string;
  commit: string;
  label: string;
  cleanup: () => void;
}

/**
 * Puts the job's code in a fresh workspace directory. Nothing from the repository is executed here: cloning disables
 * symlinks, hooks and local/ext protocols; uploads are extracted with zip-slip checks; all code then runs only inside
 * the network-less sandbox.
 */
export async function materialize(db: Db, cfg: Config, source: JobSource, jobId: string): Promise<Workspace> {
  const dir = join(cfg.DATA_DIR, "workspaces", jobId);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  try {
    if (source.type === "example") {
      const ex = EXAMPLES[source.name];
      if (!ex) throw new Error(`unknown example ${source.name}`);
      copyProject(ex.dir, dir);
      return { dir, commit: treeDigest(dir), label: ex.label, cleanup };
    }
    if (source.type === "github") {
      const { commit } = await cloneRepository(source.url, join(dir, "repo"), source.ref);
      const root = findFoundryRoot(join(dir, "repo"));
      if (!root) throw new Error("no foundry.toml found in the repository (only Foundry projects are supported)");
      return { dir: root, commit, label: source.url.replace(/\.git$/, ""), cleanup };
    }
    if (source.type === "upload") {
      const up = await db.one<{ path: string; sha256: string }>("SELECT path, sha256 FROM uploads WHERE id = $1", [source.uploadId]);
      if (!up || !existsSync(up.path)) throw new Error("upload not found");
      extractZip(new Uint8Array(readFileSync(up.path)), join(dir, "upload"));
      const root = findFoundryRoot(join(dir, "upload"));
      if (!root) throw new Error("no foundry.toml found in the uploaded archive");
      return { dir: root, commit: treeDigest(root), label: `upload:${up.sha256.slice(0, 12)}`, cleanup };
    }
    throw new Error("unsupported source");
  } catch (err) {
    cleanup();
    throw err;
  }
}

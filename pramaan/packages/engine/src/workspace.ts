import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { unzipSync } from "fflate";

const run = promisify(execFile);

export interface CopyLimits {
  maxFiles: number;
  maxBytes: number;
}
export const DEFAULT_COPY_LIMITS: CopyLimits = { maxFiles: 20_000, maxBytes: 300 * 1024 * 1024 };
const SKIP_DIRS = new Set([".git", "out", "cache", "broadcast", "crytic-export", ".pramaan", "artifacts"]);

/** Copies a project for analysis, refusing symlinks and enforcing file-count and size limits. */
export function copyProject(src: string, dest: string, limits: CopyLimits = DEFAULT_COPY_LIMITS): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const st = lstatSync(full);
      if (st.isSymbolicLink()) throw new Error(`symlinks are not allowed in analysed projects: ${relative(src, full)}`);
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
        continue;
      }
      if (!st.isFile()) continue;
      files += 1;
      bytes += st.size;
      if (files > limits.maxFiles) throw new Error(`project has more than ${limits.maxFiles} files`);
      if (bytes > limits.maxBytes) throw new Error(`project is larger than ${limits.maxBytes} bytes`);
      const target = join(dest, relative(src, full));
      mkdirSync(dirname(target), { recursive: true });
      cpSync(full, target);
    }
  };
  mkdirSync(dest, { recursive: true });
  walk(src);
  return { files, bytes };
}

export const ALLOWED_GIT_HOSTS = (process.env.PRAMAAN_GIT_HOSTS ?? "github.com,gitlab.com,bitbucket.org,codeberg.org").split(",");

export function validateGitUrl(url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("repository URL is not a valid URL");
  }
  if (u.protocol !== "https:") throw new Error("only https:// repository URLs are accepted");
  if (u.username || u.password) throw new Error("repository URLs must not contain credentials");
  if (!ALLOWED_GIT_HOSTS.includes(u.hostname)) throw new Error(`repository host ${u.hostname} is not allowed`);
  if (!/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\.git)?\/?$/.test(u.pathname)) throw new Error("repository URL must look like https://host/owner/repo");
  return u;
}

export function validateRef(ref: string): string {
  if (!/^[A-Za-z0-9._/-]{1,100}$/.test(ref) || ref.startsWith("-") || ref.includes("..")) throw new Error(`invalid git ref "${ref}"`);
  return ref;
}

const SAFE_GIT = [
  "-c", "core.symlinks=false",
  "-c", "protocol.file.allow=never",
  "-c", "protocol.ext.allow=never",
  "-c", "core.hooksPath=/dev/null",
  "-c", "advice.detachedHead=false",
];

/** Shallow clone of a public repository. Symlinks are checked out as plain files; local/ext protocols are disabled. */
export async function cloneRepository(url: string, dest: string, ref?: string): Promise<{ commit: string }> {
  const u = validateGitUrl(url);
  const args = [...SAFE_GIT, "clone", "--depth", "1", "--no-tags", "--recurse-submodules", "--shallow-submodules"];
  if (ref) args.push("--branch", validateRef(ref));
  args.push("--", u.toString(), dest);
  await run("git", args, { timeout: 180_000, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  const { stdout } = await run("git", ["-C", dest, "rev-parse", "HEAD"], { windowsHide: true });
  return { commit: stdout.trim() };
}

/** Exports one ref of a local git repository into `dest` (no checkout of the user's working tree). */
export async function exportGitRef(repoDir: string, ref: string, dest: string): Promise<{ commit: string }> {
  validateRef(ref);
  const { stdout } = await run("git", ["-C", repoDir, "rev-parse", "--verify", `${ref}^{commit}`], { windowsHide: true });
  const commit = stdout.trim();
  const tarPath = `${dest}.tar`;
  mkdirSync(dest, { recursive: true });
  await run("git", ["-C", repoDir, "archive", "--format=tar", `--output=${tarPath}`, commit], { windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  await run("tar", ["-xf", tarPath, "-C", dest], { windowsHide: true });
  rmSync(tarPath, { force: true });
  return { commit };
}

/** Extracts an uploaded .zip with zip-slip, symlink, count and size checks. */
export function extractZip(data: Uint8Array, dest: string, limits: CopyLimits = DEFAULT_COPY_LIMITS): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  const root = resolve(dest);
  const entries = unzipSync(data, {
    filter: (f) => {
      files += 1;
      bytes += f.originalSize;
      if (files > limits.maxFiles) throw new Error(`archive has more than ${limits.maxFiles} entries`);
      if (bytes > limits.maxBytes) throw new Error(`archive expands to more than ${limits.maxBytes} bytes`);
      return true;
    },
  });
  mkdirSync(root, { recursive: true });
  for (const [name, content] of Object.entries(entries)) {
    if (name.endsWith("/")) continue;
    const clean = normalize(name).replace(/^([/\\])+/, "");
    if (clean.split(/[/\\]/).some((seg) => seg === ".." ) || /^[A-Za-z]:/.test(clean)) throw new Error(`unsafe path in archive: ${name}`);
    const target = resolve(root, clean);
    if (!target.startsWith(root + sep)) throw new Error(`unsafe path in archive: ${name}`);
    if (clean.split(/[/\\]/).some((seg) => SKIP_DIRS.has(seg))) continue;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return { files, bytes };
}

/** Finds the Foundry project root inside a checkout (the directory holding foundry.toml), at most two levels deep. */
export function findFoundryRoot(dir: string): string | null {
  if (existsSync(join(dir, "foundry.toml"))) return dir;
  for (const a of readdirSync(dir, { withFileTypes: true })) {
    if (!a.isDirectory() || SKIP_DIRS.has(a.name) || a.name === "node_modules" || a.name === "lib") continue;
    if (existsSync(join(dir, a.name, "foundry.toml"))) return join(dir, a.name);
    for (const b of readdirSync(join(dir, a.name), { withFileTypes: true })) {
      if (b.isDirectory() && existsSync(join(dir, a.name, b.name, "foundry.toml"))) return join(dir, a.name, b.name);
    }
  }
  return null;
}

/** Content hash of a directory tree (used as the "commit" for non-git sources such as uploads). */
export function treeDigest(dir: string): string {
  const h = createHash("sha256");
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1))) {
      const full = join(d, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full);
      } else if (e.isFile()) {
        h.update(relative(dir, full).split(sep).join("/"));
        h.update("\0");
        h.update(readFileSync(full));
      }
    }
  };
  walk(dir);
  return h.digest("hex");
}

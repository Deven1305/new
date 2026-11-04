// Real on-disk tampering of a built demo site, and its exact reversal.
//
// The "CDN / CI compromise" demo: one contract address inside the built JavaScript is replaced by another address
// (MirrorYield's farm -> the attacker). The HTML is untouched, the page keeps working, and the file's sha256 no longer
// matches the signed release manifest. `restore` puts the original bytes back (verified by hash).
//
// What the patcher matches: a 20-byte hex address with a 0x prefix, case-insensitive, not part of a longer hex run.
// build.mjs inlines the app config as one JSON string literal, so each address is a contiguous
// `0x` + 40 hex characters inside it, in the case the demo state carries (EIP-55 checksummed).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { getAddress } from "viem";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const JS_FILE = /\.(?:m?js|cjs)$/;
const META = "meta.json";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function listJs(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && JS_FILE.test(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

const needle = (address) => new RegExp(`(?<![0-9a-fA-F])0x${address.slice(2)}(?![0-9a-fA-F])`, "gi");

function check(address, label) {
  if (typeof address !== "string" || !ADDRESS.test(address)) throw new Error(`${label} is not an address: ${String(address)}`);
}

/** Replaces every occurrence of `from` by `to`, keeping the case style of each occurrence. Returns the new text and the count. */
export function replaceAddress(text, from, to) {
  const checksummedTo = getAddress(to);
  let count = 0;
  const out = text.replace(needle(from), (m) => {
    count += 1;
    return m === m.toLowerCase() ? to.toLowerCase() : checksummedTo;
  });
  return { text: out, count };
}

function readMeta(backupDir) {
  const file = join(backupDir, META);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

function writeAtomic(file, data) {
  const tmp = `${file}.pramaan-tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

/**
 * Patches every .js file under `distDir` that contains `from`. Backs the originals up to `backupDir` first.
 * Throws if nothing matched, if the content did not change, or if the site is already tampered.
 */
export function tamper({ distDir, backupDir, from, to }) {
  check(from, "from");
  check(to, "to");
  if (from.toLowerCase() === to.toLowerCase()) throw new Error("from and to are the same address");
  distDir = resolve(distDir);
  backupDir = resolve(backupDir);
  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) throw new Error(`${distDir} does not exist: build the demos first`);
  if (readMeta(backupDir)) throw new Error("this site is already tampered; restore it first");

  const planned = [];
  for (const file of listJs(distDir)) {
    const original = readFileSync(file);
    const { text, count } = replaceAddress(original.toString("latin1"), from, to);
    if (count === 0) continue;
    const patched = Buffer.from(text, "latin1");
    const before = sha256(original);
    const after = sha256(patched);
    if (before === after) throw new Error(`${file}: patching did not change the file`);
    planned.push({ file, original, patched, count, before, after });
  }
  const total = planned.reduce((n, p) => n + p.count, 0);
  if (total === 0) throw new Error(`address ${from} does not appear in any JavaScript file under ${distDir}`);

  // Back up first (byte-identical copies), then patch; roll the patches back if anything fails half way.
  mkdirSync(join(backupDir, "files"), { recursive: true });
  const files = planned.map((p, i) => {
    const backupName = `${i}.orig`;
    writeFileSync(join(backupDir, "files", backupName), p.original);
    return { path: relative(distDir, p.file).split(sep).join("/"), backupName, replacements: p.count, originalSha256: p.before, patchedSha256: p.after };
  });
  const meta = { version: 1, createdAt: new Date().toISOString(), from, to, files };
  const done = [];
  try {
    for (const p of planned) {
      writeAtomic(p.file, p.patched);
      done.push(p);
    }
    writeFileSync(join(backupDir, META), JSON.stringify(meta, null, 2) + "\n");
  } catch (err) {
    for (const p of done) writeFileSync(p.file, p.original);
    rmSync(backupDir, { recursive: true, force: true });
    throw err;
  }
  return { replacements: total, files: files.map(({ path, replacements, originalSha256, patchedSha256 }) => ({ path, replacements, originalSha256, patchedSha256 })) };
}

/** Puts the original bytes back (checked against the recorded sha256) and removes the backup. */
export function restore({ distDir, backupDir }) {
  distDir = resolve(distDir);
  backupDir = resolve(backupDir);
  const meta = readMeta(backupDir);
  if (!meta) throw new Error("this site is not tampered (no backup found)");
  const files = [];
  for (const f of meta.files) {
    const target = resolve(distDir, ...f.path.split("/"));
    if (!target.startsWith(distDir + sep)) throw new Error(`refusing to restore outside ${distDir}: ${f.path}`);
    const original = readFileSync(join(backupDir, "files", f.backupName));
    if (sha256(original) !== f.originalSha256) throw new Error(`backup of ${f.path} is corrupt (hash mismatch); not restoring`);
    writeAtomic(target, original);
    if (sha256(readFileSync(target)) !== f.originalSha256) throw new Error(`restoring ${f.path} did not reproduce the original bytes`);
    files.push({ path: f.path, sha256: f.originalSha256 });
  }
  rmSync(backupDir, { recursive: true, force: true });
  return { files };
}

/**
 * Original vs current sha256 of the files that carry `address` (the one the tamper replaces). When the site is
 * tampered, the original hashes come from the backup record and the current ones from disk right now.
 */
export function status({ distDir, backupDir, address }) {
  distDir = resolve(distDir);
  backupDir = resolve(backupDir);
  const meta = readMeta(backupDir);
  let files;
  if (meta) {
    files = meta.files.map((f) => {
      const target = resolve(distDir, ...f.path.split("/"));
      return { path: f.path, originalSha256: f.originalSha256, currentSha256: existsSync(target) ? sha256(readFileSync(target)) : null };
    });
  } else {
    if (!existsSync(distDir)) return { tampered: false, from: address ?? null, to: null, originalSha256: null, currentSha256: null, files: [] };
    files = [];
    for (const file of listJs(distDir)) {
      const bytes = readFileSync(file);
      if (address && !needle(address).test(bytes.toString("latin1"))) continue;
      const h = sha256(bytes);
      files.push({ path: relative(distDir, file).split(sep).join("/"), originalSha256: h, currentSha256: h });
    }
  }
  const primary = files[0];
  return {
    tampered: Boolean(meta),
    from: meta?.from ?? address ?? null,
    to: meta?.to ?? null,
    originalSha256: primary?.originalSha256 ?? null,
    currentSha256: primary?.currentSha256 ?? null,
    changed: files.some((f) => f.originalSha256 !== f.currentSha256),
    files,
  };
}

/** Backups live next to the dist root, never inside the served/hashed site: <root>/dist/<app> -> <root>/.tamper/<app>. */
export const backupDirFor = (distDir) => join(dirname(dirname(resolve(distDir))), ".tamper", basename(resolve(distDir)));

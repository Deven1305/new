import { HttpError } from "./errors.js";

export interface ZipInspection {
  entries: number;
  expandedBytes: number;
  hasFoundryToml: boolean;
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;

/**
 * Validates an uploaded .zip from its central directory WITHOUT inflating anything: every name is checked for
 * zip-slip (absolute paths, drive letters, ".." segments, NUL, backslash tricks), symlink entries and encryption are
 * refused, and the declared entry count and expanded size are capped. The worker re-checks while extracting.
 */
export function inspectZip(buf: Buffer, limits: { maxEntries: number; maxExpandedBytes: number }): ZipInspection {
  const bad = (m: string) => new HttpError(400, "BAD_ARCHIVE", m);
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) throw bad("not a zip archive");
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw bad("zip end-of-central-directory record not found");
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw bad("zip64 archives are not supported");
  if (total > limits.maxEntries) throw bad(`archive has more than ${limits.maxEntries} entries`);
  if (cdOffset + cdSize > buf.length) throw bad("corrupt zip central directory");
  let pos = cdOffset;
  let expanded = 0;
  let files = 0;
  let foundry = false;
  for (let n = 0; n < total; n++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== CEN_SIG) throw bad("corrupt zip central directory");
    const madeBy = buf.readUInt16LE(pos + 4);
    const flags = buf.readUInt16LE(pos + 8);
    const uncompressed = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const external = buf.readUInt32LE(pos + 38);
    if (pos + 46 + nameLen > buf.length) throw bad("corrupt zip entry name");
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString("utf8");
    pos += 46 + nameLen + extraLen + commentLen;
    if (flags & 1) throw bad("encrypted archives are not supported");
    if (name.includes("\0")) throw bad(`unsafe path in archive: ${JSON.stringify(name)}`);
    const normalized = name.replace(/\\/g, "/");
    if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.split("/").some((seg) => seg === "..")) {
      throw bad(`unsafe path in archive: ${JSON.stringify(name.slice(0, 120))}`);
    }
    if (madeBy >> 8 === 3 && ((external >>> 16) & 0xf000) === 0xa000) throw bad(`symlinks are not allowed in archives: ${JSON.stringify(name.slice(0, 120))}`);
    if (normalized.endsWith("/")) continue;
    files += 1;
    expanded += uncompressed;
    if (expanded > limits.maxExpandedBytes) throw bad("archive expands beyond the allowed size");
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length <= 3 && parts[parts.length - 1] === "foundry.toml") foundry = true;
  }
  if (files === 0) throw bad("archive is empty");
  return { entries: files, expandedBytes: expanded, hasFoundryToml: foundry };
}

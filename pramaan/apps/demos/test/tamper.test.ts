import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { backupDirFor, replaceAddress, restore, status, tamper } from "../scripts/tamper.mjs";

const FARM = getAddress("0x5fbdb2315678afecb367f032d93f642f64180aa3");
const ATTACKER = getAddress("0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

function treeHash(dir: string): string {
  const parts: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else parts.push(`${p.slice(dir.length)}:${sha(readFileSync(p))}`);
    }
  };
  walk(dir);
  return sha(parts.join("\n"));
}

describe("replaceAddress", () => {
  it("replaces checksummed and lowercase occurrences, keeping each one's case style", () => {
    const text = `a="${FARM}";b="${FARM.toLowerCase()}";c='${FARM.toUpperCase().replace("0X", "0x")}'`;
    const r = replaceAddress(text, FARM, ATTACKER);
    expect(r.count).toBe(3);
    expect(r.text).toContain(`a="${ATTACKER}"`);
    expect(r.text).toContain(`b="${ATTACKER.toLowerCase()}"`);
    expect(r.text.toLowerCase()).not.toContain(FARM.toLowerCase());
  });

  it("does not touch longer hex runs that merely contain the address", () => {
    const padded = `0x000000000000000000000000${FARM.slice(2)}`;
    const r = replaceAddress(`x="${padded}";y="${FARM}1"`, FARM, ATTACKER);
    expect(r.count).toBe(0);
  });
});

describe("tamper / restore", () => {
  let root: string;
  let dist: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pramaan-tamper-"));
    dist = join(root, "dist", "mirroryield");
    mkdirSync(join(dist, "assets"), { recursive: true });
    writeFileSync(join(dist, "index.html"), `<!doctype html><script type="module" src="/assets/index-abc.js"></script><!-- ${FARM} -->`);
    writeFileSync(join(dist, "assets", "index-abc.js"), `const c=JSON.parse("{\\"farm\\":\\"${FARM}\\",\\"token\\":\\"0x1111111111111111111111111111111111111111\\"}");console.log(c);\n`);
    writeFileSync(join(dist, "assets", "other.js"), "export const x=1;\n");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("patches the JS on disk, leaves the HTML alone, changes the hash, and restore is byte-identical", () => {
    const backupDir = backupDirFor(dist);
    expect(backupDir).toBe(join(root, ".tamper", "mirroryield"));
    const before = treeHash(dist);
    const htmlBefore = readFileSync(join(dist, "index.html"));
    const jsBefore = sha(readFileSync(join(dist, "assets", "index-abc.js")));

    const r = tamper({ distDir: dist, backupDir, from: FARM, to: ATTACKER });
    expect(r.replacements).toBeGreaterThan(0);
    expect(r.files.map((f) => f.path)).toEqual(["assets/index-abc.js"]);
    const patched = readFileSync(join(dist, "assets", "index-abc.js"), "utf8");
    expect(patched).toContain(ATTACKER);
    expect(patched).not.toContain(FARM);
    expect(patched).toContain("0x1111111111111111111111111111111111111111"); // other addresses untouched
    expect(sha(readFileSync(join(dist, "assets", "index-abc.js")))).not.toBe(jsBefore);
    expect(readFileSync(join(dist, "index.html")).equals(htmlBefore)).toBe(true);

    const st = status({ distDir: dist, backupDir, address: FARM });
    expect(st.tampered).toBe(true);
    expect(st.originalSha256).toBe(jsBefore);
    expect(st.currentSha256).not.toBe(jsBefore);

    expect(() => tamper({ distDir: dist, backupDir, from: FARM, to: ATTACKER })).toThrow(/already tampered/);

    restore({ distDir: dist, backupDir });
    expect(treeHash(dist)).toBe(before);
    expect(existsSync(backupDir)).toBe(false);
    const after = status({ distDir: dist, backupDir, address: FARM });
    expect(after.tampered).toBe(false);
    expect(after.originalSha256).toBe(after.currentSha256);
    expect(() => restore({ distDir: dist, backupDir })).toThrow(/not tampered/);
  });

  it("refuses to run when nothing matches or the addresses are bad", () => {
    const backupDir = backupDirFor(dist);
    expect(() => tamper({ distDir: dist, backupDir, from: "0x2222222222222222222222222222222222222222", to: ATTACKER })).toThrow(/does not appear/);
    expect(() => tamper({ distDir: dist, backupDir, from: FARM, to: FARM })).toThrow(/same address/);
    expect(() => tamper({ distDir: dist, backupDir, from: "not-an-address", to: ATTACKER })).toThrow(/not an address/);
    expect(existsSync(backupDir)).toBe(false);
  });

  it("handles a lowercase-only bundle", () => {
    const file = join(dist, "assets", "index-abc.js");
    writeFileSync(file, `var a="${FARM.toLowerCase()}";`);
    const backupDir = backupDirFor(dist);
    tamper({ distDir: dist, backupDir, from: FARM, to: ATTACKER });
    expect(readFileSync(file, "utf8")).toBe(`var a="${ATTACKER.toLowerCase()}";`);
    restore({ distDir: dist, backupDir });
    expect(readFileSync(file, "utf8")).toBe(`var a="${FARM.toLowerCase()}";`);
  });
});

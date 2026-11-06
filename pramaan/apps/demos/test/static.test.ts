import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveStaticFile } from "../server/serve.mjs";

describe("resolveStaticFile (path traversal safety)", () => {
  let base: string;
  let root: string;
  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "pramaan-static-"));
    root = join(base, "site");
    mkdirSync(join(root, "assets"), { recursive: true });
    writeFileSync(join(root, "index.html"), "<h1>ok</h1>");
    writeFileSync(join(root, "assets", "a.js"), "1");
    writeFileSync(join(base, "secret.txt"), "top secret");
  });
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it("serves files and directory indexes", () => {
    expect(resolveStaticFile(root, "/index.html")).toBe(join(root, "index.html"));
    expect(resolveStaticFile(root, "/")).toBe(join(root, "index.html"));
    expect(resolveStaticFile(root, "/assets/a.js")).toBe(join(root, "assets", "a.js"));
  });

  it("rejects traversal in every encoding", () => {
    for (const p of ["/../secret.txt", "/%2e%2e/secret.txt", "/%2E%2E/secret.txt", "/..%2fsecret.txt", "/assets/../../secret.txt", "/assets/%2e%2e/%2e%2e/secret.txt", "/..\secret.txt", "/assets/..%5c..%5csecret.txt", "/%2e%2e%5csecret.txt", "//..//secret.txt", "/\0/index.html", "/index.html%00.png", "/%c0%ae%c0%ae/secret.txt"]) {
      expect(resolveStaticFile(root, p), p).toBeNull();
    }
  });

  it("returns null for missing files and malformed escapes", () => {
    expect(resolveStaticFile(root, "/nope.js")).toBeNull();
    expect(resolveStaticFile(root, "/%zz")).toBeNull();
  });
});

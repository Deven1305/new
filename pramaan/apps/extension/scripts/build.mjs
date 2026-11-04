#!/usr/bin/env node
// Builds the unpacked MV3 extension into apps/extension/dist (load it from chrome://extensions → Load unpacked).
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { build } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const out = join(root, "dist");
const require = createRequire(import.meta.url);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const common = {
  configFile: false,
  logLevel: "warn",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: { outDir: out, emptyOutDir: false, target: "chrome120", minify: false, sourcemap: false, modulePreload: false },
};

// Extension pages (ES modules are allowed in extension pages).
await build({
  ...common,
  root: join(root, "src", "pages"),
  base: "./",
  build: {
    ...common.build,
    rollupOptions: {
      input: { popup: join(root, "src/pages/popup.html"), verdict: join(root, "src/pages/verdict.html"), options: join(root, "src/pages/options.html") },
    },
  },
});

// Service worker: one ES module file (MV3 "type": "module"); service workers cannot import() lazily.
await build({
  ...common,
  build: {
    ...common.build,
    lib: { entry: join(root, "src/background/index.ts"), formats: ["es"], fileName: () => "background.js" },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});

// Content scripts must be classic scripts.
for (const name of ["inpage", "content"]) {
  await build({
    ...common,
    build: {
      ...common.build,
      lib: { entry: join(root, `src/${name}.ts`), formats: ["iife"], name: `pramaan_${name}`, fileName: () => `${name}.js` },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
}

// Manifest, icons, and the Anon-RPC harness assets (copied from the installed package version, per its README).
cpSync(join(root, "manifest.json"), join(out, "manifest.json"));
const harness = dirname(require.resolve("@anon-rpc/browser-extension-harness/package.json"));
cpSync(join(harness, "dist", "static", "anon-rpc"), join(out, "anon-rpc"), { recursive: true });

// Icons: generated (a shield-green tile with a check mark) so the repo carries no binary assets.
function png(size) {
  const rows = [];
  const r = size * 0.22;
  for (let y = 0; y < size; y++) {
    const row = [0];
    for (let x = 0; x < size; x++) {
      const dx = Math.max(0, Math.abs(x + 0.5 - size / 2) - (size / 2 - r));
      const dy = Math.max(0, Math.abs(y + 0.5 - size / 2) - (size / 2 - r));
      const inside = dx * dx + dy * dy <= r * r;
      const t = (x + y) / (2 * size);
      let [R, G, B] = [Math.round(122 * (1 - t) + 47 * t), Math.round(162 * (1 - t) + 158 * t), Math.round(255 * (1 - t) + 102 * t)];
      // check mark: two thick segments
      const u = x / size;
      const v = y / size;
      const d1 = Math.abs(v - (0.52 + (u - 0.28) * 0.9)) < 0.07 && u > 0.24 && u < 0.45;
      const d2 = Math.abs(v - (0.71 - (u - 0.43) * 1.25)) < 0.07 && u > 0.41 && u < 0.78;
      if (d1 || d2) [R, G, B] = [255, 255, 255];
      row.push(R, G, B, inside ? 255 : 0);
    }
    rows.push(Buffer.from(row));
  }
  const raw = Buffer.concat(rows);
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
mkdirSync(join(out, "icons"), { recursive: true });
for (const size of [16, 32, 48, 128]) writeFileSync(join(out, "icons", `${size}.png`), png(size));

const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
for (const f of ["background.js", "inpage.js", "content.js", "popup.html", "verdict.html", "options.html"]) {
  if (!existsSync(join(out, f))) throw new Error(`build output missing ${f}`);
}
console.log(`Pramaan extension ${manifest.version} built → ${out}`);

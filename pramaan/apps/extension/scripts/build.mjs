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

// HexFence's pure decision logic (fingerprint, Safe decoder, verdicts) is bundled straight from the root workspace.
const hexfenceShared = resolve(root, "../../../packages/shared/src/index.ts");
const common = {
  configFile: false,
  resolve: { alias: { "@hexfence/shared": hexfenceShared } },
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

// Icons: generated (a HexFence hexagon in teal-to-indigo with a white check mark, 3x3 supersampled) so the repo carries no binary assets.
function pixel(size, px, py) {
  // centred, normalised coordinates: the hexagon's circumradius is 0.94 of half the tile
  const x = ((px / size) - 0.5) * 2;
  const y = ((py / size) - 0.5) * 2;
  const R = 0.94;
  const apothem = R * Math.sqrt(3) / 2;
  let hex = 0;
  for (let k = 0; k < 3; k++) hex = Math.max(hex, Math.abs(x * Math.cos((k * Math.PI) / 3) + y * Math.sin((k * Math.PI) / 3)));
  const inside = hex <= apothem;
  const t = (x + y + 2) / 4;
  let rgb = [Math.round(20 * (1 - t) + 79 * t), Math.round(184 * (1 - t) + 70 * t), Math.round(166 * (1 - t) + 229 * t)];
  // inner hexagon ring (visible from 48 px up)
  if (size >= 48 && Math.abs(hex - apothem * 0.8) < 0.025) rgb = rgb.map((c) => Math.round(c * 0.55 + 255 * 0.45));
  // check mark: two thick round-capped segments
  const seg = (ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - (ax + u * dx), y - (ay + u * dy));
  };
  const w = size <= 16 ? 0.17 : 0.12;
  if (Math.min(seg(-0.34, 0.02, -0.1, 0.27), seg(-0.1, 0.27, 0.38, -0.27)) < w) rgb = [255, 255, 255];
  return { rgb, inside };
}
function png(size) {
  const rows = [];
  const S = 3;
  for (let y = 0; y < size; y++) {
    const row = [0];
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, bl = 0, cover = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const q = pixel(size, x + (sx + 0.5) / S, y + (sy + 0.5) / S);
        if (q.inside) { r += q.rgb[0]; g += q.rgb[1]; bl += q.rgb[2]; cover++; }
      }
      row.push(cover ? Math.round(r / cover) : 0, cover ? Math.round(g / cover) : 0, cover ? Math.round(bl / cover) : 0, Math.round((255 * cover) / (S * S)));
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

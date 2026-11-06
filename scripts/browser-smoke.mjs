// Opens the built HexFence websites in real Chromium and loads BOTH Chrome extensions.
//   node scripts/browser-smoke.mjs        (after: pnpm -r build  and  pnpm pramaan:build:extension)
// Needs Playwright's Chromium (cd pramaan/apps/extension && pnpm exec playwright install chromium).
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile, stat, mkdtemp } from "node:fs/promises";
import { join, extname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(join(root, "pramaan", "apps", "extension", "package.json"));
const { chromium } = require("@playwright/test");
const T = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".png": "image/png" };
function serve(dir) {
  const s = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html";
    const f = resolve(dir, "." + p);
    try { if (!f.startsWith(resolve(dir)) || !(await stat(f)).isFile()) throw 0; res.writeHead(200, { "content-type": T[extname(f)] ?? "application/octet-stream" }); res.end(await readFile(f)); }
    catch { res.writeHead(404); res.end("nf"); }
  });
  return new Promise((r) => s.listen(0, "127.0.0.1", () => r(s)));
}
const results = []; const ok = (name, pass, note = "") => { results.push(pass); console.log(`${pass ? "PASS" : "FAIL"}  ${name}${note ? "  - " + note : ""}`); };
const sites = [["site", "apps/site/dist/index.html", "/index.html"], ["site demo", "apps/site/dist/demo.html", "/demo.html"], ["explorer", "apps/explorer/dist/index.html", "/index.html"], ["pay", "apps/pay/dist/index.html", "/index.html"]];
const browser = await chromium.launch();
for (const [name, file, path] of sites) {
  const dir = join(root, file, "..");
  const srv = await serve(dir); const port = srv.address().port;
  const page = await browser.newPage(); const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  const title = await page.title(); const text = (await page.innerText("body")).replace(/\s+/g, " ").slice(0, 90);
  ok(`${name} renders`, text.length > 20 && errors.length === 0, `title="${title}" body="${text}…"${errors.length ? " ERR " + errors[0] : ""}`);
  await page.close(); srv.close();
}
await browser.close();
for (const [name, dir, expectName] of [["Pramaan extension", "pramaan/apps/extension/dist", "Pramaan"], ["HexFence extension", "apps/extension/dist", "HexFence"]]) {
  const ext = join(root, dir);
  const ctx = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), "hf-ext-")), { channel: "chromium", headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
  let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 }).catch(() => null);
  const url = sw?.url() ?? "";
  ok(`${name} loads in Chromium (service worker running)`, url.startsWith("chrome-extension://"), url);
  if (sw) { const manifestName = await sw.evaluate(() => chrome.runtime.getManifest().name); ok(`${name} manifest`, manifestName.includes(expectName), manifestName); }
  await ctx.close();
}
process.exit(results.every(Boolean) ? 0 : 1);

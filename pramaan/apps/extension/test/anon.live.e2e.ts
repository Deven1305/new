import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type BrowserContext, type Worker } from "@playwright/test";

/**
 * LIVE check of Anon-RPC private mode. Needs the public internet (Sepolia RPC for the bootstrap read, then the Nox
 * mixnet), so it only runs with PRAMAAN_LIVE_ANON=1. A local page announces a Sepolia ENS name that does not exist;
 * the extension verifies it and we read back, from its own log, which path each blockchain read took.
 *
 *   PRAMAAN_LIVE_ANON=1 pnpm --filter @pramaan/extension exec playwright test -c playwright.config.ts test/anon.live.e2e.ts
 *
 * The test passes if every read of the Sepolia chain is accounted for as anon-rpc or an explicit direct-fallback with
 * the reason, and prints the evidence. It does NOT claim the mixnet worked unless a read was recorded as anon-rpc.
 */
test.skip(process.env.PRAMAAN_LIVE_ANON !== "1", "set PRAMAAN_LIVE_ANON=1 (needs the public internet)");
test.setTimeout(240_000);

const EXT = fileURLToPath(new URL("../dist", import.meta.url));
const PORT = 9151;
let context: BrowserContext;
let sw: Worker;
let server: ReturnType<typeof createServer>;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/.well-known/pramaan.json") {
      res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
      return void res.end(JSON.stringify({ pramaan: 1, ensName: "pramaan-live-anon-check.eth", chainId: 11155111 }));
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<!doctype html><title>anon check</title><p>Pramaan Anon-RPC live check</p>");
  });
  await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", r));
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "pramaan-anon-")), {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
});
test.afterAll(async () => {
  await context?.close();
  await new Promise((r) => server?.close(r));
});

test("Sepolia reads are recorded with the path they took (Anon-RPC or an explained fallback)", async () => {
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`);
  const readsOf = () =>
    sw.evaluate(async (url) => {
      const all = await chrome.storage.session.get(null);
      const tabs = Object.values(all).filter((v: any) => v && typeof v === "object" && "tabId" in v && String(v.url).startsWith(url)) as any[];
      const tab = tabs.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
      return { status: tab?.release?.status ?? null, reads: (tab?.reads ?? []) as { method: string; what: string; endpoint: string; path: string; note: string | null; ok: boolean; ms: number }[] };
    }, `http://127.0.0.1:${PORT}/`);
  // Wait until the verification has a result (an unknown name ends as "none"/"unverified"), not just the first read:
  // booting the mixnet worker alone can take 25 s.
  await expect.poll(async () => (await readsOf()).reads.some((r) => r.endpoint !== `127.0.0.1:${PORT}`), { timeout: 150_000, intervals: [2000] }).toBe(true);
  await expect.poll(async () => (await readsOf()).status, { timeout: 120_000, intervals: [3000] }).not.toBeNull();
  const { status, reads } = await readsOf();
  const byPath: Record<string, number> = {};
  for (const r of reads) byPath[r.path] = (byPath[r.path] ?? 0) + 1;
  console.log(JSON.stringify({ evidence: "anon-rpc-live", releaseStatus: status, byPath, reads: reads.slice(0, 12).map((r) => ({ what: r.what, endpoint: r.endpoint, path: r.path, ok: r.ok, ms: r.ms, note: r.note })) }));
  expect(reads.length).toBeGreaterThan(0);
  for (const r of reads) {
    expect(["anon-rpc", "direct-fallback", "direct", "direct-local"]).toContain(r.path);
    if (r.path === "direct-fallback") expect(r.note, "a fallback read must say why").toBeTruthy();
  }
  await page.close();
});

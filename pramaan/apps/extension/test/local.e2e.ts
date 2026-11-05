import { existsSync, mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from "@playwright/test";

/**
 * Browser tests that need no live demo: the built extension in Chromium against two tiny local servers on 96xx
 * ports (a page and a third-party "tracker"). Run: pnpm --filter @pramaan/extension test:e2e:local
 */
const EXT = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");
const SITE = "http://localhost:9611";
const TRACKER = "http://127.0.0.1:9612";
const ADDR = "0x173a8Ce665789f4065ab3Ef9F1d190bBcaD834cC";
const MARKET = "0x3333333333333333333333333333333333333333";
const TOKEN = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

test.skip(!existsSync(join(EXT, "manifest.json")), "run `pnpm build:extension` first");

const PAGE = `<!doctype html><meta charset="utf-8"><title>local fixture</title><body><h1>fixture</h1><script>
window.__results = [];
window.addEventListener("eip6963:announceProvider", (e) => { window.__announced = e.detail.provider; });
window.dispatchEvent(new Event("eip6963:requestProvider"));
</script></body>`;

let site: Server;
let tracker: Server;
const hits: string[] = [];
let context: BrowserContext;
let sw: Worker;
const swRequests: string[] = [];

test.beforeAll(async () => {
  site = createServer((req, res) => {
    res.writeHead(req.url === "/" ? 200 : 404, { "content-type": "text/html", "cache-control": "no-store" });
    res.end(req.url === "/" ? PAGE : "not found");
  }).listen(9611, "127.0.0.1");
  tracker = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    req.resume();
    res.writeHead(204, { "access-control-allow-origin": "*" });
    res.end();
  }).listen(9612, "127.0.0.1");
  tracker.on("upgrade", (req, socket) => {
    hits.push(`WS ${req.url}`);
    socket.destroy();
  });
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "pramaan-local-")), {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  await context.exposeFunction("__wallet", async (method: string) => {
    if (method === "eth_requestAccounts" || method === "eth_accounts") return [ADDR];
    if (method === "eth_chainId") return "0xaa36a7";
    if (method === "eth_sendTransaction") return `0x${"ab".repeat(32)}`;
    return null;
  });
  await context.addInitScript(() => {
    const call = (w: Window) => (w as unknown as { __wallet: (m: string) => Promise<unknown> }).__wallet;
    const mk = (tag: string) => ({ tag, request: ({ method }: { method: string }) => call(window)(method), on: () => undefined });
    const announced = mk("eip6963");
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid: "1", name: "Test Wallet", icon: "", rdns: "test.wallet" }, provider: announced }) }));
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
    (window as unknown as { ethereum: unknown }).ethereum = mk("first");
    // A second wallet overwrites window.ethereum after injection, the way competing wallets do.
    setTimeout(() => Object.defineProperty(window, "ethereum", { value: mk("replacement"), configurable: true, writable: true }), 100);
  });
  sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  // Record every request the extension itself makes (for the "no backend" test).
  await sw.evaluate(() => {
    const orig = self.fetch.bind(self);
    (self as unknown as { __urls: string[] }).__urls = [];
    self.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      (self as unknown as { __urls: string[] }).__urls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      return orig(input, init);
    }) as typeof fetch;
  });
});

test.afterAll(async () => {
  await context?.close();
  site?.close();
  tracker?.close();
});

async function open(): Promise<Page> {
  const page = await context.newPage();
  await page.goto(SITE);
  await page.waitForTimeout(400);
  return page;
}

const approveMax = `0x095ea7b3${MARKET.slice(2).padStart(64, "0")}${"f".repeat(64)}`;

async function requestVia(page: Page, which: "announced" | "ethereum"): Promise<Page> {
  const [review] = await Promise.all([
    context.waitForEvent("page", { predicate: (p) => p.url().includes("verdict.html"), timeout: 30_000 }),
    page.evaluate(
      ([w, to, data]) => {
        const p = w === "announced" ? (window as unknown as { __announced: { request: (a: unknown) => Promise<unknown> } }).__announced : (window as unknown as { ethereum: { request: (a: unknown) => Promise<unknown> } }).ethereum;
        void p.request({ method: "eth_sendTransaction", params: [{ to, data }] }).then(
          (r) => (window as unknown as { __results: unknown[] }).__results.push({ ok: r }),
          (e: { code?: number; message?: string }) => (window as unknown as { __results: unknown[] }).__results.push({ code: e.code, message: e.message }),
        );
      },
      [which, TOKEN, approveMax] as const,
    ),
  ]);
  await review.waitForLoadState();
  return review;
}

const results = (page: Page) => page.evaluate(() => (window as unknown as { __results: { code?: number; ok?: unknown; message?: string }[] }).__results);

// Runs first: Target.closeTarget reliably stops the original worker instance, not one Chrome already restarted.
test("a request whose service worker is stopped mid-review fails closed (never silently allowed)", async () => {
  const page = await open();
  const review = await requestVia(page, "ethereum");
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${new URL(sw.url()).host}/options.html`);
  const cdp = await context.newCDPSession(ext);
  // The worker may already have been restarted by Chrome since the last test: stop every instance of it.
  const { targetInfos } = (await cdp.send("Target.getTargets")) as { targetInfos: { targetId: string; type: string; url: string }[] };
  const targets = targetInfos.filter((t) => t.type === "service_worker" && t.url.startsWith(`chrome-extension://${new URL(sw.url()).host}/`));
  expect(targets.length, "extension service worker target").toBeGreaterThan(0);
  for (const t of targets) await cdp.send("Target.closeTarget", { targetId: t.targetId }).catch(() => undefined);
  await expect.poll(async () => (await results(page))[0]?.code, { timeout: 20_000 }).toBe(4001);
  expect((await results(page))[0]?.ok).toBeUndefined();
  await review.close().catch(() => undefined);
  await ext.close();
  await page.close();
  sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
});

test("intercepts the EIP-6963 provider and a replaced window.ethereum; unlimited approval is high risk in en/hi/mr; reject reaches the page", async () => {
  const page = await open();
  expect(await page.evaluate(() => (window as unknown as { ethereum: { tag: string } }).ethereum.tag)).toBe("replacement");
  for (const which of ["announced", "ethereum"] as const) {
    const review = await requestVia(page, which);
    await expect(review.locator(".risk.high").first()).toContainText("unlimited permission", { timeout: 60_000 });
    await review.selectOption("#lang", "hi");
    await expect(review.locator(".risk.high").first()).toContainText("सभी");
    await review.selectOption("#lang", "mr");
    await expect(review.locator(".risk.high").first()).toContainText("सर्व");
    await review.selectOption("#lang", "en");
    await review.click("#reject");
    await expect.poll(async () => (await results(page)).length, { timeout: 15_000 }).toBeGreaterThan(which === "announced" ? 0 : 1);
  }
  const r = await results(page);
  expect(r.every((x) => x.code === 4001)).toBe(true);
  await page.close();
});

test("address leaks over every channel are shown with host/method/match; Block stops the next request", async () => {
  const page = await open();
  await page.evaluate(async () => (window as unknown as { ethereum: { request: (a: unknown) => Promise<unknown> } }).ethereum.request({ method: "eth_requestAccounts" }));
  await page.waitForTimeout(300);
  const before = hits.length;
  await page.evaluate(
    ([t, a]) => {
      void fetch(`${t}/collect?addr=${a}`, { mode: "no-cors" });
      void fetch(`${t}/collect?a=${a.toLowerCase().slice(2)}`, { mode: "no-cors", keepalive: true });
      void fetch(`${t}/collect`, { method: "POST", mode: "no-cors", body: JSON.stringify({ wallet: a }) });
      void fetch(`${t}/collect`, { method: "POST", mode: "no-cors", body: btoa(a) });
      navigator.sendBeacon(`${t}/collect`, JSON.stringify({ w: a.slice(2) }));
      new Image().src = `${t}/collect?e=pixel&w=${a.toLowerCase()}`;
      try {
        new WebSocket(`${t.replace("http", "ws")}/ws?wallet=${a}`);
      } catch {
        // ignore
      }
    },
    [TRACKER, ADDR] as const,
  );
  await expect.poll(() => hits.length - before, { timeout: 15_000 }).toBeGreaterThanOrEqual(6);
  const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: `${u}/*` }))[0]?.id ?? -1, SITE);
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html?tab=${tabId}`);
  const leak = ext.locator('.leak[data-host="127.0.0.1:9612"]');
  await expect(leak).toContainText("NOT declared", { timeout: 15_000 });
  await expect(leak).toContainText("query ?addr=");
  await expect(ext.locator("details", { hasText: "cannot observe" })).toHaveCount(1);
  await leak.locator("button").click();
  await expect(leak).toContainText("blocked", { timeout: 10_000 });
  const blockedAt = hits.length;
  await page.evaluate(([t, a]) => {
    void fetch(`${t}/collect?addr=${a}`, { mode: "no-cors" }).catch(() => undefined);
    navigator.sendBeacon(`${t}/collect`, a);
    new Image().src = `${t}/collect?w=${a}`;
  }, [TRACKER, ADDR] as const);
  await page.waitForTimeout(2_000);
  expect(hits.length).toBe(blockedAt);
  // Blocking is per origin: a different origin (127.0.0.1:9611 serves the same page) can still reach the tracker.
  const other = await context.newPage();
  await other.goto("http://127.0.0.1:9611/");
  await other.evaluate((t) => fetch(`${t}/collect?x=1`, { mode: "no-cors" }), TRACKER);
  await expect.poll(() => hits.length, { timeout: 10_000 }).toBeGreaterThan(blockedAt);
  await other.close();
  await ext.close();
  await page.close();
});

test("verification never contacts a Pramaan backend (no backend is running; only the page's own origin is read)", async () => {
  const page = await open();
  await page.waitForTimeout(1500);
  const urls = await sw.evaluate(() => (self as unknown as { __urls?: string[] }).__urls ?? []);
  for (const u of urls) {
    expect(u).not.toMatch(/:8787|:5173|pramaan\.dev\/api/);
    expect(new URL(u).origin === SITE || new URL(u).origin === "http://127.0.0.1:9611" || u.startsWith("chrome-extension://")).toBe(true);
  }
  const tabId = await sw.evaluate(async (s) => (await chrome.tabs.query({ url: `${s}/*` }))[0]?.id ?? -1, SITE);
  const state = await sw.evaluate(async (id) => (await chrome.storage.session.get(`tab:${id}`))[`tab:${id}`] as { release: { status: string } | null }, tabId);
  expect(state.release?.status).toBe("missing"); // no release published: amber "no release", never green
  await page.close();
});

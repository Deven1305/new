import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, http, maxUint256, parseAbi, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * End-to-end against the integrator's live three-app demo (DemoStateV2). Requires the demo running and
 * `pnpm build:extension`. State: $PRAMAAN_DEMO_STATE or .pramaan/demo/state.json; user key: .pramaan/demo/keys.json
 * (`user`) or $PRAMAAN_DEMO_USER_KEY. Requests are sent through window.ethereum directly (independent of each app's
 * DOM); the "wallet" signs in Node with the demo user's key, so Pramaan sees exactly what it sees in front of MetaMask.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const STATE = process.env["PRAMAAN_DEMO_STATE"] ?? join(ROOT, ".pramaan", "demo", "state.json");
const KEYS = join(ROOT, ".pramaan", "demo", "keys.json");
const EXT = resolve(HERE, "../dist");
const BACKEND = process.env["PRAMAAN_BACKEND_URL"] ?? "http://localhost:8787";

type Addr = `0x${string}`;
interface App { origin: string; ensName: string; contracts: Record<string, Addr> }
interface StateV2 { version: 2; network: { chainId: number; rpcUrl: string }; apps: Record<"vaultlab" | "mirroryield" | "permitmarket", App>; shared: { token: Addr; nft: Addr }; hosts: { adminUrl: string; trackerUrl: string | null; lookalikeOrigin: string | null }; fixturesEnabled: boolean }

const raw = existsSync(STATE) ? (JSON.parse(readFileSync(STATE, "utf8")) as Partial<StateV2>) : null;
const state = raw?.version === 2 ? (raw as StateV2) : null;
const userKey = (process.env["PRAMAAN_DEMO_USER_KEY"] ?? (existsSync(KEYS) ? (JSON.parse(readFileSync(KEYS, "utf8")) as { user?: string }).user : undefined)) as Hex | undefined;
test.skip(!state || !userKey || !existsSync(join(EXT, "manifest.json")), "needs a running DemoStateV2 demo, the user key and `pnpm build:extension`");

const role = (app: App, re: RegExp, not?: RegExp): Addr => {
  const hit = Object.entries(app.contracts).find(([k]) => re.test(k) && !(not && not.test(k)));
  if (!hit) throw new Error(`no contract role matching ${re} in ${JSON.stringify(Object.keys(app.contracts))}`);
  return hit[1];
};

let context: BrowserContext;
let sw: Worker;

test.beforeAll(async () => {
  const s = state!;
  const account = privateKeyToAccount(userKey!);
  const chain = defineChain({ id: s.network.chainId, name: "demo", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [s.network.rpcUrl] } } });
  const wallet = createWalletClient({ account, chain, transport: http(s.network.rpcUrl) });
  const reader = createPublicClient({ chain, transport: http(s.network.rpcUrl) });
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "pramaan-e2e-")), { channel: "chromium", headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  await context.exposeFunction("__pramaanTestWallet", async (method: string, params: unknown[]) => {
    if (method === "eth_requestAccounts" || method === "eth_accounts") return [account.address];
    if (method === "eth_chainId") return `0x${s.network.chainId.toString(16)}`;
    if (method === "eth_sendTransaction") {
      const tx = params[0] as { to: Hex; data?: Hex; value?: Hex };
      const value = tx.value ? BigInt(tx.value) : 0n;
      const gas = ((await reader.estimateGas({ account, to: tx.to, data: tx.data, value })) * 13n) / 10n;
      return wallet.sendTransaction({ to: tx.to, data: tx.data, value, gas });
    }
    if (method === "eth_signTypedData_v4") return account.signTypedData(JSON.parse(params[1] as string));
    if (method === "personal_sign") return account.signMessage({ message: { raw: params[0] as Hex } });
    return reader.request({ method: method as never, params: params as never });
  });
  await context.addInitScript(() => {
    const w = window as unknown as { ethereum: unknown; __pramaanTestWallet: (m: string, p: unknown[]) => Promise<unknown>; __results: unknown[] };
    w.__results = [];
    w.ethereum = { isPramaanTestWallet: true, request: ({ method, params }: { method: string; params?: unknown[] }) => w.__pramaanTestWallet(method, params ?? []), on: () => undefined };
  });
  sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  // Point the local chain at the demo RPC (the default is already http://127.0.0.1:8545).
  await sw.evaluate(async ([id, rpc]) => {
    const cur = ((await chrome.storage.local.get("settings"))["settings"] ?? {}) as { chains?: Record<string, unknown> };
    await chrome.storage.local.set({ settings: { ...cur, chains: { ...(cur.chains ?? {}), [String(id)]: { label: "demo", rpcUrls: [rpc], anonRpc: false, local: id === 31337, ...(id === 31337 ? { universalResolver: "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe" } : {}) } } } });
  }, [s.network.chainId, s.network.rpcUrl] as const);
});

test.afterAll(async () => {
  if (state) await fetch(`${state.hosts.adminUrl}/restore?app=mirroryield`, { method: "POST" }).catch(() => undefined);
  await context?.close();
});

async function tab(url: string) {
  return sw.evaluate(async (u) => {
    const all = await chrome.storage.session.get(null);
    const tabs = Object.values(all).filter((v) => v && typeof v === "object" && "tabId" in (v as object)) as { url: string; tabId: number; status: string; release: { status: string } | null; site: { severity: string; status: string } | null; updatedAt: string }[];
    return tabs.filter((t) => t.url?.startsWith(u)).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0] ?? null;
  }, url);
}
const waitRelease = (url: string, status: string) => expect.poll(async () => (await tab(url))?.release?.status ?? "pending", { timeout: 120_000, intervals: [1000] }).toBe(status);
const waitSite = (url: string, sev: string) => expect.poll(async () => (await tab(url))?.site?.severity, { timeout: 90_000, intervals: [1000] }).toBe(sev);

async function open(url: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(url);
  return page;
}

async function send(page: Page, method: string, params: unknown[]): Promise<Page> {
  const [review] = await Promise.all([
    context.waitForEvent("page", { predicate: (p) => p.url().includes("verdict.html"), timeout: 60_000 }),
    page.evaluate(
      ([m, p]) => {
        const w = window as unknown as { ethereum: { request: (a: unknown) => Promise<unknown> }; __results: unknown[] };
        void w.ethereum.request({ method: m, params: p }).then((r) => w.__results.push({ ok: r }), (e: { code?: number }) => w.__results.push({ code: e.code }));
      },
      [method, params] as const,
    ),
  ]);
  await review.waitForLoadState();
  await expect(review.locator(".banner.amber")).toHaveCount(0, { timeout: 90_000 }); // verification finished
  return review;
}
const lastResult = (page: Page) => page.evaluate(() => (window as unknown as { __results: { ok?: unknown; code?: number }[] }).__results.at(-1) ?? null);
const tokenAbi = parseAbi(["function approve(address,uint256) returns (bool)"]);

test("VaultLab genuine → green, deposit goes through", async () => {
  const app = state!.apps.vaultlab;
  const page = await open(app.origin);
  await waitRelease(app.origin, "verified");
  await waitSite(app.origin, "green");
  await page.evaluate(() => (window as unknown as { ethereum: { request: (a: unknown) => Promise<unknown> } }).ethereum.request({ method: "eth_requestAccounts" }));
  const vault = role(app, /vault/i, /impl/i);
  const review = await send(page, "eth_sendTransaction", [{ to: vault, data: encodeFunctionData({ abi: parseAbi(["function deposit() payable"]), functionName: "deposit" }), value: `0x${parseEther("0.01").toString(16)}` }]);
  await expect(review.locator(".row.green").first()).toBeVisible();
  await expect(review.locator(".row.red")).toHaveCount(0);
  await review.click("#continue");
  await expect.poll(() => lastResult(page), { timeout: 60_000 }).toMatchObject({ ok: expect.stringMatching(/^0x[0-9a-f]{64}$/) });
  await page.close();
});

test("MirrorYield genuine → green; tampered → red and signing blocked; restored → green", async () => {
  const app = state!.apps.mirroryield;
  let page = await open(app.origin);
  await waitSite(app.origin, "green");
  await page.close();
  expect((await fetch(`${state!.hosts.adminUrl}/tamper?app=mirroryield`, { method: "POST" })).ok).toBe(true);
  page = await open(app.origin);
  await waitSite(app.origin, "red");
  const review = await send(page, "eth_sendTransaction", [{ to: state!.shared.token, data: encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [role(app, /farm|vault|stake/i, /impl/i), 1_000_000n] }) }]);
  await expect(review.locator(".banner").first()).toBeVisible();
  await expect(review.locator("#continue")).toBeDisabled();
  await review.click("#reject");
  await expect.poll(() => lastResult(page)).toMatchObject({ code: 4001 });
  await page.close();
  expect((await fetch(`${state!.hosts.adminUrl}/restore?app=mirroryield`, { method: "POST" })).ok).toBe(true);
  page = await open(app.origin);
  await waitSite(app.origin, "green");
  await page.close();
});

test("the same files on the lookalike origin fail the ENS domain binding (red)", async () => {
  test.skip(!state!.hosts.lookalikeOrigin, "no lookalike origin in this demo");
  const page = await open(state!.hosts.lookalikeOrigin!);
  await waitRelease(state!.hosts.lookalikeOrigin!, "mismatch");
  await page.close();
});

test("PermitMarket: unlimited approval is high risk in en/hi/mr and rejected; exact approve is lower risk; permit is decoded", async () => {
  const app = state!.apps.permitmarket;
  const market = role(app, /market/i);
  const token = state!.shared.token;
  const page = await open(app.origin);
  await waitRelease(app.origin, "verified");
  await page.evaluate(() => (window as unknown as { ethereum: { request: (a: unknown) => Promise<unknown> } }).ethereum.request({ method: "eth_requestAccounts" }));
  const max = await send(page, "eth_sendTransaction", [{ to: token, data: encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [market, maxUint256] }) }]);
  await expect(max.locator(".risk.high").first()).toContainText("unlimited permission");
  await max.selectOption("#lang", "hi");
  await expect(max.locator(".risk.high").first()).toContainText("सभी");
  await max.selectOption("#lang", "mr");
  await expect(max.locator(".risk.high").first()).toContainText("सर्व");
  await max.selectOption("#lang", "en");
  await max.click("#reject");
  await expect.poll(() => lastResult(page)).toMatchObject({ code: 4001 });
  const exact = await send(page, "eth_sendTransaction", [{ to: token, data: encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [market, 5_000_000n] }) }]);
  await expect(exact.locator(".risk.high")).toHaveCount(0);
  await expect(exact.locator(".headline")).toContainText("up to 5");
  await exact.click("#reject");
  const owner = (await page.evaluate(() => (window as unknown as { ethereum: { request: (a: unknown) => Promise<string[]> } }).ethereum.request({ method: "eth_accounts" })))[0]!;
  const td = {
    types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }], Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
    primaryType: "Permit",
    domain: { name: "Pramaan Demo USD", version: "1", chainId: state!.network.chainId, verifyingContract: token },
    message: { owner, spender: market, value: "5000000", nonce: "0", deadline: String(Math.floor(Date.now() / 1000) + 1200) },
  };
  const permit = await send(page, "eth_signTypedData_v4", [owner, JSON.stringify(td)]);
  await expect(permit.locator(".headline")).toContainText("permit");
  await expect(permit.locator(".risk.medium").first()).toContainText("signature, not a transaction");
  await permit.click("#reject");
  await page.close();
});

test("leak fixture: undeclared tracker shown, Block, next request blocked", async () => {
  test.skip(!state!.fixturesEnabled || !state!.hosts.trackerUrl, "fixtures disabled");
  const app = state!.apps.permitmarket;
  const trackerHost = new URL(state!.hosts.trackerUrl!).host;
  const count = async () => ((await (await fetch(`${state!.hosts.trackerUrl}/log`)).json()) as unknown[]).length;
  const page = await open(`${app.origin}/__fixtures/leak.html`);
  await page.evaluate(() => (window as unknown as { ethereum: { request: (a: unknown) => Promise<unknown> } }).ethereum.request({ method: "eth_requestAccounts" }));
  const sendAll = page.getByRole("button", { name: /send all/i });
  // The fixture enables its attack buttons only after its own Connect button succeeds, like a real page would.
  await page.getByRole("button", { name: /connect wallet/i }).click();
  await expect(sendAll).toBeEnabled({ timeout: 15_000 });
  const fire = async () => {
    if (await sendAll.count()) await sendAll.click();
    else await page.evaluate(([t]) => void fetch(`${t}/collect?addr=${(window as unknown as { __a?: string }).__a ?? ""}`, { mode: "no-cors" }), [state!.hosts.trackerUrl!] as const);
  };
  const before = await count();
  await fire();
  await expect.poll(count, { timeout: 15_000 }).toBeGreaterThan(before);
  // the background worker persists a tab record shortly after the first events, so wait for it instead of assuming it exists
  let record = await tab(`${app.origin}/__fixtures/leak.html`);
  for (let i = 0; i < 30 && !record; i++) {
    await page.waitForTimeout(500);
    record = await tab(`${app.origin}/__fixtures/leak.html`);
  }
  expect(record, "the extension has a record of the leak fixture tab").not.toBeNull();
  const tabId = record!.tabId;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html?tab=${tabId}`);
  const leak = popup.locator(`.leak[data-host="${trackerHost}"]`);
  await expect(leak).toContainText("NOT declared", { timeout: 20_000 });
  await leak.locator("button").click();
  await expect(leak).toContainText("blocked");
  const blockedAt = await count();
  await fire();
  await page.waitForTimeout(3000);
  expect(await count()).toBe(blockedAt);
  await popup.close();
  await page.close();
});

test("backend down: verification still works (the extension never needs the Pramaan server)", async () => {
  // Every request from the extension to the backend now fails, exactly as if the server were stopped.
  await sw.evaluate((backend) => {
    const orig = self.fetch.bind(self);
    self.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (u.startsWith(backend)) {
        (self as unknown as { __backendHits?: number }).__backendHits = ((self as unknown as { __backendHits?: number }).__backendHits ?? 0) + 1;
        return Promise.reject(new TypeError("backend down (test)"));
      }
      return orig(input, init);
    }) as typeof fetch;
  }, BACKEND);
  const app = state!.apps.vaultlab;
  const page = await open(app.origin);
  const tabId = (await expect.poll(async () => (await tab(app.origin))?.tabId).toBeDefined(), (await tab(app.origin))!.tabId);
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${new URL(sw.url()).host}/options.html`);
  await ext.evaluate((id) => chrome.runtime.sendMessage({ type: "reverify", tabId: id }), tabId);
  await waitRelease(app.origin, "verified");
  expect(await sw.evaluate(() => (self as unknown as { __backendHits?: number }).__backendHits ?? 0)).toBe(0);
  await ext.close();
  await page.close();
});

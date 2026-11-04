import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";

/**
 * End-to-end: the built extension in Chromium against the running local demo (`pnpm demo:up`).
 * The "wallet" is a minimal EIP-1193 provider injected into the page; it signs in Node with the demo user's
 * local-fork key, so Pramaan sees exactly what it would see in front of MetaMask.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../..");
const STATE = join(ROOT, ".pramaan", "demo", "state.json");
const KEYS = join(ROOT, ".pramaan", "demo", "keys.json");
const EXT = resolve(__dirname, "../dist");
const ready = existsSync(STATE) && existsSync(KEYS) && existsSync(join(EXT, "manifest.json"));

test.skip(!ready, "run `pnpm demo:up` and `pnpm build:extension` first");

const state = ready ? JSON.parse(readFileSync(STATE, "utf8")) : null;
const keys = ready ? JSON.parse(readFileSync(KEYS, "utf8")) : null;
test.skip(state?.version === 2, "legacy single-app selectors and state; V2 coverage is in v2.e2e.ts");
let context: BrowserContext;
let sw: Worker;

const chain = defineChain({ id: 31337, name: "fork", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } } });

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const r = await fetch("http://127.0.0.1:8545", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = (await r.json()) as { result?: unknown; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

test.beforeAll(async () => {
  const account = privateKeyToAccount(keys.user as Hex);
  const wallet = createWalletClient({ account, chain, transport: http("http://127.0.0.1:8545") });
  const reader = createPublicClient({ chain, transport: http("http://127.0.0.1:8545") });
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "pramaan-e2e-")), {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  await context.exposeFunction("__pramaanTestWallet", async (method: string, params: unknown[]) => {
    if (method === "eth_requestAccounts" || method === "eth_accounts") return [account.address];
    if (method === "eth_chainId") return "0x7a69";
    if (method === "eth_sendTransaction") {
      const tx = params[0] as { to: Hex; data?: Hex; value?: Hex };
      const value = tx.value ? BigInt(tx.value) : 0n;
      // 30% gas margin: Sepolia (and its fork) runs the Amsterdam fork, where anvil's estimates come out short.
      const gas = ((await reader.estimateGas({ account, to: tx.to, data: tx.data, value })) * 13n) / 10n;
      return wallet.sendTransaction({ to: tx.to, data: tx.data, value, gas });
    }
    if (method === "personal_sign") return account.signMessage({ message: { raw: params[0] as Hex } });
    if (method === "eth_signTypedData_v4") return account.signTypedData(JSON.parse(params[1] as string));
    return rpc(method, params);
  });
  await context.addInitScript(() => {
    const w = window as unknown as { ethereum: unknown; __pramaanTestWallet: (m: string, p: unknown[]) => Promise<unknown> };
    w.ethereum = { isPramaanTestWallet: true, request: ({ method, params }: { method: string; params?: unknown[] }) => w.__pramaanTestWallet(method, params ?? []), on: () => undefined };
  });
  sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
});

test.afterAll(async () => {
  await fetch("http://127.0.0.1:5189/mode?set=genuine", { method: "POST" }).catch(() => undefined);
  await context?.close();
});

async function tabState(url: string): Promise<{ status: string; release: { status: string } | null; site: { severity: string; status: string } | null; leaks: Record<string, { declared: boolean; blocked: boolean; count: number }> } | null> {
  return sw.evaluate(async (u) => {
    const all = await chrome.storage.session.get(null);
    const tabs = Object.values(all).filter((v) => v && typeof v === "object" && "tabId" in (v as object)) as { url: string; status: string; release: unknown; site: unknown; leaks: unknown; updatedAt: string }[];
    const matching = tabs.filter((t) => t.url?.startsWith(u)).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return (matching[0] as never) ?? null;
  }, url);
}

async function waitVerified(url: string, expected: string, timeout = 120_000) {
  await expect.poll(async () => (await tabState(url))?.release?.status ?? "pending", { timeout, intervals: [1000] }).toBe(expected);
}

async function open(url: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(url);
  return page;
}

async function clickAndReview(page: Page, action: string): Promise<Page> {
  const [verdict] = await Promise.all([context.waitForEvent("page", { predicate: (p) => p.url().includes("verdict.html"), timeout: 90_000 }), page.click(`button[data-action="${action}"]`)]);
  await verdict.waitForLoadState();
  await expect(verdict.locator(".headline")).not.toHaveText("", { timeout: 60_000 });
  return verdict;
}

test("genuine release: ENS pointer, manifest hash, signature and every loaded file verify (green)", async () => {
  const page = await open(state.origin);
  await waitVerified(state.origin, "verified");
  await expect.poll(async () => (await tabState(state.origin))?.site?.severity, { timeout: 60_000 }).toBe("green");
  await page.close();
});

test("unlimited approval is explained in Hindi as high risk and can be rejected", async () => {
  const page = await open(state.origin);
  await waitVerified(state.origin, "verified");
  await page.click("#connect");
  const verdict = await clickAndReview(page, "approveMax");
  await verdict.selectOption("#lang", "hi");
  await expect(verdict.locator(".risk.high")).toContainText("सभी pUSD");
  await expect(verdict.locator(".headline")).toContainText("असीमित");
  await verdict.selectOption("#lang", "en");
  await expect(verdict.locator(".risk.high")).toContainText("unlimited permission to use your pUSD");
  await verdict.click("#reject");
  await expect(page.locator("#log")).toContainText("rejected", { timeout: 30_000 });
  await page.close();
});

test("a deposit to the released VaultV2 shows a verified contract and goes through on continue", async () => {
  const page = await open(state.origin);
  await waitVerified(state.origin, "verified");
  await page.click("#connect");
  const verdict = await clickAndReview(page, "deposit");
  await expect(verdict.locator(".row.green", { hasText: "VaultV2" })).toBeVisible();
  await expect(verdict.locator(".headline")).toContainText("deposit");
  await verdict.click("#continue");
  await expect(page.locator("#log")).toContainText("Deposit ETH: confirmed", { timeout: 60_000 });
  await page.close();
});

test("an unlisted contract is amber and a Safe DELEGATECALL is critical", async () => {
  const page = await open(state.origin);
  await waitVerified(state.origin, "verified");
  await page.click("#connect");
  const legacy = await clickAndReview(page, "legacy");
  await expect(legacy.locator(".row.amber")).toContainText("not part of the site's published release");
  await legacy.click("#reject");
  const dc = await clickAndReview(page, "delegatecall");
  await expect(dc.locator(".risk.critical")).toContainText("DELEGATECALL");
  await dc.click("#reject");
  await page.close();
});

test("a tampered JS bundle on the same origin turns the site red and blocks signing", async () => {
  await fetch("http://127.0.0.1:5189/mode?set=tampered", { method: "POST" });
  const page = await open(state.origin);
  await waitVerified(state.origin, "verified");
  await expect.poll(async () => (await tabState(state.origin))?.site?.status, { timeout: 60_000 }).toBe("mismatch");
  await page.click("#connect");
  const verdict = await clickAndReview(page, "deposit");
  await expect(verdict.locator(".banner")).toBeVisible();
  await expect(verdict.locator("#continue")).toBeDisabled();
  await verdict.click("#reject");
  await fetch("http://127.0.0.1:5189/mode?set=genuine", { method: "POST" });
  await page.close();
});

test("the same files on a lookalike origin fail the ENS domain binding", async () => {
  const page = await open(state.lookalikeOrigin);
  await waitVerified(state.lookalikeOrigin, "mismatch");
  await page.close();
});

test("the privacy page's undeclared address leak is observed, then blocked", async () => {
  const before = ((await (await fetch("http://127.0.0.1:5190/log")).json()) as unknown[]).length;
  const page = await open(`${state.origin}/leak.html`);
  await waitVerified(`${state.origin}/leak.html`, "verified");
  await page.click("#check");
  await expect.poll(async () => Object.values((await tabState(`${state.origin}/leak.html`))?.leaks ?? {}).find((l) => !l.declared)?.count ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
  const after = ((await (await fetch("http://127.0.0.1:5190/log")).json()) as unknown[]).length;
  expect(after).toBeGreaterThan(before);
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: "http://localhost:5180/leak.html" }))[0]?.id ?? -1);
  // The popup's "Block" button sends this message; an extension page is used because a worker cannot message itself.
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${new URL(sw.url()).host}/options.html`);
  await ext.evaluate(async (id) => chrome.runtime.sendMessage({ type: "block-host", tabId: id, origin: "http://127.0.0.1:5190" }), tabId);
  await ext.close();
  const blockedAt = ((await (await fetch("http://127.0.0.1:5190/log")).json()) as unknown[]).length;
  await page.click("#check");
  await page.waitForTimeout(3000);
  const later = ((await (await fetch("http://127.0.0.1:5190/log")).json()) as unknown[]).length;
  expect(later).toBe(blockedAt);
  await page.close();
});

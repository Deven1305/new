import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from "@playwright/test";

/**
 * The merged HexFence + Pramaan extension in real Chromium: a Safe payment on the local fork. A real HexFenceGuard is
 * deployed on the demo chain, a "Safe" is given that Guard and one approved payee, and the page then asks the wallet
 * to sign a SafeTx. The review window must show the Recipient row.
 * Needs `pnpm merged:up` (anvil on :8545) and `pnpm build:extension`; compiled Guard artifacts in ../../contracts.
 */
const here = dirname(fileURLToPath(import.meta.url));
const EXT = resolve(here, "../dist");
const ARTIFACT = resolve(here, "../../../../contracts/artifacts/contracts/HexFenceGuard.sol/HexFenceGuard.json");
const RPC = "http://127.0.0.1:8545";
const SITE = "http://localhost:9621";
const WALLET = "0x173a8Ce665789f4065ab3Ef9F1d190bBcaD834cC";
const SAFE = "0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe";
const DEPLOYER = "0xd0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0";
const P = "0x4E185e251Ac7fB83E9DE10723EAda46cadE74120"; // approved payee
const L = "0x4E185a3FC4B530244aB9ed0dE38167b403344120"; // lookalike of P
const B = "0xcB0a33f755826307CcaC3f4b4833e7e19d38cEb6"; // new supplier
const GUARD_SLOT = "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8";

async function rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await r.json()) as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result as T;
}
async function chainUp(): Promise<boolean> {
  try {
    return (await rpc<string>("eth_chainId")) === "0x7a69";
  } catch {
    return false;
  }
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>safe fixture</title><body><h1>safe fixture</h1><script>
window.__results = [];
window.addEventListener("eip6963:announceProvider", (e) => { window.__announced = e.detail.provider; });
window.dispatchEvent(new Event("eip6963:requestProvider"));
</script></body>`;

let site: Server;
let context: BrowserContext;
let sw: Worker;
let guard = "";

test.skip(!existsSync(join(EXT, "manifest.json")), "run `pnpm build:extension` first");
test.skip(!existsSync(ARTIFACT), "compile the HexFence contracts first (Hardhat, Node 22 or Docker)");

test.beforeAll(async () => {
  test.skip(!(await chainUp()), "start the local demo chain first (pnpm merged:up)");
  // Real HexFenceGuard on the local fork; the "Safe" (an impersonated address) installs it and approves payee P.
  for (const a of [DEPLOYER, SAFE]) {
    await rpc("anvil_setBalance", [a, "0x56BC75E2D63100000"]);
    await rpc("anvil_impersonateAccount", [a]);
  }
  const bytecode = (JSON.parse(readFileSync(ARTIFACT, "utf8")) as { bytecode: string }).bytecode;
  const hash = await rpc<string>("eth_sendTransaction", [{ from: DEPLOYER, data: bytecode }]);
  await rpc("evm_mine"); // the demo chain does not necessarily auto-mine
  guard = (await rpc<{ contractAddress: string }>("eth_getTransactionReceipt", [hash])).contractAddress;
  await rpc("anvil_setStorageAt", [SAFE, GUARD_SLOT, `0x${guard.slice(2).padStart(64, "0")}`]);
  await rpc("eth_sendTransaction", [{ from: SAFE, to: guard, data: `0x0f78cf0f${P.slice(2).toLowerCase().padStart(64, "0")}` }]);
  await rpc("evm_mine");

  site = createServer((req, res) => {
    res.writeHead(req.url === "/" ? 200 : 404, { "content-type": "text/html", "cache-control": "no-store" });
    res.end(req.url === "/" ? PAGE : "not found");
  }).listen(9621, "127.0.0.1");
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "hexfence-unified-")), {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  await context.exposeFunction("__wallet", async (method: string) => {
    if (method === "eth_requestAccounts" || method === "eth_accounts") return [WALLET];
    if (method === "eth_chainId") return "0x7a69";
    return null;
  });
  await context.addInitScript(() => {
    const call = (w: Window) => (w as unknown as { __wallet: (m: string) => Promise<unknown> }).__wallet;
    const provider = { request: ({ method }: { method: string }) => call(window)(method), on: () => undefined };
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid: "1", name: "Test Wallet", icon: "", rdns: "test.wallet" }, provider }) }));
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
    (window as unknown as { ethereum: unknown }).ethereum = provider;
  });
  sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  // Tell the extension where this chain's HexFence Guard is (the options page does the same).
  await sw.evaluate(async (g) => {
    await chrome.storage.local.set({ settings: { hexfenceGuards: { "31337": g } } });
  }, guard);
});

test.afterAll(async () => {
  await context?.close();
  site?.close();
  for (const a of [DEPLOYER, SAFE]) await rpc("anvil_stopImpersonatingAccount", [a]).catch(() => undefined);
});

const safeTx = (to: string, value = "100000000000000", operation = 0) =>
  JSON.stringify({
    primaryType: "SafeTx",
    domain: { chainId: 31337, verifyingContract: SAFE },
    types: { SafeTx: [] },
    message: { to, value, data: "0x", operation, safeTxGas: "0", baseGas: "0", gasPrice: "0", gasToken: "0x0000000000000000000000000000000000000000", refundReceiver: "0x0000000000000000000000000000000000000000", nonce: "0" },
  });

async function review(to: string, operation = 0): Promise<{ page: Page; review: Page }> {
  const page = await context.newPage();
  await page.goto(SITE);
  await page.waitForTimeout(400);
  const [r] = await Promise.all([
    context.waitForEvent("page", { predicate: (p) => p.url().includes("verdict.html"), timeout: 30_000 }),
    page.evaluate(
      ([td]) => {
        const p = (window as unknown as { __announced: { request: (a: unknown) => Promise<unknown> } }).__announced;
        void p.request({ method: "eth_signTypedData_v4", params: [window.location.origin, td] }).then(
          (x) => (window as unknown as { __results: unknown[] }).__results.push({ ok: x }),
          (e: { code?: number }) => (window as unknown as { __results: unknown[] }).__results.push({ code: e.code }),
        );
      },
      [safeTx(to, "100000000000000", operation)] as const,
    ),
  ]);
  await r.waitForLoadState();
  return { page, review: r };
}
const rowText = (r: Page, cls: string) => r.locator(`.row.${cls}`, { hasText: "Recipient" }).first().innerText({ timeout: 40_000 });
const results = (page: Page) => page.evaluate(() => (window as unknown as { __results: { code?: number; ok?: unknown }[] }).__results);

test("a payment from a Safe to a lookalike of an approved payee shows a RED Recipient row and is held", async () => {
  const { page, review: r } = await review(L);
  const text = await rowText(r, "red");
  // Set SHOT_DIR to keep a picture of the merged review window (used for the demo material).
  if (process.env.SHOT_DIR) await r.screenshot({ path: join(process.env.SHOT_DIR, "review-lookalike-red.png") });
  expect(text).toMatch(/Possible address poisoning/);
  expect(text).toContain(P);
  await expect(r.getByRole("button", { name: /Reject/ })).toBeVisible();
  await r.getByRole("button", { name: /Reject/ }).click();
  await expect.poll(async () => (await results(page))[0]?.code, { timeout: 15_000 }).toBe(4001);
  await page.close();
});

test("the approved payee is green and a new supplier is amber (the same window, the same rule as the Guard)", async () => {
  const ok = await review(P);
  expect(await rowText(ok.review, "green")).toMatch(/approved payees/);
  await ok.review.getByRole("button", { name: /Reject/ }).click();
  const fresh = await review(B);
  expect(await rowText(fresh.review, "amber")).toMatch(/New recipient/);
  await fresh.review.getByRole("button", { name: /Reject/ }).click();
  await ok.page.close();
  await fresh.page.close();
});

test("the Recipient row is translated: Hindi and Marathi", async () => {
  const { page, review: r } = await review(L);
  await rowText(r, "red");
  await r.locator("#lang").selectOption("hi");
  await expect(r.locator(".row.red", { hasText: "प्राप्तकर्ता" }).first()).toContainText("एड्रेस पॉइज़निंग");
  await r.locator("#lang").selectOption("mr");
  await expect(r.locator(".row.red", { hasText: "प्राप्तकर्ता" }).first()).toContainText("पॉइझनिंग");
  await r.locator("#reject").click({ timeout: 10_000 });
  await page.close();
});

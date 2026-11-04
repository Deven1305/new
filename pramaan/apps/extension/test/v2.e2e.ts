import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { dnsEncode } from "@pramaan/verifier-core";
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from "@playwright/test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../../..");
const statePath = join(root, ".pramaan/demo/state.json");
const ext = resolve(__dirname, "../dist");
const ready = existsSync(statePath) && existsSync(join(ext, "manifest.json"));
test.skip(!ready, "start the V2 local demo and build the extension first");
const state = ready ? JSON.parse(readFileSync(statePath, "utf8")) : null;
let context: BrowserContext;
let sw: Worker;
let providerCalls = 0;
let guardedCalls = 0;
let lastHash: Hex | null = null;
const keys = ready ? JSON.parse(readFileSync(join(root, ".pramaan/demo/keys.json"), "utf8")) : null;
const chain = defineChain({ id: 31337, name: "Local fork", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } } });
const reader = createPublicClient({ chain, transport: http() });
const wallet = ready ? createWalletClient({ account: privateKeyToAccount(keys.user as Hex), chain, transport: http() }) : null;
const approval = ready ? encodeFunctionData({ abi: parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]), functionName: "approve", args: [state.apps.mirroryield.contracts.farm, 0n] }) : "0x";
const origin = state?.apps?.mirroryield?.origin as string;

test.beforeAll(async () => {
  if (process.env.PRAMAAN_EXPECT_BACKEND_OFF === "1") {
    const backendResponded = await fetch("http://127.0.0.1:8787/healthz").then(() => true, () => false);
    expect(backendResponded).toBe(false);
  }
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "pramaan-browser-")), { channel: "chromium", headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
  await context.exposeFunction("__testProvider", async (method: string, params: any[]) => {
    if (method === "eth_chainId") return "0x7a69";
    if (method === "eth_accounts" || method === "eth_requestAccounts") return [state.accounts.user];
    if (method === "eth_sendTransaction" || method === "eth_signTypedData_v4") guardedCalls++;
    if (method === "eth_sendTransaction") { providerCalls++; const tx = params[0]; lastHash = await wallet!.sendTransaction({ to: tx.to, data: tx.data, gas: 300_000n }); return lastHash; }
    throw new Error(`unexpected provider method ${method}`);
  });
  await context.addInitScript(() => {
    const w = window as any;
    w.ethereum = { request: ({ method, params }: { method: string; params?: unknown[] }) => w.__testProvider(method, params ?? []), on: () => undefined };
  });
  sw = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
});
test.afterAll(async () => {
  await fetch("http://127.0.0.1:5189/restore?app=mirroryield", { method: "POST" }).catch(() => undefined);
  await context?.close();
});
async function openAndWait(expected: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(origin);
  await expect.poll(async () => sw.evaluate(async (url) => {
    const all = await chrome.storage.session.get(null);
    const tabs = Object.values(all).filter((v: any) => v && v.url === url && v.status === "done") as any[];
    return tabs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.site?.status ?? "waiting";
  }, origin + "/"), { timeout: 120_000 }).toBe(expected);
  return page;
}
async function request(page: Page) {
  const popup = context.waitForEvent("page", { predicate: (p) => p.url().includes("verdict.html"), timeout: 90_000 });
  await page.evaluate(({ to, from, data }) => {
    const w = window as any;
    w.__result = "pending";
    void w.ethereum.request({ method: "eth_sendTransaction", params: [{ from, to, value: "0x0", data }] }).then(() => { w.__result = "continued"; }, () => { w.__result = "rejected"; });
  }, { to: state.apps.mirroryield.contracts.token, from: state.accounts.user, data: approval });
  const verdict = await popup;
  await verdict.waitForLoadState();
  return verdict;
}
test("signed release, changed served JS, and byte-identical restore gate the provider", async () => {
  let page = await openAndWait("verified");
  let review = await request(page);
  await expect(review.locator("#continue")).toBeEnabled();
  await review.click("#continue");
  await expect.poll(() => providerCalls).toBe(1);
  await expect.poll(async () => lastHash ? (await reader.getTransactionReceipt({ hash: lastHash }).catch(() => null))?.status ?? "pending" : "pending").toBe("success");
  const acceptedTx = lastHash;
  const nonceBeforeTamper = await reader.getTransactionCount({ address: state.accounts.user });
  await page.close();
  const assetsDir = join(root, state.apps.mirroryield.distDir, "assets");
  const bundle = readdirSync(assetsDir).filter((f) => f.endsWith(".js")).map((f) => join(assetsDir, f)).find((f) => readFileSync(f, "utf8").toLowerCase().includes(state.apps.mirroryield.contracts.farm.toLowerCase()));
  expect(bundle).toBeTruthy();
  const digest = () => createHash("sha256").update(readFileSync(bundle!)).digest("hex");
  const originalHash = digest();
  const tamper = await fetch("http://127.0.0.1:5189/tamper?app=mirroryield", { method: "POST" });
  expect(tamper.ok).toBe(true);
  expect(digest()).not.toBe(originalHash);
  const servedBytes = await (await fetch(`${origin}/assets/${bundle!.split(/[\\/]/).pop()}`)).arrayBuffer();
  expect(createHash("sha256").update(Buffer.from(servedBytes)).digest("hex")).toBe(digest());
  page = await openAndWait("mismatch");
  review = await request(page);
  await expect(review.locator("#continue")).toBeDisabled();
  await review.click("#reject");
  await expect.poll(async () => page.evaluate(() => (window as any).__result)).toBe("rejected");
  expect(providerCalls).toBe(1);
  const nonceAfterReject = await reader.getTransactionCount({ address: state.accounts.user });
  expect(nonceAfterReject).toBe(nonceBeforeTamper);
  await page.close();
  const restored = await fetch("http://127.0.0.1:5189/restore?app=mirroryield", { method: "POST" });
  expect(restored.ok).toBe(true);
  expect(digest()).toBe(originalHash);
  page = await openAndWait("verified");
  review = await request(page);
  await expect(review.locator("#continue")).toBeEnabled();
  await review.click("#continue");
  await expect.poll(() => providerCalls).toBe(2);
  console.log(JSON.stringify({ evidence: "local-fork-browser", manifest: state.apps.mirroryield.release.sha256, acceptedTx, nonceBeforeTamper, nonceAfterReject, providerCallsAfterTamper: 1, providerCallsAfterRestore: providerCalls }));
  await page.close();
});


test("unlisted contract spender holds approval and typed-data permit", async () => {
  const page = await openAndWait("verified");
  const spender = state.apps.vaultlab.contracts.vault;
  const before = guardedCalls;
  const data = encodeFunctionData({ abi: parseAbi(["function approve(address spender,uint256 amount) returns (bool)"]), functionName: "approve", args: [spender, 1n] });
  const permit = { domain: { name: "Demo Token", version: "1", chainId: 31337, verifyingContract: state.apps.mirroryield.contracts.token }, primaryType: "Permit", types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }], Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] }, message: { owner: state.accounts.user, spender, value: "1", nonce: "0", deadline: "9999999999" } };
  for (const [method, params] of [["eth_sendTransaction", [{ from: state.accounts.user, to: state.apps.mirroryield.contracts.token, data }]], ["eth_signTypedData_v4", [state.accounts.user, JSON.stringify(permit)]]] as const) {
    const popup = context.waitForEvent("page", { predicate: (p) => p.url().includes("verdict.html"), timeout: 90_000 });
    await page.evaluate(({ method, params }) => { void (window as any).ethereum.request({ method, params }).catch(() => undefined); }, { method, params });
    const review = await popup;
    await review.waitForLoadState();
    await expect(review.locator(".risk.high")).toContainText("not one of the contracts");
    await expect(review.locator("#continue")).toBeDisabled();
    await review.click("#reject");
    expect(guardedCalls).toBe(before);
  }
  await page.close();
});

test.skip("pending pointer and revocation are read from the real fork resolver", async () => {
  const app = state.apps.mirroryield;
  const timelockAbi = parseAbi(["function queue(string value)", "function cancel(uint256 id)", "function operationCount() view returns (uint256)"]);
  const resolverAbi = parseAbi(["function setText(bytes name,string key,string value)"]);
  const signer = (key: Hex) => createWalletClient({ account: privateKeyToAccount(key), chain, transport: http() });
  const proposer = signer(keys.proposer), guardian = signer(keys.guardian), owner = signer(keys.owner);
  const queued = await proposer.writeContract({ address: app.timelock, abi: timelockAbi, functionName: "queue", args: [`pramaan:v1:v2.0.0:${"1".repeat(64)}`], gas: 1_500_000n });
  expect((await reader.waitForTransactionReceipt({ hash: queued })).status).toBe("success");
  const id = await reader.readContract({ address: app.timelock, abi: timelockAbi, functionName: "operationCount" });
  try {
    let page = await openAndWait("verified");
    await expect.poll(async () => sw.evaluate(async (url) => {
      const all = await chrome.storage.session.get(null);
      const tabs = Object.values(all).filter((v: any) => v && v.url === url && v.status === "done") as any[];
      return tabs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.release?.pending?.length ?? 0;
    }, origin + "/"), { timeout: 60_000 }).toBeGreaterThan(0);
    await page.close();
  } finally {
    const cancelled = await guardian.writeContract({ address: app.timelock, abi: timelockAbi, functionName: "cancel", args: [id], gas: 300_000n });
    expect((await reader.waitForTransactionReceipt({ hash: cancelled })).status).toBe("success");
  }
  const setRevocation = async (value: string) => {
    const hash = await owner.writeContract({ address: app.resolver, abi: resolverAbi, functionName: "setText", args: [dnsEncode(app.ensName), "pramaan.revoked", value], gas: 300_000n });
    expect((await reader.waitForTransactionReceipt({ hash })).status).toBe("success");
  };
  await setRevocation(app.release.sha256);
  try {
    const page = await context.newPage();
    await page.goto(origin);
    await expect.poll(async () => sw.evaluate(async (url) => {
      const all = await chrome.storage.session.get(null);
      const tabs = Object.values(all).filter((v: any) => v && v.url === url && v.status === "done") as any[];
      return tabs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.release?.status ?? "waiting";
    }, origin + "/"), { timeout: 60_000 }).toBe("revoked");
    await page.close();
  } finally { await setRevocation(""); }
});

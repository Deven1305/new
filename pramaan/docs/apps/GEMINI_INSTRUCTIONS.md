# Instructions for the AI agent (Gemini) building the Pramaan demo apps

**How to use this file:** give the agent this file first. Then give it ONE plan at a time:
1. `docs/apps/GEMINI_PLAN_VAULTLAB.md`
2. `docs/apps/GEMINI_PLAN_MIRRORYIELD.md`
3. `docs/apps/GEMINI_PLAN_PERMITMARKET.md`

Finish and check one app before starting the next. Every step below is meant to be executed exactly as written. Do not redesign or skip anything, and do not add features.

---

## 0. Facts you need

- **Project root:** `D:\Deven\1_Hackathon_proj\my\eth\Pramaan\pramaan`. All paths in these plans are relative to it.
- **Shell:** Windows PowerShell 5.1. `&&` does **not** work; run commands one per line.
- **Tools already installed:** Node 20, pnpm 10.34.9, viem 2.57.7 and vite 7.3.7 in `apps/demos`, Foundry (`anvil`, `forge`, `cast`) in `%USERPROFILE%\.foundry\bin`.
- **There is no git in this project.** Never run `git`.
- **Contracts are already written** in `contracts/src/demo/`. You only build web frontends.
- **The background documents:**
  - `docs/apps/00_SHARED_RULES.md` is general background. If something there conflicts with this file or the plans, **this file and the plans win**. In particular: always use your app's own `src/lib/` folder, never `apps/demos/shared/`.
  - `VAULTLAB.md`, `MIRRORYIELD.md` and `PERMITMARKET.md` say *what* each app is.
  - The `GEMINI_PLAN_*.md` files say exactly *how* to build each one.

## 1. Folders you may create and edit — nothing else

```
apps/demos/vaultlab/        ← VaultLab plan only
apps/demos/mirroryield/     ← MirrorYield plan only
apps/demos/permitmarket/    ← PermitMarket plan only
```

Each app folder has the same structure:

```
apps/demos/<appId>/
  index.html
  vite.config.ts
  src/
    main.ts            entry: builds the page, wires buttons
    style.css          the app's look
    abi.ts             parseAbi([...]) for the contracts the app uses
    ui.ts              small DOM helpers (el(), toast(), setBusy())
    lib/
      config.ts        copied from section 3 (identical in all 3 apps)
      wallet.ts        copied from section 3
      tx.ts            copied from section 3
      format.ts        copied from section 3
      errors.ts        copied from section 3
    sections/*.ts      one file per screen section (named in each plan)
  test/
    smoke.md           your manual test log (what you clicked, tx hashes)
```

**Never edit:**
- `contracts/`, `packages/`, `apps/demos/shared/`, `apps/demos/scripts/`, `apps/demos/server/`, or any other app;
- the root `package.json`, any `package.json`, or `pnpm-lock.yaml`.

**Never run** `pnpm add`, `pnpm install`, `npm install` or `git`.

## 2. Global rules (a reviewer checks all of them)

1. **Vanilla TypeScript + viem only.** No React or Vue, no UI or CSS frameworks, no CDN links, no external fonts or images. Generate images as inline SVG strings.
2. **Nothing hardcoded.**
   - Addresses, chain id, RPC URL and ENS name come only from `getConfig()`.
   - The only literal addresses allowed: none.
   - The only literal numbers allowed: UI constants and `maxUint256` (import it from viem).
3. **No fake data.**
   - Every displayed balance or number comes from a contract read.
   - Every button sends a real transaction or does a real read.
   - A button that can't work right now must be `disabled`, with a `title` saying why.
4. **No security badges.** Never write "Verified", "Secure", "Audited ✓" or similar. The Pramaan extension decides that, not the app.
5. **Errors are shown, never swallowed.** Every `catch` shows `humanError(e)` from `lib/errors.ts` in a toast **and** in the section's status line.
6. **No `console.log` of addresses.** No trackers or analytics, except PermitMarket's `fixtures/` folder, which its plan describes.
7. **Accessibility and layout.**
   - Every input has a `<label>`; buttons have visible text.
   - Focus outlines stay visible.
   - The layout works at 360 px width.
   - Light and dark themes via `prefers-color-scheme`.
8. **Use `escapeHtml()`** (in `ui.ts`) for any text that comes from the chain or the user before it goes into HTML. Better still, use `textContent`.

## 3. Library files — copy these exactly into `src/lib/` of each app

### `src/lib/config.ts`
```ts
export type Hex = `0x${string}`;
export interface AppConfig {
  appId: "vaultlab" | "mirroryield" | "permitmarket";
  name: string;
  chainId: number;
  chainName: string;
  rpcUrl: string;
  explorer: string | null;
  ensName: string;
  origin: string;
  contracts: Record<string, Hex>;
}
let cached: AppConfig | null = null;
export function getConfig(): AppConfig {
  if (cached) return cached;
  const raw = import.meta.env.VITE_PRAMAAN_APP as string | undefined;
  if (!raw) throw new Error("App configuration missing: build this app with VITE_PRAMAAN_APP (see docs/apps/GEMINI_INSTRUCTIONS.md).");
  const cfg = JSON.parse(raw) as AppConfig;
  if (!cfg.chainId || !cfg.rpcUrl || !cfg.contracts) throw new Error("App configuration is incomplete.");
  cached = cfg;
  return cfg;
}
export function contract(name: string): Hex {
  const a = getConfig().contracts[name];
  if (!a) throw new Error(`Contract "${name}" is not configured for this app.`);
  return a;
}
```

### `src/vite-env.d.ts` (create in `src/`)
```ts
/// <reference types="vite/client" />
interface ImportMetaEnv { readonly VITE_PRAMAAN_APP?: string; readonly VITE_TRACKER_URL?: string }
interface ImportMeta { readonly env: ImportMetaEnv }
```

### `src/lib/wallet.ts`
```ts
import { createPublicClient, createWalletClient, custom, defineChain, http, type EIP1193Provider, type PublicClient, type WalletClient } from "viem";
import { getConfig, type Hex } from "./config";

export interface WalletInfo { name: string; icon: string; rdns: string; provider: EIP1193Provider }
export function appChain() {
  const c = getConfig();
  return defineChain({ id: c.chainId, name: c.chainName, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [c.rpcUrl] } } });
}
let pub: PublicClient | null = null;
export function publicClient(): PublicClient {
  return (pub ??= createPublicClient({ chain: appChain(), transport: http(getConfig().rpcUrl) }));
}
/** EIP-6963 discovery; falls back to window.ethereum. */
export function discoverWallets(timeoutMs = 400): Promise<WalletInfo[]> {
  return new Promise((resolve) => {
    const found: WalletInfo[] = [];
    const onAnnounce = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.info && d?.provider && !found.some((w) => w.rdns === d.info.rdns)) found.push({ name: d.info.name, icon: d.info.icon, rdns: d.info.rdns, provider: d.provider });
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      const injected = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
      if (found.length === 0 && injected) found.push({ name: "Browser wallet", icon: "", rdns: "injected", provider: injected });
      resolve(found);
    }, timeoutMs);
  });
}
export interface Session { address: Hex; wallet: WalletClient; provider: EIP1193Provider }
export async function connect(provider: EIP1193Provider): Promise<Session> {
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as Hex[];
  if (!accounts[0]) throw new Error("The wallet returned no account.");
  await ensureChain(provider);
  const wallet = createWalletClient({ account: accounts[0], chain: appChain(), transport: custom(provider) });
  return { address: accounts[0], wallet, provider };
}
export async function ensureChain(provider: EIP1193Provider): Promise<void> {
  const c = getConfig();
  const hexId = `0x${c.chainId.toString(16)}`;
  const current = (await provider.request({ method: "eth_chainId" })) as string;
  if (current.toLowerCase() === hexId) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (err) {
    if ((err as { code?: number }).code !== 4902) throw err;
    await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: hexId, chainName: c.chainName, rpcUrls: [c.rpcUrl], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, blockExplorerUrls: c.explorer ? [c.explorer] : undefined }] });
  }
}
export function onWalletEvents(provider: EIP1193Provider, onChange: () => void): void {
  provider.on?.("accountsChanged", onChange as never);
  provider.on?.("chainChanged", onChange as never);
}
```

### `src/lib/tx.ts`
```ts
import type { Hex } from "./config";
import { getConfig } from "./config";
import { publicClient } from "./wallet";
import { humanError } from "./errors";

export interface TxUi { status: (text: string, kind: "info" | "ok" | "error") => void; link: (hash: Hex) => void }
export function txLink(hash: Hex): string | null {
  const ex = getConfig().explorer;
  return ex ? `${ex.replace(/\/$/, "")}/tx/${hash}` : null;
}
/** Sends one transaction, waits for it, reports every stage. Returns true if it succeeded. */
export async function sendTx(label: string, send: () => Promise<Hex>, ui: TxUi): Promise<boolean> {
  try {
    ui.status(`${label}: confirm in your wallet…`, "info");
    const hash = await send();
    ui.link(hash);
    ui.status(`${label}: pending…`, "info");
    const receipt = await publicClient().waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      ui.status(`${label}: reverted on-chain.`, "error");
      return false;
    }
    ui.status(`${label}: confirmed in block ${receipt.blockNumber}.`, "ok");
    return true;
  } catch (e) {
    ui.status(`${label}: ${humanError(e)}`, "error");
    return false;
  }
}
```

### `src/lib/format.ts`
```ts
import { formatUnits, parseUnits } from "viem";
export function fmt(v: bigint, decimals: number, maxFrac = 4): string {
  const s = formatUnits(v, decimals);
  const [i, f = ""] = s.split(".");
  const frac = f.slice(0, maxFrac).replace(/0+$/, "");
  return `${BigInt(i).toLocaleString("en-US")}${frac ? "." + frac : ""}`;
}
export function parseAmount(input: string, decimals: number): bigint {
  const t = input.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) throw new Error("Enter a positive number.");
  const v = parseUnits(t, decimals);
  if (v <= 0n) throw new Error("Amount must be greater than zero.");
  return v;
}
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export function countdown(untilSec: bigint | number): string {
  const s = Number(untilSec) - Math.floor(Date.now() / 1000);
  if (s <= 0) return "ended";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}
```

### `src/lib/errors.ts`
```ts
import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";
/** Plain-words messages for the custom errors in contracts/src/demo/*.sol. Each plan adds its own entries. */
export const ERROR_TEXT: Record<string, string> = {
  ZeroAmount: "Enter an amount greater than zero.",
  FaucetCooldown: "The faucet can be used once per hour per address. Try again later.",
};
export function humanError(e: unknown): string {
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError)) return "You rejected the request in your wallet.";
    const rev = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (rev instanceof ContractFunctionRevertedError) {
      const name = rev.data?.errorName;
      if (name) return ERROR_TEXT[name] ?? `The contract rejected this (${name}).`;
      return rev.reason ?? "The contract rejected this transaction.";
    }
    return e.shortMessage;
  }
  if ((e as { code?: number })?.code === 4001) return "You rejected the request in your wallet.";
  return e instanceof Error ? e.message : String(e);
}
```
**Important:** viem can only decode a custom error name if that error is in the ABI you pass. So every `parseAbi([...])` in `abi.ts` must include the contract's `error` lines. The plans list them.

## 4. `index.html` and `vite.config.ts` (same pattern for every app)

`vite.config.ts`:
```ts
import { defineConfig } from "vite";
export default defineConfig({ base: "/", build: { target: "es2022", sourcemap: false } });
```

`index.html`:
- has `<meta charset="utf-8">`, the viewport meta and `<title>`;
- has `<div id="app"></div>`;
- loads `<script type="module" src="/src/main.ts"></script>`;
- contains no inline scripts and no external links.

## 5. How to build and check (run each line separately)

```powershell
cd D:\Deven\1_Hackathon_proj\my\eth\Pramaan\pramaan
pnpm --filter @pramaan/demos exec tsc --noEmit -p apps/demos/<appId>/tsconfig.json
```

Create `apps/demos/<appId>/tsconfig.json`:
```json
{ "compilerOptions": { "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler", "strict": true, "lib": ["ES2022", "DOM", "DOM.Iterable"], "types": ["vite/client"], "noEmit": true, "skipLibCheck": true }, "include": ["src"] }
```

Then build. The address values come from the local test chain in section 6:
```powershell
$env:VITE_PRAMAAN_APP = Get-Content apps/demos/<appId>/test/config.local.json -Raw
pnpm --filter @pramaan/demos exec vite build apps/demos/<appId> --outDir dist-local
```
`apps/demos/<appId>/test/config.local.json` is a config JSON you write in section 6. If a team member later runs `node apps/demos/scripts/build.mjs`, that script injects the real config for you.

## 6. Local test chain (each plan names the exact deploy commands)

1. Start a chain in a **separate** PowerShell window:
   ```powershell
   & "$env:USERPROFILE\.foundry\bin\anvil.exe" --port <your port>
   ```
   VaultLab uses 9110, MirrorYield 9120, PermitMarket 9130.
2. anvil prints 10 test private keys. **These are public test keys for this local chain only.** Use key #0 as the deployer and key #1 as the "user". Never use them on any real network.
3. Deploy with `forge create`, run from `contracts/`. Each plan gives the exact commands. Put the printed `Deployed to:` addresses into `test/config.local.json`.
4. Serve the built app:
   ```powershell
   pnpm --filter @pramaan/demos exec vite preview apps/demos/<appId> --outDir dist-local --port <your port + 1>
   ```
5. Test in Chrome with MetaMask:
   - add the network: RPC `http://127.0.0.1:<port>`, chain id `31337`;
   - import anvil key #1;
   - run every flow in the plan's checklist;
   - write each tx hash into `test/smoke.md`.
6. Delete `apps/demos/<appId>/dist-local` when you are done. It must not stay in the repo.

## 7. When you finish an app, report (max 200 words)

- the files created;
- the checklist from the plan, each item ticked or explained;
- anything you could not do.

**Do not claim** a flow works unless you ran it and wrote its tx hash in `test/smoke.md`.

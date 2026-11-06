import { BaseError, ContractFunctionRevertedError, type TransactionReceipt } from "viem";
import { getConfig, type AppConfig } from "./config.js";
import { getPublicClient } from "./wallet.js";

export type TxReceipt = TransactionReceipt;

/** What a UI shows while a transaction goes through its states. */
export interface TxUi {
  /** The wallet is asked to sign (nothing is on chain yet). */
  waitingForWallet(label: string): void;
  /** The wallet broadcast the transaction; it is not mined yet. `link` is null on a local chain. */
  pending(label: string, hash: `0x${string}`, link: string | null): void;
  mined(label: string, receipt: TxReceipt, link: string | null): void;
  /** Rejected in the wallet, failed to send, or reverted. `hash` is set when the transaction was broadcast. */
  failed(label: string, message: string, hash?: `0x${string}`, link?: string | null): void;
}

export class TxFailedError extends Error {
  constructor(
    message: string,
    readonly hash?: `0x${string}`,
  ) {
    super(message);
    this.name = "TxFailedError";
  }
}

/** Explorer link for a transaction, or null when the configured chain has no explorer (the local demo chain). */
export function txLink(cfg: AppConfig, hash: string): string | null {
  return cfg.explorer ? `${cfg.explorer}/tx/${hash}` : null;
}

/** Explorer link for an address, or null on the local chain. */
export function addressLink(cfg: AppConfig, address: string): string | null {
  return cfg.explorer ? `${cfg.explorer}/address/${address}` : null;
}

/**
 * Plain-English message for a wallet/RPC/contract error. `custom` maps a Solidity custom-error name to a message (or a
 * function of its decoded arguments); contract errors only decode when the ABI passed to viem declares them.
 */
export function describeError(err: unknown, custom: Record<string, string | ((args: readonly unknown[]) => string)> = {}): string {
  const code = (err as { code?: number }).code;
  const nested = (err as { cause?: { code?: number } }).cause?.code;
  if (code === 4001 || nested === 4001 || /user (rejected|denied)/i.test(String((err as { message?: unknown }).message ?? ""))) return "You rejected the request in your wallet.";
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      if (name) {
        const m = custom[name];
        if (typeof m === "string") return m;
        if (typeof m === "function") return m(revert.data?.args ?? []);
        const args = revert.data?.args?.map((a) => String(a)).join(", ");
        return args ? `The contract rejected this: ${name}(${args}).` : `The contract rejected this: ${name}.`;
      }
      if (revert.reason) return `The contract rejected this: ${revert.reason}.`;
    }
    return err.shortMessage;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Sends one transaction through the wallet and follows it to a receipt: waiting for wallet -> pending (hash + explorer
 * link) -> mined, or failed (rejected, send error, reverted). Resolves with the receipt; rejects with TxFailedError after
 * `ui.failed` was called.
 */
export async function sendTx(opts: { label: string; request: () => Promise<`0x${string}`>; cfg?: AppConfig; errors?: Record<string, string | ((args: readonly unknown[]) => string)> }, ui: TxUi): Promise<TxReceipt> {
  const cfg = opts.cfg ?? getConfig();
  ui.waitingForWallet(opts.label);
  let hash: `0x${string}`;
  try {
    hash = await opts.request();
  } catch (err) {
    const message = describeError(err, opts.errors);
    ui.failed(opts.label, message);
    throw new TxFailedError(message);
  }
  const link = txLink(cfg, hash);
  ui.pending(opts.label, hash, link);
  try {
    const receipt = await getPublicClient().waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== "success") {
      const message = "The transaction was mined but reverted on-chain, so nothing changed.";
      ui.failed(opts.label, message, hash, link);
      throw new TxFailedError(message, hash);
    }
    ui.mined(opts.label, receipt, link);
    return receipt;
  } catch (err) {
    if (err instanceof TxFailedError) throw err;
    const message = describeError(err);
    ui.failed(opts.label, message, hash, link);
    throw new TxFailedError(message, hash);
  }
}

/**
 * A ready-made TxUi that renders into `container` (an aria-live status line with the hash and an explorer link on
 * Sepolia, or the plain hash on the local chain). Styled by base.css (`.tx-status`).
 */
export function createTxUi(container: HTMLElement): TxUi {
  container.classList.add("tx-status");
  container.setAttribute("role", "status");
  container.setAttribute("aria-live", "polite");
  const render = (state: "wait" | "pending" | "ok" | "fail", text: string, hash?: string, link?: string | null) => {
    container.dataset["state"] = state;
    container.textContent = "";
    const span = document.createElement("span");
    span.textContent = text;
    container.append(span);
    if (hash) {
      container.append(" ");
      if (link) {
        const a = document.createElement("a");
        a.href = link;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = `${hash.slice(0, 10)}…${hash.slice(-8)}`;
        container.append(a);
      } else {
        const code = document.createElement("code");
        code.textContent = hash;
        code.title = "transaction hash";
        container.append(code);
      }
    }
  };
  return {
    waitingForWallet: (label) => render("wait", `${label}: confirm in your wallet…`),
    pending: (label, hash, link) => render("pending", `${label}: submitted, waiting for confirmation…`, hash, link),
    mined: (label, receipt, link) => render("ok", `${label}: confirmed in block ${receipt.blockNumber}.`, receipt.transactionHash, link),
    failed: (label, message, hash, link) => render("fail", `${label} failed: ${message}`, hash, link),
  };
}

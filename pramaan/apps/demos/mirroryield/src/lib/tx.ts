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

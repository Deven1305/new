import type { sourcifyStatuses } from "@pramaan/manifest";

export type SourcifyStatus = (typeof sourcifyStatuses)[number];

export const SOURCIFY_API = "https://sourcify.dev/server";

/**
 * Sourcify answers a different question from Pramaan's code-hash check: "does published source compile to this
 * bytecode?". `exact_match` also matches the metadata hash; `match` matches executable code only.
 */
export async function sourcifyStatus(chainId: number, address: string, fetchFn: typeof fetch = fetch, api = SOURCIFY_API): Promise<SourcifyStatus> {
  if (chainId === 31337 || chainId === 1337) return "not_applicable";
  try {
    const res = await fetchFn(`${api}/v2/contract/${chainId}/${address}`, { headers: { accept: "application/json" } });
    if (res.status === 404) return "not_found";
    if (!res.ok) return "not_checked";
    const body = (await res.json()) as { match?: string | null };
    if (body.match === "exact_match") return "exact_match";
    if (body.match === "match") return "match";
    return "not_found";
  } catch {
    return "not_checked";
  }
}

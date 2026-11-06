import { format, type DescriptorResolver, type RegistryIndex } from "@ethereum-sourcify/clear-signing";
import type { DecodeContext, VerifiedDescriptor } from "./types.js";

export interface ClearSigningResult {
  intent: string | null;
  interpolatedIntent: string | null;
  fields: { label: string; value: string }[];
  warnings: string[];
}

/**
 * Renders a call with the ERC-7730 reference implementation, using ONLY descriptors the caller already verified
 * against the signed release manifest (custom in-memory resolver, no registry fetch). The deterministic decoder and
 * risk rules remain authoritative; this adds the project's own wording.
 */
export async function clearSignFormat(
  tx: { chainId: number; to: string; data: string; value?: bigint; from?: string },
  descriptors: VerifiedDescriptor[],
  ctx: Pick<DecodeContext, "tokenInfo">,
): Promise<ClearSigningResult | null> {
  const match = descriptors.find((d) => d.chainId === tx.chainId && d.address.toLowerCase() === tx.to.toLowerCase());
  if (!match) return null;
  const path = `pramaan/${match.chainId}/${match.address.toLowerCase()}.json`;
  const index: RegistryIndex = { calldataIndex: { [`eip155:${match.chainId}:${match.address.toLowerCase()}`]: path }, typedDataIndex: {} };
  const resolver: DescriptorResolver = {
    index,
    fetchDescriptor: async (requested: string) => {
      if (requested !== path) throw new Error(`descriptor ${requested} is not pinned by the release`);
      return match.descriptor as never;
    },
  };
  try {
    const model = await format(
      { chainId: tx.chainId, to: tx.to, data: tx.data, value: tx.value, from: tx.from },
      {
        descriptorResolverOptions: { type: "custom", resolver },
        externalDataProvider: {
          resolveToken: async (_chainId: number, address: string) => {
            const info = await ctx.tokenInfo?.(address as `0x${string}`).catch(() => null);
            if (!info || info.decimals === undefined || !info.symbol) return null;
            return { name: info.name ?? info.symbol, symbol: info.symbol, decimals: info.decimals };
          },
        },
      },
    );
    const fields: { label: string; value: string }[] = [];
    for (const f of model.fields ?? []) {
      if ("value" in f && typeof f.value === "string") fields.push({ label: f.label, value: f.value });
    }
    return {
      intent: typeof model.intent === "string" ? model.intent : null,
      interpolatedIntent: model.interpolatedIntent ?? null,
      fields,
      warnings: (model.warnings ?? []).map((w) => `${w.code}: ${w.message}`),
    };
  } catch {
    return null;
  }
}

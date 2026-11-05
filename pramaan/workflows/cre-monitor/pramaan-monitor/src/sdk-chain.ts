import {
  EVMClient,
  LAST_FINALIZED_BLOCK_NUMBER,
  LATEST_BLOCK_NUMBER,
  bigintToProtoBigInt,
  encodeCallMsg,
  getNetwork,
  hexToBase64,
  protoBigIntToBigint,
  type Runtime,
} from "@chainlink/cre-sdk";
import { getAddress, toHex, zeroAddress } from "viem";
import type { RawLog } from "./abi";
import type { ChainPort } from "./reads";
import type { Address, Hex } from "./types";

/** Minimal capability interface used by SdkChainPort, implemented by SDK EVMClient and mocks. */
export type EvmClientCapability = Pick<
  EVMClient,
  "headerByNumber" | "callContract" | "filterLogs"
>;

/**
 * Resolves a chain selector name or ID to an EVMClient instance using installed SDK chain selectors.
 */
export function createEvmClient(chainSelectorNameOrId: string | bigint): EVMClient {
  let selector: bigint;
  if (typeof chainSelectorNameOrId === "bigint") {
    selector = chainSelectorNameOrId;
  } else if (/^\d+$/.test(chainSelectorNameOrId)) {
    selector = BigInt(chainSelectorNameOrId);
  } else {
    const net = getNetwork({ chainSelectorName: chainSelectorNameOrId });
    if (!net) {
      throw new Error(`Unsupported chain selector name: ${chainSelectorNameOrId}`);
    }
    selector = net.chainSelector.selector;
  }
  return new EVMClient(selector);
}

export interface SdkChainPortOptions {
  client: EvmClientCapability;
  runtime: Runtime<unknown>;
  blockTag?: "latest" | "finalized";
}

/**
 * Adapts Chainlink CRE SDK 1.23.0 EVMClient capability to Pramaan's synchronous ChainPort interface.
 * Operates in DON mode through Runtime.
 */
export class SdkChainPort implements ChainPort {
  private readonly client: EvmClientCapability;
  private readonly runtime: Runtime<unknown>;
  private readonly blockTag: "latest" | "finalized";
  private pinnedBlockNumber: bigint | null = null;

  constructor(options: SdkChainPortOptions) {
    this.client = options.client;
    this.runtime = options.runtime;
    this.blockTag = options.blockTag ?? "latest";
  }

  header(): { number: bigint; timestamp: bigint } {
    this.pinnedBlockNumber = null;
    const blockNum =
      this.blockTag === "finalized"
        ? LAST_FINALIZED_BLOCK_NUMBER
        : LATEST_BLOCK_NUMBER;
    const res = this.client
      .headerByNumber(this.runtime, { blockNumber: blockNum })
      .result();
    if (!res.header || !res.header.blockNumber) {
      throw new Error("EVM headerByNumber returned empty header or block number");
    }
    const number = protoBigIntToBigint(res.header.blockNumber);
    const timestamp = res.header.timestamp;
    this.pinnedBlockNumber = number;
    return { number, timestamp };
  }

  call(to: Address, data: Hex): Hex {
    if (this.pinnedBlockNumber === null) {
      throw new Error("SdkChainPort.call requires a successful header() call first to pin block height");
    }
    const blockNum = bigintToProtoBigInt(this.pinnedBlockNumber);
    const callMsg = encodeCallMsg({
      from: zeroAddress,
      to: getAddress(to) as Address,
      data,
    });
    const res = this.client
      .callContract(this.runtime, {
        call: callMsg,
        blockNumber: blockNum,
      })
      .result();
    return toHex(res.data);
  }

  logs(addresses: Address[], topic0: Hex[], from: bigint, to: bigint): RawLog[] {
    const res = this.client
      .filterLogs(this.runtime, {
        filterQuery: {
          addresses: addresses.map((a) => hexToBase64(getAddress(a))),
          topics: [{ topic: topic0.map((t) => hexToBase64(t)) }],
          fromBlock: bigintToProtoBigInt(from),
          toBlock: bigintToProtoBigInt(to),
        },
      })
      .result();

    const rawLogs: RawLog[] = [];
    for (const log of res.logs) {
      rawLogs.push({
        address: getAddress(toHex(log.address)) as Address,
        topics: log.topics.map((t) => toHex(t) as Hex),
        data: toHex(log.data),
        blockNumber: log.blockNumber ? Number(protoBigIntToBigint(log.blockNumber)) : 0,
        logIndex: log.index,
      });
    }
    return rawLogs;
  }
}

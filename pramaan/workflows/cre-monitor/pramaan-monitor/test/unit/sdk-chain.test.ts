import { describe, expect, it } from "bun:test";
import {
  LAST_FINALIZED_BLOCK_NUMBER,
  LATEST_BLOCK_NUMBER,
  bigintToBytes,
  bigintToProtoBigInt,
  hexToBase64,
  type Runtime,
} from "@chainlink/cre-sdk";
import type { EVM_PB, VALUES_PB } from "@chainlink/cre-sdk/pb";
import { getAddress, hexToBytes } from "viem";
import {
  createEvmClient,
  SdkChainPort,
  type EvmClientCapability,
} from "../../src/sdk-chain";
import type { Address, Hex } from "../../src/types";

function mockProtoBigInt(n: bigint): VALUES_PB.BigInt {
  const sign = n === 0n ? 0n : n < 0n ? -1n : 1n;
  const abs = n < 0n ? -n : n;
  return {
    $typeName: "values.v1.BigInt",
    sign,
    absVal: bigintToBytes(abs),
  };
}

function mockHeaderReply(blockNumber: bigint, timestamp: bigint): EVM_PB.HeaderByNumberReply {
  return {
    $typeName: "capabilities.blockchain.evm.v1alpha.HeaderByNumberReply",
    header: {
      $typeName: "capabilities.blockchain.evm.v1alpha.Header",
      blockNumber: mockProtoBigInt(blockNumber),
      timestamp,
      hash: new Uint8Array(32),
      parentHash: new Uint8Array(32),
    },
  };
}

function mockEmptyHeaderReply(): EVM_PB.HeaderByNumberReply {
  return {
    $typeName: "capabilities.blockchain.evm.v1alpha.HeaderByNumberReply",
    header: undefined,
  };
}

function mockCallReply(data: Uint8Array = new Uint8Array()): EVM_PB.CallContractReply {
  return {
    $typeName: "capabilities.blockchain.evm.v1alpha.CallContractReply",
    data,
  };
}

function mockFilterLogsReply(logs: EVM_PB.Log[] = []): EVM_PB.FilterLogsReply {
  return {
    $typeName: "capabilities.blockchain.evm.v1alpha.FilterLogsReply",
    logs,
  };
}

function mockLog(params: {
  address: Uint8Array;
  topics: Uint8Array[];
  data: Uint8Array;
  blockNumber: bigint;
  index: number;
}): EVM_PB.Log {
  return {
    $typeName: "capabilities.blockchain.evm.v1alpha.Log",
    address: params.address,
    topics: params.topics,
    data: params.data,
    blockNumber: mockProtoBigInt(params.blockNumber),
    index: params.index,
    txHash: new Uint8Array(32),
    blockHash: new Uint8Array(32),
    eventSig: new Uint8Array(32),
    txIndex: 0,
    removed: false,
  };
}

describe("SdkChainPort", () => {
  const dummyRuntime = {} as any;

  it("header() retrieves and translates block number and timestamp for latest", () => {
    let capturedBlockNumber: any = null;
    const mockClient: EvmClientCapability = {
      headerByNumber: (_rt, input: any) => {
        capturedBlockNumber = input.blockNumber;
        return {
          result: () => mockHeaderReply(5000000n, 1710000000n),
        };
      },
      callContract: () => ({ result: () => mockCallReply() }),
      filterLogs: () => ({ result: () => mockFilterLogsReply() }),
    };

    const port = new SdkChainPort({ client: mockClient, runtime: dummyRuntime, blockTag: "latest" });
    const h = port.header();

    expect(capturedBlockNumber).toEqual(LATEST_BLOCK_NUMBER);
    expect(h.number).toBe(5000000n);
    expect(h.timestamp).toBe(1710000000n);
  });

  it("header() uses LAST_FINALIZED_BLOCK_NUMBER when blockTag is finalized", () => {
    let capturedBlockNumber: any = null;
    const mockClient: EvmClientCapability = {
      headerByNumber: (_rt, input: any) => {
        capturedBlockNumber = input.blockNumber;
        return {
          result: () => mockHeaderReply(4999900n, 1709999000n),
        };
      },
      callContract: () => ({ result: () => mockCallReply() }),
      filterLogs: () => ({ result: () => mockFilterLogsReply() }),
    };

    const port = new SdkChainPort({ client: mockClient, runtime: dummyRuntime, blockTag: "finalized" });
    const h = port.header();

    expect(capturedBlockNumber).toEqual(LAST_FINALIZED_BLOCK_NUMBER);
    expect(h.number).toBe(4999900n);
    expect(h.timestamp).toBe(1709999000n);
  });

  it("header() throws if response has missing header or blockNumber", () => {
    const mockClient: EvmClientCapability = {
      headerByNumber: () => ({
        result: () => mockEmptyHeaderReply(),
      }),
      callContract: () => ({ result: () => mockCallReply() }),
      filterLogs: () => ({ result: () => mockFilterLogsReply() }),
    };

    const port = new SdkChainPort({ client: mockClient, runtime: dummyRuntime });
    expect(() => port.header()).toThrow();
  });

  it("call() sends CallMsg and decodes hex return data when pinned by header()", () => {
    const target: Address = "0x1234567890123456789012345678901234567890";
    const data: Hex = "0xaabbccdd";
    let capturedInput: any = null;

    const mockClient: EvmClientCapability = {
      headerByNumber: () => ({ result: () => mockHeaderReply(5000000n, 1710000000n) }),
      callContract: (_rt, input: any) => {
        capturedInput = input;
        return {
          result: () => mockCallReply(hexToBytes("0xdeadbeef")),
        };
      },
      filterLogs: () => ({ result: () => mockFilterLogsReply() }),
    };

    const port = new SdkChainPort({ client: mockClient, runtime: dummyRuntime });
    port.header();
    const out = port.call(target, data);

    expect(capturedInput.call.to).toBe(hexToBase64(target));
    expect(capturedInput.call.data).toBe(hexToBase64(data));
    expect(capturedInput.blockNumber).toEqual(bigintToProtoBigInt(5000000n));
    expect(out.toLowerCase()).toBe("0xdeadbeef");
  });

  it("call() throws without invoking callContract when header() was not called", () => {
    const target: Address = "0x1234567890123456789012345678901234567890";
    const data: Hex = "0xaabbccdd";
    let callContractInvocations = 0;

    const mockClient: EvmClientCapability = {
      headerByNumber: () => ({ result: () => mockEmptyHeaderReply() }),
      callContract: () => {
        callContractInvocations++;
        return { result: () => mockCallReply() };
      },
      filterLogs: () => ({ result: () => mockFilterLogsReply() }),
    };

    const port = new SdkChainPort({ client: mockClient, runtime: dummyRuntime });
    expect(() => port.call(target, data)).toThrow(
      "SdkChainPort.call requires a successful header() call first to pin block height",
    );
    expect(callContractInvocations).toBe(0);
  });

  it("call() throws without invoking callContract when header() fails", () => {
    const target: Address = "0x1234567890123456789012345678901234567890";
    const data: Hex = "0xaabbccdd";
    let callContractInvocations = 0;

    const mockClient: EvmClientCapability = {
      headerByNumber: () => {
        throw new Error("header RPC error");
      },
      callContract: () => {
        callContractInvocations++;
        return {
          result: () => mockCallReply(hexToBytes("0xdeadbeef")),
        };
      },
      filterLogs: () => ({ result: () => mockFilterLogsReply() }),
    };

    const port = new SdkChainPort({ client: mockClient, runtime: dummyRuntime });
    expect(() => port.header()).toThrow("header RPC error");

    expect(() => port.call(target, data)).toThrow(
      "SdkChainPort.call requires a successful header() call first to pin block height",
    );
    expect(callContractInvocations).toBe(0);
  });

  it("call() resets pinned block on failed second header refresh and rejects without contract calls", () => {
    const target: Address = "0x1234567890123456789012345678901234567890";
    const data: Hex = "0xaabbccdd";
    let headerCalls = 0;
    let callContractInvocations = 0;

    const mockClient: EvmClientCapability = {
      headerByNumber: () => {
        headerCalls++;
        if (headerCalls === 1) {
          return { result: () => mockHeaderReply(5000000n, 1710000000n) };
        }
        throw new Error("second header failure");
      },
      callContract: () => {
        callContractInvocations++;
        return { result: () => mockCallReply(hexToBytes("0xdeadbeef")) };
      },
      filterLogs: () => ({ result: () => mockFilterLogsReply() }),
    };

    const port = new SdkChainPort({ client: mockClient, runtime: dummyRuntime });
    port.header();
    port.call(target, data);
    expect(callContractInvocations).toBe(1);

    // Second header refresh fails: must clear pin
    expect(() => port.header()).toThrow("second header failure");
    // Subsequent call must throw without invoking callContract
    expect(() => port.call(target, data)).toThrow(
      "SdkChainPort.call requires a successful header() call first to pin block height",
    );
    expect(callContractInvocations).toBe(1);
  });

  it("logs() formats filter query with base64 and maps raw log objects", () => {
    const contractAddr: Address = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const topic0: Hex = "0x1111111111111111111111111111111111111111111111111111111111111111";
    let capturedFilterQuery: any = null;

    const mockClient: EvmClientCapability = {
      headerByNumber: () => ({ result: () => mockEmptyHeaderReply() }),
      callContract: () => ({ result: () => mockCallReply() }),
      filterLogs: (_rt, input: any) => {
        capturedFilterQuery = input.filterQuery;
        return {
          result: () =>
            mockFilterLogsReply([
              mockLog({
                address: hexToBytes(contractAddr),
                topics: [hexToBytes(topic0)],
                data: hexToBytes("0x1234"),
                blockNumber: 10050n,
                index: 2,
              }),
            ]),
        };
      },
    };

    const port = new SdkChainPort({ client: mockClient, runtime: dummyRuntime });
    const logs = port.logs([contractAddr], [topic0], 10000n, 10050n);

    expect(capturedFilterQuery.addresses).toEqual([hexToBase64(getAddress(contractAddr))]);
    expect(capturedFilterQuery.topics).toEqual([{ topic: [hexToBase64(topic0)] }]);
    expect(logs.length).toBe(1);
    expect(logs[0]?.address).toBe(getAddress(contractAddr));
    expect(logs[0]?.topics[0]?.toLowerCase()).toBe(topic0.toLowerCase());
    expect(logs[0]?.data.toLowerCase()).toBe("0x1234");
    expect(logs[0]?.blockNumber).toBe(10050);
    expect(logs[0]?.logIndex).toBe(2);
  });

  it("logs() with real EVMClient encodes base64 so fromJson decodes exact 20-byte address and 32-byte topic bytes", () => {
    const contractAddr: Address = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const topic0: Hex = "0x1111111111111111111111111111111111111111111111111111111111111111";
    let capturedCapabilityParams: any = null;

    const fakeRuntime: Runtime<unknown> = {
      callCapability: (params: any) => {
        capturedCapabilityParams = params;
        return {
          result: () => mockFilterLogsReply([]),
        };
      },
    } as any;

    const realClient = createEvmClient("ethereum-testnet-sepolia");
    const port = new SdkChainPort({ client: realClient, runtime: fakeRuntime });
    port.logs([contractAddr], [topic0], 10000n, 10050n);

    expect(capturedCapabilityParams).not.toBeNull();
    expect(capturedCapabilityParams.method).toBe("FilterLogs");

    const payload = capturedCapabilityParams.payload;
    expect(payload.filterQuery).toBeDefined();

    // Assert address was parsed by SDK fromJson into a 20-byte Uint8Array matching contractAddr
    const decodedAddresses = payload.filterQuery.addresses;
    expect(decodedAddresses.length).toBe(1);
    expect(decodedAddresses[0]).toEqual(hexToBytes(contractAddr));
    expect(decodedAddresses[0].byteLength).toBe(20);

    // Assert topic was parsed by SDK fromJson into a 32-byte Uint8Array matching topic0
    const decodedTopics = payload.filterQuery.topics;
    expect(decodedTopics.length).toBe(1);
    expect(decodedTopics[0].topic.length).toBe(1);
    expect(decodedTopics[0].topic[0]).toEqual(hexToBytes(topic0));
    expect(decodedTopics[0].topic[0].byteLength).toBe(32);
  });

  describe("createEvmClient", () => {
    it("creates client from supported chain selector name", () => {
      const client = createEvmClient("ethereum-testnet-sepolia");
      expect(client).toBeDefined();
    });

    it("creates client from numeric chain selector string", () => {
      const client = createEvmClient("16015286601757825753");
      expect(client).toBeDefined();
    });

    it("creates client from bigint selector", () => {
      const client = createEvmClient(16015286601757825753n);
      expect(client).toBeDefined();
    });

    it("throws on unknown chain selector name", () => {
      expect(() => createEvmClient("nonexistent-chain")).toThrow("Unsupported chain selector name");
    });
  });
});

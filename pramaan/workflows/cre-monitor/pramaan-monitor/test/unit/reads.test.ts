import { describe, expect, it } from "bun:test";
import { encodeFunctionData, encodeFunctionResult } from "viem";
import {
  pramaanTimelockAbi,
  resolverAbi,
  UPGRADED_TOPIC,
  type RawLog,
} from "../../src/abi";
import {
  BudgetedChain,
  BudgetExceeded,
  collectObservation,
  type ChainPort,
  type ManifestFetcher,
} from "../../src/reads";
import type { Address, AppConfig, Config, Hex } from "../../src/types";

describe("ChainPort BudgetedChain & collectObservation", () => {
  const sampleConfig: Config = {
    schedule: "0 */5 * * * *",
    workflowName: "pramaan-monitor",
    chainSelectorName: "ethereum-testnet-sepolia",
    chainId: 11155111,
    blockTag: "latest",
    ingestUrl: "",
    limits: {
      evmCalls: 15,
      maxPendingOps: 3,
      maxLogWindows: 4,
      windowBlocks: 99,
    },
    apps: [
      {
        app: "vaultlab",
        ensName: "vaultlab.pramaan.eth",
        resolver: "0x1111111111111111111111111111111111111111",
        resolverMode: "ensv2",
        timelock: null,
        upgradeTimelock: null,
        proxies: [],
        manifestUrlTemplate: "https://manifests.pramaan.dev/{sha256}.json",
        logsFromBlock: null,
      },
    ],
  };

  const sampleApp: AppConfig = sampleConfig.apps[0]!;

  const noopManifestFetcher: ManifestFetcher = () => ({
    status: 404,
    sha256: "",
    size: 0,
    facts: null,
    error: "not found",
  });

  describe("BudgetedChain", () => {
    it("tracks call count and throws BudgetExceeded when limit reached", () => {
      const mockInner: ChainPort = {
        header: () => ({ number: 100n, timestamp: 1000n }),
        call: () => "0x",
        logs: () => [],
      };

      const budgeted = new BudgetedChain(mockInner, 3);
      expect(budgeted.remaining).toBe(3);

      budgeted.header();
      expect(budgeted.used).toBe(1);
      expect(budgeted.remaining).toBe(2);

      budgeted.call("0x1111111111111111111111111111111111111111", "0x");
      budgeted.logs([], [], 0n, 10n);
      expect(budgeted.used).toBe(3);
      expect(budgeted.remaining).toBe(0);

      expect(() => budgeted.header()).toThrow(BudgetExceeded);
    });
  });

  describe("collectObservation with ENSv2", () => {
    it("reads profile text records via resolve(dnsName, text(...))", () => {
      const recordValue = "pramaan:v1:v1.0.0:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

      const mockPort: ChainPort = {
        header: () => ({ number: 1000n, timestamp: 1710000000n }),
        call: (_to: Address, data: Hex) => {
          // If calling resolver resolve(...)
          // Return ABI-encoded string inside resolve bytes return
          const textResult = encodeFunctionResult({
            abi: resolverAbi,
            functionName: "text",
            result: recordValue,
          });
          return encodeFunctionResult({
            abi: resolverAbi,
            functionName: "resolve",
            result: textResult,
          });
        },
        logs: () => [],
      };

      const obs = collectObservation(sampleConfig, sampleApp, mockPort, noopManifestFetcher);
      expect(obs.app).toBe("vaultlab");
      expect(obs.headBlock).toBe(1000);
      expect(obs.now).toBe(1710000000);
      expect(obs.record).toBe(recordValue);
      expect(obs.revokedRaw).toBe(recordValue);
      expect(obs.gaps.length).toBe(0);
    });

    it("records gap and null value when resolver call throws", () => {
      const mockPort: ChainPort = {
        header: () => ({ number: 1000n, timestamp: 1710000000n }),
        call: () => {
          throw new Error("execution reverted");
        },
        logs: () => [],
      };

      const obs = collectObservation(sampleConfig, sampleApp, mockPort, noopManifestFetcher);
      expect(obs.record).toBeNull();
      expect(obs.gaps).toContain("pramaan.record could not be read from the resolver");
      expect(obs.gaps).toContain("pramaan.revoked could not be read from the resolver");
    });

    it("records gap when resolver returns empty nested profile bytes", () => {
      const mockPort: ChainPort = {
        header: () => ({ number: 1000n, timestamp: 1710000000n }),
        call: () =>
          encodeFunctionResult({
            abi: resolverAbi,
            functionName: "resolve",
            result: "0x",
          }),
        logs: () => [],
      };

      const obs = collectObservation(sampleConfig, sampleApp, mockPort, noopManifestFetcher);
      expect(obs.record).toBeNull();
      expect(obs.gaps).toContain("pramaan.record could not be read from the resolver");
      expect(obs.gaps).toContain("pramaan.revoked could not be read from the resolver");
    });
  });

  describe("collectObservation with ENSv1", () => {
    it("reads profile text records via direct text(namehash, key)", () => {
      const v1App: AppConfig = {
        ...sampleApp,
        resolverMode: "ensv1",
      };
      const recordValue = "pramaan:v1:v1.0.0:1122334455667788112233445566778811223344556677881122334455667788";

      const mockPort: ChainPort = {
        header: () => ({ number: 1000n, timestamp: 1710000000n }),
        call: () =>
          encodeFunctionResult({
            abi: resolverAbi,
            functionName: "text",
            result: recordValue,
          }),
        logs: () => [],
      };

      const obs = collectObservation(sampleConfig, v1App, mockPort, noopManifestFetcher);
      expect(obs.record).toBe(recordValue);
      expect(obs.gaps.length).toBe(0);
    });
  });

  describe("PramaanTimelock and proxy log inspection", () => {
    it("collects queued operations from PramaanTimelock", () => {
      const timelockAddr: Address = "0x2222222222222222222222222222222222222222";
      const appWithTimelock: AppConfig = {
        ...sampleApp,
        timelock: timelockAddr,
      };

      const mockPort: ChainPort = {
        header: () => ({ number: 2000n, timestamp: 1710000500n }),
        call: (to: Address, data: Hex) => {
          if (to.toLowerCase() === timelockAddr.toLowerCase()) {
            const opCountSelector = encodeFunctionData({ abi: pramaanTimelockAbi, functionName: "operationCount" });
            const lastExecutedIdSelector = encodeFunctionData({ abi: pramaanTimelockAbi, functionName: "lastExecutedId" });
            const getOpSelector = encodeFunctionData({ abi: pramaanTimelockAbi, functionName: "getOperation", args: [0n] }).slice(0, 10);
            if (data.startsWith(opCountSelector)) {
              return encodeFunctionResult({ abi: pramaanTimelockAbi, functionName: "operationCount", result: 2n });
            }
            if (data.startsWith(lastExecutedIdSelector)) {
              return encodeFunctionResult({ abi: pramaanTimelockAbi, functionName: "lastExecutedId", result: 1n });
            }
            if (data.startsWith(getOpSelector)) {
              return encodeFunctionResult({
                abi: pramaanTimelockAbi,
                functionName: "getOperation",
                result: ["pramaan:v1:v1.1.0:aabbcc", 1710001000n, 1], // state 1 = Queued
              });
            }
            throw new Error(`Unexpected call to timelock: ${data}`);
          }
          if (to.toLowerCase() === sampleApp.resolver?.toLowerCase()) {
            const textResult = encodeFunctionResult({ abi: resolverAbi, functionName: "text", result: "" });
            return encodeFunctionResult({ abi: resolverAbi, functionName: "resolve", result: textResult });
          }
          throw new Error(`Unexpected call to ${to}`);
        },
        logs: () => [],
      };

      const obs = collectObservation(sampleConfig, appWithTimelock, mockPort, noopManifestFetcher);
      expect(obs.timelock).not.toBeNull();
      expect(obs.timelock?.operationCount).toBe(2);
      expect(obs.timelock?.lastExecutedId).toBe(1);
      expect(obs.timelock?.ops.length).toBe(1);
      expect(obs.timelock?.ops[0]?.id).toBe("2");
      expect(obs.timelock?.ops[0]?.state).toBe("Queued");
      expect(obs.timelock?.ops[0]?.eta).toBe(1710001000);
    });
  });
});

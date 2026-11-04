import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, createTestClient, createWalletClient, encodeFunctionData, getAddress, http, keccak256, type Abi, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { MANIFEST_SCHEMA_V1, type ManifestV1 } from "@pramaan/manifest";
import { compareContract, contractRow, inspectAddress, inspectAgreed, SLOTS } from "../src/index.js";
import { ANVIL_KEY_0, foundryBin, startAnvil, type Anvil } from "./helpers/anvil.js";

const CONTRACTS = resolve(__dirname, "../../../contracts");

function artifact(file: string, name: string): { abi: Abi; bytecode: Hex } {
  const json = JSON.parse(readFileSync(join(CONTRACTS, "out", file, `${name}.json`), "utf8"));
  return { abi: json.abi, bytecode: json.bytecode.object };
}

let anvil: Anvil;
let pub: PublicClient;
const account = privateKeyToAccount(ANVIL_KEY_0);
let wallet: ReturnType<typeof createWalletClient>;
let test: ReturnType<typeof createTestClient>;
let token: `0x${string}`, vaultImpl: `0x${string}`, proxy: `0x${string}`, unaudited: `0x${string}`;

async function deploy(file: string, name: string, args: unknown[] = []): Promise<`0x${string}`> {
  const { abi, bytecode } = artifact(file, name);
  const hash = await wallet.deployContract({ abi, bytecode, args, account, chain: foundry });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  return getAddress(receipt.contractAddress!);
}

beforeAll(async () => {
  if (!existsSync(join(CONTRACTS, "out", "VaultV2.sol", "VaultV2.json"))) {
    execFileSync(foundryBin("forge"), ["build"], { cwd: CONTRACTS, stdio: "inherit" });
  }
  anvil = await startAnvil();
  const transport = http(anvil.url);
  pub = createPublicClient({ chain: foundry, transport }) as PublicClient;
  wallet = createWalletClient({ chain: foundry, transport, account });
  test = createTestClient({ chain: foundry, transport, mode: "anvil" });
  token = await deploy("DemoToken.sol", "DemoToken");
  vaultImpl = await deploy("VaultV2.sol", "VaultV2");
  unaudited = await deploy("VaultV3Unaudited.sol", "VaultV3Unaudited");
  const init = encodeFunctionData({ abi: artifact("VaultV2.sol", "VaultV2").abi, functionName: "initialize", args: [account.address, token] });
  proxy = await deploy("ERC1967Proxy.sol", "ERC1967Proxy", [vaultImpl, init]);
});

afterAll(() => anvil?.stop());

async function codehash(a: `0x${string}`) {
  return keccak256((await pub.getCode({ address: a }))!);
}

async function manifestFor(): Promise<ManifestV1> {
  return {
    schema: MANIFEST_SCHEMA_V1,
    app: { name: "t", ensName: "pramaan-demo.eth", domain: "http://localhost:5180" },
    repo: "local:test",
    commit: "0".repeat(40),
    tag: "v1.0.0",
    workflow: null,
    builtAt: "2026-11-04T00:00:00Z",
    files: [],
    contracts: [
      {
        label: "VaultV2",
        chainId: 31337,
        address: proxy,
        runtimeCodehash: await codehash(proxy),
        proxy: { type: "eip1967", implAddress: vaultImpl, implCodehash: await codehash(vaultImpl) },
        sourcify: { status: "not_applicable" },
      },
      { label: "pUSD", chainId: 31337, address: token, runtimeCodehash: await codehash(token), proxy: null, sourcify: { status: "not_applicable" } },
    ],
    findings: [],
    descriptors: [],
    thirdParties: [],
    tools: [],
  };
}

describe("contract verification against a live chain", () => {
  it("verifies a listed EIP-1967 proxy and its implementation", async () => {
    const inspection = await inspectAddress(pub, proxy);
    expect(inspection.proxy).toMatchObject({ type: "eip1967", implementation: vaultImpl });
    expect(compareContract(await manifestFor(), 31337, inspection).status).toBe("verified");
  });

  it("verifies a listed plain contract", async () => {
    expect(compareContract(await manifestFor(), 31337, await inspectAddress(pub, token)).status).toBe("verified");
  });

  it("reports an unlisted contract", async () => {
    expect(compareContract(await manifestFor(), 31337, await inspectAddress(pub, unaudited)).status).toBe("unlisted");
  });

  it("goes red when the proxy is upgraded to unreleased code", async () => {
    const manifest = await manifestFor();
    const snapshot = await test.snapshot();
    const hash = await wallet.writeContract({
      address: proxy,
      abi: artifact("VaultV2.sol", "VaultV2").abi,
      functionName: "upgradeToAndCall",
      args: [unaudited, "0x"],
      account,
      chain: foundry,
    });
    expect((await pub.waitForTransactionReceipt({ hash })).status).toBe("success");
    const check = compareContract(manifest, 31337, await inspectAddress(pub, proxy));
    expect(check.status).toBe("impl-mismatch");
    expect(check.actual?.implAddress).toBe(unaudited);
    await test.revert({ id: snapshot });
  });

  it("goes red when the code at a listed address changes", async () => {
    const manifest = await manifestFor();
    const snapshot = await test.snapshot();
    await test.setCode({ address: token, bytecode: (await pub.getCode({ address: unaudited }))! });
    expect(compareContract(manifest, 31337, await inspectAddress(pub, token)).status).toBe("code-mismatch");
    await test.revert({ id: snapshot });
  });

  it("detects EIP-1167 clones, EIP-7702 delegations, beacons, Safe proxies and diamonds", async () => {
    const clone = "0x1000000000000000000000000000000000000001" as const;
    await test.setCode({ address: clone, bytecode: `0x363d3d373d3d3d363d73${vaultImpl.slice(2).toLowerCase()}5af43d82803e903d91602b57fd5bf3` });
    expect((await inspectAddress(pub, clone)).proxy).toMatchObject({ type: "eip1167", implementation: vaultImpl });

    const delegated = "0x1000000000000000000000000000000000000002" as const;
    await test.setCode({ address: delegated, bytecode: `0xef0100${vaultImpl.slice(2).toLowerCase()}` });
    expect((await inspectAddress(pub, delegated)).proxy).toMatchObject({ type: "eip7702", implementation: vaultImpl });

    const beacon = "0x1000000000000000000000000000000000000003" as const;
    const beaconProxy = "0x1000000000000000000000000000000000000004" as const;
    // Beacon runtime: returns vaultImpl for any call (PUSH20 impl; MSTORE at 0; RETURN 32 bytes).
    await test.setCode({ address: beacon, bytecode: `0x73${vaultImpl.slice(2).toLowerCase()}60005260206000f3` });
    await test.setCode({ address: beaconProxy, bytecode: "0x600160005500" });
    await test.setStorageAt({ address: beaconProxy, index: SLOTS.eip1967Beacon, value: `0x${beacon.slice(2).padStart(64, "0")}` });
    expect((await inspectAddress(pub, beaconProxy)).proxy).toMatchObject({ type: "eip1967-beacon", implementation: vaultImpl });

    const safe = "0x1000000000000000000000000000000000000005" as const;
    await test.setCode({ address: safe, bytecode: "0x63a619486e00" });
    await test.setStorageAt({ address: safe, index: SLOTS.safeSingleton, value: `0x${vaultImpl.slice(2).padStart(64, "0")}` });
    expect((await inspectAddress(pub, safe)).proxy).toMatchObject({ type: "safe", implementation: vaultImpl });

    const diamond = "0x1000000000000000000000000000000000000006" as const;
    await test.setCode({ address: diamond, bytecode: "0x637a0ed62700" });
    const d = await inspectAddress(pub, diamond);
    expect(d.unsupported).toMatch(/diamond/);
  });

  it("treats wallets as EOAs", async () => {
    const eoa = await inspectAddress(pub, "0x9999999999999999999999999999999999999999");
    expect(eoa.kind).toBe("eoa");
    expect(compareContract(await manifestFor(), 31337, eoa).status).toBe("eoa");
  });

  it("flags a listed address used on another chain as wrong-chain (red, blocking)", async () => {
    const check = compareContract(await manifestFor(), 1, await inspectAddress(pub, token));
    expect(check).toMatchObject({ status: "wrong-chain", label: "pUSD" });
    expect(contractRow(check)).toMatchObject({ color: "red", blocking: true });
  });

  it("is red when the release lists a contract but the address has no code (EOA)", async () => {
    const manifest = await manifestFor();
    const snapshot = await test.snapshot();
    await test.setCode({ address: token, bytecode: "0x" });
    const check = compareContract(manifest, 31337, await inspectAddress(pub, token));
    expect(check).toMatchObject({ status: "code-mismatch", detail: expect.stringMatching(/no code/) });
    expect(contractRow(check).color).toBe("red");
    await test.revert({ id: snapshot });
  });

  it("never verifies beacon proxies, PUSH0 clones or unknown forwarders (unsupported, amber)", async () => {
    const beacon = "0x2000000000000000000000000000000000000003" as const;
    const beaconProxy = "0x2000000000000000000000000000000000000004" as const;
    await test.setCode({ address: beacon, bytecode: `0x73${vaultImpl.slice(2).toLowerCase()}60005260206000f3` });
    await test.setCode({ address: beaconProxy, bytecode: "0x600260005500" });
    await test.setStorageAt({ address: beaconProxy, index: SLOTS.eip1967Beacon, value: `0x${beacon.slice(2).padStart(64, "0")}` });
    const manifest = await manifestFor();
    manifest.contracts.push({
      label: "BeaconVault",
      chainId: 31337,
      address: beaconProxy,
      runtimeCodehash: await codehash(beaconProxy),
      proxy: { type: "eip1967-beacon", implAddress: vaultImpl, implCodehash: await codehash(vaultImpl) },
      sourcify: { status: "not_applicable" },
    });
    const b = compareContract(manifest, 31337, await inspectAddress(pub, beaconProxy));
    expect(b.status).toBe("unsupported-proxy");
    expect(contractRow(b).color).toBe("amber");

    const push0 = "0x2000000000000000000000000000000000000005" as const;
    await test.setCode({ address: push0, bytecode: `0x365f5f375f5f365f73${vaultImpl.slice(2).toLowerCase()}5af43d5f5f3e5f3d91602a57fd5bf3` });
    manifest.contracts.push({ label: "Clone", chainId: 31337, address: push0, runtimeCodehash: await codehash(push0), proxy: null, sourcify: { status: "not_applicable" } });
    const c = compareContract(manifest, 31337, await inspectAddress(pub, push0));
    expect(c).toMatchObject({ status: "unsupported-proxy", detail: expect.stringMatching(/ERC-7511/) });
  });

  it("compares deployed-vs-deployed code: immutables make each deployment's codehash unique", async () => {
    // PramaanTimelock has immutables (resolver, delay, guardian): same source, different constructor args.
    const name = "0x0c7072616d61616e2d64656d6f0365746800";
    const a = await deploy("PramaanTimelock.sol", "PramaanTimelock", [token, name, 120n, account.address, account.address]);
    const b = await deploy("PramaanTimelock.sol", "PramaanTimelock", [token, name, 300n, account.address, account.address]);
    expect(await codehash(a)).not.toBe(await codehash(b));
    const manifest = await manifestFor();
    manifest.contracts.push({ label: "Timelock", chainId: 31337, address: a, runtimeCodehash: await codehash(a), proxy: null, sourcify: { status: "not_applicable" } });
    expect(compareContract(manifest, 31337, await inspectAddress(pub, a)).status).toBe("verified");
    // b's code is the same source compiled the same way but with other immutables: it is NOT the released code.
    const swapped = { ...manifest, contracts: manifest.contracts.map((x) => (x.label === "Timelock" ? { ...x, address: b } : x)) };
    expect(compareContract(swapped, 31337, await inspectAddress(pub, b)).status).toBe("code-mismatch");
  });

  it("refuses an RPC that serves a different chain id (unknown, never verified)", async () => {
    const wrong = await startAnvil({ chainId: 5 });
    try {
      const r = await inspectAgreed({ chainId: 31337, rpcUrls: [wrong.url], minAgreement: 1 }, proxy);
      expect(r).toMatchObject({ status: "unknown", detail: expect.stringMatching(/serves chain 5/) });
    } finally {
      wrong.stop();
    }
  });

  it("requires two RPCs to agree and refuses a lying one", async () => {
    const honest = { chainId: 31337, rpcUrls: [anvil.url, anvil.url] };
    const ok = await inspectAgreed(honest, proxy);
    expect(ok.status).toBe("ok");
    const other = await startAnvil();
    try {
      const split = await inspectAgreed({ chainId: 31337, rpcUrls: [anvil.url, other.url] }, proxy);
      expect(split.status).toBe("unknown");
    } finally {
      other.stop();
    }
  });
});

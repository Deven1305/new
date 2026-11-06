/**
 * End-to-end infra test on a real anvil (port 9100; the servers use 9101-9106): deploy the suite, build the three
 * apps, assemble + sign a release per app, serve them, tamper with MirrorYield on disk, restore it, and run the
 * timelocked VaultV2 upgrade. Needs `forge build` artifacts (contracts/out) and anvil (~/.foundry/bin).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeFunctionData, getAddress, keccak256, parseAbi, toBytes } from "viem";
import { ManifestV1, WellKnownHint } from "@pramaan/manifest";
import { demoRestore, demoTamper, demoTamperStatus, executeUpgrade, scheduleUpgrade, UpgradeNotReadyError, upgradeStatus } from "../../cli/src/demo-actions.js";
import { REPO_ROOT, waitSeconds } from "@pramaan/release";
import { startDemoServers, type RunningDemoServers } from "../server/serve.mjs";
import { setupDemoEnv, startAnvil, TEST_PORTS, type DemoEnv } from "./harness.js";

const sha = (b: Buffer | Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const base = (port: number) => `http://127.0.0.1:${port}`;
const ports = { vaultlab: TEST_PORTS.vaultlab, mirroryield: TEST_PORTS.mirroryield, lookalike: TEST_PORTS.lookalike, permitmarket: TEST_PORTS.permitmarket, admin: TEST_PORTS.admin, tracker: TEST_PORTS.tracker };

function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

/** Raw HTTP request that does not normalise the path (fetch would collapse `..`). */
function raw(port: number, path: string, method = "GET", headers: Record<string, string> = {}, body?: string): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

const timelockAbi = parseAbi(["function getMinDelay() view returns (uint256)", "function hasRole(bytes32 role, address account) view returns (bool)", "function DEFAULT_ADMIN_ROLE() view returns (bytes32)", "function PROPOSER_ROLE() view returns (bytes32)", "function EXECUTOR_ROLE() view returns (bytes32)"]);
const vaultAbi = parseAbi(["function owner() view returns (address)", "function version() view returns (string)", "function upgradeToAndCall(address newImplementation, bytes data) payable"]);

describe("demo infra on a real chain", () => {
  let anvil: { stop(): void };
  let env: DemoEnv;
  let servers: RunningDemoServers | null = null;

  beforeAll(async () => {
    anvil = await startAnvil(TEST_PORTS.anvil);
    env = await setupDemoEnv();
  }, 280_000);

  afterAll(async () => {
    await servers?.close();
    anvil?.stop();
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("contracts", () => {
    it("deployed every app's contracts with code on chain", async () => {
      for (const id of ["vaultlab", "mirroryield", "permitmarket"] as const) {
        const app = env.state.apps[id];
        for (const [role, address] of [...Object.entries(app.contracts), ...Object.entries(app.unlisted).filter(([r]) => r !== "attacker")]) {
          const code = await env.ctx.pub.getCode({ address });
          expect(code && code !== "0x", `${id}.${role}`).toBe(true);
        }
      }
    });

    it("VaultV2 is owned by a TimelockController with no admin, min delay 120 s, owner key as proposer + executor", async () => {
      const { vault, upgradeTimelock } = env.state.apps.vaultlab.contracts;
      expect(getAddress((await env.ctx.pub.readContract({ address: vault!, abi: vaultAbi, functionName: "owner" })) as string)).toBe(getAddress(upgradeTimelock!));
      expect(await env.ctx.pub.readContract({ address: upgradeTimelock!, abi: timelockAbi, functionName: "getMinDelay" })).toBe(120n);
      const role = async (name: "DEFAULT_ADMIN_ROLE" | "PROPOSER_ROLE" | "EXECUTOR_ROLE") => (await env.ctx.pub.readContract({ address: upgradeTimelock!, abi: timelockAbi, functionName: name })) as `0x${string}`;
      const has = async (name: "DEFAULT_ADMIN_ROLE" | "PROPOSER_ROLE" | "EXECUTOR_ROLE", who: `0x${string}`) =>
        env.ctx.pub.readContract({ address: upgradeTimelock!, abi: timelockAbi, functionName: "hasRole", args: [await role(name), who] });
      expect(await has("DEFAULT_ADMIN_ROLE", env.owner.account.address)).toBe(false);
      expect(await has("PROPOSER_ROLE", env.owner.account.address)).toBe(true);
      expect(await has("EXECUTOR_ROLE", env.owner.account.address)).toBe(true);
    });

    it("lists the right monitors and keeps legacy/unaudited contracts unlisted", () => {
      const v = env.state.apps.vaultlab;
      expect(v.monitors.map((m) => m.kind).sort()).toEqual(["proxy", "upgrade-timelock"]);
      expect(Object.keys(v.contracts).sort()).toEqual(["token", "upgradeTimelock", "vault", "vaultImplementation"]);
      expect(Object.keys(v.unlisted)).toEqual(expect.arrayContaining(["legacyVault", "unauditedImpl"]));
      expect(Object.keys(env.state.apps.mirroryield.contracts).sort()).toEqual(["farm", "token"]);
      expect(Object.keys(env.state.apps.permitmarket.contracts).sort()).toEqual(["marketplace", "nft", "token"]);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("build output", () => {
    it("writes a page, a valid WellKnownHint and ERC-7730 descriptors for every app", () => {
      for (const id of ["vaultlab", "mirroryield", "permitmarket"] as const) {
        const dist = env.state.apps[id].distDir;
        expect(existsSync(join(dist, "index.html")), id).toBe(true);
        const hint = WellKnownHint.parse(JSON.parse(readFileSync(join(dist, ".well-known", "pramaan.json"), "utf8")));
        expect(hint.ensName).toBe(env.state.apps[id].ensName);
        expect(hint.chainId).toBe(env.state.network.chainId);
        const descriptors = readdirSync(join(dist, "erc7730"));
        expect(descriptors.length).toBeGreaterThan(0);
        for (const f of descriptors) {
          const d = JSON.parse(readFileSync(join(dist, "erc7730", f), "utf8"));
          expect(d.context.contract.deployments[0].chainId).toBe(env.state.network.chainId);
          expect(Object.values(env.state.apps[id].contracts)).toContain(d.context.contract.deployments[0].address);
        }
      }
    });

    it("bakes the deployment into each bundle as one contiguous literal per address", () => {
      for (const id of ["vaultlab", "mirroryield", "permitmarket"] as const) {
        const js = listFiles(join(env.state.apps[id].distDir, "assets")).filter((f) => f.endsWith(".js"));
        expect(js.length).toBeGreaterThan(0);
        const all = js.map((f) => readFileSync(f, "utf8")).join("\n");
        for (const address of Object.values(env.state.apps[id].contracts)) expect(all, `${id} ${address}`).toContain(address);
      }
      // MirrorYield: the farm address is in exactly the asset(s) the patcher will touch
      const farm = env.state.apps.mirroryield.contracts["farm"]!;
      const holders = listFiles(env.state.apps.mirroryield.distDir).filter((f) => readFileSync(f, "utf8").includes(farm));
      expect(holders.map((f) => f.replace(/.*[\\/]/, "")).filter((n) => n.endsWith(".js")).length).toBe(1);
      expect(holders.some((f) => f.endsWith(".html"))).toBe(false);
    });

    it("keeps the tracker and the leak code out of the production PermitMarket build", () => {
      const dist = env.state.apps.permitmarket.distDir;
      for (const f of listFiles(dist)) {
        const text = readFileSync(f, "utf8");
        expect(text, f).not.toMatch(/5190|\/collect|leak|tracker/i);
      }
      expect(existsSync(join(dist, "__fixtures"))).toBe(false);
      expect(existsSync(join(dist, "leak.html"))).toBe(false);
    });

    it("builds the PermitMarket fixture separately, with the tracker URL", () => {
      const fixtureDir = join(env.out, "dist-fixtures", "permitmarket");
      expect(existsSync(join(fixtureDir, "leak.html"))).toBe(true);
      const all = listFiles(fixtureDir).map((f) => readFileSync(f, "utf8")).join("\n");
      expect(all).toContain(`http://127.0.0.1:${TEST_PORTS.tracker}/collect`);
      expect(readFileSync(join(fixtureDir, "leak.html"), "utf8")).toContain("/__fixtures/assets/");
    });

    it.skipIf(!existsSync(join(REPO_ROOT, ".pramaan", "demo", "prove", "findings.json")))("publishes the real PROVE findings + evidence with VaultLab", () => {
      const dist = env.state.apps.vaultlab.distDir;
      const findings = JSON.parse(readFileSync(join(dist, ".well-known", "pramaan", "findings.json"), "utf8")) as { id: string; evidenceSha256: string | null }[];
      expect(findings.length).toBe(env.state.prove!.findings.length);
      for (const f of findings) {
        expect(Object.keys(f).sort()).toEqual(["class", "evidenceSha256", "exploitTestSha256", "id", "severity", "status", "title"]);
        if (!f.evidenceSha256) continue;
        const file = join(dist, ".well-known", "pramaan", "evidence", `${f.evidenceSha256}.json`);
        expect(sha(readFileSync(file))).toBe(f.evidenceSha256);
        expect(JSON.parse(readFileSync(file, "utf8")).findingId).toBe(f.id);
      }
      // the other apps publish no findings
      expect(existsSync(join(env.state.apps.mirroryield.distDir, ".well-known", "pramaan"))).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("release assembly", () => {
    it("assembles a schema-valid manifest per app from live chain data", async () => {
      for (const id of ["vaultlab", "mirroryield", "permitmarket"] as const) {
        const app = env.state.apps[id];
        const manifest = ManifestV1.parse(JSON.parse(readFileSync(app.release!.manifestPath, "utf8")));
        expect(manifest.app).toEqual({ name: app.name, ensName: app.ensName, domain: app.origin });
        expect(sha(readFileSync(app.release!.manifestPath))).toBe(app.release!.sha256);
        // every file in the dist is listed with its real hash
        for (const file of manifest.files) expect(sha(readFileSync(join(app.distDir, ...file.path.slice(1).split("/"))))).toBe(file.sha256);
        expect(manifest.files.length).toBe(listFiles(app.distDir).length);
        // contracts: live code hashes
        for (const c of manifest.contracts) {
          const code = await env.ctx.pub.getCode({ address: c.address as `0x${string}` });
          expect(c.runtimeCodehash).toBe(keccak256(code!));
        }
        expect(manifest.contracts.length).toBe(Object.keys(app.contracts).filter((r) => r !== "vaultImplementation").length);
        // only the RPC endpoint is declared; never the tracker
        expect(manifest.thirdParties).toEqual([expect.objectContaining({ host: `127.0.0.1:${TEST_PORTS.anvil}`, receivesAddress: true })]);
        expect(JSON.stringify(manifest)).not.toMatch(/5190|tracker/);
        expect(manifest.descriptors.length).toBe(readdirSync(join(app.distDir, "erc7730")).length);
      }
    });

    it("pins the ERC-1967 implementation of the VaultV2 proxy and carries the PROVE findings", () => {
      const app = env.state.apps.vaultlab;
      const manifest = ManifestV1.parse(JSON.parse(readFileSync(app.release!.manifestPath, "utf8")));
      const proxy = manifest.contracts.find((c) => c.address.toLowerCase() === app.contracts["vault"]!.toLowerCase())!;
      expect(proxy.proxy?.type).toBe("eip1967");
      expect(proxy.proxy?.implAddress.toLowerCase()).toBe(app.contracts["vaultImplementation"]!.toLowerCase());
      expect(manifest.findings.length).toBe(env.state.prove?.findings.length ?? 0);
      expect(manifest.contracts.some((c) => c.address.toLowerCase() === app.contracts["upgradeTimelock"]!.toLowerCase())).toBe(true);
      // the vulnerable vault and the unaudited implementation are not part of any release
      const listed = JSON.stringify(manifest).toLowerCase();
      expect(listed).not.toContain(app.unlisted["legacyVault"]!.toLowerCase());
      expect(listed).not.toContain(app.unlisted["unauditedImpl"]!.toLowerCase());
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("hosting (with --fixtures)", () => {
    it("starts every listener", async () => {
      servers = await startDemoServers({ statePath: env.statePath, fixtures: true, ports, out: env.out, quiet: true });
      expect(Object.keys(servers.urls).sort()).toEqual(["admin", "lookalike", "mirroryield", "permitmarket", "tracker", "vaultlab"]);
    });

    it("serves each origin's page and well-known hint with correct types and no-store", async () => {
      for (const id of ["vaultlab", "mirroryield", "permitmarket"] as const) {
        const page = await raw(ports[id], "/");
        expect(page.status, id).toBe(200);
        expect(page.headers["content-type"]).toBe("text/html; charset=utf-8");
        expect(page.headers["cache-control"]).toBe("no-store");
        expect(page.headers["x-content-type-options"]).toBe("nosniff");
        expect(page.body.equals(readFileSync(join(env.state.apps[id].distDir, "index.html")))).toBe(true);
        const hint = await raw(ports[id], "/.well-known/pramaan.json");
        expect(hint.status).toBe(200);
        expect(hint.headers["content-type"]).toContain("application/json");
        expect(hint.headers["cache-control"]).toBe("no-store");
        expect(hint.headers["access-control-allow-origin"]).toBe("*");
        expect(WellKnownHint.parse(JSON.parse(hint.body.toString())).ensName).toBe(env.state.apps[id].ensName);
        // a hashed asset: javascript content type
        const js = listFiles(join(env.state.apps[id].distDir, "assets")).find((f) => f.endsWith(".js"))!;
        const asset = await raw(ports[id], `/assets/${js.replace(/.*[\\/]/, "")}`);
        expect(asset.status).toBe(200);
        expect(asset.headers["content-type"]).toBe("text/javascript; charset=utf-8");
        expect(asset.headers["cache-control"]).toBe("no-store");
      }
    });

    it("serves the release sidecars (manifest + DSSE) per app, byte for byte", async () => {
      for (const id of ["vaultlab", "mirroryield", "permitmarket"] as const) {
        const rel = env.state.apps[id].release!;
        const m = await raw(ports[id], "/.well-known/pramaan-manifest.json");
        const s = await raw(ports[id], "/.well-known/pramaan-manifest.dsse.json");
        expect(m.status).toBe(200);
        expect(s.status).toBe(200);
        expect(m.body.equals(readFileSync(rel.manifestPath))).toBe(true);
        expect(s.body.equals(readFileSync(rel.signaturePath))).toBe(true);
        expect(sha(m.body)).toBe(rel.sha256);
        expect(m.headers["cache-control"]).toBe("no-store");
      }
      expect((await raw(ports.vaultlab, "/.well-known/pramaan-manifest.sigstore.json")).status).toBe(404);
    });

    it("serves the same MirrorYield files on the lookalike origin", async () => {
      const a = await raw(ports.mirroryield, "/");
      const b = await raw(ports.lookalike, "/");
      expect(b.status).toBe(200);
      expect(b.body.equals(a.body)).toBe(true);
      const manifest = await raw(ports.lookalike, "/.well-known/pramaan-manifest.json");
      expect(sha(manifest.body)).toBe(env.state.apps.mirroryield.release!.sha256);
    });

    it("answers 404 for unknown paths, 405 for non-GET and never escapes the web root", async () => {
      expect((await raw(ports.vaultlab, "/nope.js")).status).toBe(404);
      expect((await raw(ports.vaultlab, "/", "POST")).status).toBe(405);
      expect((await raw(ports.vaultlab, "/", "HEAD")).status).toBe(200);
      const attempts = ["/../package.json", "/%2e%2e/%2e%2e/package.json", "/..%2f..%2f..%2fpackage.json", "/assets/../../../../package.json", "/%2e%2e%5c%2e%2e%5cpackage.json", "/..\\..\\package.json", "/.%2e/.%2e/.%2e/.%2e/.%2e/package.json", "/%00", "/index.html%00.png", "/%c0%ae%c0%ae/package.json", "/__fixtures/../../package.json"];
      for (const port of [ports.vaultlab, ports.mirroryield, ports.lookalike, ports.permitmarket]) {
        for (const p of attempts) {
          const r = await raw(port, p);
          expect([400, 404], `${port} ${p}`).toContain(r.status);
          expect(r.body.toString()).not.toContain('"name"');
        }
      }
    });

    it("serves the fixture only because --fixtures is on, and logs everything the tracker receives", async () => {
      const page = await raw(ports.permitmarket, "/__fixtures/leak.html");
      expect(page.status).toBe(200);
      expect(page.headers["content-type"]).toBe("text/html; charset=utf-8");
      const asset = /\/__fixtures\/(assets\/[^"']+\.js)/.exec(page.body.toString())![0];
      expect((await raw(ports.permitmarket, asset)).status).toBe(200);

      const addr = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";
      await raw(ports.tracker, `/collect?addr=${addr}`);
      await raw(ports.tracker, `/collect?a=${addr.slice(2).toLowerCase()}`);
      await raw(ports.tracker, "/collect", "POST", { "content-type": "application/json" }, JSON.stringify({ wallet: addr }));
      await raw(ports.tracker, "/collect", "POST", { "content-type": "text/plain" }, Buffer.from(addr).toString("base64"));
      await raw(ports.tracker, "/collect", "POST", { "content-type": "text/plain;charset=UTF-8" }, addr); // what sendBeacon sends
      const pixel = await raw(ports.tracker, `/collect/pixel.gif?addr=${addr}`, "GET", { accept: "image/avif,image/webp,*/*" });
      expect(pixel.status).toBe(200);
      expect(pixel.headers["content-type"]).toBe("image/gif");
      const log = JSON.parse((await raw(ports.tracker, "/log")).body.toString()) as { method: string; path: string; query: Record<string, string>; body: string }[];
      expect(log.length).toBe(6);
      expect(log[0]!.query["addr"]).toBe(addr);
      expect(log[1]!.query["a"]).toBe(addr.slice(2).toLowerCase());
      expect(JSON.parse(log[2]!.body)).toEqual({ wallet: addr });
      expect(Buffer.from(log[3]!.body, "base64").toString()).toBe(addr);
      expect(log[4]!.body).toBe(addr);
      expect(log[5]!.path).toBe("/collect/pixel.gif");
      expect(servers!.trackerLog.length).toBe(6);
    });

    it("refuses browser-origin requests on the admin endpoint", async () => {
      expect((await raw(ports.admin, "/tamper?app=mirroryield", "POST", { origin: "http://evil.example" })).status).toBe(403);
      expect((await raw(ports.admin, "/status", "GET", { host: "evil.example" })).status).toBe(403);
      expect((await raw(ports.admin, "/tamper?app=vaultlab", "POST")).status).toBe(400);
      expect((await raw(ports.admin, "/status")).status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("tamper and restore MirrorYield through the admin endpoint", () => {
    const distOf = () => env.state.apps.mirroryield.distDir;
    const treeHash = () => sha(listFiles(distOf()).map((f) => `${f}:${sha(readFileSync(f))}`).join("\n"));
    let originalTree = "";
    let originalJsHash = "";

    it("reports original == current before tampering", async () => {
      const r = JSON.parse((await raw(ports.admin, "/status")).body.toString());
      expect(r.tampered).toBe(false);
      expect(r.originalSha256).toBe(r.currentSha256);
      originalJsHash = r.originalSha256;
      originalTree = treeHash();
      expect(originalJsHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("patches the built JS on disk: attacker address in, farm address out, HTML unchanged, hash changed", async () => {
      const farm = env.state.apps.mirroryield.contracts["farm"]!;
      const html = readFileSync(join(distOf(), "index.html"));
      const res = await raw(ports.admin, "/tamper?app=mirroryield", "POST");
      expect(res.status).toBe(200);
      const body = JSON.parse(res.body.toString());
      expect(body.replacements).toBeGreaterThan(0);
      expect(body.tampered).toBe(true);
      expect(body.originalSha256).toBe(originalJsHash);
      expect(body.currentSha256).not.toBe(originalJsHash);

      const manifest = ManifestV1.parse(JSON.parse(readFileSync(env.state.apps.mirroryield.release!.manifestPath, "utf8")));
      const entry = manifest.files.find((f) => f.sha256 === originalJsHash)!;
      expect(entry, "the signed manifest lists the original JS hash").toBeTruthy();
      const served = await raw(ports.mirroryield, entry.path);
      expect(sha(served.body)).toBe(body.currentSha256);
      expect(sha(served.body)).not.toBe(entry.sha256);
      expect(served.body.toString()).toContain(env.attackerAddress);
      expect(served.body.toString().toLowerCase()).not.toContain(farm.toLowerCase());
      expect(readFileSync(join(distOf(), "index.html")).equals(html)).toBe(true);
      // the lookalike serves the same (tampered) files; the sidecar still carries the ORIGINAL manifest
      expect(sha((await raw(ports.lookalike, entry.path)).body)).toBe(body.currentSha256);
      expect(sha((await raw(ports.mirroryield, "/.well-known/pramaan-manifest.json")).body)).toBe(env.state.apps.mirroryield.release!.sha256);
    });

    it("refuses a second tamper and shows the difference in /status", async () => {
      expect((await raw(ports.admin, "/tamper?app=mirroryield", "POST")).status).toBe(409);
      const r = JSON.parse((await raw(ports.admin, "/status")).body.toString());
      expect(r.tampered).toBe(true);
      expect(r.originalSha256).toBe(originalJsHash);
      expect(r.currentSha256).not.toBe(r.originalSha256);
      expect(r.changed).toBe(true);
    });

    it("restores byte-identical files", async () => {
      expect(treeHash()).not.toBe(originalTree);
      const res = await raw(ports.admin, "/restore?app=mirroryield", "POST");
      expect(res.status).toBe(200);
      expect(treeHash()).toBe(originalTree);
      const r = JSON.parse((await raw(ports.admin, "/status")).body.toString());
      expect(r.tampered).toBe(false);
      expect(r.currentSha256).toBe(originalJsHash);
      expect((await raw(ports.admin, "/restore?app=mirroryield", "POST")).status).toBe(409);
    });

    it("does the same through the CLI actions (files, no server)", () => {
      const r = demoTamper(env.state);
      expect(r.replacements).toBeGreaterThan(0);
      expect(demoTamperStatus(env.state).tampered).toBe(true);
      expect(treeHash()).not.toBe(originalTree);
      demoRestore(env.state);
      expect(treeHash()).toBe(originalTree);
      expect(demoTamperStatus(env.state).tampered).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("hosting without --fixtures", () => {
    it("404s the fixture and does not start the tracker", async () => {
      await servers!.close();
      servers = await startDemoServers({ statePath: env.statePath, fixtures: false, ports, out: env.out, quiet: true });
      expect(Object.keys(servers.urls)).not.toContain("tracker");
      expect((await raw(ports.permitmarket, "/__fixtures/leak.html")).status).toBe(404);
      expect((await raw(ports.permitmarket, "/__fixtures/")).status).toBe(404);
      await expect(raw(ports.tracker, "/log")).rejects.toThrow();
      expect((await raw(ports.permitmarket, "/")).status).toBe(200);
    });

    it("refuses to start when a port is taken", async () => {
      await expect(startDemoServers({ statePath: env.statePath, ports, out: env.out, quiet: true })).rejects.toThrow(/cannot listen/);
      // the first server is still healthy afterwards
      expect((await raw(ports.vaultlab, "/")).status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("timelocked VaultV2 upgrade", () => {
    it("cannot be done directly, not before the delay, and works after it", async () => {
      const { vault } = env.state.apps.vaultlab.contracts;
      const { unauditedImpl } = env.state.apps.vaultlab.unlisted;
      const before = await upgradeStatus(env.ctx, env.state);
      expect(before.state).toBe("Unset");
      expect(before.version).toBe("2.0.0");
      const originalImplementation = before.currentImplementation;

      // 1. the owner key cannot upgrade the proxy directly: the timelock is the owner
      await expect(env.ctx.pub.simulateContract({ address: vault!, abi: vaultAbi, functionName: "upgradeToAndCall", args: [unauditedImpl!, "0x"], account: env.owner.account })).rejects.toThrow();

      // 2. nothing scheduled -> execute refuses
      await expect(executeUpgrade(env.ctx, env.state, env.owner)).rejects.toThrow(/nothing is scheduled/);

      // 3. schedule; the operation waits for the full delay
      const scheduled = await scheduleUpgrade(env.ctx, env.state, env.owner);
      const waiting = await upgradeStatus(env.ctx, env.state);
      expect(waiting.state).toBe("Waiting");
      expect(waiting.readyAt).toBe(scheduled.readyAt);
      expect(waiting.secondsRemaining).toBeGreaterThan(100);
      expect(waiting.secondsRemaining).toBeLessThanOrEqual(120);
      await expect(scheduleUpgrade(env.ctx, env.state, env.owner)).rejects.toThrow(); // already scheduled

      // 4. execute before the delay: refused with the time left, and the chain agrees (a raw execute reverts)
      await expect(executeUpgrade(env.ctx, env.state, env.owner)).rejects.toBeInstanceOf(UpgradeNotReadyError);
      await waitSeconds(env.ctx, 60);
      await expect(executeUpgrade(env.ctx, env.state, env.owner)).rejects.toBeInstanceOf(UpgradeNotReadyError);
      expect((await upgradeStatus(env.ctx, env.state)).currentImplementation).toBe(originalImplementation);
      const rawExecute = parseAbi(["function execute(address target, uint256 value, bytes payload, bytes32 predecessor, bytes32 salt)"]);
      const data = encodeFunctionData({ abi: vaultAbi, functionName: "upgradeToAndCall", args: [unauditedImpl!, "0x"] });
      const salt = keccak256(toBytes("pramaan-demo-vault-upgrade-v1"));
      await expect(
        env.ctx.pub.simulateContract({ address: env.state.apps.vaultlab.contracts["upgradeTimelock"]!, abi: rawExecute, functionName: "execute", args: [vault!, 0n, data, `0x${"00".repeat(32)}`, salt], account: env.owner.account }),
      ).rejects.toThrow();

      // 5. after the delay (evm_increaseTime) it succeeds and the proxy points at the unaudited implementation
      await waitSeconds(env.ctx, 61);
      const ready = await upgradeStatus(env.ctx, env.state);
      expect(ready.state).toBe("Ready");
      const done = await executeUpgrade(env.ctx, env.state, env.owner);
      expect(getAddress(done.implementation)).toBe(getAddress(unauditedImpl!));
      expect(done.version).toBe("3.0.0-unaudited");
      expect((await upgradeStatus(env.ctx, env.state)).state).toBe("Done");
      await expect(executeUpgrade(env.ctx, env.state, env.owner)).rejects.toThrow(/already executed/);
      expect(statSync(env.statePath).isFile()).toBe(true);
    }, 120_000);
  });
});

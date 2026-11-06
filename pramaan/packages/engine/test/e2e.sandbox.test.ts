import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  analyzeProject,
  buildEvidence,
  dockerStatus,
  proposeFix,
  renderMarkdownReport,
  runSandbox,
  verifyFix,
  type AnalysisReport,
  type ProjectConfig,
} from "../src/index.js";

/**
 * Real end-to-end runs of the PROVE pipeline in the network-less Docker sandbox. Slow (minutes): enabled with
 * PRAMAAN_E2E=1 and skipped when Docker or the sandbox image is missing.
 */
const ROOT = resolve(__dirname, "../../..");
const enabled = process.env.PRAMAAN_E2E === "1";
const config = (dir: string) => JSON.parse(readFileSync(join(dir, "pramaan.json"), "utf8")) as ProjectConfig;
let ready = false;

beforeAll(async () => {
  if (!enabled) return;
  const s = await dockerStatus();
  ready = s.available && s.imagePresent;
});

describe.runIf(enabled)("PROVE pipeline in the sandbox", () => {
  let report: AnalysisReport;
  const repo = join(ROOT, "contracts");

  it("reproduces the VulnerableVault sweep, rejects unproven candidates and verifies the VaultV2 pair", async (ctx) => {
    if (!ready) ctx.skip();
    report = await analyzeProject({ repoDir: repo, repo: "local:pramaan/contracts", commit: null, config: config(repo) });
    const sweep = report.findings.find((f) => f.candidate.key === "access-control:VulnerableVault:withdrawAll()");
    expect(sweep?.status).toBe("reproduced");
    expect(sweep?.vulnerableRun.logs.some((l) => l.includes("pramaan.attacker_gain"))).toBe(true);
    expect(sweep?.pairs[0]).toMatchObject({ fixedContract: "VaultV2", verified: true, outcome: { kind: "reverted" } });
    // Aderyn also flags the honest withdraw(uint256) functions; their exploits must NOT reproduce.
    const honest = report.findings.filter((f) => f.candidate.function === "withdraw(uint256)" && f.test);
    expect(honest.length).toBeGreaterThan(0);
    expect(honest.every((f) => f.status === "not-reproduced")).toBe(true);
    expect(report.findings.filter((f) => f.status === "reproduced").map((f) => f.candidate.key)).toEqual(["access-control:VulnerableVault:withdrawAll()"]);
    expect(report.regression.ran && report.regression.failed === 0).toBe(true);
    expect(report.tools.map((t) => t.name)).toEqual(expect.arrayContaining(["forge", "slither", "aderyn", "solc"]));
  }, 900_000);

  it("proposes the onlyOwner fix and re-proves it: exploit reverts, regression suite passes", async (ctx) => {
    if (!ready || !report) ctx.skip();
    const sweep = report.findings.find((f) => f.candidate.key === "access-control:VulnerableVault:withdrawAll()")!;
    const c = report.contracts.find((x) => x.name === "VulnerableVault")!;
    const fix = proposeFix(repo, c, c.functions.find((f) => f.name === "withdrawAll")!, "access-control");
    expect(fix.ok).toBe(true);
    if (!fix.ok) return;
    const v = await verifyFix({ repoDir: repo, finding: sweep, fix: fix.fix, config: config(repo) });
    expect(v).toMatchObject({ verified: true, exploit: { kind: "reverted" } });
    expect(v.regression.failed).toBe(0);
    const { evidence, sha256 } = buildEvidence(report, sweep, { fixVerification: v, fixedRef: "pramaan-fix" });
    expect(evidence.confidence).toBe("reproduced");
    expect(evidence.fixedRun.result).toBe("failed-as-expected");
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);
    const md = renderMarkdownReport(report, { [sweep.id]: { verification: v, diff: fix.fix.diff, explanation: fix.fix.explanation } });
    expect(md).toContain("REPRODUCED");
    expect(md).toContain("onlyOwner");
  }, 900_000);

  it("reproduces reentrancy in EtherBank and shows EtherBankFixed resists it", async (ctx) => {
    if (!ready) ctx.skip();
    const dir = join(ROOT, "examples", "reentrancy-bank");
    const r = await analyzeProject({ repoDir: dir, repo: "local:examples/reentrancy-bank", commit: null, config: config(dir) });
    const f = r.findings.find((x) => x.templateId === "reentrancy-eth" && x.candidate.contract === "EtherBank");
    expect(f?.status).toBe("reproduced");
    expect(f?.pairs[0]?.verified).toBe(true);
  }, 900_000);

  it("reproduces the initializer takeover in RewardsPool and verifies the guard fix", async (ctx) => {
    if (!ready) ctx.skip();
    const dir = join(ROOT, "examples", "initializer-takeover");
    const r = await analyzeProject({ repoDir: dir, repo: "local:examples/initializer-takeover", commit: null, config: config(dir) });
    const f = r.findings.find((x) => x.templateId === "initializer-takeover" && x.candidate.contract === "RewardsPool");
    expect(f?.status).toBe("reproduced");
    expect(f?.pairs[0]?.verified).toBe(true);
    const c = r.contracts.find((x) => x.name === "RewardsPool")!;
    const fix = proposeFix(dir, c, c.functions.find((x) => x.name === "initialize")!, "unprotected-initializer");
    expect(fix.ok).toBe(true);
    if (!fix.ok) return;
    expect((await verifyFix({ repoDir: dir, finding: f!, fix: fix.fix })).verified).toBe(true);
  }, 900_000);

  it("reproduces the unchecked oracle answer in OracleLoan, verifies the deterministic fix and sees OracleLoanFixed resist", async (ctx) => {
    if (!ready) ctx.skip();
    const dir = join(ROOT, "examples", "oracle-lending");
    const r = await analyzeProject({ repoDir: dir, repo: "local:examples/oracle-lending", commit: null, config: config(dir) });
    const f = r.findings.find((x) => x.templateId === "oracle-unchecked-price" && x.candidate.contract === "OracleLoan");
    expect(f?.status).toBe("reproduced");
    expect(f?.vulnerableRun.logs.some((l) => l.includes("pramaan.attacker_gain"))).toBe(true);
    expect(f?.pairs[0]).toMatchObject({ fixedContract: "OracleLoanFixed", verified: true });
    // The already-fixed twin must not be reported as vulnerable.
    expect(r.findings.some((x) => x.status === "reproduced" && x.candidate.contract === "OracleLoanFixed")).toBe(false);
    const c = r.contracts.find((x) => x.name === "OracleLoan")!;
    const fix = proposeFix(dir, c, c.functions.find((x) => x.name === "borrow")!, "unchecked-oracle");
    expect(fix.ok).toBe(true);
    if (!fix.ok) return;
    expect(fix.fix.after).toContain("require(answer > 0");
    expect((await verifyFix({ repoDir: dir, finding: f!, fix: fix.fix })).verified).toBe(true);
  }, 900_000);

  it("contains a malicious repository that enables FFI and tries to run shell commands", async (ctx) => {
    if (!ready) ctx.skip();
    const dir = mkdtempSync(join(tmpdir(), "pramaan-evil-"));
    mkdirSync(join(dir, "src"));
    mkdirSync(join(dir, "test"));
    cpSync(join(ROOT, "contracts", "lib", "forge-std"), join(dir, "lib", "forge-std"), { recursive: true });
    writeFileSync(join(dir, "foundry.toml"), '[profile.default]\nsrc = "src"\nlibs = ["lib"]\nffi = true\n');
    writeFileSync(join(dir, "src", "A.sol"), "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\ncontract A { function f() external pure returns (uint256) { return 1; } }\n");
    writeFileSync(
      join(dir, "test", "Evil.t.sol"),
      `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
contract EvilTest is Test {
    function test_pwn() public {
        string[] memory cmd = new string[](3);
        cmd[0] = "sh"; cmd[1] = "-c"; cmd[2] = "echo pwned";
        bytes memory out = vm.ffi(cmd);
        assertEq(string(out), "pwned");
    }
}
`,
    );
    const r = await runSandbox({ mode: "test", srcDir: dir, suite: true });
    const suite = r.result?.["suite"] as { json: Record<string, { test_results: Record<string, { status: string; reason: string }> }> } | undefined;
    const result = suite?.json?.["test/Evil.t.sol:EvilTest"]?.test_results?.["test_pwn()"];
    expect(result?.status).toBe("Failure");
    expect(String(result?.reason)).toMatch(/ffi/i);
  }, 600_000);

  it("kills the container when the wall-clock limit is hit", async (ctx) => {
    if (!ready) ctx.skip();
    const r = await runSandbox({ mode: "analyze", srcDir: repo, limits: { timeoutMs: 6_000 } });
    expect(r.timedOut).toBe(true);
    expect(r.ok).toBe(false);
    await new Promise((res) => setTimeout(res, 3_000));
    const running = execFileSync("docker", ["ps", "--filter", "name=pramaan-", "--format", "{{.Names}}"], { encoding: "utf8" }).trim();
    expect(running).toBe("");
  }, 120_000);
});

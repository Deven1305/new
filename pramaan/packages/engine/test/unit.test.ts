import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  classifyFixedRun,
  collectCandidates,
  extractZip,
  parseForgeJson,
  planExploit,
  proposeFix,
  renderExploit,
  retarget,
  sandboxArgv,
  staticGates,
  validateGitUrl,
  validateRef,
  validateSlots,
  type AnalyzeOutput,
  type ContractInfo,
  type ExploitPlan,
} from "../src/index.js";

const CONTRACTS = resolve(__dirname, "../../../contracts");
const analysis = JSON.parse(readFileSync(join(__dirname, "fixtures", "contracts-analyze.json"), "utf8")) as AnalyzeOutput;
const contract = (name: string) => analysis.contracts.find((c) => c.name === name) as ContractInfo;

describe("candidates", () => {
  const candidates = collectCandidates(analysis);

  it("merges Slither and Aderyn reports for the same function into one candidate", () => {
    const sweep = candidates.find((c) => c.key === "access-control:VulnerableVault:withdrawAll()");
    expect(sweep).toBeDefined();
    expect(sweep!.sources.map((s) => `${s.tool}:${s.detector}`).sort()).toEqual([
      "aderyn:eth-send-unchecked-address",
      "slither:arbitrary-send-eth",
      "slither:pramaan-unprotected-sweep",
    ]);
    expect(sweep!.confidence).toBe("high");
  });

  it("keeps candidates from other code (they still need proof)", () => {
    expect(candidates.some((c) => c.contract === "VaultV2")).toBe(true);
    expect(candidates.every((c) => !c.file.startsWith("lib/"))).toBe(true);
  });
});

describe("exploit planning and rendering", () => {
  const candidate = collectCandidates(analysis).find((c) => c.key === "access-control:VulnerableVault:withdrawAll()")!;

  it("plans a proxy deployment with the owner and a mock token for an upgradeable vault", () => {
    const r = planExploit({ candidate, contract: contract("VulnerableVault") });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.deploy).toEqual({ kind: "proxy", ctorArgs: [], initializer: { name: "initialize", args: ["owner", "address(token)"] } });
    expect(r.plan.fund).toEqual({ fn: "deposit", valueExpr: "SEED" });
    expect(r.plan.attack).toEqual({ fn: "withdrawAll", args: [] });
    const source = renderExploit(r.plan, { findingId: "PRM-1" });
    expect(source).toContain('import {VulnerableVault as PramaanTarget} from "src/demo/VulnerableVault.sol";');
    expect(source).toContain("contract PramaanExploit_PRM_1 is Test");
    expect(staticGates(r.plan, source).every((g) => g.passed)).toBe(true);
    const fixed = renderExploit(retarget(r.plan, contract("VaultV2")), { findingId: "PRM-1", suffix: "_VaultV2" });
    expect(fixed).toContain("import {VaultV2 as PramaanTarget}");
  });

  it("rejects state-forging cheatcodes and owner pranks in the attack phase", () => {
    const r = planExploit({ candidate, contract: contract("VulnerableVault") });
    if (!r.ok) throw new Error(r.reason);
    const forged = renderExploit(r.plan, { findingId: "X-1" }).replace(
      "vm.prank(attacker);",
      "vm.store(address(target), bytes32(0), bytes32(0));\n        vm.prank(owner);",
    );
    const gates = staticGates(r.plan, forged);
    expect(gates.find((g) => g.id === "no-state-forging")!.passed).toBe(false);
    expect(gates.find((g) => g.id === "attacker-only")!.passed).toBe(false);
  });

  it("refuses slot values outside the vocabulary (no code injection through slots)", () => {
    const r = planExploit({ candidate, contract: contract("VulnerableVault") });
    if (!r.ok) throw new Error(r.reason);
    const injected: ExploitPlan = { ...r.plan, attack: { fn: "withdrawAll", args: ['attacker); selfdestruct(payable(attacker)); ("'] } };
    expect(staticGates(injected, renderExploit(injected, { findingId: "X-2" })).find((g) => g.id === "slot-vocabulary")!.passed).toBe(false);
    expect(planExploit({ candidate, contract: contract("VulnerableVault"), config: { targets: { VulnerableVault: { deploy: { kind: "direct", constructorArgs: ["block.timestamp"] } } } } }).ok).toBe(false);
  });

  it("validates AI-proposed slots against the contract's own functions", () => {
    const base = { deployKind: "proxy" as const, constructorArgs: [], initializer: "initialize", initializerArgs: ["owner", "address(token)"], fundFunction: "deposit", attackArgs: [], rationale: "" };
    expect(validateSlots(base, candidate, contract("VulnerableVault"), "access-control-drain")?.filledBy).toBe("ai");
    expect(validateSlots({ ...base, fundFunction: "notAFunction" }, candidate, contract("VulnerableVault"), "access-control-drain")).toBeNull();
    expect(validateSlots({ ...base, initializerArgs: ["tx.origin", "address(token)"] }, candidate, contract("VulnerableVault"), "access-control-drain")).toBeNull();
    expect(validateSlots({ ...base, attackArgs: ["attacker"] }, candidate, contract("VulnerableVault"), "access-control-drain")).toBeNull();
  });
});

describe("deterministic fixer", () => {
  it("adds onlyOwner to the Ownable vault's sweep and produces a reviewable diff", () => {
    const vv = contract("VulnerableVault");
    const fn = vv.functions.find((f) => f.name === "withdrawAll")!;
    const repo = mkdtempSync(join(tmpdir(), "pramaan-fix-"));
    const file = join(repo, vv.source);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, readFileSync(join(CONTRACTS, vv.source), "utf8").replace(/\r\n/g, "\n"));
    const r = proposeFix(repo, vv, fn, "access-control");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fix.after).toContain("function withdrawAll() external onlyOwner {");
    expect(r.fix.diff).toContain("+    function withdrawAll() external onlyOwner {");
    expect(r.fix.diff).toContain("-    function withdrawAll() external {");
    expect(r.fix.after.length - r.fix.before.length).toBe(" onlyOwner".length);
  });

  it("rejects stale byte offsets instead of patching the wrong location", () => {
    const vv = contract("VulnerableVault");
    const fn = vv.functions.find((f) => f.name === "withdrawAll")!;
    const repo = mkdtempSync(join(tmpdir(), "pramaan-stale-"));
    const file = join(repo, vv.source);
    mkdirSync(join(file, ".."), { recursive: true });
    const source = readFileSync(join(CONTRACTS, vv.source), "utf8").replace(/\r\n/g, "\n");
    writeFileSync(file, source.replace(/\n/g, "\r\n"));
    expect(proposeFix(repo, vv, fn, "access-control")).toMatchObject({ ok: false, reason: expect.stringContaining("re-run analysis") });
  });

  it("refuses to invent a guard the contract cannot use", () => {
    const vv = contract("VulnerableVault");
    const fn = vv.functions.find((f) => f.name === "withdraw")!;
    expect(proposeFix(CONTRACTS, vv, fn, "reentrancy").ok).toBe(false);
  });
});

describe("forge result classification", () => {
  const json = {
    "test/pramaan/X.t.sol:X": {
      test_results: {
        "test_exploit()": { status: "Failure", reason: "OwnableUnauthorizedAccount(0x1)", decoded_logs: [], duration: "1ms" },
        "test_other()": { status: "Failure", reason: "Pramaan: property violated: 1 < 2", decoded_logs: [] },
      },
    },
  };
  it("distinguishes a revert, a property failure, a setup failure and a pass", () => {
    const [revert, property] = parseForgeJson(json);
    expect(classifyFixedRun(revert).kind).toBe("reverted");
    expect(classifyFixedRun(property).kind).toBe("assertion-failed");
    expect(classifyFixedRun({ ...revert!, test: "setUp()", reason: "setUp() failed" }).kind).toBe("setup-failed");
    expect(classifyFixedRun({ ...revert!, status: "Success", reason: null }).kind).toBe("passed");
    expect(classifyFixedRun(undefined).kind).toBe("missing");
  });
});

describe("input hardening", () => {
  it("only accepts https repository URLs on allowed hosts, without credentials", () => {
    expect(validateGitUrl("https://github.com/foundry-rs/forge-std").hostname).toBe("github.com");
    for (const bad of ["http://github.com/a/b", "file:///etc", "https://user:pw@github.com/a/b", "https://evil.example/a/b", "https://github.com/a/b/../../c", "ext::sh -c id"]) {
      expect(() => validateGitUrl(bad)).toThrow();
    }
  });

  it("rejects option-like and traversal git refs", () => {
    expect(validateRef("v1.2.3")).toBe("v1.2.3");
    for (const bad of ["--upload-pack=touch x", "a..b", "a b", ""]) expect(() => validateRef(bad)).toThrow();
  });

  it("blocks zip-slip and oversized archives", () => {
    const dest = mkdtempSync(join(tmpdir(), "pramaan-zip-"));
    expect(() => extractZip(zipSync({ "../evil.sol": new Uint8Array([1]) }), dest)).toThrow(/unsafe path/);
    expect(() => extractZip(zipSync({ "a.sol": new Uint8Array(2048) }), dest, { maxFiles: 10, maxBytes: 1024 })).toThrow(/more than/);
    expect(extractZip(zipSync({ "src/A.sol": new TextEncoder().encode("contract A {}") }), dest).files).toBe(1);
  });

  it("builds a docker argv with every isolation flag and refuses option smuggling in mount paths", () => {
    const argv = sandboxArgv({ mode: "analyze", srcDir: resolve(CONTRACTS) }, "pramaan-test");
    for (const flag of ["--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "--memory", "--cpus", "--user", "1000:1000"]) {
      expect(argv).toContain(flag);
    }
    expect(argv.find((a) => a.startsWith("type=bind"))).toMatch(/,readonly$/);
    expect(() => sandboxArgv({ mode: "analyze", srcDir: "C:\\repo,target=/,readonly=false" }, "x")).toThrow();
    expect(() => sandboxArgv({ mode: "analyze", srcDir: "relative/path" }, "x")).toThrow();
  });
});

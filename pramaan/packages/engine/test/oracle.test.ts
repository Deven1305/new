import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { collectCandidates, guardOracleReads, planExploit, renderExploit, staticGates, templateFor, type AnalyzeOutput, type ContractInfo } from "../src/index.js";

const ROOT = resolve(__dirname, "../../..");
const vulnerable = readFileSync(resolve(ROOT, "examples/oracle-lending/src/OracleLoan.sol"), "utf8");
const fixed = readFileSync(resolve(ROOT, "examples/oracle-lending/src/OracleLoanFixed.sol"), "utf8");

const loan: ContractInfo = {
  name: "OracleLoan",
  source: "src/OracleLoan.sol",
  kind: "contract",
  abstract: false,
  bases: [],
  deployable: true,
  abi: [],
  functions: [
    { name: "constructor", kind: "constructor", visibility: "public", stateMutability: "nonpayable", modifiers: [], parameters: [{ name: "feed_", type: "contract IPriceFeed" }], src: { start: 0, length: 0, bodyStart: 0 }, lines: [1, 1] },
    { name: "deposit", kind: "function", visibility: "external", stateMutability: "payable", modifiers: [], parameters: [], src: { start: 0, length: 0, bodyStart: 0 }, lines: [1, 1] },
    { name: "borrow", kind: "function", visibility: "external", stateMutability: "nonpayable", modifiers: [], parameters: [{ name: "amount", type: "uint256" }], src: { start: 0, length: 0, bodyStart: 0 }, lines: [1, 1] },
  ],
};

const candidate = {
  key: "unchecked-oracle:OracleLoan:borrow(uint256)",
  vulnClass: "unchecked-oracle",
  title: "t",
  severity: "high" as const,
  confidence: "medium" as const,
  contract: "OracleLoan",
  function: "borrow(uint256)",
  file: "src/OracleLoan.sol",
  lines: [33],
  sources: [{ tool: "slither" as const, detector: "pramaan-unchecked-oracle", description: "d" }],
};

describe("oracle template", () => {
  it("maps the detector to the unchecked-oracle class and the oracle template", () => {
    const analysis = {
      mode: "analyze",
      tools: [],
      slither: { ok: true, error: null, durationMs: 0, detectors: [{ check: "pramaan-unchecked-oracle", impact: "High", confidence: "Medium", description: "d", elements: [{ type: "function", name: "borrow", source_mapping: { filename_relative: "src/OracleLoan.sol", lines: [33] }, type_specific_fields: { signature: "borrow(uint256)", parent: { type: "contract", name: "OracleLoan" } } }] }] },
      build: { ok: true, exitCode: 0, log: "", durationMs: 0 },
      contracts: [loan],
    } as unknown as AnalyzeOutput;
    const [c] = collectCandidates(analysis);
    expect(c).toMatchObject({ vulnClass: "unchecked-oracle", contract: "OracleLoan", function: "borrow(uint256)", severity: "high" });
    expect(templateFor(c!)).toBe("oracle-unchecked-price");
  });

  it("plans a feed-injecting exploit, renders a test inside the allowed vocabulary and passes the static gates", () => {
    const planned = planExploit({ candidate, contract: loan });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const { plan } = planned;
    expect(plan.templateId).toBe("oracle-unchecked-price");
    expect(plan.deploy).toMatchObject({ kind: "direct", ctorArgs: ["address(feed)"], lowLevelCreate: true });
    const source = renderExploit(plan, { findingId: "PRM-1" });
    expect(source).toContain("contract PramaanMockFeed");
    expect(source).toContain("feed.set(-1);");
    expect(source).toContain("abi.encode(address(feed))"); // contract-typed constructor parameter: no type import needed
    const gates = staticGates(plan, source);
    expect(gates.filter((g) => !g.passed)).toEqual([]);
  });

  it("refuses to plan when the feed cannot be injected", () => {
    const hardcoded: ContractInfo = { ...loan, functions: loan.functions.filter((f) => f.kind !== "constructor") };
    const planned = planExploit({ candidate, contract: hardcoded });
    expect(planned.ok).toBe(false);
    if (!planned.ok) expect(planned.reason).toMatch(/price feed/);
  });
});

describe("guardOracleReads", () => {
  it("adds a positivity check right after the unchecked read", () => {
    const r = guardOracleReads(vulnerable);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stale).toBe(false);
    expect(r.text).toContain('(, int256 answer,,,) = feed.latestRoundData();\n        require(answer > 0, "Pramaan: oracle answer is not positive");');
  });

  it("adds a freshness bound only when the updatedAt slot is named", () => {
    const named = vulnerable.replace("(, int256 answer,,,)", "(, int256 answer,, uint256 updatedAt,)");
    const r = guardOracleReads(named);
    expect(r.ok && r.stale).toBe(true);
    if (r.ok) expect(r.text).toContain("block.timestamp - updatedAt <= 1 days");
  });

  it("handles the latestAnswer() form", () => {
    const r = guardOracleReads("contract C {\n    function p() internal view returns (uint256) {\n        int256 px = feed.latestAnswer();\n        return uint256(px);\n    }\n}\n");
    expect(r.ok && r.text).toContain('require(px > 0, "Pramaan: oracle answer is not positive");');
  });

  it("leaves already-checked code alone and refuses unknown shapes", () => {
    expect(guardOracleReads(fixed).ok).toBe(false);
    const inline = guardOracleReads("contract C { function p() internal view returns (uint256) { return uint256(feed.latestAnswer()); } }");
    expect(inline.ok).toBe(false);
  });
});

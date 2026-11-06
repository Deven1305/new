import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTwoFilesPatch } from "diff";
import type { ContractFunction, ContractInfo, VulnClass } from "./types.js";

export interface FixProposal {
  generator: "deterministic" | "ai";
  file: string;
  before: string;
  after: string;
  diff: string;
  explanation: string;
  change: string;
}

export type FixResult = { ok: true; fix: FixProposal } | { ok: false; reason: string };

/** Index of `returns` at parenthesis depth 0 within a function header, or -1. */
function returnsIndex(header: string): number {
  let depth = 0;
  for (let i = 0; i < header.length; i++) {
    const ch = header[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0 && header.startsWith("returns", i) && /\W/.test(header[i - 1] ?? " ") && /[\s(]/.test(header[i + 7] ?? " ")) return i;
  }
  return -1;
}

/** Inserts a modifier into the function header using the AST byte span (works for any formatting). */
function addModifier(source: Buffer, fn: ContractFunction, modifier: string): Buffer | null {
  if (fn.src.bodyStart === null) return null;
  const header = source.subarray(fn.src.start, fn.src.bodyStart).toString("utf8");
  if (new RegExp(`\\b${modifier.replace(/\(.*$/, "")}\\b`).test(header)) return null; // already present
  const r = returnsIndex(header);
  const insertAt = r >= 0 ? r : header.trimEnd().length;
  const patchedHeader = r >= 0 ? `${header.slice(0, insertAt)}${modifier} ${header.slice(insertAt)}` : `${header.slice(0, insertAt)} ${modifier}${header.slice(insertAt)}`;
  return Buffer.concat([source.subarray(0, fn.src.start), Buffer.from(patchedHeader, "utf8"), source.subarray(fn.src.bodyStart)]);
}

function addRequireAtBodyStart(source: Buffer, fn: ContractFunction, statement: string): Buffer | null {
  if (fn.src.bodyStart === null) return null;
  const open = fn.src.bodyStart + 1; // after "{"
  const lineStart = source.lastIndexOf(0x0a, fn.src.start) + 1;
  const indent = (source.subarray(lineStart, fn.src.start).toString("utf8").match(/^\s*/)?.[0] ?? "") + "    ";
  return Buffer.concat([source.subarray(0, open), Buffer.from(`\n${indent}${statement}`, "utf8"), source.subarray(open)]);
}

const SANITY_AFTER = 600; // characters after the read that are searched for an existing check

/**
 * Adds `require(answer > 0)` (and a one-day staleness bound when the updatedAt slot is named) right after every
 * `latestRoundData()` / `latestAnswer()` read that is not already checked. Only handles the destructuring and the
 * `int256 x = feed.latestAnswer();` forms; anything else is left for a human or the AI drafter.
 */
export function guardOracleReads(text: string): { ok: true; text: string; stale: boolean } | { ok: false; reason: string } {
  type Edit = { at: number; insert: string };
  const edits: Edit[] = [];
  let stale = false;
  const checked = (name: string, after: string) =>
    new RegExp(`\\b${name}\\b\\s*(?:>|>=|!=|<=|<)\\s*[01]\\b|\\b[01]\\s*(?:<|<=|!=|>)\\s*\\b${name}\\b`).test(after.slice(0, SANITY_AFTER));

  const tuple = /^([ \t]*)\(([^;()]*)\)\s*=\s*[^;]*?\blatestRoundData\s*\(\s*\)\s*;/gm;
  for (const m of text.matchAll(tuple)) {
    const names = m[2]!.split(",").map((s) => s.trim().split(/\s+/).pop() ?? "");
    const answer = names[1] ?? "";
    if (!/^[A-Za-z_]\w*$/.test(answer)) return { ok: false, reason: "the oracle answer is not bound to a named variable, so a check cannot be placed deterministically" };
    const end = m.index! + m[0].length;
    const after = text.slice(end);
    const lines: string[] = [];
    if (!checked(answer, after)) lines.push(`require(${answer} > 0, "Pramaan: oracle answer is not positive");`);
    const updated = names[3] ?? "";
    if (/^[A-Za-z_]\w*$/.test(updated) && !new RegExp(`block\\.timestamp\\s*-\\s*${updated}`).test(after.slice(0, SANITY_AFTER))) {
      lines.push(`require(block.timestamp - ${updated} <= 1 days, "Pramaan: oracle answer is stale");`);
      stale = true;
    }
    if (lines.length) edits.push({ at: end, insert: lines.map((l) => `\n${m[1]}${l}`).join("") });
  }
  const single = /^([ \t]*)(?:u?int256)\s+(\w+)\s*=\s*[^;]*?\blatestAnswer\s*\(\s*\)\s*;/gm;
  for (const m of text.matchAll(single)) {
    const end = m.index! + m[0].length;
    if (!checked(m[2]!, text.slice(end))) edits.push({ at: end, insert: `\n${m[1]}require(${m[2]} > 0, "Pramaan: oracle answer is not positive");` });
  }
  if (edits.length === 0) return { ok: false, reason: "no unchecked latestRoundData()/latestAnswer() read in a form the deterministic fixer understands" };
  let out = text;
  for (const e of edits.sort((a, b) => b.at - a.at)) out = out.slice(0, e.at) + e.insert + out.slice(e.at);
  return { ok: true, text: out, stale };
}

const has = (c: ContractInfo, re: RegExp) => c.bases.some((b) => re.test(b));
const abiHas = (c: ContractInfo, name: string) => c.abi.some((e) => e.type === "function" && e.name === name);

/**
 * Deterministic remediations for the classes Pramaan has templates for. The patch is only a proposal: it is
 * re-verified in the sandbox (exploit must fail, regression suite must pass) and then needs a human to merge it.
 */
export function proposeFix(repoDir: string, contract: ContractInfo, fn: ContractFunction, vulnClass: VulnClass): FixResult {
  const file = contract.source;
  let original: Buffer;
  try {
    original = readFileSync(join(repoDir, file));
  } catch {
    return { ok: false, reason: `cannot read ${file}` };
  }
  // Compiler offsets refer to the exact bytes analyzed, including line endings.
  const { start, bodyStart } = fn.src;
  const header = bodyStart === null ? "" : original.subarray(start, bodyStart).toString("utf8");
  if (start < 0 || bodyStart === null || bodyStart <= start || bodyStart >= original.length ||
      original[bodyStart] !== 0x7b || !new RegExp(`^function\\s+${fn.name}\\s*\\(`).test(header)) {
    return { ok: false, reason: `source span for ${fn.name}() does not match the analyzed bytes; re-run analysis` };
  }
  let patched: Buffer | null = null;
  let change = "";
  let explanation = "";

  if (vulnClass === "access-control") {
    if (has(contract, /^Ownable(Upgradeable|2Step|2StepUpgradeable)?$/)) {
      patched = addModifier(original, fn, "onlyOwner");
      change = `add onlyOwner to ${fn.name}()`;
      explanation = `${contract.name}.${fn.name}() moves funds without checking msg.sender. It inherits Ownable, so restricting it with onlyOwner makes it the owner-only emergency function it was meant to be.`;
    } else if (has(contract, /^AccessControl(Upgradeable)?$/)) {
      patched = addModifier(original, fn, "onlyRole(DEFAULT_ADMIN_ROLE)");
      change = `add onlyRole(DEFAULT_ADMIN_ROLE) to ${fn.name}()`;
      explanation = `${contract.name}.${fn.name}() moves funds without a role check; it now requires the admin role.`;
    } else if (abiHas(contract, "owner")) {
      patched = addRequireAtBodyStart(original, fn, `require(msg.sender == this.owner(), "caller is not the owner");`);
      change = `require msg.sender == owner() in ${fn.name}()`;
      explanation = `${contract.name}.${fn.name}() moves funds without checking msg.sender; it now requires the owner.`;
    } else {
      return { ok: false, reason: `${contract.name} has no Ownable/AccessControl/owner() to restrict ${fn.name}() with` };
    }
  } else if (vulnClass === "reentrancy") {
    if (!has(contract, /^ReentrancyGuard(Upgradeable|Transient)?$/)) {
      return { ok: false, reason: `${contract.name} does not inherit ReentrancyGuard; reorder state updates before the call (checks-effects-interactions) or add the guard` };
    }
    patched = addModifier(original, fn, "nonReentrant");
    change = `add nonReentrant to ${fn.name}()`;
    explanation = `${contract.name}.${fn.name}() sends ETH before its bookkeeping is final, so it can be re-entered. nonReentrant blocks the nested call.`;
  } else if (vulnClass === "unprotected-initializer") {
    if (has(contract, /^Initializable$/)) {
      patched = addModifier(original, fn, "initializer");
      change = `add initializer to ${fn.name}()`;
      explanation = `${contract.name}.${fn.name}() could be called again to take ownership. The initializer modifier makes it callable once.`;
    } else if (abiHas(contract, "owner")) {
      patched = addRequireAtBodyStart(original, fn, `require(this.owner() == address(0), "already initialized");`);
      change = `allow ${fn.name}() only while no owner is set`;
      explanation = `${contract.name}.${fn.name}() could be called again to take ownership. It now refuses to run once an owner exists.`;
    } else {
      return { ok: false, reason: `no initializer guard available for ${contract.name}` };
    }
  } else if (vulnClass === "unchecked-oracle") {
    const fixed = guardOracleReads(original.toString("utf8"));
    if (!fixed.ok) return { ok: false, reason: fixed.reason };
    patched = Buffer.from(fixed.text, "utf8");
    change = `require a positive${fixed.stale ? " and fresh" : ""} oracle answer in ${contract.name}`;
    explanation = `${contract.name}.${fn.name}() reads the price feed and uses the answer as an unsigned price without checking it. A non-positive answer (an invalid round) is cast to an enormous uint256, which makes any account look massively over-collateralised. The patch rejects non-positive answers${fixed.stale ? " and answers older than one day (adjust to the feed's heartbeat)" : ""}.`;
  } else {
    return { ok: false, reason: `no deterministic fix for class "${vulnClass}"` };
  }
  if (!patched) return { ok: false, reason: `could not place the change in ${fn.name}() (already present or no body)` };
  const before = original.toString("utf8");
  const after = patched.toString("utf8");
  return {
    ok: true,
    fix: {
      generator: "deterministic",
      file,
      before,
      after,
      diff: createTwoFilesPatch(`a/${file}`, `b/${file}`, before, after, "", "", { context: 3 }),
      explanation,
      change,
    },
  };
}

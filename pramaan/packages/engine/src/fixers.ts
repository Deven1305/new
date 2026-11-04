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

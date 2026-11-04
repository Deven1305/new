import { SLOT_EXPRESSION, type ExploitPlan } from "./templates.js";

export interface Gate {
  id: string;
  passed: boolean;
  detail: string;
}

const FORBIDDEN_CHEATCODES = /\bvm\s*\.\s*(store|etch|mockCall|mockCallRevert|mockFunction|ffi|readFile|writeFile|setEnv|envOr|loadAllocs|copyStorage|setNonce|allowCheatcodes)\s*\(/;
const FORBIDDEN_DEAL_TO_TARGET = /\b(vm\s*\.\s*)?deal\s*\(\s*address\s*\(\s*target\s*\)/;

/** Extracts the body of `function <name>(...) ... { ... }` with brace matching (comments and strings are rare here). */
export function functionBody(source: string, name: string): string | null {
  const m = new RegExp(`function\\s+${name}\\s*\\(`).exec(source);
  if (!m) return null;
  const open = source.indexOf("{", m.index);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  return null;
}

/**
 * Static gates that must hold before a test result may count as proof (research, Deliverable 7):
 *   G1 slot values come from the allowed vocabulary (no injected code)
 *   G2 the attack phase uses no state-forging cheatcodes (vm.store/etch/mockCall/deal on the target, ffi, ...)
 *   G3 the attack phase acts only as the attacker (no owner prank)
 *   G4 the test asserts a concrete state change (balance or owner)
 * Two runtime gates follow from execution: passes on vulnerable code, fails as expected on fixed code. The last
 * gate, human review, is recorded separately and never set by Pramaan itself.
 */
export function staticGates(plan: ExploitPlan, source: string): Gate[] {
  const slots = [...plan.deploy.ctorArgs, ...(plan.deploy.initializer?.args ?? []), plan.fund.valueExpr, ...plan.attack.args, ...(plan.drain?.args ?? [])];
  const badSlot = slots.find((s) => !SLOT_EXPRESSION.test(s));
  const identifiers = [plan.attack.fn, plan.drain?.fn, plan.fund.fn, plan.deploy.initializer?.name].filter(Boolean) as string[];
  const badIdent = identifiers.find((i) => !/^[A-Za-z_$][\w$]{0,63}$/.test(i));
  const body = functionBody(source, "test_exploit") ?? "";
  const pranks = [...body.matchAll(/vm\s*\.\s*(?:startPrank|prank)\s*\(\s*([^),]+)/g)].map((m) => m[1]!.trim());
  const assertion = /\bassert(Ge|Gt|Eq)\s*\(\s*(gained|attacker\.balance|address\(exploit\)\.balance|target\.owner\(\))/.test(body);
  return [
    { id: "slot-vocabulary", passed: !badSlot && !badIdent, detail: badSlot ? `slot "${badSlot}" is not allowed` : badIdent ? `identifier "${badIdent}" is not allowed` : `${slots.length} slot values from the allowed vocabulary` },
    {
      id: "no-state-forging",
      passed: !FORBIDDEN_CHEATCODES.test(body) && !FORBIDDEN_DEAL_TO_TARGET.test(body),
      detail: "attack phase uses no vm.store / etch / mockCall / deal(target) / ffi",
    },
    {
      id: "attacker-only",
      passed: pranks.length > 0 && pranks.every((p) => p === "attacker"),
      detail: pranks.length ? `pranks: ${pranks.join(", ")}` : "attack phase never acts as the attacker",
    },
    { id: "concrete-assertion", passed: assertion, detail: assertion ? "asserts an attacker balance or owner change" : "no concrete state assertion" },
  ];
}

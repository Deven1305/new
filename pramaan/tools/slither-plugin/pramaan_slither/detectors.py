import re

from slither.core.declarations import Function
from slither.detectors.abstract_detector import AbstractDetector, DetectorClassification

_SWEEP_PATTERNS = (
    re.compile(r"address\s*\(\s*this\s*\)\s*\.\s*balance"),
    re.compile(r"\.balanceOf\s*\(\s*address\s*\(\s*this\s*\)\s*\)"),
)
_INITIALIZER_NAME = re.compile(r"^_?_?(initiali[sz]e|init|setup|configure)(V\d+)?$", re.IGNORECASE)
_PRIVILEGED_VAR = re.compile(r"owner|admin|governance|governor|operator|guardian|manager|authority", re.IGNORECASE)
_INIT_FLAG = re.compile(r"initiali[sz]ed|initiali[sz]ing", re.IGNORECASE)
_GUARD_MODIFIERS = re.compile(r"^(initializer|reinitializer|onlyInitializing|onlyOwner|onlyRole|onlyAdmin|auth|requiresAuth)$")


def _is_entry_point(function: Function) -> bool:
    return (
        function.visibility in ("public", "external")
        and not function.is_constructor
        and not function.view
        and not function.pure
        and not function.is_fallback
        and not function.is_receive
    )


def _source(function: Function) -> str:
    try:
        return function.source_mapping.content or ""
    except Exception:  # pragma: no cover - source unavailable
        return ""


def _transfers_tokens(function: Function) -> bool:
    for call in function.all_high_level_calls():
        called = call[1] if isinstance(call, tuple) else getattr(call, "function", None)
        name = getattr(called, "name", "") or ""
        if name in ("transfer", "safeTransfer", "transferFrom", "safeTransferFrom"):
            return True
    return False


class PramaanUnprotectedSweep(AbstractDetector):
    ARGUMENT = "pramaan-unprotected-sweep"
    HELP = "Public function moves the contract's entire balance without access control"
    IMPACT = DetectorClassification.HIGH
    CONFIDENCE = DetectorClassification.MEDIUM

    WIKI = "https://github.com/pramaan-dev/pramaan/blob/main/docs/SECURITY.md#detectors"
    WIKI_TITLE = "Unprotected balance sweep"
    WIKI_DESCRIPTION = (
        "A public or external function sends the contract's whole ETH or token balance and checks nothing about "
        "msg.sender. Any account can call it and take every depositor's funds."
    )
    WIKI_EXPLOIT_SCENARIO = (
        "`withdrawAll()` was written as an owner-only emergency sweep but has no `onlyOwner`. An attacker calls it "
        "and receives every depositor's ETH."
    )
    WIKI_RECOMMENDATION = "Restrict the function (e.g. `onlyOwner`) or pay only the caller's own recorded balance."

    def _detect(self):
        results = []
        for contract in self.compilation_unit.contracts_derived:
            if contract.is_interface or contract.is_library:
                continue
            for function in contract.functions:
                if function.contract_declarer != contract or not _is_entry_point(function):
                    continue
                source = _source(function)
                if not any(p.search(source) for p in _SWEEP_PATTERNS):
                    continue
                if not (function.can_send_eth() or _transfers_tokens(function)):
                    continue
                if function.is_protected():
                    continue
                info = [function, " moves the contract's entire balance and does not restrict msg.sender\n"]
                results.append(self.generate_result(info))
        return results


class PramaanUnprotectedInitializer(AbstractDetector):
    ARGUMENT = "pramaan-unprotected-initializer"
    HELP = "Initializer that sets privileged state can be called again by anyone"
    IMPACT = DetectorClassification.HIGH
    CONFIDENCE = DetectorClassification.MEDIUM

    WIKI = "https://github.com/pramaan-dev/pramaan/blob/main/docs/SECURITY.md#detectors"
    WIKI_TITLE = "Unprotected initializer"
    WIKI_DESCRIPTION = (
        "An initialize-style function writes an owner/admin variable without an `initializer` guard, an "
        "initialized flag or an access check, so it can be called again after deployment."
    )
    WIKI_EXPLOIT_SCENARIO = "An attacker calls `initialize(attacker)` and becomes the owner of a live contract."
    WIKI_RECOMMENDATION = "Use OpenZeppelin `Initializable` (`initializer` modifier) or check an initialized flag."

    def _detect(self):
        results = []
        for contract in self.compilation_unit.contracts_derived:
            if contract.is_interface or contract.is_library:
                continue
            for function in contract.functions:
                if function.contract_declarer != contract or not _is_entry_point(function):
                    continue
                if not _INITIALIZER_NAME.match(function.name):
                    continue
                if any(_GUARD_MODIFIERS.match(m.name) for m in function.modifiers):
                    continue
                if function.is_protected():
                    continue
                written = [v.name for v in function.all_state_variables_written()]
                if not any(_PRIVILEGED_VAR.search(name) for name in written):
                    continue
                guarded = [v.name for v in function.all_conditional_state_variables_read()]
                if any(_INIT_FLAG.search(name) for name in guarded):
                    continue
                info = [function, " writes privileged state and can be called again by anyone\n"]
                results.append(self.generate_result(info))
        return results


_ORACLE_CALLS = ("latestRoundData", "latestAnswer")
_ORACLE_TUPLE = re.compile(r"\(([^;()]*)\)\s*=\s*[^;]*?\blatestRoundData\s*\(\s*\)\s*;")
_ORACLE_SINGLE = re.compile(r"\bu?int256\s+(\w+)\s*=\s*[^;]*?\blatestAnswer\s*\(\s*\)\s*;")


def _call_name(call) -> str:
    """Name of the function a high-level call IR targets (Slither versions expose it as .function or .function_name)."""
    called = call[1] if isinstance(call, tuple) else call
    fn = getattr(called, "function", None)
    name = getattr(fn, "name", None)
    if not name:
        raw = getattr(called, "function_name", None)
        name = getattr(raw, "value", raw)
    return str(name or "")


def _reads_oracle(function: Function) -> bool:
    # direct calls only: all_high_level_calls() is transitive and would make every caller of a price helper a "reader"
    return any(_call_name(call) in _ORACLE_CALLS for call in function.high_level_calls)


def _internal_callees(function: Function):
    out = []
    for call in function.all_internal_calls():
        target = getattr(call, "function", call)
        if isinstance(target, Function) and target not in out:
            out.append(target)
    return out


def _answer_variables(source: str):
    """Names the price answer is bound to; an empty string means it is used inline and so can never be checked."""
    names = []
    for m in _ORACLE_TUPLE.finditer(source):
        parts = [p.strip().split()[-1] if p.strip() else "" for p in m.group(1).split(",")]
        names.append(parts[1] if len(parts) > 1 else "")
    for m in _ORACLE_SINGLE.finditer(source):
        names.append(m.group(1))
    return names


def _is_checked(name: str, source: str) -> bool:
    if not name:
        return False
    n = re.escape(name)
    return bool(re.search(r"\b%s\b\s*(?:>|>=|!=|<=|<)\s*[01]\b|\b[01]\s*(?:<|<=|!=|>)\s*\b%s\b" % (n, n), source))


class PramaanUncheckedOracle(AbstractDetector):
    ARGUMENT = "pramaan-unchecked-oracle"
    HELP = "Price feed answer is used without checking that it is positive"
    IMPACT = DetectorClassification.HIGH
    CONFIDENCE = DetectorClassification.MEDIUM

    WIKI = "https://github.com/pramaan-dev/pramaan/blob/main/docs/SECURITY.md#detectors"
    WIKI_TITLE = "Unchecked oracle answer"
    WIKI_DESCRIPTION = (
        "A state-changing function reads `latestRoundData()` / `latestAnswer()` and converts the signed answer to "
        "`uint256` without requiring it to be positive. An invalid round returns a non-positive number, which the "
        "cast turns into an enormous price."
    )
    WIKI_EXPLOIT_SCENARIO = (
        "A feed reports -1 during an incident. `uint256(answer)` becomes 2**256-1 and a borrower with 1 wei of "
        "collateral can borrow the whole pool."
    )
    WIKI_RECOMMENDATION = "Require `answer > 0` and a recent `updatedAt` before using the price."

    def _detect(self):
        results = []
        for contract in self.compilation_unit.contracts_derived:
            if contract.is_interface or contract.is_library:
                continue
            for function in contract.functions:
                if function.contract_declarer != contract or not _is_entry_point(function):
                    continue
                reachable = [function] + _internal_callees(function)
                readers = [f for f in reachable if _reads_oracle(f)]
                if not readers:
                    continue
                combined = "\n".join(_source(f) for f in reachable)
                answers = []
                for f in readers:
                    answers.extend(_answer_variables(_source(f)) or [""])
                if answers and all(_is_checked(a, combined) for a in answers):
                    continue
                info = [function, " uses a price feed answer without requiring it to be positive\n"]
                results.append(self.generate_result(info))
        return results

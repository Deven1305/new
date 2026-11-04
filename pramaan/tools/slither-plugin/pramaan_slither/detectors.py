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

"""Pramaan's Slither plugin.

Slither ships no generic "missing access control" detector. `arbitrary-send-eth` covers unprotected ETH transfers
only, so an unprotected sweep of a contract's *token* balance, or a re-callable initializer that hands out ownership,
needs these extra detectors. They produce *candidates* only: Pramaan reports a vulnerability only after a Foundry
exploit test reproduces it.
"""

from .detectors import PramaanUncheckedOracle, PramaanUnprotectedInitializer, PramaanUnprotectedSweep


def make_plugin():
    return [PramaanUnprotectedSweep, PramaanUnprotectedInitializer, PramaanUncheckedOracle], []

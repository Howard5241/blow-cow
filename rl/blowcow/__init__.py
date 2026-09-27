"""Vanilla Blow Cow, as a headless simulator and RL environment.

Vanilla means characters off, no action ranks, no statuses, and every rule card active. `RULES.md` is
the source of truth for the rules themselves; `src/game/blowCowGame.ts` is the source of truth for
their behaviour, `rl/conformance.py` is what holds the simulator to it, and `rl/check_env.py` is what
holds the encoding to the simulator.

The simulator half needs no third-party packages at all, which is why the numpy-backed half is
re-exported lazily below rather than imported here — ``python rl/conformance.py`` runs on a bare
interpreter, and it should stay that way.
"""

from __future__ import annotations

import importlib
from typing import Any

from .actions import ACTION_KINDS, Action
from .canonical import JOKER_TYPE, NUM_CARD_TYPES, NUM_RANK_SLOTS, RankMapping
from .cards import RANKS, Deck, build_deck, get_default_standard_rank_count, get_max_cards_on_table
from .engine import BlowCowEngine, InvalidMove, LegalParts
from .projection import diff, project
from .spaces import NUM_ACTIONS, decompose, describe

#: Names served from modules that import numpy (or torch). Resolved on first access.
_LAZY = {
    "ActionTable": "bridge",
    "CanonicalTable": "bridge",
    "BlowCowEnv": "env",
    "DEFAULT_PLAYER_COUNTS": "env",
    "RewardConfig": "env",
    "TimeStep": "env",
    "MAX_SEATS": "observation",
    "OBSERVATION_SIZE": "observation",
    "encode": "observation",
    "feature_names": "observation",
    "BASELINES": "agents",
    "Decision": "agents",
    "PolicyAgent": "agents",
    "make_agent": "agents",
    "BlowCowNet": "nets",
    "RNAD_DEFAULTS": "rnad",
    "RNaDConfig": "rnad",
    "neurd_policy_loss": "rnad",
    "regularisation_shares": "rnad",
}


def __getattr__(name: str) -> Any:
    module_name = _LAZY.get(name)
    if module_name is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    return getattr(importlib.import_module(f".{module_name}", __name__), name)


__all__ = [
    "ACTION_KINDS",
    "BASELINES",
    "Action",
    "ActionTable",
    "BlowCowEngine",
    "BlowCowEnv",
    "BlowCowNet",
    "CanonicalTable",
    "Decision",
    "PolicyAgent",
    "RNAD_DEFAULTS",
    "RNaDConfig",
    "make_agent",
    "DEFAULT_PLAYER_COUNTS",
    "Deck",
    "InvalidMove",
    "JOKER_TYPE",
    "LegalParts",
    "MAX_SEATS",
    "NUM_ACTIONS",
    "NUM_CARD_TYPES",
    "NUM_RANK_SLOTS",
    "OBSERVATION_SIZE",
    "RANKS",
    "RankMapping",
    "RewardConfig",
    "TimeStep",
    "build_deck",
    "decompose",
    "describe",
    "diff",
    "encode",
    "feature_names",
    "get_default_standard_rank_count",
    "get_max_cards_on_table",
    "neurd_policy_loss",
    "project",
    "regularisation_shares",
]

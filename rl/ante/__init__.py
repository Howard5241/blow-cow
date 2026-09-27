"""Reinforcement learning for **one Ante Mode round**.

`RULES-ANTE.md` is the source of truth for the rules; this package is a transcription of them and
never an authority over one. It is deliberately separate from `rl/blowcow/`, which transcribes the
classic game: Ante drops characters, rule cards, statuses, action ranks, cheating, points, the table
limit and `Call Reset`, so almost nothing in that package would have survived the trip.

The numpy-backed half is re-exported lazily so that importing this package on a bare interpreter
still works — :mod:`ante.game` has no third-party dependencies by design, exactly as Stage A of the
classic work does.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .config import AnteConfig, DEFAULT_CONFIG
from .game import (
    ACTION_CALL_BS,
    ACTION_PASS,
    ENDING_ALL_PASS,
    ENDING_BS,
    ENDING_EMPTY_HAND,
    AnteRound,
    Play,
    lie_probability_from_counts,
)
from .spaces import ActionSpace

if TYPE_CHECKING:  # pragma: no cover - import-time typing only
    from .env import AnteEnv, Decision
    from .observation import ObservationEncoder

_LAZY = {
    "AnteEnv": ("ante.env", "AnteEnv"),
    "Decision": ("ante.env", "Decision"),
    "ObservationEncoder": ("ante.observation", "ObservationEncoder"),
}


def __getattr__(name: str) -> Any:
    """Import the numpy-backed modules only when something actually asks for them."""
    target = _LAZY.get(name)
    if target is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

    import importlib

    return getattr(importlib.import_module(target[0]), target[1])


__all__ = [
    "ACTION_CALL_BS",
    "ACTION_PASS",
    "ENDING_ALL_PASS",
    "ENDING_BS",
    "ENDING_EMPTY_HAND",
    "ActionSpace",
    "AnteConfig",
    "AnteEnv",
    "AnteRound",
    "DEFAULT_CONFIG",
    "Decision",
    "ObservationEncoder",
    "Play",
    "lie_probability_from_counts",
]

"""The decision space.

Vanilla Blow Cow has exactly five actions, and only one of them carries a choice beyond its own
name. `Call BS` has no target to pick — the rules fix it as the previous non-passing player — and
`Call Reset` and `Pass` take nothing at all. Everything else the client presses (Take Turn, the
Reveal Rule's flips, the BS and Reset reveal walks) is forced, and is driven by
:meth:`BlowCowEngine.forced_move` rather than offered to a policy.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional, Tuple

#: Every action kind, in a stable order. A policy head can index into this.
ACTION_KINDS: Tuple[str, ...] = ("play", "trumpPlay", "pass", "callBS", "callReset")


@dataclass(frozen=True, slots=True)
class Action:
    kind: str
    trump_rank: Optional[str] = None
    cards: Tuple[int, ...] = ()

    def to_move(self) -> Tuple[str, Dict[str, object]]:
        """The engine move this action dispatches to, with the real engine's argument names."""
        if self.kind == "play":
            return "play", {"cardIDs": list(self.cards)}
        if self.kind == "trumpPlay":
            return "selectTrumpAndPlay", {
                "trumpRank": self.trump_rank,
                "cardIDs": list(self.cards),
            }
        if self.kind == "pass":
            return "pass", {}
        if self.kind == "callBS":
            return "callBS", {}
        if self.kind == "callReset":
            return "callReset", {}
        raise ValueError(f"Unknown action kind: {self.kind}")

    def __str__(self) -> str:
        if self.kind == "trumpPlay":
            return f"trumpPlay({self.trump_rank}, {list(self.cards)})"
        if self.kind == "play":
            return f"play({list(self.cards)})"
        return self.kind

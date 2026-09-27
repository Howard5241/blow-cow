"""The shape of the subgame: how many seats, and how many standard ranks are in the deck.

Kept in its own module because three things are derived from it and must agree — the simulator's
deck, the flat action space, and the observation width. A network is built for one config and cannot
be moved to another, so the config is what a checkpoint is stamped with.

The default is the sub-task this package was built for: **one round, five players**. Ante's own rank
table (`RULES-ANTE.md`) gives five players seven standard ranks, so the deck is 30 cards and every
seat holds six.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

#: The thirteen standard ranks the real game draws from. Only the *count* matters here — rank
#: identity carries no information in Blow Cow, so the simulator numbers its ranks `0..R-1` and the
#: conformance harness is what maps them onto `2..A`.
TOTAL_STANDARD_RANKS = 13

#: Copies of each standard rank in the pool, and of the Joker. One deck plus two Jokers.
COPIES_PER_RANK = 4
JOKER_COPIES = 2

#: How many recent public events the observation shows, unless a config says otherwise. Every
#: checkpoint in `rl/runs/` was trained at this, and it is the width `src/bots/ante/anteObservation.ts`
#: ports, so it is the default rather than merely the current value.
DEFAULT_RECENT_EVENTS = 8


def lap_events(num_players: int) -> int:
    """A window that actually covers what `ante/observation.py` claims it does.

    The event block's size was fixed at 8 and its comment reads "long enough to cover a lap of the
    table plus the reveals inside it" — which was written at five seats and is false above them. A lap
    is `n` plays, and the Reveal Rule turns each seat's previous play face up at the start of its next
    turn, so a lap generates about `2n` events. At seven and eight seats 8 events is under half a lap,
    and those are exactly the counts where `rl/ANTE.md`'s rollout shipped nothing.

    Floored at the default so no seat count loses coverage relative to what shipped: 2-4 seats are
    unchanged, and 5 through 8 widen to 10, 12, 14 and 16.
    """
    return max(DEFAULT_RECENT_EVENTS, 2 * num_players)


def standard_rank_count(num_players: int) -> int:
    """Ante's rank table, keyed on the number of players **currently** in the game.

    A transcription of `getAnteStandardRankCount` in `src/game/blowCowAnte.ts`. A single round never
    eliminates anybody, so for this package `n` is fixed for the whole episode.
    """
    if num_players <= 2:
        return 3
    if num_players == 3:
        return 4
    if num_players == 4:
        return 6
    if num_players in (5, 6):
        return 7
    if num_players == 7:
        return 10
    return 12


@dataclass(frozen=True)
class AnteConfig:
    """Everything the deck, the action space and the observation width are derived from."""

    num_players: int = 5
    num_ranks: int = 7
    #: The event window. Defaulted rather than derived so every existing checkpoint keeps the width it
    #: was trained at; `lap_events` is the opt-in that scales it with the table.
    recent_events: int = DEFAULT_RECENT_EVENTS

    @classmethod
    def for_players(cls, num_players: int, recent_events: Optional[int] = None) -> "AnteConfig":
        return cls(
            num_players=num_players,
            num_ranks=standard_rank_count(num_players),
            recent_events=DEFAULT_RECENT_EVENTS if recent_events is None else recent_events,
        )

    def __post_init__(self) -> None:
        if not 2 <= self.num_players <= 8:
            raise ValueError(f"Ante seats 2 to 8 players, not {self.num_players}")
        if not 1 <= self.num_ranks <= TOTAL_STANDARD_RANKS:
            raise ValueError(f"A deck holds 1 to 13 standard ranks, not {self.num_ranks}")
        if not 1 <= self.recent_events <= 64:
            raise ValueError(f"The event window is 1 to 64 events, not {self.recent_events}")

    # -- the deck ----------------------------------------------------------------

    @property
    def joker_type(self) -> int:
        """Card types are `0..R-1` for the standard ranks and `R` for the Joker."""
        return self.num_ranks

    @property
    def num_types(self) -> int:
        return self.num_ranks + 1

    @property
    def deck_size(self) -> int:
        return COPIES_PER_RANK * self.num_ranks + JOKER_COPIES

    @property
    def copies(self) -> tuple[int, ...]:
        return tuple([COPIES_PER_RANK] * self.num_ranks + [JOKER_COPIES])

    @property
    def hand_size(self) -> int:
        """The smallest hand dealt. Only 4 and 8 players fail to divide, and both leave 2 over."""
        return self.deck_size // self.num_players

    # -- trump -------------------------------------------------------------------

    @property
    def has_off_deck_trump(self) -> bool:
        """Whether naming a rank that is not in the deck is a distinct option at all."""
        return self.num_ranks < TOTAL_STANDARD_RANKS

    @property
    def off_deck_trump(self) -> int:
        """The single representative of every standard rank the deck does not contain.

        All `13 - R` of them are the same move — every play of the round becomes a lie unless it is a
        Joker, and the Reverse Rule can never arm because no card of that rank exists. Offering each
        one separately would split a policy's probability across identical actions, which is the same
        collapse `rl/blowcow/spaces.py` makes for the classic game.
        """
        return self.num_ranks

    @property
    def num_trump_slots(self) -> int:
        return self.num_ranks + (1 if self.has_off_deck_trump else 0)


DEFAULT_CONFIG = AnteConfig()

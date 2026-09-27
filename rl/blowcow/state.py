"""State records for the vanilla simulator.

Each one mirrors a type in ``src/game/blowCowGame.ts`` with the character, status, cheat, action-rank
and rule-card fields dropped — vanilla never writes them, and a field nothing can set is a field that
can silently disagree with the engine. Where a name differs from the TypeScript one it is only the
snake_case of it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set


@dataclass(slots=True)
class ScoredSet:
    """A four-of-a-kind that has left a hand. Points are a penalty: fewest points wins."""

    id: str
    rank: str
    cards: List[int]


@dataclass(slots=True)
class Play:
    """One player's cards on the table. Face down until the Reveal Rule turns them over."""

    id: str
    player_id: str
    cards: List[int]
    declared_card_count: int
    revealed_card_ids: Set[int]
    claimed_rank: Optional[str]
    played_at_round: int
    played_at_turn: int
    revealed_at_turn: Optional[int]
    was_trump_selection: bool


@dataclass(slots=True)
class Player:
    id: str
    seat_index: int
    hand: List[int] = field(default_factory=list)
    points: int = 0
    scored_sets: List[ScoredSet] = field(default_factory=list)
    pending_reveal_play_id: Optional[str] = None
    has_left: bool = False
    leave_order: Optional[int] = None


@dataclass(slots=True)
class RoundState:
    round_number: int = 1
    status: str = "awaitingTrumpSelection"
    direction: str = "counterclockwise"
    starting_player_id: str = "0"
    trump_rank: Optional[str] = None
    previous_trump_rank: Optional[str] = None
    pass_streak: int = 0
    last_non_passing_player_id: Optional[str] = None
    max_cards_on_table: int = 10
    started_turn_number: Optional[int] = None


@dataclass(slots=True)
class TurnReveal:
    """Exactly the cards this turn owes the table, fixed at the moment Take Turn is pressed."""

    play_id: str
    card_ids: List[int]
    is_full_reveal: bool


@dataclass(slots=True)
class TurnOpening:
    id: str
    player_id: str
    turn_number: int
    is_taken: bool
    reveal: Optional[TurnReveal]


@dataclass(slots=True)
class BSResolution:
    id: str
    caller_player_id: str
    target_player_id: str
    target_play_id: str
    target_declared_card_count: int
    trump_rank: str
    punishment_card_count: int
    reveal_order: List[str]
    reveal_step_index: int
    is_punishing: bool
    target_was_honest: bool
    reverse_rule_triggered: bool
    punished_player_id: str
    unpunished_player_id: str


@dataclass(slots=True)
class ResetResolution:
    id: str
    caller_player_id: str
    kind: str  # 'reset' | 'roundReturn'
    reveal_order: List[str]
    reveal_step_index: int


@dataclass(slots=True)
class GameOver:
    placements: List[str]
    winner_id: str
    points_by_player: Dict[str, int]


@dataclass(frozen=True, slots=True)
class PublicEvent:
    """Something every seat at the table saw happen.

    Frozen, unlike every other record here, because the trace is only ever appended to and
    truncated — no event is ever edited after the fact. That makes the events safe to share between
    an engine and its clones, which is what lets ``BlowCowEngine.clone`` copy the trace shallowly;
    a search clones the engine once per simulation, so copying 64 of these was measurable.

    Deliberately not the engine's history: that is prose, and this is the handful of facts a player
    could have watched. Nothing private is recorded — a play carries how many cards were put down and
    what rank was claimed, never what the cards were, and a reveal carries the cards precisely
    because the Reveal Rule turned them face up for everyone.
    """

    kind: str  # play | pass | callBS | callReset | reveal | bsVerdict | roundReturn | leave
    player_id: str
    round_number: int
    turn_number: int
    card_count: int = 0
    claimed_rank: Optional[str] = None
    target_player_id: Optional[str] = None
    punished_player_id: Optional[str] = None
    was_honest: Optional[bool] = None
    was_trump_selection: bool = False

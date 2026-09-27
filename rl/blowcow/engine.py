"""The vanilla Blow Cow simulator.

Vanilla means: no characters, no action ranks, no statuses, every rule card active, and therefore no
cheats — ``canCheat`` in the real engine is ``isDreamer(...) || isRuleRemoved(state, 'noCheating')``
and both halves are false here. What survives is a small game: five actions, one of which carries a
card selection.

Every rule below is a transcription of ``src/game/blowCowGame.ts`` restricted to that subset, and
``rl/conformance.py`` holds it to the original move for move. `RULES.md` is the source of truth for
what the game does; this file is only allowed to disagree with it by being wrong.

Two framework behaviours are reproduced rather than transcribed, because the engine leans on
boardgame.io for them:

* ``events.endTurn`` is queued during a move and processed afterwards — ``turn.onEnd`` for the seat
  leaving, then the turn counter, then ``turn.onBegin`` for the seat arriving. ``onBegin`` can queue
  another hand-over (a player who starts a turn with no cards leaves and passes it straight on), so
  draining is a loop.
* An ``INVALID_MOVE`` return discards the whole move, queued events included.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

from .actions import Action
from .cards import (
    JOKER,
    RANKS,
    Deck,
    build_deck,
    get_default_standard_rank_count,
    get_max_cards_on_table,
)
from .rng import Shuffle, make_seeded_shuffle
from .state import (
    BSResolution,
    GameOver,
    Play,
    Player,
    PublicEvent,
    ResetResolution,
    RoundState,
    ScoredSet,
    TurnOpening,
    TurnReveal,
)

INVALID = "INVALID_MOVE"

_BIG = 2**53 - 1

#: How much of the public event trace is kept. The observation encoder reads the last handful; the
#: rest is there for logging and analysis.
MAX_PUBLIC_EVENTS = 64


@dataclass(frozen=True, slots=True)
class LegalParts:
    """The legal action space without taking its cross product. See ``legal_action_parts``."""

    player_id: str
    can_pass: bool
    can_call_bs: bool
    can_call_reset: bool
    #: Concrete card selections, one per distinct rank multiset the hand can send.
    card_choices: Tuple[Tuple[int, ...], ...]
    #: Selectable trump ranks. Empty unless ``trump_required``.
    trump_ranks: Tuple[str, ...]
    #: True when the round has no trump yet, so every play must name one.
    trump_required: bool


def _copy_record(value):
    """A deep copy of one record from ``state.py``, specialised to the shapes that file uses.

    ``copy.deepcopy`` is general enough to cost three times what this does: it threads an identity
    memo, keeps a reverse-reference list alive, and dispatches through ``__reduce_ex__`` for every
    slots dataclass it meets. None of that is needed for these records, which form a plain tree of
    lists, sets and dicts whose leaves are all immutable.

    Driven off ``__slots__`` rather than a per-class field list, so a field added to a record in
    ``state.py`` is copied without anyone having to remember this function exists. A frozen record
    is shared rather than rebuilt, which is both faster and the only thing ``setattr`` would allow.
    """
    kind = type(value)
    if kind is list:
        return [_copy_record(item) for item in value]
    if kind is dict:
        return {key: _copy_record(item) for key, item in value.items()}
    if kind is set:
        return set(value)  # only `Set[int]` occurs
    slots = getattr(kind, "__slots__", None)
    if slots is None or getattr(kind, "__dataclass_params__", None) is None:
        return value  # str, int, bool, float, None
    if kind.__dataclass_params__.frozen:
        return value
    clone = kind.__new__(kind)
    for name in slots:
        setattr(clone, name, _copy_record(getattr(value, name)))
    return clone


def _toggle_direction(direction: str) -> str:
    return "clockwise" if direction == "counterclockwise" else "counterclockwise"


class InvalidMove(Exception):
    """Raised by :meth:`BlowCowEngine.apply_action` when a chosen action is refused."""


class BlowCowEngine:
    """One vanilla match. Server-authoritative in the same sense the real engine is: every move
    re-checks its own preconditions rather than trusting the caller's action mask."""

    def __init__(
        self,
        num_players: int,
        selected_ranks: Optional[Sequence[str]] = None,
        seed: int = 0,
        shuffle: Optional[Shuffle] = None,
    ) -> None:
        if not 2 <= num_players <= 8:
            raise ValueError("Blow Cow supports 2 to 8 players.")

        self.num_players = num_players
        if selected_ranks is None:
            selected_ranks = RANKS[: get_default_standard_rank_count(num_players)]
        self.deck: Deck = build_deck(selected_ranks)
        self.shuffle: Shuffle = shuffle if shuffle is not None else make_seeded_shuffle(seed)

        self.seat_order: List[str] = [str(index) for index in range(num_players)]
        self.host_player_id = self.seat_order[0]
        self.players: Dict[str, Player] = {
            player_id: Player(id=player_id, seat_index=index)
            for index, player_id in enumerate(self.seat_order)
        }
        self.round = RoundState(
            starting_player_id=self.host_player_id,
            max_cards_on_table=get_max_cards_on_table(num_players),
        )
        self.plays: List[Play] = []
        self.game_status = "staging"
        self.bs_resolution: Optional[BSResolution] = None
        self.reset_resolution: Optional[ResetResolution] = None
        self.turn_opening: Optional[TurnOpening] = None
        self.placements: List[str] = []
        self.gameover: Optional[GameOver] = None
        self.public_events: List[PublicEvent] = []

        self.ctx_turn = 1
        self.current_player = self.seat_order[0]
        self._pending_end_turns: List[Optional[str]] = []

        # boardgame.io opens turn 1 before any move is possible; the match is still staging, so this
        # is a no-op kept for faithfulness rather than effect.
        self._handle_turn_start()
        self.apply_move(self.host_player_id, "startMatch", {})

    # ----------------------------------------------------------- public trace

    def _record_event(self, kind: str, player_id: str, **fields: object) -> None:
        """Append to the public trace. Bounded, and read by nothing in the rules."""
        self.public_events.append(
            PublicEvent(
                kind=kind,
                player_id=player_id,
                round_number=self.round.round_number,
                turn_number=self.ctx_turn,
                **fields,  # type: ignore[arg-type]
            )
        )
        if len(self.public_events) > MAX_PUBLIC_EVENTS:
            del self.public_events[: len(self.public_events) - MAX_PUBLIC_EVENTS]

    # ------------------------------------------------------------------ cards

    def _sorted(self, cards: Sequence[int]) -> List[int]:
        return self.deck.sorted_cards(cards)

    def _is_trump(self, card: int, trump_rank: Optional[str]) -> bool:
        """``isTrumpCard`` with the Joker Rule in play: a Joker takes the trump rank."""
        if trump_rank is None:
            return False
        if self.deck.rank[card] == JOKER:
            return True
        return self.deck.rank[card] == trump_rank

    def _counts_toward_reverse_rule(self, card: int, trump_rank: Optional[str]) -> bool:
        """Jokers deliberately do not count, which is what stops a wild card reversing a punishment."""
        return trump_rank is not None and self.deck.rank[card] == trump_rank

    def score_hand(
        self,
        hand: Sequence[int],
        player_id: str,
        round_number: int,
        turn_number: int,
    ) -> Tuple[List[int], List[ScoredSet], int]:
        """``scoreHand``: every complete four-of-a-kind leaves the hand at once and costs a point.

        Eight matching cards therefore cost two. Jokers never count toward a set.
        """
        sorted_hand = self._sorted(hand)
        cards_by_rank: Dict[str, List[int]] = {}

        for card in sorted_hand:
            rank = self.deck.rank[card]
            if rank == JOKER:
                continue
            cards_by_rank.setdefault(rank, []).append(card)

        scored_card_ids: set[int] = set()
        scored_sets: List[ScoredSet] = []

        for rank in RANKS:
            matching = cards_by_rank.get(rank)
            if not matching:
                continue
            for set_index in range(len(matching) // 4):
                set_cards = matching[set_index * 4 : (set_index + 1) * 4]
                scored_card_ids.update(set_cards)
                scored_sets.append(
                    ScoredSet(
                        id=f"score-{player_id}-{round_number}-{turn_number}-{rank}-{set_index}",
                        rank=rank,
                        cards=set_cards,
                    )
                )

        remaining = [card for card in sorted_hand if card not in scored_card_ids]
        # Every standard rank awards a point; only action ranks are removed for free, and vanilla has
        # none. See `doesScoredSetAwardPoint`.
        return remaining, scored_sets, len(scored_sets)

    def _add_cards_to_hand(self, player_id: str, cards: Sequence[int], turn_number: int) -> None:
        if not cards:
            return
        player = self.players[player_id]
        remaining, scored_sets, points = self.score_hand(
            [*player.hand, *cards], player_id, self.round.round_number, turn_number
        )
        player.hand = remaining
        player.points += points
        player.scored_sets.extend(scored_sets)

    def _remove_cards_from_hand(self, player_id: str, card_ids: Sequence[int]) -> Optional[List[int]]:
        unique = list(dict.fromkeys(card_ids))
        if len(unique) != len(card_ids) or not unique:
            return None

        player = self.players[player_id]
        held = set(player.hand)
        if any(card not in held for card in unique):
            return None

        selected_set = set(unique)
        player.hand = [card for card in player.hand if card not in selected_set]
        return list(card_ids)

    # ------------------------------------------------------------------ table

    def _find_play(self, play_id: str) -> Optional[Play]:
        for play in self.plays:
            if play.id == play_id:
                return play
        return None

    def _is_card_face_up(self, play: Play, card_id: int) -> bool:
        return play.revealed_at_turn is not None or card_id in play.revealed_card_ids

    def _face_down_cards(self, play: Play) -> List[int]:
        return [card for card in play.cards if not self._is_card_face_up(play, card)]

    def _hidden_cards(self, play: Play) -> List[int]:
        """What still counts as an unresolved claim, which is what BS targeting reads."""
        if play.revealed_at_turn is not None:
            return []
        return [card for card in play.cards if card not in play.revealed_card_ids]

    def _face_down_cards_for_player(self, player_id: str) -> List[int]:
        cards: List[int] = []
        for play in self.plays:
            if play.player_id == player_id:
                cards.extend(self._face_down_cards(play))
        return cards

    def table_card_count(self) -> int:
        return sum(len(play.cards) for play in self.plays)

    def _all_table_cards(self) -> List[int]:
        cards: List[int] = []
        for play in self.plays:
            cards.extend(play.cards)
        return cards

    def _get_pending_reveal_play(self, player_id: str) -> Optional[Play]:
        play_id = self.players[player_id].pending_reveal_play_id
        return self._find_play(play_id) if play_id else None

    def _get_pending_play(self, player_id: str) -> Optional[Play]:
        """``getPendingPlay``: the play a BS call would answer."""
        pending = self._get_pending_reveal_play(player_id)
        if pending is not None and self._hidden_cards(pending):
            return pending

        for play in reversed(self.plays):
            if play.player_id == player_id and self._hidden_cards(play):
                return play
        return None

    def _create_play(
        self,
        player_id: str,
        cards: List[int],
        declared_card_count: int,
        claimed_rank: Optional[str],
        turn_number: int,
        was_trump_selection: bool,
    ) -> None:
        play_id = f"play-{self.round.round_number}-{turn_number}-{player_id}"
        self.plays.append(
            Play(
                id=play_id,
                player_id=player_id,
                cards=cards,
                declared_card_count=declared_card_count,
                revealed_card_ids=set(),
                claimed_rank=claimed_rank,
                played_at_round=self.round.round_number,
                played_at_turn=turn_number,
                revealed_at_turn=None,
                was_trump_selection=was_trump_selection,
            )
        )
        self.players[player_id].pending_reveal_play_id = play_id

    # ------------------------------------------------------------------ seats

    def active_player_ids(self) -> List[str]:
        return [player_id for player_id in self.seat_order if not self.players[player_id].has_left]

    def _active_count(self) -> int:
        return len(self.active_player_ids())

    def _get_next_active_player_id(
        self,
        current_player_id: str,
        direction: Optional[str] = None,
        active_player_ids: Optional[Sequence[str]] = None,
    ) -> Optional[str]:
        direction = direction if direction is not None else self.round.direction
        active = list(active_player_ids) if active_player_ids is not None else list(self.seat_order)
        if not self.seat_order or not active:
            return None
        if current_player_id not in self.seat_order:
            return None

        current_index = self.seat_order.index(current_player_id)
        active_set = set(active)
        step = -1 if direction == "counterclockwise" else 1

        for offset in range(1, len(self.seat_order) + 1):
            next_index = (current_index + step * offset) % len(self.seat_order)
            next_player_id = self.seat_order[next_index]
            if next_player_id in active_set:
                return next_player_id
        return None

    def _get_default_starting_player_id(self, fallback_player_id: Optional[str]) -> Optional[str]:
        """``getDefaultStartingPlayerID`` with The Privileged's claim removed — vanilla has no one to
        make it, so the fallback is the whole rule."""
        active = self.active_player_ids()
        if not active:
            return None
        if fallback_player_id and fallback_player_id in active:
            return fallback_player_id
        return active[0]

    def _update_round_capacity(self) -> None:
        self.round.max_cards_on_table = get_max_cards_on_table(self._active_count())

    # ------------------------------------------------------------- procedures

    def _is_turn_reveal_running(self) -> bool:
        return bool(self.turn_opening and self.turn_opening.is_taken and self.turn_opening.reveal)

    def is_procedure_running(self) -> bool:
        return (
            self.bs_resolution is not None
            or self.reset_resolution is not None
            or self._is_turn_reveal_running()
        )

    def is_awaiting_turn_take(self, player_id: str) -> bool:
        opening = self.turn_opening
        return bool(opening and not opening.is_taken and opening.player_id == player_id)

    def _get_default_bs_target(self, current_player_id: str) -> Optional[str]:
        if self.bs_resolution is not None:
            return None
        target_player_id = self.round.last_non_passing_player_id
        if not self.round.trump_rank or not target_player_id or target_player_id == current_player_id:
            return None
        return target_player_id if self._get_pending_play(target_player_id) else None

    def is_final_two_resolution_turn(self, current_player_id: str) -> bool:
        """Two players left and the other one has just emptied their hand: Play and Pass are gone."""
        if self._active_count() != 2:
            return False
        target_player_id = self._get_default_bs_target(current_player_id)
        if not target_player_id:
            return False
        return not self.players[target_player_id].hand

    def _get_table_reveal_order(self, start_player_id: str) -> List[str]:
        """Frozen at call time, and walked against the current direction. Seats with nothing face
        down are dropped, which is why an all-pass return can begin at someone other than the caller."""
        reveal_direction = _toggle_direction(self.round.direction)
        active = self.active_player_ids()
        visit_order = [start_player_id]

        for _ in range(1, len(self.seat_order)):
            next_player_id = self._get_next_active_player_id(
                visit_order[-1], reveal_direction, active
            )
            if not next_player_id or next_player_id == start_player_id:
                break
            visit_order.append(next_player_id)

        return [
            player_id
            for player_id in visit_order
            if self._face_down_cards_for_player(player_id)
        ]

    @staticmethod
    def _reveal_focused_player(reveal_order: Sequence[str], step_index: int) -> Optional[str]:
        return reveal_order[step_index] if step_index < len(reveal_order) else None

    @staticmethod
    def _is_reveal_complete(reveal_order: Sequence[str], step_index: int) -> bool:
        return step_index >= len(reveal_order)

    def _create_bs_resolution(
        self, caller_player_id: str, target_player_id: str, target_play: Play, trump_rank: str
    ) -> BSResolution:
        target_was_honest = all(
            self._is_trump(card, trump_rank) for card in target_play.cards
        )
        reverse_rule_triggered = (
            sum(
                1
                for play in self.plays
                for card in play.cards
                if self._counts_toward_reverse_rule(card, trump_rank)
            )
            >= 4
        )
        default_punished = caller_player_id if target_was_honest else target_player_id
        if reverse_rule_triggered:
            punished = target_player_id if default_punished == caller_player_id else caller_player_id
        else:
            punished = default_punished
        unpunished = target_player_id if punished == caller_player_id else caller_player_id

        return BSResolution(
            id=f"bs-{self.round.round_number}-{target_play.played_at_turn}-{caller_player_id}",
            caller_player_id=caller_player_id,
            target_player_id=target_player_id,
            target_play_id=target_play.id,
            target_declared_card_count=target_play.declared_card_count,
            trump_rank=trump_rank,
            punishment_card_count=self.table_card_count(),
            reveal_order=self._get_table_reveal_order(target_player_id),
            reveal_step_index=0,
            is_punishing=False,
            target_was_honest=target_was_honest,
            reverse_rule_triggered=reverse_rule_triggered,
            punished_player_id=punished,
            unpunished_player_id=unpunished,
        )

    def _create_reset_resolution(self, caller_player_id: str, kind: str) -> ResetResolution:
        return ResetResolution(
            id=f"{kind}-{self.round.round_number}-{len(self.plays)}-{caller_player_id}",
            caller_player_id=caller_player_id,
            kind=kind,
            reveal_order=self._get_table_reveal_order(caller_player_id),
            reveal_step_index=0,
        )

    # ------------------------------------------------------------ round flow

    def _begin_next_round(self, next_starting_player_id: str) -> None:
        self.round.round_number += 1
        self.round.direction = _toggle_direction(self.round.direction)
        self.round.starting_player_id = (
            self._get_default_starting_player_id(next_starting_player_id) or next_starting_player_id
        )
        if self.round.trump_rank is not None:
            self.round.previous_trump_rank = self.round.trump_rank
        self.round.trump_rank = None
        self.round.pass_streak = 0
        self.round.last_non_passing_player_id = None
        self.round.started_turn_number = None
        self.round.status = "awaitingTrumpSelection"
        self.plays = []
        self.bs_resolution = None
        self.reset_resolution = None
        for player in self.players.values():
            player.pending_reveal_play_id = None
        self._update_round_capacity()

    def _get_round_start_player_order(self) -> List[str]:
        active = self.active_player_ids()
        fallback = (
            self.round.starting_player_id
            if self.round.starting_player_id in active
            else (active[0] if active else None)
        )
        start = self._get_default_starting_player_id(fallback)
        if not start:
            return []

        order = [start]
        while len(order) < len(active):
            next_player_id = self._get_next_active_player_id(order[-1], self.round.direction, active)
            if not next_player_id or next_player_id in order:
                break
            order.append(next_player_id)
        return order

    def _resolve_round_start_leaves(self, turn_number: int) -> Optional[str]:
        next_starting_player_id: Optional[str] = None

        for player_id in self._get_round_start_player_order():
            if not self.players[player_id].hand:
                self._mark_player_left(player_id, turn_number)
                continue
            if next_starting_player_id is None:
                next_starting_player_id = player_id

        next_starting_player_id = self._get_default_starting_player_id(next_starting_player_id)
        if next_starting_player_id:
            self.round.starting_player_id = next_starting_player_id
        return next_starting_player_id

    def _resolve_round_start(self, turn_number: int) -> Optional[str]:
        next_starting_player_id = self._resolve_round_start_leaves(turn_number)
        active = self.active_player_ids()

        if not active:
            self._finalize_game()
            return None
        if len(active) <= 1:
            self._finalize_game_for_last_remaining(
                next_starting_player_id or self.round.starting_player_id, turn_number
            )
            return None
        return next_starting_player_id or active[0]

    def _mark_player_left(self, player_id: str, turn_number: int) -> None:
        player = self.players[player_id]
        if player.has_left:
            return

        player.has_left = True
        player.leave_order = sum(1 for entry in self.players.values() if entry.has_left)
        player.pending_reveal_play_id = None
        # Cards in front of a leaver are removed from the game entirely: they never come back, are
        # never redistributed, and stop counting toward MaxCardsOnTable.
        removed = len(self._face_down_cards_for_player(player_id))
        self.plays = [play for play in self.plays if play.player_id != player_id]
        self._record_event("leave", player_id, card_count=removed)
        self._update_round_capacity()

    def _finalize_game(self) -> None:
        placements = sorted(
            self.seat_order,
            key=lambda player_id: (
                self.players[player_id].points,
                self.players[player_id].leave_order
                if self.players[player_id].leave_order is not None
                else _BIG,
                self.players[player_id].seat_index,
            ),
        )
        self.game_status = "finished"
        self.placements = placements
        self.gameover = GameOver(
            placements=placements,
            winner_id=placements[0],
            points_by_player={
                player_id: self.players[player_id].points for player_id in self.seat_order
            },
        )

    def _finalize_game_for_last_remaining(self, current_player_id: str, turn_number: int) -> None:
        active = self.active_player_ids()
        last_remaining = active[0] if active else current_player_id
        if len(active) == 1:
            self._mark_player_left(last_remaining, turn_number)
        self._finalize_game()

    # ------------------------------------------------------------- turn hooks

    def _handle_turn_start(self) -> None:
        if self.game_status != "active":
            return

        current_player_id = self.current_player
        # Stamped before anything below can end the turn again — it is what tells the turn-end hook
        # that a turn genuinely opened.
        self.round.started_turn_number = self.ctx_turn
        self.turn_opening = None

        if not self.players[current_player_id].hand:
            self._mark_player_left(current_player_id, self.ctx_turn)

            active = self.active_player_ids()
            if len(active) <= 1:
                self._finalize_game_for_last_remaining(current_player_id, self.ctx_turn)
                return

            next_active = self._get_next_active_player_id(
                current_player_id, self.round.direction, active
            )
            next_player_id = (
                self._get_default_starting_player_id(next_active)
                if self.round.trump_rank is None
                else next_active
            )

            if next_player_id:
                if (
                    self.round.trump_rank is None
                    and self.round.starting_player_id == current_player_id
                ):
                    self.round.starting_player_id = next_player_id
                self._end_turn(next_player_id)
            return

        self._update_round_capacity()
        self.turn_opening = TurnOpening(
            id=f"turn-open-r{self.round.round_number}-t{self.ctx_turn}-p{current_player_id}",
            player_id=current_player_id,
            turn_number=self.ctx_turn,
            is_taken=False,
            reveal=None,
        )

    def _handle_turn_end(self) -> None:
        """``handleTurnEnd``. In vanilla both of its jobs — The Thinker's recalculation and the
        Status Rule's counter tick — belong to features that are switched off, so this is a no-op.
        It is kept as a named hook so the turn loop reads like the original."""
        if self.game_status != "active":
            return
        if self.round.started_turn_number != self.ctx_turn:
            return

    def _advance_turn(self, current_player_id: str, turn_number: int) -> None:
        active = self.active_player_ids()
        if len(active) <= 1:
            self._finalize_game_for_last_remaining(current_player_id, turn_number)
            return

        next_player_id = self._get_next_active_player_id(
            current_player_id, self.round.direction, active
        )
        if next_player_id:
            self._end_turn(next_player_id)

    def _end_turn(self, next_player_id: Optional[str]) -> None:
        self._pending_end_turns.append(next_player_id)

    def _drain_events(self) -> None:
        guard = 0
        while self._pending_end_turns and self.gameover is None:
            guard += 1
            if guard > 1024:
                raise RuntimeError("Turn hand-over did not settle")

            next_player_id = self._pending_end_turns.pop(0)
            self._handle_turn_end()
            self.ctx_turn += 1
            if next_player_id:
                self.current_player = next_player_id
            self._handle_turn_start()

        if self.gameover is not None:
            self._pending_end_turns.clear()

    # ----------------------------------------------------------------- moves

    def _start_match(self, player_id: str, _args: dict) -> Optional[str]:
        if self.game_status != "staging" or player_id != self.host_player_id:
            return INVALID

        self._start_match_state(self.ctx_turn)
        next_starting_player_id = self._resolve_round_start(self.ctx_turn)
        if not next_starting_player_id:
            return None

        if self.current_player == next_starting_player_id:
            self._handle_turn_start()
            return None

        self._end_turn(next_starting_player_id)
        return None

    def _start_match_state(self, turn_number: int) -> None:
        """Two shuffles, in this order: the seating, then the deck. The Python and TypeScript sides
        must draw from their streams in the same order for a seeded match to deal identically."""
        shuffled_seat_order = self.shuffle(self.seat_order)
        shuffled_deck = self.shuffle(self.deck.card_ids())

        dealt: Dict[str, List[int]] = {player_id: [] for player_id in shuffled_seat_order}
        for card_index, card in enumerate(shuffled_deck):
            dealt[shuffled_seat_order[card_index % len(shuffled_seat_order)]].append(card)

        self.game_status = "active"
        self.seat_order = shuffled_seat_order
        self.plays = []
        self.placements = []
        self.public_events = []
        self.round = RoundState(
            round_number=1,
            status="awaitingTrumpSelection",
            direction="counterclockwise",
            starting_player_id=shuffled_seat_order[0],
            max_cards_on_table=get_max_cards_on_table(len(shuffled_seat_order)),
        )

        for seat_index, player_id in enumerate(shuffled_seat_order):
            player = self.players[player_id]
            remaining, scored_sets, points = self.score_hand(
                dealt[player_id], player_id, 1, turn_number
            )
            player.seat_index = seat_index
            player.hand = remaining
            player.points = points
            player.scored_sets = list(scored_sets)
            player.pending_reveal_play_id = None
            player.has_left = False
            player.leave_order = None

        self.round.starting_player_id = (
            self._get_default_starting_player_id(shuffled_seat_order[0]) or self.host_player_id
        )
        self._update_round_capacity()

    def _take_turn(self, player_id: str, args: dict) -> Optional[str]:
        opening = self.turn_opening
        opening_id = args.get("openingID")

        if self.game_status != "active" or opening is None or opening.id != opening_id:
            return INVALID
        if opening.is_taken or opening.player_id != player_id or self.current_player != player_id:
            return INVALID

        opening.is_taken = True
        opening.reveal = self._open_turn_reveal(opening)
        if not opening.reveal:
            self.turn_opening = None
        return None

    def _open_turn_reveal(self, opening: TurnOpening) -> Optional[TurnReveal]:
        """What the Reveal Rule owes this turn, decided at the press rather than at the turn's start.

        Returns the walk the player performs by hand, or ``None`` when there is nothing to press —
        having already written whatever the rule owed in that case, so the two paths differ only in
        ceremony.
        """
        player = self.players[opening.player_id]
        play = self._get_pending_reveal_play(opening.player_id)
        player.pending_reveal_play_id = None

        if play is None:
            return None

        reveal = TurnReveal(
            play_id=play.id,
            card_ids=self._face_down_cards(play),
            is_full_reveal=True,
        )
        if reveal.card_ids:
            return reveal

        self._complete_turn_reveal(play, reveal, opening.turn_number)
        return None

    def _complete_turn_reveal(self, play: Play, reveal: TurnReveal, turn_number: int) -> None:
        play.revealed_at_turn = turn_number
        # Public by construction: the Reveal Rule just turned these cards face up for everyone, so
        # whether the claim held is now common knowledge.
        self._record_event(
            "reveal",
            play.player_id,
            card_count=len(reveal.card_ids),
            claimed_rank=play.claimed_rank,
            was_honest=all(self._is_trump(card, play.claimed_rank) for card in play.cards),
        )

    def _drivable_turn_reveal(self, player_id: str, opening_id: str) -> Optional[TurnOpening]:
        opening = self.turn_opening
        if self.game_status != "active" or opening is None or opening.id != opening_id:
            return None
        if not opening.is_taken:
            return None
        return opening if opening.reveal and player_id == opening.player_id else None

    def _reveal_turn_card(self, player_id: str, args: dict) -> Optional[str]:
        opening = self._drivable_turn_reveal(player_id, args.get("openingID", ""))
        card_id = args.get("cardID")

        if opening is None or opening.reveal is None or card_id not in opening.reveal.card_ids:
            return INVALID

        play = self._find_play(opening.reveal.play_id)
        if play is None or self._is_card_face_up(play, card_id):
            return INVALID

        play.revealed_card_ids.add(card_id)
        return None

    def _finalize_turn_reveal(self, player_id: str, args: dict) -> Optional[str]:
        opening = self._drivable_turn_reveal(player_id, args.get("openingID", ""))
        reveal = opening.reveal if opening else None

        if opening is None or reveal is None:
            return INVALID

        play = self._find_play(reveal.play_id)
        if play is None or any(
            not self._is_card_face_up(play, card_id) for card_id in reveal.card_ids
        ):
            return INVALID

        self._complete_turn_reveal(play, reveal, opening.turn_number)
        self.turn_opening = None
        return None

    def _validate_common_play(
        self, player_id: str, card_ids: Sequence[int], next_trump_rank: Optional[str]
    ) -> bool:
        if self.current_player != player_id:
            return False
        if (
            self.game_status != "active"
            or self.is_procedure_running()
            or self.is_final_two_resolution_turn(player_id)
        ):
            return False
        if self.is_awaiting_turn_take(player_id):
            return False
        # The one place a trump selection is checked to be a rank at all. Note that it is *not*
        # checked against the deck's selected ranks: naming a rank that is not in play is legal, and
        # makes every play of the round a lie.
        if next_trump_rank is not None and next_trump_rank not in RANKS:
            return False
        if self.round.trump_rank is None and next_trump_rank is None:
            return False
        if self.round.trump_rank is not None and next_trump_rank is not None:
            return False
        if next_trump_rank is not None and self.round.previous_trump_rank == next_trump_rank:
            return False
        if not card_ids:
            return False
        if len(card_ids) > 2:
            return False
        return self.table_card_count() + len(card_ids) <= self.round.max_cards_on_table

    def _perform_play(
        self, player_id: str, card_ids: Sequence[int], next_trump_rank: Optional[str]
    ) -> Optional[str]:
        if not self._validate_common_play(player_id, card_ids, next_trump_rank):
            return INVALID

        selected = self._remove_cards_from_hand(player_id, card_ids)
        if selected is None:
            return INVALID

        claimed_rank = next_trump_rank if next_trump_rank is not None else self.round.trump_rank
        if not claimed_rank:
            self._add_cards_to_hand(player_id, selected, self.ctx_turn)
            return INVALID

        self._create_play(
            player_id,
            selected,
            len(selected),
            claimed_rank,
            self.ctx_turn,
            next_trump_rank is not None,
        )
        if next_trump_rank is not None:
            self.round.trump_rank = next_trump_rank
        self.round.status = "inProgress"
        self.round.pass_streak = 0
        self.round.last_non_passing_player_id = player_id
        # The count and the claim, which is exactly what the table hears. Never the cards.
        self._record_event(
            "play",
            player_id,
            card_count=len(selected),
            claimed_rank=claimed_rank,
            was_trump_selection=next_trump_rank is not None,
        )

        self._advance_turn(player_id, self.ctx_turn)
        return None

    def _play(self, player_id: str, args: dict) -> Optional[str]:
        return self._perform_play(player_id, args.get("cardIDs", []), None)

    def _select_trump_and_play(self, player_id: str, args: dict) -> Optional[str]:
        return self._perform_play(player_id, args.get("cardIDs", []), args.get("trumpRank"))

    def _pass(self, player_id: str, _args: dict) -> Optional[str]:
        if (
            self.game_status != "active"
            or self.is_procedure_running()
            or self.current_player != player_id
            or self.is_awaiting_turn_take(player_id)
            or self.is_final_two_resolution_turn(player_id)
        ):
            return INVALID

        self.round.pass_streak += 1
        self._record_event("pass", player_id, card_count=self.round.pass_streak)
        if self.round.pass_streak >= self._active_count():
            self.reset_resolution = self._create_reset_resolution(player_id, "roundReturn")
            return None

        self._advance_turn(player_id, self.ctx_turn)
        return None

    def _call_bs(self, player_id: str, _args: dict) -> Optional[str]:
        if (
            self.game_status != "active"
            or self.is_procedure_running()
            or self.current_player != player_id
            or self.is_awaiting_turn_take(player_id)
        ):
            return INVALID

        target_player_id = self._get_default_bs_target(player_id)
        trump_rank = self.round.trump_rank
        if not target_player_id or not trump_rank:
            return INVALID

        target_play = self._get_pending_play(target_player_id)
        if target_play is None:
            return INVALID

        self.bs_resolution = self._create_bs_resolution(
            player_id, target_player_id, target_play, trump_rank
        )
        self._record_event("callBS", player_id, target_player_id=target_player_id)
        return None

    def _reveal_table_card(
        self, reveal_order: Sequence[str], step_index: int, card_id: int
    ) -> Optional[str]:
        play = next((entry for entry in self.plays if card_id in entry.cards), None)
        focused = self._reveal_focused_player(reveal_order, step_index)

        if play is None or play.player_id != focused or self._is_card_face_up(play, card_id):
            return INVALID

        play.revealed_card_ids.add(card_id)
        return None

    def _advance_reveal_step(self, reveal_order: Sequence[str], step_index: int) -> Optional[str]:
        focused = self._reveal_focused_player(reveal_order, step_index)
        if not focused or self._face_down_cards_for_player(focused):
            return INVALID
        return None

    def _reveal_bs_card(self, player_id: str, args: dict) -> Optional[str]:
        resolution = self.bs_resolution
        if (
            resolution is None
            or resolution.id != args.get("resolutionID")
            or resolution.caller_player_id != player_id
            or self.game_status != "active"
            or resolution.is_punishing
            or self._is_reveal_complete(resolution.reveal_order, resolution.reveal_step_index)
        ):
            return INVALID
        return self._reveal_table_card(
            resolution.reveal_order, resolution.reveal_step_index, args.get("cardID")
        )

    def _advance_bs_reveal(self, player_id: str, args: dict) -> Optional[str]:
        resolution = self.bs_resolution
        if (
            resolution is None
            or resolution.id != args.get("resolutionID")
            or resolution.caller_player_id != player_id
            or self.game_status != "active"
            or resolution.is_punishing
            or self._is_reveal_complete(resolution.reveal_order, resolution.reveal_step_index)
        ):
            return INVALID
        if self._advance_reveal_step(resolution.reveal_order, resolution.reveal_step_index) == INVALID:
            return INVALID
        resolution.reveal_step_index += 1
        return None

    def _begin_bs_punishment(self, player_id: str, args: dict) -> Optional[str]:
        resolution = self.bs_resolution
        if (
            resolution is None
            or resolution.id != args.get("resolutionID")
            or resolution.caller_player_id != player_id
            or self.game_status != "active"
            or resolution.is_punishing
            or not self._is_reveal_complete(resolution.reveal_order, resolution.reveal_step_index)
        ):
            return INVALID
        if any(self._face_down_cards(play) for play in self.plays):
            return INVALID

        resolution.is_punishing = True
        return None

    def _finalize_bs_resolution(self, player_id: str, args: dict) -> Optional[str]:
        resolution = self.bs_resolution
        resolution_id = args.get("resolutionID")

        if resolution is None or (resolution_id and resolution.id != resolution_id):
            return INVALID
        if player_id != resolution.caller_player_id or not self._is_reveal_complete(
            resolution.reveal_order, resolution.reveal_step_index
        ):
            return INVALID

        punishment_cards = self._all_table_cards()
        self._add_cards_to_hand(resolution.punished_player_id, punishment_cards, self.ctx_turn)
        self._record_event(
            "bsVerdict",
            resolution.caller_player_id,
            card_count=len(punishment_cards),
            claimed_rank=resolution.trump_rank,
            target_player_id=resolution.target_player_id,
            punished_player_id=resolution.punished_player_id,
            was_honest=resolution.target_was_honest,
        )

        self._begin_next_round(resolution.unpunished_player_id)
        next_starting_player_id = self._resolve_round_start(self.ctx_turn)
        if next_starting_player_id:
            self._end_turn(next_starting_player_id)
        return None

    def _call_reset(self, player_id: str, _args: dict) -> Optional[str]:
        if (
            self.game_status != "active"
            or self.is_procedure_running()
            or self.current_player != player_id
            or self.is_awaiting_turn_take(player_id)
            or self.table_card_count() < self.round.max_cards_on_table
        ):
            return INVALID

        self.reset_resolution = self._create_reset_resolution(player_id, "reset")
        self._record_event("callReset", player_id, card_count=self.table_card_count())
        return None

    def _reveal_reset_card(self, player_id: str, args: dict) -> Optional[str]:
        resolution = self.reset_resolution
        if (
            resolution is None
            or resolution.id != args.get("resolutionID")
            or resolution.caller_player_id != player_id
            or self.game_status != "active"
            or self._is_reveal_complete(resolution.reveal_order, resolution.reveal_step_index)
        ):
            return INVALID
        return self._reveal_table_card(
            resolution.reveal_order, resolution.reveal_step_index, args.get("cardID")
        )

    def _advance_reset_reveal(self, player_id: str, args: dict) -> Optional[str]:
        resolution = self.reset_resolution
        if (
            resolution is None
            or resolution.id != args.get("resolutionID")
            or resolution.caller_player_id != player_id
            or self.game_status != "active"
            or self._is_reveal_complete(resolution.reveal_order, resolution.reveal_step_index)
        ):
            return INVALID
        if self._advance_reveal_step(resolution.reveal_order, resolution.reveal_step_index) == INVALID:
            return INVALID
        resolution.reveal_step_index += 1
        return None

    def _finalize_reset_resolution(self, player_id: str, args: dict) -> Optional[str]:
        resolution = self.reset_resolution
        resolution_id = args.get("resolutionID")

        if (
            resolution is None
            or (resolution_id and resolution.id != resolution_id)
            or resolution.caller_player_id != player_id
            or not self._is_reveal_complete(resolution.reveal_order, resolution.reveal_step_index)
        ):
            return INVALID

        if resolution.kind == "roundReturn":
            return self._return_cards_after_all_pass(player_id)

        # The third and last shuffle site in a vanilla match.
        table_cards = self.shuffle(self._all_table_cards())
        active = self.active_player_ids()
        caller_first = [resolution.caller_player_id] + [
            entry for entry in active if entry != resolution.caller_player_id
        ]
        cards_per_player = len(table_cards) // len(active)
        extra_card_count = len(table_cards) % len(active)
        card_index = 0

        for active_player_id in caller_first:
            chunk = table_cards[card_index : card_index + cards_per_player]
            card_index += cards_per_player
            self._add_cards_to_hand(active_player_id, chunk, self.ctx_turn)

        if extra_card_count > 0:
            self._add_cards_to_hand(
                resolution.caller_player_id,
                table_cards[card_index : card_index + extra_card_count],
                self.ctx_turn,
            )

        self._begin_next_round(resolution.caller_player_id)
        next_starting_player_id = self._resolve_round_start(self.ctx_turn)
        if next_starting_player_id:
            self._end_turn(next_starting_player_id)
        return None

    def _return_cards_after_all_pass(self, player_id: str) -> Optional[str]:
        cards_by_owner: Dict[str, List[int]] = {}
        for play in self.plays:
            cards_by_owner.setdefault(play.player_id, []).extend(play.cards)

        for owner_player_id, cards in cards_by_owner.items():
            if not self.players[owner_player_id].has_left:
                self._add_cards_to_hand(owner_player_id, cards, self.ctx_turn)

        self._record_event("roundReturn", player_id, card_count=self.table_card_count())
        self._begin_next_round(player_id)
        next_starting_player_id = self._resolve_round_start(self.ctx_turn)
        if next_starting_player_id:
            self._end_turn(next_starting_player_id)
        return None

    _MOVES = {
        "startMatch": _start_match,
        "takeTurn": _take_turn,
        "revealTurnCard": _reveal_turn_card,
        "finalizeTurnReveal": _finalize_turn_reveal,
        "selectTrumpAndPlay": _select_trump_and_play,
        "play": _play,
        "pass": _pass,
        "callBS": _call_bs,
        "revealBSCard": _reveal_bs_card,
        "advanceBSReveal": _advance_bs_reveal,
        "beginBSPunishment": _begin_bs_punishment,
        "finalizeBSResolution": _finalize_bs_resolution,
        "callReset": _call_reset,
        "revealResetCard": _reveal_reset_card,
        "advanceResetReveal": _advance_reset_reveal,
        "finalizeResetResolution": _finalize_reset_resolution,
    }

    def apply_move(self, player_id: str, move_name: str, args: Optional[dict] = None) -> bool:
        """Apply one primitive move. Returns ``True`` when the move was refused.

        A refused move leaves no trace, queued turn hand-overs included — the real engine discards
        the whole thing on ``INVALID_MOVE``, and a simulator that half-applied one would drift.
        """
        handler = self._MOVES.get(move_name)
        if handler is None:
            raise ValueError(f"Unknown move: {move_name}")

        before_length = len(self._pending_end_turns)
        result = handler(self, player_id, args or {})

        if result == INVALID:
            del self._pending_end_turns[before_length:]
            return True

        self._drain_events()
        return False

    # --------------------------------------------------------------- actions

    def decision_player(self) -> Optional[str]:
        """The seat owing a real choice, or ``None`` while a forced procedure is mid-flight."""
        if self.game_status != "active" or self.gameover is not None:
            return None
        if self.is_procedure_running() or self.turn_opening is not None:
            return None
        return self.current_player

    def forced_move(self) -> Optional[Tuple[str, str, dict]]:
        """The next move nobody chooses: ``(playerID, moveName, args)``, or ``None`` at a decision.

        Take Turn, the Reveal Rule's flips and the two reveal walks are all pressed by hand in the
        real client, but none of them is a choice — which card of a pile is turned over first changes
        nothing, and the walk cannot be declined or reordered. An environment that exposed them as
        actions would be handing a policy a long stretch of moves with one outcome each.
        """
        resolution = self.bs_resolution
        if resolution is not None:
            complete = self._is_reveal_complete(
                resolution.reveal_order, resolution.reveal_step_index
            )
            args = {"resolutionID": resolution.id}
            if not complete and not resolution.is_punishing:
                focused = self._reveal_focused_player(
                    resolution.reveal_order, resolution.reveal_step_index
                )
                face_down = self._face_down_cards_for_player(focused) if focused else []
                if face_down:
                    return (
                        resolution.caller_player_id,
                        "revealBSCard",
                        {**args, "cardID": face_down[0]},
                    )
                return resolution.caller_player_id, "advanceBSReveal", args
            if not resolution.is_punishing:
                return resolution.caller_player_id, "beginBSPunishment", args
            return resolution.caller_player_id, "finalizeBSResolution", args

        reset = self.reset_resolution
        if reset is not None:
            args = {"resolutionID": reset.id}
            if not self._is_reveal_complete(reset.reveal_order, reset.reveal_step_index):
                focused = self._reveal_focused_player(reset.reveal_order, reset.reveal_step_index)
                face_down = self._face_down_cards_for_player(focused) if focused else []
                if face_down:
                    return (
                        reset.caller_player_id,
                        "revealResetCard",
                        {**args, "cardID": face_down[0]},
                    )
                return reset.caller_player_id, "advanceResetReveal", args
            return reset.caller_player_id, "finalizeResetResolution", args

        opening = self.turn_opening
        if opening is not None:
            if not opening.is_taken:
                return opening.player_id, "takeTurn", {"openingID": opening.id}

            reveal = opening.reveal
            if reveal is not None:
                play = self._find_play(reveal.play_id)
                if play is not None:
                    for card_id in reveal.card_ids:
                        if not self._is_card_face_up(play, card_id):
                            return (
                                opening.player_id,
                                "revealTurnCard",
                                {"openingID": opening.id, "cardID": card_id},
                            )
                return opening.player_id, "finalizeTurnReveal", {"openingID": opening.id}

        return None

    def legal_action_parts(self) -> Optional[LegalParts]:
        """The legal action space, factored rather than enumerated.

        Plays are enumerated by *rank* rather than by card: a single deck can hold at most one card of
        each rank and suit, nothing in the vanilla rules reads a suit, and so two plays that differ
        only in which suit was sent are the same play. Each one is realised with the lowest-sorting
        held card of that rank, which keeps the choice reproducible on both sides of the conformance
        run. ``rl/conformance.py --suit-invariance`` is what checks that claim against the engine
        rather than assuming it.

        Factored because the cross product is large exactly where it is least interesting: at a trump
        selection, every rank pairs with every card choice, and materialising all of them allocates
        four figures' worth of objects for one decision. :meth:`legal_actions` is the enumeration, and
        stays the reference the conformance run checks; the environment reads this instead.
        """
        player_id = self.decision_player()
        if player_id is None:
            return None

        final_two = self.is_final_two_resolution_turn(player_id)
        table_count = self.table_card_count()
        room = self.round.max_cards_on_table - table_count
        trump_required = self.round.trump_rank is None

        card_choices: Tuple[Tuple[int, ...], ...] = ()
        trump_ranks: Tuple[str, ...] = ()

        if not final_two and room > 0:
            card_choices = tuple(self._enumerate_play_card_choices(player_id, room))
            if trump_required and card_choices:
                trump_ranks = tuple(
                    rank for rank in RANKS if rank != self.round.previous_trump_rank
                )

        return LegalParts(
            player_id=player_id,
            can_pass=not final_two,
            can_call_bs=bool(
                self.round.trump_rank is not None and self._get_default_bs_target(player_id)
            ),
            can_call_reset=table_count >= self.round.max_cards_on_table,
            card_choices=card_choices,
            trump_ranks=trump_ranks,
            trump_required=trump_required,
        )

    def legal_actions(self) -> List[Action]:
        """Every legal action, enumerated. The reference the conformance run holds the mask to."""
        parts = self.legal_action_parts()
        if parts is None:
            return []

        actions: List[Action] = []
        if parts.trump_required:
            for rank in parts.trump_ranks:
                for cards in parts.card_choices:
                    actions.append(Action("trumpPlay", rank, cards))
        else:
            for cards in parts.card_choices:
                actions.append(Action("play", None, cards))

        if parts.can_call_bs:
            actions.append(Action("callBS"))
        if parts.can_call_reset:
            actions.append(Action("callReset"))
        if parts.can_pass:
            actions.append(Action("pass"))

        return actions

    def _enumerate_play_card_choices(self, player_id: str, room: int) -> List[Tuple[int, ...]]:
        """Every distinct 1- or 2-card play, keyed by rank and realised with concrete cards."""
        hand = self.players[player_id].hand
        by_rank: Dict[str, List[int]] = {}
        rank_order: List[str] = []
        for card in hand:
            rank = self.deck.rank[card]
            if rank not in by_rank:
                by_rank[rank] = []
                rank_order.append(rank)
            by_rank[rank].append(card)

        choices: List[Tuple[int, ...]] = [(by_rank[rank][0],) for rank in rank_order]

        if room >= 2:
            for first_index, first_rank in enumerate(rank_order):
                if len(by_rank[first_rank]) >= 2:
                    choices.append((by_rank[first_rank][0], by_rank[first_rank][1]))
                for second_rank in rank_order[first_index + 1 :]:
                    choices.append((by_rank[first_rank][0], by_rank[second_rank][0]))

        return choices

    def apply_action(self, action: Action) -> None:
        """Apply one decision. Raises :class:`InvalidMove` if the engine refuses it."""
        player_id = self.decision_player()
        if player_id is None:
            raise InvalidMove("No decision is owed right now.")

        move_name, args = action.to_move()
        if self.apply_move(player_id, move_name, args):
            raise InvalidMove(f"{action} was refused.")

    def clone(self) -> "BlowCowEngine":
        """A full copy. The shuffle callback is shared, not copied, so a clone that reaches a Reset
        draws from the same stream — fine for conformance, and something a search over clones has to
        replace with its own source.

        Hand-rolled rather than ``copy.deepcopy`` because an ISMCTS search clones once per
        simulation, and profiling put ``deepcopy`` at two thirds of the whole search. The one
        semantic difference is aliasing: ``deepcopy``'s memo keeps ``gameover.placements`` and
        ``self.placements`` the same list, and here they become two. Nothing mutates either — both
        are assigned wholesale and only after the match is over — so the split is unobservable.
        """
        clone = object.__new__(BlowCowEngine)
        # Shared outright: immutable, or (the deck and the shuffle) deliberately common to both.
        for field_name in (
            "num_players",
            "deck",
            "shuffle",
            "host_player_id",
            "game_status",
            "ctx_turn",
            "current_player",
        ):
            setattr(clone, field_name, getattr(self, field_name))
        # Lists that are appended to, holding nothing that can be edited in place.
        for field_name in ("seat_order", "placements", "public_events", "_pending_end_turns"):
            setattr(clone, field_name, list(getattr(self, field_name)))
        for field_name in (
            "players",
            "round",
            "plays",
            "bs_resolution",
            "reset_resolution",
            "turn_opening",
            "gameover",
        ):
            setattr(clone, field_name, _copy_record(getattr(self, field_name)))
        return clone

    def __deepcopy__(self, memo: dict) -> "BlowCowEngine":
        clone = self.clone()
        memo[id(self)] = clone
        return clone

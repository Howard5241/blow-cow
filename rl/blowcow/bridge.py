"""The canonical interface to one match: observation in, action index out, real move at the end.

Everything a policy touches goes through here, and so does everything that would let a trained policy
sit at a real table. Point a :class:`CanonicalTable` at any :class:`BlowCowEngine` — a training
episode, or one mirroring a live boardgame.io match — hand it the mapping built from that match's own
`selectedRanks`, and the policy sees exactly the distribution it trained on.
"""

from __future__ import annotations

from typing import Dict, Iterator, List, Optional, Tuple

import numpy as np

from .actions import Action
from .canonical import RankMapping
from .engine import BlowCowEngine
from .observation import encode
from .spaces import (
    ACTION_CALL_BS,
    ACTION_CALL_RESET,
    ACTION_PASS,
    NUM_ACTIONS,
    NUM_CARD_CHOICES,
    PLAY_BASE,
    TRUMP_PLAY_BASE,
    choice_for_cards,
    decompose,
    off_deck_representative,
    trump_play_index,
)


class ActionTable:
    """Index to move, resolved on demand.

    A trump selection pairs every legal rank with every legal card choice, so at the opening of a
    round the legal set runs into the hundreds. Only one of them is ever taken, so the concrete move
    is built when it is asked for rather than up front. It still behaves like the mapping it replaced
    — iterate it for the legal indices, subscript it for the move.
    """

    __slots__ = ("_mapping", "_mask", "_choices", "_trump_required")

    def __init__(
        self,
        mapping: RankMapping,
        mask: np.ndarray,
        choices: Dict[int, Tuple[int, ...]],
        trump_required: bool,
    ) -> None:
        self._mapping = mapping
        self._mask = mask
        self._choices = choices
        self._trump_required = trump_required

    def __iter__(self) -> Iterator[int]:
        return (int(index) for index in np.flatnonzero(self._mask))

    def __len__(self) -> int:
        return int(self._mask.sum())

    def __contains__(self, index: object) -> bool:
        return isinstance(index, int) and 0 <= index < NUM_ACTIONS and bool(self._mask[index])

    def __getitem__(self, index: int) -> Action:
        action = self.get(index)
        if action is None:
            raise KeyError(index)
        return action

    def get(self, index: int, default: Optional[Action] = None) -> Optional[Action]:
        index = int(index)
        if not (0 <= index < NUM_ACTIONS) or not self._mask[index]:
            return default

        kind, trump_slot, choice_index = decompose(index)
        if kind in ("pass", "callBS", "callReset"):
            return Action(kind)

        cards = self._choices[choice_index]  # type: ignore[index]
        if kind == "play":
            return Action("play", None, cards)
        return Action("trumpPlay", self._mapping.rank(trump_slot), cards)  # type: ignore[arg-type]


class CanonicalTable:
    def __init__(self, engine: BlowCowEngine, mapping: RankMapping) -> None:
        # The mapping carries its own card-type table, so a mapping paired with the wrong deck would
        # silently mislabel every card. Checked once, here, rather than trusted.
        mapping.check_deck(engine.deck)
        self.engine = engine
        self.mapping = mapping

    # ------------------------------------------------------------- observation

    def observation(self, viewer_id: str) -> np.ndarray:
        return encode(self.engine, self.mapping, viewer_id)

    # ------------------------------------------------------------------ actions

    def index_for(self, action: Action) -> Optional[int]:
        """The canonical index for a concrete engine action, or ``None`` if it was collapsed away.

        The only actions that collapse are trump selections naming an off-deck rank. All of them are
        the same move, so exactly one representative survives; the rest return ``None`` and are left
        out of the mask.
        """
        if action.kind == "pass":
            return ACTION_PASS
        if action.kind == "callBS":
            return ACTION_CALL_BS
        if action.kind == "callReset":
            return ACTION_CALL_RESET

        choice = choice_for_cards(self.mapping, action.cards)
        if action.kind == "play":
            return PLAY_BASE + choice

        assert action.trump_rank is not None
        slot = self.mapping.slot(action.trump_rank)
        if not self.mapping.is_in_deck(slot):
            previous = self.engine.round.previous_trump_rank
            previous_slot = self.mapping.slot(previous) if previous else None
            if slot != off_deck_representative(self.mapping, previous_slot):
                return None

        return trump_play_index(slot, choice)

    def build_actions(self) -> Tuple[np.ndarray, ActionTable]:
        """The mask and the index-to-move table for whoever is on the clock.

        Built from the engine's *factored* legality rather than from the enumerated list, so a trump
        selection costs a handful of array writes instead of hundreds of objects. It is the same
        rule check either way — ``legal_actions`` is that enumeration, and Stage A's conformance run
        holds it to the real engine.
        """
        mask = np.zeros(NUM_ACTIONS, dtype=bool)
        parts = self.engine.legal_action_parts()

        if parts is None:
            return mask, ActionTable(self.mapping, mask, {}, False)

        choices: Dict[int, Tuple[int, ...]] = {}
        for cards in parts.card_choices:
            choice = choice_for_cards(self.mapping, cards)
            if choice in choices:
                raise RuntimeError(
                    f"Two card selections collapsed onto choice {choice}: "
                    f"{choices[choice]} and {cards}"
                )
            choices[choice] = cards

        if choices:
            choice_indices = np.fromiter(choices, dtype=np.intp, count=len(choices))
            if parts.trump_required:
                previous = self.engine.round.previous_trump_rank
                previous_slot = self.mapping.slot(previous) if previous else None
                representative = off_deck_representative(self.mapping, previous_slot)

                for rank in parts.trump_ranks:
                    slot = self.mapping.slot(rank)
                    # Every off-deck rank is the same move, so only the representative is offered.
                    if not self.mapping.is_in_deck(slot) and slot != representative:
                        continue
                    mask[TRUMP_PLAY_BASE + slot * NUM_CARD_CHOICES + choice_indices] = True
            else:
                mask[PLAY_BASE + choice_indices] = True

        mask[ACTION_PASS] = parts.can_pass
        mask[ACTION_CALL_BS] = parts.can_call_bs
        mask[ACTION_CALL_RESET] = parts.can_call_reset

        return mask, ActionTable(self.mapping, mask, choices, parts.trump_required)

    def legal_indices(self) -> List[int]:
        mask, _table = self.build_actions()
        return [int(index) for index in np.flatnonzero(mask)]

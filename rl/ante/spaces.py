"""The flat action space, and the index arithmetic that gets in and out of it.

```
0                       Pass
1                       Call BS
2        .. 1+C         Play(card choice)
2+C      .. 1+C+T*C     Select trump slot and play(card choice)
```

`C` is the number of card choices — one card type, or an unordered pair (a pair of one type meaning
two cards of that rank) — and `T` is the number of trump slots. At the default five-seat config that
is `8 + 36 = 44` choices and `7 + 1 = 8` slots, so **398 indices**.

The card choice is a *type* choice, not a card choice, which is the whole reason the space is this
small: two cards of one rank are interchangeable in Ante, so offering both would split a policy's
probability across identical actions.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Sequence, Tuple

from .config import AnteConfig, DEFAULT_CONFIG
from .game import ACTION_CALL_BS, ACTION_PASS, ACTION_PLAY, Action, AnteRound

PASS_INDEX = 0
CALL_BS_INDEX = 1
_FIRST_PLAY_INDEX = 2


def build_choices(num_types: int) -> List[Tuple[int, ...]]:
    """Every multiset of one or two card types, in a fixed order. Singles first, then pairs."""
    choices: List[Tuple[int, ...]] = [(card_type,) for card_type in range(num_types)]
    for left in range(num_types):
        for right in range(left, num_types):
            choices.append((left, right))
    return choices


class ActionSpace:
    """One config's flat space. Build it once and keep it; the tables are pure lookup."""

    def __init__(self, config: AnteConfig = DEFAULT_CONFIG) -> None:
        self.config = config
        self.choices: List[Tuple[int, ...]] = build_choices(config.num_types)
        self.choice_index: Dict[Tuple[int, ...], int] = {
            choice: index for index, choice in enumerate(self.choices)
        }
        self.num_choices = len(self.choices)
        self.play_offset = _FIRST_PLAY_INDEX
        self.trump_offset = _FIRST_PLAY_INDEX + self.num_choices
        self.size = self.trump_offset + config.num_trump_slots * self.num_choices

        #: Which single card types each choice sends, precomputed so the mask loop never allocates.
        self._choice_needs: List[Tuple[Tuple[int, int], ...]] = []
        for choice in self.choices:
            needs: Dict[int, int] = {}
            for card_type in choice:
                needs[card_type] = needs.get(card_type, 0) + 1
            self._choice_needs.append(tuple(sorted(needs.items())))

    # ----------------------------------------------------------------- indexing

    def play(self, choice: Sequence[int], trump_slot: Optional[int] = None) -> int:
        choice_index = self.choice_index[tuple(sorted(choice))]
        if trump_slot is None:
            return self.play_offset + choice_index
        return self.trump_offset + trump_slot * self.num_choices + choice_index

    def decompose(self, index: int) -> Action:
        """The factored view of a flat index: what action it is, and with what arguments."""
        if index == PASS_INDEX:
            return (ACTION_PASS,)
        if index == CALL_BS_INDEX:
            return (ACTION_CALL_BS,)
        if index < self.trump_offset:
            return (ACTION_PLAY, None, self.choices[index - self.play_offset])

        offset = index - self.trump_offset
        trump_slot, choice_index = divmod(offset, self.num_choices)
        return (ACTION_PLAY, trump_slot, self.choices[choice_index])

    def index(self, action: Action) -> int:
        kind = action[0]
        if kind == ACTION_PASS:
            return PASS_INDEX
        if kind == ACTION_CALL_BS:
            return CALL_BS_INDEX
        return self.play(action[2], action[1])

    # ----------------------------------------------------------------- masking

    def legal_mask(self, game: AnteRound) -> List[bool]:
        """The mask, built directly from the hand rather than by enumerating actions.

        `AnteRound.legal_actions` is the reference this is checked against; this is the hot path.
        """
        mask = [False] * self.size
        if game.finished:
            return mask

        mask[PASS_INDEX] = True  # Ante takes nothing away from `Pass` — no statuses, no locks.
        if game.bs_target() is not None:
            mask[CALL_BS_INDEX] = True

        hand = game.hands[game.current]
        playable: List[int] = []
        for choice_index, needs in enumerate(self._choice_needs):
            if all(hand[card_type] >= count for card_type, count in needs):
                playable.append(choice_index)

        if game.trump is None:
            # Off the round, not off the config: an elimination trims the deck, and a rank slot that
            # is no longer in it must not be offered beside the off-deck slot it has become a
            # duplicate of. `AnteRound.legal_actions` is the reference this tracks.
            for trump_slot in game.trump_slots:
                base = self.trump_offset + trump_slot * self.num_choices
                for choice_index in playable:
                    mask[base + choice_index] = True
        else:
            for choice_index in playable:
                mask[self.play_offset + choice_index] = True

        return mask

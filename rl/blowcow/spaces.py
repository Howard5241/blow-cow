"""The canonical action space: a flat index, a mask, and the translation back to real cards.

Five action kinds, one of which carries a card selection and one of which also carries a trump rank.
Because suits are irrelevant and rank identity is relabelled away, a play is fully described by which
*canonical card types* it sends — one type, or an unordered pair, with a pair of the same type
meaning two cards of one rank.

    index 0                     Pass
    index 1                     Call BS
    index 2                     Call Reset
    index 3   .. 121            Play(card choice)                      119 choices
    index 122 .. 1668           Select trump slot and play(card choice) 13 x 119

Off-deck trump ranks are collapsed. All ``13 - R`` of them are interchangeable, so leaving every one
unmasked would split a policy's probability across identical actions; exactly one representative slot
is offered instead, and :func:`off_deck_representative` picks it. Which real rank that is changes with
the mapping, which is the point — it is *an* off-deck rank, and they are all the same move.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Sequence, Tuple

from .canonical import JOKER_TYPE, NUM_CARD_TYPES, NUM_RANK_SLOTS, RankMapping

ACTION_PASS = 0
ACTION_CALL_BS = 1
ACTION_CALL_RESET = 2
PLAY_BASE = 3


def _build_card_choices() -> Tuple[Tuple[Tuple[int, ...], ...], Dict[Tuple[int, ...], int]]:
    choices: List[Tuple[int, ...]] = [(card_type,) for card_type in range(NUM_CARD_TYPES)]
    for first in range(NUM_CARD_TYPES):
        for second in range(first, NUM_CARD_TYPES):
            choices.append((first, second))
    return tuple(choices), {choice: index for index, choice in enumerate(choices)}


#: Every distinct 1- or 2-card play, as canonical card types.
CARD_CHOICES, CARD_CHOICE_INDEX = _build_card_choices()
NUM_CARD_CHOICES = len(CARD_CHOICES)

TRUMP_PLAY_BASE = PLAY_BASE + NUM_CARD_CHOICES
NUM_ACTIONS = TRUMP_PLAY_BASE + NUM_RANK_SLOTS * NUM_CARD_CHOICES


def play_index(choice_index: int) -> int:
    return PLAY_BASE + choice_index


def trump_play_index(trump_slot: int, choice_index: int) -> int:
    return TRUMP_PLAY_BASE + trump_slot * NUM_CARD_CHOICES + choice_index


def decompose(index: int) -> Tuple[str, Optional[int], Optional[int]]:
    """``(kind, trump_slot, choice_index)`` — the factored view, for an autoregressive head."""
    if index == ACTION_PASS:
        return "pass", None, None
    if index == ACTION_CALL_BS:
        return "callBS", None, None
    if index == ACTION_CALL_RESET:
        return "callReset", None, None
    if index < TRUMP_PLAY_BASE:
        return "play", None, index - PLAY_BASE
    offset = index - TRUMP_PLAY_BASE
    return "trumpPlay", offset // NUM_CARD_CHOICES, offset % NUM_CARD_CHOICES


def describe(index: int, mapping: Optional[RankMapping] = None) -> str:
    kind, trump_slot, choice_index = decompose(index)
    if kind in ("pass", "callBS", "callReset"):
        return kind

    types = CARD_CHOICES[choice_index] if choice_index is not None else ()
    cards = "+".join("Joker" if entry == JOKER_TYPE else f"slot{entry}" for entry in types)
    if kind == "play":
        return f"play({cards})"

    slot_label = f"slot{trump_slot}"
    if mapping is not None and trump_slot is not None:
        slot_label += f"[{mapping.rank(trump_slot)}{'' if mapping.is_in_deck(trump_slot) else ' off-deck'}]"
    return f"trumpPlay({slot_label}, {cards})"


def off_deck_representative(
    mapping: RankMapping, previous_trump_slot: Optional[int]
) -> Optional[int]:
    """The one off-deck slot offered as a trump choice, or ``None`` when the deck holds every rank.

    The lowest legal one, which is slot ``R`` unless last round's trump happens to be sitting there.
    """
    for slot in range(mapping.in_deck_slot_count, NUM_RANK_SLOTS):
        if slot != previous_trump_slot:
            return slot
    return None


def choice_for_cards(mapping: RankMapping, cards: Sequence[int]) -> int:
    """The canonical choice index a concrete card selection collapses to.

    A single card's index is its own card type, because ``_build_card_choices`` lays the fourteen
    singles down first. Worth the special case: this sits in the environment's hot path.
    """
    types = mapping.card_types
    if len(cards) == 1:
        return types[cards[0]]

    first = types[cards[0]]
    second = types[cards[1]]
    if first > second:
        first, second = second, first
    return CARD_CHOICE_INDEX[(first, second)]

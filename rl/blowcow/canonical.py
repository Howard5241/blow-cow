"""Canonical rank slots: the relabelling that makes rank identity invisible to a policy.

Rank identity carries no information in vanilla Blow Cow. Holding two `2`s and a `Q` is the same
position as holding two `3`s and a `K`; nothing in the rules compares ranks, orders them, or treats
one differently from another. What *does* matter is the partition:

* the ``R`` ranks that are in the deck, four copies each — mutually interchangeable;
* the ``13 - R`` ranks that are not, which may still be named as trump (legal, and it makes every
  play of the round a lie) — mutually interchangeable;
* whichever rank was trump last round, which may not be named again.

So the encoder works in **slots**, not ranks. A match fixes one random bijection from the thirteen
real ranks to thirteen slots, with the in-deck ranks landing in slots ``0..R-1`` and the rest in
``R..12``. The bijection is fixed for the whole match, so a slot keeps its identity turn to turn and
an agent can still track "I hold three of slot 4". Because it is re-drawn every episode, the slot
index itself carries nothing, and a policy cannot learn that "slot 0 is Aces".

That is also what lets a trained policy sit down at a real table: build the mapping from that match's
actual `selectedRanks`, and the policy sees the distribution it trained on whatever ranks were dealt.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Dict, Optional, Sequence, Tuple

from .cards import JOKER, RANKS, Deck, normalize_selected_ranks

#: Slots for the thirteen standard ranks.
NUM_RANK_SLOTS = 13

#: Jokers are their own card type rather than a rank slot: they are wild for BS, count for neither
#: four-of-a-kind nor the Reverse Rule, and can never be trump, so they share nothing with a rank.
JOKER_TYPE = NUM_RANK_SLOTS

#: Card types a hand can be described in: thirteen rank slots plus the Joker.
NUM_CARD_TYPES = NUM_RANK_SLOTS + 1

#: Copies of each card type in a full deck.
COPIES_PER_RANK = 4
COPIES_PER_JOKER = 2


def copies_of_type(card_type: int) -> int:
    return COPIES_PER_JOKER if card_type == JOKER_TYPE else COPIES_PER_RANK


@dataclass(frozen=True, slots=True)
class RankMapping:
    """A bijection between the thirteen real ranks and thirteen canonical slots.

    It also carries the two lookup tables everything downstream actually wants. Both are derivable
    from ``selected_ranks`` alone — the deck's layout is fully determined by it, suit-major over the
    sorted ranks with the two Jokers last — so precomputing them here keeps the hot paths out of
    string dictionaries.
    """

    slot_to_rank: Tuple[str, ...]
    rank_to_slot: Dict[str, int]
    in_deck_slot_count: int
    #: Canonical card type per ``deckOrder``, for the deck this mapping was built for.
    card_types: Tuple[int, ...]
    #: Copies of each canonical card type present in that deck. Zero for off-deck rank slots.
    type_copies: Tuple[int, ...]

    @staticmethod
    def from_permutation(
        selected_ranks: Sequence[str],
        in_deck_order: Sequence[int],
        off_deck_order: Sequence[int],
    ) -> "RankMapping":
        """Build from explicit permutations of the sorted in-deck and off-deck rank lists.

        Taking the two orders as indices into *sorted* lists rather than as ranks is what makes the
        relabelling test in ``rl/check_env.py`` possible: two decks that differ by a rank relabelling
        produce identical canonical views when given the same permutation indices.
        """
        in_deck = normalize_selected_ranks(selected_ranks)
        off_deck = [rank for rank in RANKS if rank not in set(in_deck)]

        if sorted(in_deck_order) != list(range(len(in_deck))):
            raise ValueError("in_deck_order must be a permutation of the in-deck ranks.")
        if sorted(off_deck_order) != list(range(len(off_deck))):
            raise ValueError("off_deck_order must be a permutation of the off-deck ranks.")

        slot_to_rank = [in_deck[index] for index in in_deck_order]
        slot_to_rank.extend(off_deck[index] for index in off_deck_order)
        rank_to_slot = {rank: slot for slot, rank in enumerate(slot_to_rank)}

        # `createDeck` lays cards out suit-major over the sorted in-deck ranks, then the two Jokers.
        rank_count = len(in_deck)
        card_types = tuple(
            rank_to_slot[in_deck[card % rank_count]] for card in range(4 * rank_count)
        ) + (JOKER_TYPE, JOKER_TYPE)

        type_copies = tuple(
            COPIES_PER_JOKER
            if card_type == JOKER_TYPE
            else (COPIES_PER_RANK if card_type < rank_count else 0)
            for card_type in range(NUM_CARD_TYPES)
        )

        return RankMapping(
            slot_to_rank=tuple(slot_to_rank),
            rank_to_slot=rank_to_slot,
            in_deck_slot_count=rank_count,
            card_types=card_types,
            type_copies=type_copies,
        )

    @staticmethod
    def random(selected_ranks: Sequence[str], rng: Optional[random.Random] = None) -> "RankMapping":
        rng = rng or random.Random()
        in_deck = normalize_selected_ranks(selected_ranks)
        off_deck_count = len(RANKS) - len(in_deck)

        in_deck_order = list(range(len(in_deck)))
        off_deck_order = list(range(off_deck_count))
        rng.shuffle(in_deck_order)
        rng.shuffle(off_deck_order)

        return RankMapping.from_permutation(selected_ranks, in_deck_order, off_deck_order)

    @staticmethod
    def identity(selected_ranks: Sequence[str]) -> "RankMapping":
        """In-deck ranks in rank order, then the rest. For readable failure reports and tests."""
        in_deck = normalize_selected_ranks(selected_ranks)
        off_deck_count = len(RANKS) - len(in_deck)
        return RankMapping.from_permutation(
            selected_ranks, list(range(len(in_deck))), list(range(off_deck_count))
        )

    def slot(self, rank: str) -> int:
        return self.rank_to_slot[rank]

    def rank(self, slot: int) -> str:
        return self.slot_to_rank[slot]

    def is_in_deck(self, slot: int) -> bool:
        return slot < self.in_deck_slot_count

    def card_type(self, card: int) -> int:
        """The canonical type of a concrete card. Suits are dropped here and nowhere else."""
        return self.card_types[card]

    def hand_counts(self, cards: Sequence[int]) -> list[int]:
        """A hand as counts per canonical card type — the whole of what a hand is, in vanilla."""
        counts = [0] * NUM_CARD_TYPES
        types = self.card_types
        for card in cards:
            counts[types[card]] += 1
        return counts

    def check_deck(self, deck: Deck) -> None:
        """Assert this mapping was built for that deck. Cheap, and catches a mismatched pairing."""
        if len(deck.rank) != len(self.card_types):
            raise ValueError("This RankMapping was built for a different deck.")
        for card, rank in enumerate(deck.rank):
            expected = JOKER_TYPE if rank == JOKER else self.rank_to_slot[rank]
            if self.card_types[card] != expected:
                raise ValueError("This RankMapping was built for a different deck.")

"""Deck construction and the card tables, mirroring ``createDeck`` in ``src/game/blowCowGame.ts``.

A card is an ``int`` here: its ``deckOrder``, which is exactly the number the real engine assigns and
embeds in its ``card-N`` ids. Keeping card identity rather than collapsing suits away is deliberate —
the conformance run compares hands and piles card for card, so the simulator has to be able to name
the same card the engine does.

Suits carry no strategic information in the vanilla game (four-of-a-kind is "count reaches 4", and a
single deck can never hold two of the same rank and suit), but that is a fact about *modelling*, not
about the rules. It belongs in the observation encoder, not in here.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Sequence, Tuple

RANKS: Tuple[str, ...] = ("A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K")
SUITS: Tuple[str, ...] = ("clubs", "diamonds", "hearts", "spades")
JOKER = "Joker"

RANK_SORT_INDEX: Dict[str, int] = {rank: index for index, rank in enumerate(RANKS)}
RANK_SORT_INDEX[JOKER] = 13

SUIT_SORT_INDEX: Dict[str, int] = {suit: index for index, suit in enumerate(SUITS)}
SUIT_SORT_INDEX["joker"] = 4

MIN_PLAYERS = 2
MAX_PLAYERS = 8


def normalize_selected_ranks(selected_ranks: Sequence[str]) -> List[str]:
    """``normalizeSelectedRanks``: drop unknowns, collapse duplicates, order by rank."""
    unique = {rank for rank in selected_ranks if rank in RANK_SORT_INDEX and rank != JOKER}
    return sorted(unique, key=lambda rank: RANK_SORT_INDEX[rank])


def get_max_cards_on_table(player_count: int) -> int:
    """``getMaxCardsOnTable``. Not monotonic in the player count, which is the rules' own choice."""
    if player_count <= 2:
        return 10
    if player_count <= 4:
        return 12
    if player_count == 5:
        return 10
    if player_count == 6:
        return 12
    if player_count == 7:
        return 14
    return 16


def get_default_standard_rank_count(player_count: int) -> int:
    """``getDefaultStandardRankCount``."""
    if player_count <= 2:
        return 4
    if player_count == 3:
        return 6
    if player_count == 4:
        return 9
    if player_count == 5:
        return 11
    return len(RANKS)


@dataclass(slots=True)
class Deck:
    """Card metadata for one match configuration, indexed by ``deckOrder``."""

    selected_ranks: Tuple[str, ...]
    rank: Tuple[str, ...]
    suit: Tuple[str, ...]
    sort_key: Tuple[Tuple[int, int, int], ...]

    @property
    def size(self) -> int:
        return len(self.rank)

    def card_ids(self) -> List[int]:
        return list(range(self.size))

    def sorted_cards(self, cards: Sequence[int]) -> List[int]:
        """``sortCards``: by rank, then suit, then sprite/id — and deck order settles both tails."""
        return sorted(cards, key=lambda card: self.sort_key[card])

    def label(self, card: int) -> str:
        return f"{self.rank[card]}{'' if self.rank[card] == JOKER else ' of ' + self.suit[card]}"


def build_deck(selected_ranks: Sequence[str]) -> Deck:
    """``createDeck``: suit-major over the selected ranks, then the two Jokers."""
    ranks = tuple(normalize_selected_ranks(selected_ranks))
    if len(ranks) < 2:
        raise ValueError("A deck needs at least 2 standard ranks.")

    card_ranks: List[str] = []
    card_suits: List[str] = []

    for suit in SUITS:
        for rank in ranks:
            card_ranks.append(rank)
            card_suits.append(suit)

    for _ in range(2):
        card_ranks.append(JOKER)
        card_suits.append("joker")

    sort_key = tuple(
        (RANK_SORT_INDEX[card_ranks[index]], SUIT_SORT_INDEX[card_suits[index]], index)
        for index in range(len(card_ranks))
    )

    return Deck(
        selected_ranks=ranks,
        rank=tuple(card_ranks),
        suit=tuple(card_suits),
        sort_key=sort_key,
    )

"""One Ante Mode round, as a headless simulator.

`RULES-ANTE.md` is the source of truth for what this does, and `rl/ante_conformance.py` is what holds
this file to the real engine move for move. Nothing here decides a rule that is not written there.

Two abstractions are made, and both are earned rather than assumed:

**Cards are card *types*, not cards.** A card is its rank slot `0..R-1`, or the Joker at `R`. Suits do
nothing in Ante — there are no characters, no action ranks and no cheats, so every place a card is
inspected asks only "is it the trump rank" or "is it a Joker". Two cards of one rank are therefore
interchangeable everywhere, which is what lets a hand be a vector of counts.

**Seats are indexed in turn order.** Seat 0 is the round's starting player and the next to act is
always `(seat + 1) % n`. Ante fixes `Direction` at counterclockwise for the whole match, so the
engine's ring walk is this ring read backwards; the conformance harness is the one place that
translates between the two.

The module is dependency-free on purpose, the way Stage A of the classic work is, so it runs on any
Python 3.10+ and so a search can clone it cheaply.
"""

from __future__ import annotations

import random
from typing import List, Optional, Sequence, Tuple

from .config import (
    COPIES_PER_RANK,
    DEFAULT_CONFIG,
    JOKER_COPIES,
    TOTAL_STANDARD_RANKS,
    AnteConfig,
)

# --------------------------------------------------------------------------- actions

#: An action is one of these. `PLAY` carries the trump slot it selects (``None`` once the round has
#: one) and the multiset of card types it puts down, as a sorted tuple of length 1 or 2.
ACTION_PASS = "pass"
ACTION_CALL_BS = "bs"
ACTION_PLAY = "play"

Action = Tuple  # ("pass",) | ("bs",) | ("play", Optional[int], Tuple[int, ...])

# --------------------------------------------------------------------------- endings

#: `Ending 1`. The only ending that takes gold away, and so the only one with a loser.
ENDING_BS = "bs"
#: `Ending 2`. `n` consecutive passes; the last passer wins.
ENDING_ALL_PASS = "all_pass"
#: `Ending 3`. An empty hand at the start of a turn, checked before `Take Turn`.
ENDING_EMPTY_HAND = "empty_hand"

#: How much a `Play` may put down. `Max Cards Per Play Rule`, which Ante plays unchanged.
MAX_CARDS_PER_PLAY = 2

def turn_limit(deck_size: int, num_seats: int) -> int:
    """How long a round can possibly run. An assertion, not a move limit.

    Hands only shrink, and between any two plays there are at most `n - 1` passes before `Ending 2`
    fires, so the bound follows from the deck size. Nothing here needs a move limit and nothing can
    be truncated — the single biggest structural difference from the classic game, where a table
    that never challenges cycles for ever and truncation had to be *scored*.
    """
    return deck_size * num_seats + num_seats + 8


#: How much more likely a player with trump in hand is to play it than chance would suggest. The
#: honest branch is scaled by this before the complement is taken. Carried over unchanged from
#: `rl/blowcow/observation.py`, so the two packages' counting estimates are the same estimate.
HONEST_PLAY_BIAS = 4.0


def lie_probability_from_counts(claimed: int, trump_left: int, unseen: int) -> float:
    """Chance a claim of ``claimed`` hidden trump cards is a lie, from what the viewer cannot see.

    The arithmetic only, with no state, because it has two callers that must never drift: the
    scripted `heuristic` bot and the per-seat observation feature. Two transcriptions of one
    hypergeometric would disagree eventually and nothing else would notice.
    """
    if claimed <= 0:
        return 0.0
    if trump_left < claimed:
        return 1.0  # They cannot be telling the truth; the cards are not there to be held.
    if unseen <= 0:
        return 0.0

    chance_all_trump = 1.0
    for offset in range(claimed):
        chance_all_trump *= max(0.0, trump_left - offset) / max(1.0, unseen - offset)
    return 1.0 - min(1.0, chance_all_trump * HONEST_PLAY_BIAS)


class Play:
    """One play on the table.

    ``size`` is public the moment the cards land — a play announces how many cards it puts down.
    ``types`` is public only once ``revealed``, which the Reveal Rule does at the start of the
    player's next turn. That one-lap delay is the whole game.
    """

    __slots__ = ("seat", "types", "size", "revealed", "trump_selection", "turn")

    def __init__(self, seat: int, types: Tuple[int, ...], trump_selection: bool, turn: int) -> None:
        self.seat = seat
        self.types = types
        self.size = len(types)
        self.revealed = False
        self.trump_selection = trump_selection
        self.turn = turn

    def copy(self) -> "Play":
        clone = Play.__new__(Play)
        clone.seat = self.seat
        clone.types = self.types
        clone.size = self.size
        clone.revealed = self.revealed
        clone.trump_selection = self.trump_selection
        clone.turn = self.turn
        return clone


class Event:
    """One public thing that happened, in order. What a seat at the table would have seen."""

    __slots__ = ("seat", "kind", "size", "trump_selection", "revealed_honest")

    def __init__(
        self,
        seat: int,
        kind: str,
        size: int = 0,
        trump_selection: bool = False,
        revealed_honest: Optional[bool] = None,
    ) -> None:
        self.seat = seat
        self.kind = kind  # "play" | "pass" | "reveal"
        self.size = size
        self.trump_selection = trump_selection
        #: Only set on a `reveal`: whether the cards turned over were really all trump. Public — the
        #: whole table watches the flip.
        self.revealed_honest = revealed_honest


class IllegalAction(RuntimeError):
    pass


class AnteRound:
    """A single Ante round played by ``num_seats`` seats out of a deck of ``active_ranks`` ranks.

    The round ends in exactly one of three ways and always names exactly one winner. Reward is the
    gold that moves: ``+1`` to the winner, ``-1`` to a lost `Call BS`, ``0`` to everyone else.

    **The two shape parameters are not on the config, and that separation is the whole reason a
    multi-round match is possible.** `AnteConfig` fixes what a *network* is built for — how many seat
    rows the observation has, how many card-type rows, how wide the action space is. Elimination moves
    neither: it shrinks the table and re-derives the deck for the new `n` (`RULES-ANTE.md`,
    `Elimination`), so a match that starts at five seats plays later rounds at four, three and two out
    of steadily smaller decks. Carrying that on the config would mean a new network per round.

    So the config stays at the *starting* shape and a round is told its own. Two consequences are
    load-bearing:

    * **The Joker keeps index ``config.joker_type`` at every deck size.** Ranks occupy `0..R'-1` and
      the slots from `R'` up to `config.num_ranks` are simply out of the deck. Numbering the Joker
      `R'` instead would slide its row along the observation every time somebody went bankrupt.
    * **Ranks may be renumbered freely between rounds**, because rank identity carries nothing across
      one. The whole deck is redealt and Ante drops the `Rank Change Rule`, so which of the engine's
      thirteen labels survived an elimination is information about nothing. A round needs the rank
      *count*; it never needs to know which ranks they were.
    """

    __slots__ = (
        "config",
        "n",
        "active_ranks",
        "copies",
        "hands",
        "table",
        "events",
        "trump",
        "pass_streak",
        "last_non_passing",
        "pending_reveal",
        "current",
        "turn",
        "finished",
        "winner",
        "loser",
        "ending",
        "_turn_limit",
    )

    def __init__(
        self,
        config: AnteConfig = DEFAULT_CONFIG,
        num_seats: Optional[int] = None,
        active_ranks: Optional[int] = None,
    ) -> None:
        self.config = config
        self.n = config.num_players if num_seats is None else num_seats
        self.active_ranks = config.num_ranks if active_ranks is None else active_ranks
        if not 2 <= self.n <= config.num_players:
            raise ValueError(f"A round seats 2 to {config.num_players} players, not {self.n}")
        if not 1 <= self.active_ranks <= config.num_ranks:
            raise ValueError(f"A round deck holds 1 to {config.num_ranks} ranks, not {self.active_ranks}")

        # Out-of-deck rank slots hold zero copies rather than being removed, so every per-type array
        # in this file and in the encoder stays `config.num_types` long whatever the table has done.
        self.copies: Tuple[int, ...] = tuple(
            [COPIES_PER_RANK] * self.active_ranks
            + [0] * (config.num_ranks - self.active_ranks)
            + [JOKER_COPIES]
        )
        self.hands: List[List[int]] = []
        self.table: List[Play] = []
        self.events: List[Event] = []
        self.trump: Optional[int] = None
        self.pass_streak = 0
        self.last_non_passing: Optional[int] = None
        self.pending_reveal: List[Optional[int]] = []
        self.current = 0
        self.turn = 0
        self.finished = False
        self.winner: Optional[int] = None
        self.loser: Optional[int] = None
        self.ending: Optional[str] = None
        self._turn_limit = turn_limit(self.deck_size, self.n)

    # ----------------------------------------------------------------- shape

    @property
    def deck_size(self) -> int:
        return sum(self.copies)

    @property
    def trump_slots(self) -> List[int]:
        """The trump ranks that may be named: the ones in the deck, plus one off-deck representative.

        A rank slot the deck no longer holds is not offered, because naming it would be the same move
        as naming the off-deck slot — every play becomes a lie unless it is a Joker and the Reverse
        Rule can never arm. Two indices for one move split a policy's probability across identical
        actions, which is the collapse `off_deck_trump` exists to make in the first place.
        """
        slots = list(range(self.active_ranks))
        if self.active_ranks < TOTAL_STANDARD_RANKS:
            slots.append(self.config.off_deck_trump)
        return slots

    # ----------------------------------------------------------------- setup

    @classmethod
    def deal(
        cls,
        config: AnteConfig = DEFAULT_CONFIG,
        rng: Optional[random.Random] = None,
        hands: Optional[Sequence[Sequence[int]]] = None,
        num_seats: Optional[int] = None,
        active_ranks: Optional[int] = None,
    ) -> "AnteRound":
        """Gather every card in the game, shuffle, and deal it out.

        ``hands`` bypasses the shuffle with an explicit deal, which is how the conformance harness
        puts this simulator on the engine's cards without either side telling the other what it drew.
        """
        game = cls(config, num_seats=num_seats, active_ranks=active_ranks)
        num_players = game.n
        deck_size = game.deck_size

        if hands is None:
            deck: List[int] = []
            for card_type, copies in enumerate(game.copies):
                deck.extend([card_type] * copies)
            (rng or random.Random()).shuffle(deck)

            # The remainder goes to the seats **latest** in turn order. Holding fewer cards is an
            # advantage here, and seat 0 already picks the trump rank and acts first, so the extras
            # are dealt away from them. See `dealAnteHands` and `RULES-ANTE.md`.
            base = deck_size // num_players
            remainder = deck_size % num_players
            game.hands = []
            cursor = 0
            for seat in range(num_players):
                size = base + (1 if seat >= num_players - remainder else 0)
                counts = [0] * config.num_types
                for card_type in deck[cursor : cursor + size]:
                    counts[card_type] += 1
                game.hands.append(counts)
                cursor += size
        else:
            game.hands = [list(hand) for hand in hands]

        game.pending_reveal = [None] * num_players
        game.current = 0
        game.turn = 0
        game._begin_turn()
        return game

    def clone(self) -> "AnteRound":
        """A hand-rolled copy, for search. Everything here is a list of ints or of frozen plays."""
        other = AnteRound.__new__(AnteRound)
        other.config = self.config
        other.n = self.n
        other.active_ranks = self.active_ranks
        other.copies = self.copies
        other.hands = [list(hand) for hand in self.hands]
        other.table = [play.copy() for play in self.table]
        other.events = list(self.events)  # Events are never mutated after construction.
        other.trump = self.trump
        other.pass_streak = self.pass_streak
        other.last_non_passing = self.last_non_passing
        other.pending_reveal = list(self.pending_reveal)
        other.current = self.current
        other.turn = self.turn
        other.finished = self.finished
        other.winner = self.winner
        other.loser = self.loser
        other.ending = self.ending
        other._turn_limit = self._turn_limit
        return other

    # ----------------------------------------------------------------- turn flow

    def _begin_turn(self) -> None:
        """`handleTurnStart` plus the Reveal Rule, neither of which is a choice.

        Ordering is load-bearing and matches the engine: the empty-hand check sits **above** the turn
        being opened, so `Take Turn` is never pressed and this seat's own reveal never runs. `Call BS`
        is still the only thing that could have stopped the play — the round is already lost by the
        time the table finds out what it was. `_finish` turns it over on the way out.
        """
        self.turn += 1
        if self.turn > self._turn_limit:
            raise RuntimeError("An Ante round ran past its arithmetic bound")

        seat = self.current
        if sum(self.hands[seat]) == 0:
            self._finish(seat, None, ENDING_EMPTY_HAND)
            return

        play_index = self.pending_reveal[seat]
        self.pending_reveal[seat] = None
        if play_index is not None:
            play = self.table[play_index]
            if not play.revealed:
                play.revealed = True
                self.events.append(
                    Event(seat, "reveal", play.size, revealed_honest=self._is_honest(play))
                )

    def _advance(self) -> None:
        self.current = (self.current + 1) % self.n
        self._begin_turn()

    def _finish(self, winner: int, loser: Optional[int], ending: str) -> None:
        """Settle the round, table face up.

        All three endings turn the whole table over — the engine walks `Ending 2` and `Ending 3`
        through the same reveal procedure `Call BS` uses — so the flip lives here rather than in one
        ending's branch. It changes nothing an agent sees: a finished round is terminal, and
        `AnteEnv` hands a terminal decision a zero observation. What reads it is the match layer's
        public record, for which `play.revealed` is the honest test of "did the table see this".
        """
        for play in self.table:
            play.revealed = True
        self.finished = True
        self.winner = winner
        self.loser = loser
        self.ending = ending

    # ----------------------------------------------------------------- reading the table

    def _is_trump_type(self, card_type: int) -> bool:
        """The Joker Rule: a Joker is treated as having the trump rank, whatever that rank is."""
        if card_type == self.config.joker_type:
            return True
        return self.trump is not None and card_type == self.trump

    def _is_honest(self, play: Play) -> bool:
        """Were the cards really all of the claimed rank. The whole question `Call BS` asks."""
        return all(self._is_trump_type(card_type) for card_type in play.types)

    def pending_play_index(self, seat: int) -> Optional[int]:
        """That seat's live claim: their most recent play that is still face down.

        A seat holds at most one at a time — the Reveal Rule turns the previous one over before they
        may act again — but this is written as a search so it does not depend on that argument.
        """
        for index in range(len(self.table) - 1, -1, -1):
            play = self.table[index]
            if play.seat == seat and not play.revealed:
                return index
        return None

    def is_play_honest(self, play: Play) -> bool:
        """Were that play's cards really all trump. Public because the match layer reads the table.

        Ground truth, so it is for the environment's own resolution and for the *public* record a
        finished round leaves — never for an agent deciding. Which plays are in that record is
        `AnteMatch._record_round`'s question, not this one's.
        """
        return self._is_honest(play)

    def claim_was_honest(self, seat: int) -> Optional[bool]:
        """Whether that seat's live claim is really all trump, or ``None`` if they have none.

        Ground truth, so it is for instrumentation and for the environment's own resolution — never
        for an agent. Every measurement of call accuracy in `rl/ante_train.py` and
        `rl/ante_evaluate.py` reads it, which is why it is one public method rather than three
        reaches into a private one.
        """
        index = self.pending_play_index(seat)
        return None if index is None else self._is_honest(self.table[index])

    def bs_target(self) -> Optional[int]:
        """Who the current player may call BS on: the previous non-passing player, or nobody.

        Transcribes `getDefaultBSTargetPlayerID`. The target must have a live claim, which is why a
        player whose own play went uncontested cannot call BS on themselves and is left with
        `{Play, Pass}` — and why passing there wins the round outright.
        """
        if self.trump is None or self.last_non_passing is None:
            return None
        if self.last_non_passing == self.current:
            return None
        return self.last_non_passing if self.pending_play_index(self.last_non_passing) is not None else None

    def reverse_rule_count(self) -> int:
        """Cards of the trump rank on the table, Jokers excluded.

        Counted over every play, face up or face down, because a `Call BS` flips the whole table
        before the count is taken. A caller can only see the face-up half of this, which is exactly
        the uncertainty the rule adds.
        """
        # `>= active_ranks` covers the off-deck slot and, after an elimination trimmed the deck, every
        # rank slot that is no longer in it. Neither can put a card of the trump rank on the table.
        if self.trump is None or self.trump >= self.active_ranks:
            return 0
        return sum(
            1
            for play in self.table
            for card_type in play.types
            if card_type == self.trump
        )

    def table_card_count(self) -> int:
        return sum(play.size for play in self.table)

    # ----------------------------------------------------------------- legality

    def legal_actions(self) -> List[Action]:
        """Every action the current player may take. The reference the flat mask is checked against."""
        if self.finished:
            return []

        actions: List[Action] = [(ACTION_PASS,)]
        if self.bs_target() is not None:
            actions.append((ACTION_CALL_BS,))

        hand = self.hands[self.current]
        held = [card_type for card_type, count in enumerate(hand) if count > 0]
        choices: List[Tuple[int, ...]] = [(card_type,) for card_type in held]
        for left_index, left in enumerate(held):
            for right in held[left_index:]:
                if left == right and hand[left] < 2:
                    continue
                choices.append((left, right))

        if self.trump is None:
            # `{Select trump rank and play, Pass}`. Every in-deck rank, plus one representative of
            # the ranks that are not in the deck.
            for trump_slot in self.trump_slots:
                for choice in choices:
                    actions.append((ACTION_PLAY, trump_slot, choice))
        else:
            for choice in choices:
                actions.append((ACTION_PLAY, None, choice))

        return actions

    def is_legal(self, action: Action) -> bool:
        if self.finished:
            return False

        kind = action[0]
        if kind == ACTION_PASS:
            return True
        if kind == ACTION_CALL_BS:
            return self.bs_target() is not None
        if kind != ACTION_PLAY:
            return False

        trump_slot, types = action[1], action[2]
        if (trump_slot is None) != (self.trump is not None):
            return False
        if trump_slot is not None and trump_slot not in self.trump_slots:
            return False
        if not 1 <= len(types) <= MAX_CARDS_PER_PLAY:
            return False

        hand = self.hands[self.current]
        for card_type in set(types):
            if hand[card_type] < types.count(card_type):
                return False
        return True

    # ----------------------------------------------------------------- moves

    def apply(self, action: Action) -> None:
        if not self.is_legal(action):
            raise IllegalAction(f"{action!r} is not legal for seat {self.current}")

        kind = action[0]
        if kind == ACTION_PASS:
            self._apply_pass()
        elif kind == ACTION_CALL_BS:
            self._apply_call_bs()
        else:
            self._apply_play(action[1], action[2])

    def _apply_pass(self) -> None:
        seat = self.current
        self.pass_streak += 1
        self.events.append(Event(seat, "pass"))

        # `Ending 2`. The trigger and the seat it singles out are vanilla's Pass Ending Rule
        # unchanged; only the reward differs. Note the consequence: with the streak at `n - 1`,
        # passing wins the round outright, which makes it a dominant action there.
        if self.pass_streak >= self.n:
            self._finish(seat, None, ENDING_ALL_PASS)
            return

        self._advance()

    def _apply_play(self, trump_slot: Optional[int], types: Tuple[int, ...]) -> None:
        seat = self.current
        hand = self.hands[seat]
        for card_type in types:
            hand[card_type] -= 1

        play = Play(seat, tuple(sorted(types)), trump_slot is not None, self.turn)
        self.table.append(play)
        self.pending_reveal[seat] = len(self.table) - 1

        if trump_slot is not None:
            self.trump = trump_slot
        self.pass_streak = 0
        self.last_non_passing = seat
        self.events.append(Event(seat, "play", play.size, trump_selection=trump_slot is not None))
        self._advance()

    def _apply_call_bs(self) -> None:
        """`Ending 1`, and the only ending that takes gold away from anybody."""
        caller = self.current
        target = self.bs_target()
        assert target is not None
        play = self.table[self.pending_play_index(target)]

        honest = self._is_honest(play)
        # Every card on the table goes face up before the count is taken, so the count is over all of
        # them. Jokers never contribute — see the Joker Rule. `_finish` is what does the flipping.
        reversed_result = self.reverse_rule_count() >= 4

        default_loser = caller if honest else target
        loser = (target if default_loser == caller else caller) if reversed_result else default_loser
        winner = target if loser == caller else caller

        self._finish(winner, loser, ENDING_BS)

    # ----------------------------------------------------------------- rewards

    def rewards(self) -> List[float]:
        """The gold that moved: ``+1`` to the winner, ``-1`` to a lost `Call BS`, ``0`` otherwise.

        Deliberately not zero-sum. Two of the three endings mint a gold from the bank and only
        `Call BS` takes one away, which is the mode's economy rather than an oversight — see the
        design notes at the end of `RULES-ANTE.md`.
        """
        payoff = [0.0] * self.n
        if not self.finished:
            return payoff
        payoff[self.winner] = 1.0
        if self.loser is not None:
            payoff[self.loser] = -1.0
        return payoff

    # ----------------------------------------------------------------- viewer-side counting

    def unaccounted(self, viewer: int) -> List[int]:
        """Copies of each card type the viewer cannot place: in another hand, or face down in front
        of somebody else.

        The sufficient statistic for everything a viewer can infer. A player *can* see their own face
        down cards — they played them — so their own pile is subtracted along with their hand.
        """
        counts = list(self.copies)
        for card_type, held in enumerate(self.hands[viewer]):
            counts[card_type] -= held
        for play in self.table:
            if play.revealed or play.seat == viewer:
                for card_type in play.types:
                    counts[card_type] -= 1
        return counts

    def claim_lie_probability(self, viewer: int, target: int) -> float:
        """The counting read on ``target``'s live claim, from ``viewer``'s seat. Zero for yourself."""
        if target == viewer or self.trump is None:
            return 0.0
        index = self.pending_play_index(target)
        if index is None:
            return 0.0

        unaccounted = self.unaccounted(viewer)
        trump_left = unaccounted[self.config.joker_type]
        # A trump slot at or above `active_ranks` is a rank the deck does not hold — the off-deck
        # representative, or one an elimination trimmed away — so only Jokers can honestly answer it.
        if self.trump < self.active_ranks:
            trump_left += unaccounted[self.trump]
        return lie_probability_from_counts(self.table[index].size, trump_left, sum(unaccounted))

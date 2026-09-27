"""A whole Ante match: rounds, gold, elimination, and the public record that survives a round.

`AnteRound` is one round and knows nothing outside it. This is the layer above — the one the
one-round package was built to earn the right to write. `RULES-ANTE.md` is the source of truth and
`rl/ante_conformance.py --rounds N` is what holds this to the engine.

**Why this layer exists at all.** The one-round agent's measured defect is not that it calls too
rarely; a sweep over a bias on its `Call BS` logit is flat against its own population and worth
`+0.100` against a bluffer, so the rate is a correct answer to the wrong question. The failure is
opponent modelling, and a single round cannot support it: two or three reveals spread across four
opponents is under one honesty observation each. Twenty rounds give twenty to sixty. That is the
whole argument for this file, and `match_lie_rate` in `match_observation.py` is the feature it exists
to make available.

Three things are carried across a round boundary and nothing else is:

* **Gold**, which is the score, and elimination at zero.
* **The deck**, which shrinks as seats are lost — see `Elimination`.
* **The public record** of who was caught lying and who called, which is the modelling signal.

No card, no hand and no table position survives a round: the whole deck is redealt every time.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Sequence, Tuple

from .config import AnteConfig, DEFAULT_CONFIG, standard_rank_count
from .game import ENDING_BS, Action, AnteRound

#: ``(live match seats in turn order, ranks in the deck) -> hands, or None to shuffle``.
Dealer = Callable[[List[int], int], Optional[Sequence[Sequence[int]]]]

#: What a seat's honesty record is built from. ``full`` counts every play the round held; ``round``
#: counts only the ones the table actually saw.
#:
#: **The two no longer separate anything, and that is a rules change rather than a bug here.** ``full``
#: was written as the proposal that all three endings turn the table over, against a ``round`` where
#: `Ending 3` buried the hand-emptying play for ever. The proposal shipped — see `RULES-ANTE.md` and
#: `AnteRound._finish` — so every play is face up by the time a round settles and both modes now read
#: the same table. The flag is kept so saved configs and run manifests still load, and so the finding
#: it produced (`rl/ANTE.md`, "Full post-round disclosure would change almost nothing") stays legible.
DISCLOSURE_MODES = ("round", "full")


@dataclass(frozen=True)
class MatchConfig:
    """The match's shape. ``shape`` is the *starting* table and is what a network is built for."""

    shape: AnteConfig = DEFAULT_CONFIG
    round_limit: int = 20
    starting_gold: int = 5
    disclosure: str = "round"

    def __post_init__(self) -> None:
        if self.round_limit < 1:
            raise ValueError(f"A match runs at least one round, not {self.round_limit}")
        if self.starting_gold < 1:
            raise ValueError(f"A seat starts with at least one gold, not {self.starting_gold}")
        if self.disclosure not in DISCLOSURE_MODES:
            raise ValueError(f"Disclosure is one of {DISCLOSURE_MODES}, not {self.disclosure!r}")

    @property
    def num_players(self) -> int:
        return self.shape.num_players


@dataclass
class SeatRecord:
    """Everything public about one seat, accumulated over completed rounds.

    Every field here is something the whole table watched happen. `lies` and `honest` come from
    reveals — the Reveal Rule's, a `Call BS` flipping the table, and under ``full`` disclosure the
    end-of-round sweep as well — so the pair is the honesty record and nothing else is.
    """

    lies: int = 0
    honest: int = 0
    calls_made: int = 0
    calls_won: int = 0
    rounds_won: int = 0
    bs_losses: int = 0
    plays: int = 0
    passes: int = 0

    @property
    def observations(self) -> int:
        return self.lies + self.honest

    @property
    def lie_rate(self) -> float:
        """Their measured dishonesty, or 0.5 with nothing to go on. The one number this file is for."""
        total = self.observations
        return 0.5 if total == 0 else self.lies / total


@dataclass
class RoundOutcome:
    """What one finished round did, in match-seat terms."""

    round_number: int
    ending: str
    winner: int
    loser: Optional[int]
    gold_delta: List[float]
    eliminated: List[int] = field(default_factory=list)


class AnteMatch:
    """``round_limit`` rounds of Ante, or until one seat is left.

    Seats are numbered by their **original** seating, `0..N-1`, and keep that number for the whole
    match even after the table shrinks — the network's seat rows are indexed by it. A round numbers
    its own live seats `0..n-1` in turn order, and :attr:`seats` is the map between the two. That is
    the same split `rl/ante_conformance.py` already makes between engine seats and simulator seats,
    for the same reason: exactly one place is allowed to know both.
    """

    def __init__(
        self,
        config: MatchConfig = MatchConfig(),
        rng: Optional[random.Random] = None,
        starting_seat: int = 0,
        dealer: Optional[Dealer] = None,
    ) -> None:
        """``dealer`` overrides the shuffle, and is the seam `rl/ante_conformance.py` drives through.

        It is called once per round with the live seats in turn order and the deck size, and returns
        the hands to deal or ``None`` to shuffle as usual — the same escape hatch `AnteRound.deal`
        already offers, lifted one layer so a whole match can be played on the engine's cards. Dealing
        the simulator what the engine dealt is stricter than sharing a PRNG, because a bug in
        `dealAnteHands` then shows up as a hand mismatch rather than as two copies of one mistake.
        """
        self.config = config
        self.shape = config.shape
        self.rng = rng or random.Random()
        self.dealer = dealer

        self.num_seats = config.num_players
        self.gold: List[int] = [config.starting_gold] * self.num_seats
        self.eliminated: List[bool] = [False] * self.num_seats
        #: Round number a seat left on, for the placement tie-break. Leaving later ranks higher.
        self.left_at: List[Optional[int]] = [None] * self.num_seats
        self.records: List[SeatRecord] = [SeatRecord() for _ in range(self.num_seats)]

        self.active_ranks = self.shape.num_ranks
        self.round_number = 0
        self.starting_seat = starting_seat
        self.finished = False
        self.outcomes: List[RoundOutcome] = []

        self.round: Optional[AnteRound] = None
        #: Round seat -> match seat, for the round in progress.
        self.seats: List[int] = []
        #: Match seat -> round seat, for the round in progress.
        self.round_seat: Dict[int, int] = {}
        #: The gold each match seat gained or lost in the round that just finished.
        self.last_gold_delta: List[float] = [0.0] * self.num_seats

        self._begin_round()

    # ----------------------------------------------------------------- shape

    @property
    def active_seats(self) -> List[int]:
        return [seat for seat in range(self.num_seats) if not self.eliminated[seat]]

    @property
    def num_active(self) -> int:
        return sum(1 for done in self.eliminated if not done)

    @property
    def rounds_left(self) -> int:
        return max(0, self.config.round_limit - self.round_number)

    # ----------------------------------------------------------------- rounds

    def _turn_order(self) -> List[int]:
        """Live match seats, in turn order, starting from whoever starts this round.

        Ante fixes `Direction` counterclockwise for the whole match and never flips it, so turn order
        is the seating rotated to put the starting player first, with the eliminated skipped.
        """
        active = self.active_seats
        start = active.index(self.starting_seat)
        return active[start:] + active[:start]

    def _begin_round(self) -> None:
        active = self.active_seats
        if len(active) <= 1:
            self.finished = True
            return
        if self.round_number >= self.config.round_limit:
            self.finished = True
            return

        # The deck is re-derived for whoever is left, and only ever shrinks: `RULES-ANTE.md` says
        # dropped ranks never come back even when a later rank count would allow them. Which ranks
        # were dropped is not tracked, because rank identity carries nothing across a round — the
        # whole deck is redealt and Ante drops the `Rank Change Rule`. See `AnteRound`.
        self.active_ranks = min(self.active_ranks, standard_rank_count(len(active)))

        self.round_number += 1
        if self.starting_seat not in active:
            self.starting_seat = active[0]
        self.seats = self._turn_order()
        self.round_seat = {match_seat: index for index, match_seat in enumerate(self.seats)}
        hands = None if self.dealer is None else self.dealer(list(self.seats), self.active_ranks)
        self.round = AnteRound.deal(
            self.shape,
            rng=self.rng,
            hands=hands,
            num_seats=len(self.seats),
            active_ranks=self.active_ranks,
        )
        # A round can be over before anybody acts only if a hand were empty at the deal, which cannot
        # happen — the smallest hand at any seat count is five cards. Settled anyway so the invariant
        # "a live match is standing at a decision" holds by construction rather than by argument.
        if self.round.finished:
            self._settle_round()

    # ----------------------------------------------------------------- the loop

    @property
    def current_seat(self) -> Optional[int]:
        """The match seat on the clock, or ``None`` when the match is over."""
        if self.finished or self.round is None:
            return None
        return self.seats[self.round.current]

    def legal_actions(self) -> List[Action]:
        return [] if self.finished or self.round is None else self.round.legal_actions()

    def apply(self, action: Action) -> None:
        if self.finished or self.round is None:
            raise RuntimeError("The match is over")
        self.round.apply(action)
        if self.round.finished:
            self._settle_round()

    # ----------------------------------------------------------------- settlement

    def _record_round(self, game: AnteRound) -> None:
        """Fold the round's public record into the per-seat totals.

        The honesty half is read off the **table**, not off the reveal events, and that is the one
        subtle thing in this file. Every ending flips the whole table face up in `_finish` without
        emitting a reveal event for any of it, so an event-based record would miss the richest
        disclosure in the game — a whole round's plays at once. `play.revealed` is the honest test of
        "did the table see this", whichever thing flipped it.

        The ``disclosure`` branch below no longer separates anything, because no play survives a round
        face down any more. It is kept as the *test* of that claim rather than an assumption of it —
        see `DISCLOSURE_MODES` for why the flag outlived the rules change that emptied it.
        """
        for event in game.events:
            record = self.records[self.seats[event.seat]]
            if event.kind == "play":
                record.plays += 1
            elif event.kind == "pass":
                record.passes += 1

        for play in game.table:
            if not play.revealed and self.config.disclosure != "full":
                continue
            record = self.records[self.seats[play.seat]]
            if game.is_play_honest(play):
                record.honest += 1
            else:
                record.lies += 1

        if game.ending == ENDING_BS:
            # The caller is whoever ended the round, and `_apply_call_bs` finishes on their turn.
            caller = self.seats[game.current]
            self.records[caller].calls_made += 1
            if game.winner is not None and self.seats[game.winner] == caller:
                self.records[caller].calls_won += 1

    def _settle_round(self) -> None:
        game = self.round
        assert game is not None and game.finished

        self._record_round(game)

        delta = [0.0] * self.num_seats
        winner = self.seats[game.winner]
        delta[winner] = 1.0
        self.gold[winner] += 1
        self.records[winner].rounds_won += 1
        loser: Optional[int] = None
        if game.loser is not None:
            loser = self.seats[game.loser]
            delta[loser] = -1.0
            self.gold[loser] -= 1
            self.records[loser].bs_losses += 1
        self.last_gold_delta = delta

        # Only `Ending 1` removes gold, so at most one seat can go bankrupt per round. Written as a
        # sweep anyway so it stays correct if that ever stops being true.
        gone: List[int] = []
        for seat in range(self.num_seats):
            if not self.eliminated[seat] and self.gold[seat] <= 0:
                self.eliminated[seat] = True
                self.left_at[seat] = self.round_number
                gone.append(seat)

        self.outcomes.append(
            RoundOutcome(
                round_number=self.round_number,
                ending=game.ending or "?",
                winner=winner,
                loser=loser,
                gold_delta=delta,
                eliminated=gone,
            )
        )

        self.starting_seat = winner
        self._begin_round()

    # ----------------------------------------------------------------- results

    def placements(self) -> List[int]:
        """Each seat's finishing place, `0` for first. Ties share a place.

        `RULES-ANTE.md`, `Game End And Final Ranking`: most gold wins, every eliminated seat ranks
        below every survivor, and eliminated seats are ranked against each other by when they left,
        later being better. This is `compareAntePlacements` with both of the classic terms inverted.
        """
        def key(seat: int) -> Tuple[int, int]:
            if self.eliminated[seat]:
                return (1, -(self.left_at[seat] or 0))
            return (0, -self.gold[seat])

        order = sorted(range(self.num_seats), key=key)
        places = [0] * self.num_seats
        place = 0
        for index, seat in enumerate(order):
            if index > 0 and key(seat) != key(order[index - 1]):
                place = index
            places[seat] = place
        return places

    def placement_rewards(self) -> List[float]:
        """Finishing place mapped to `+1` for first and `-1` for last, shared places averaged.

        The match's actual objective, and not the same thing as maximising gold: elimination ranks
        below every survivor however the gold fell, so a seat's last coin is worth far more than its
        fifth. That gap is what a risk-appetite level would be for, and keeping this separate from
        :meth:`gold_rewards` is what lets the two be measured against each other.
        """
        places = self.placements()
        return [1.0 - 2.0 * place / (self.num_seats - 1) for place in places]

    def gold_rewards(self) -> List[float]:
        """Total gold won or lost over the match, per seat."""
        return [float(self.gold[seat] - self.config.starting_gold) for seat in range(self.num_seats)]

    def summary(self) -> Dict[str, object]:
        endings: Dict[str, int] = {}
        for outcome in self.outcomes:
            endings[outcome.ending] = endings.get(outcome.ending, 0) + 1
        return {
            "rounds": len(self.outcomes),
            "gold": list(self.gold),
            "eliminated": [seat for seat in range(self.num_seats) if self.eliminated[seat]],
            "placements": self.placements(),
            "endings": endings,
        }

    # ----------------------------------------------------------------- modelling input

    def live_records(self) -> List[SeatRecord]:
        """Per-seat records including the round in progress, which is what a policy should read.

        :attr:`records` holds completed rounds only, because a round's reveals are folded in once it
        settles. A seat deciding now has also watched everything revealed *this* round, so the two are
        summed here rather than double-counted there.
        """
        live = [
            SeatRecord(
                lies=record.lies,
                honest=record.honest,
                calls_made=record.calls_made,
                calls_won=record.calls_won,
                rounds_won=record.rounds_won,
                bs_losses=record.bs_losses,
                plays=record.plays,
                passes=record.passes,
            )
            for record in self.records
        ]
        if self.round is None or self.round.finished:
            return live
        for event in self.round.events:
            record = live[self.seats[event.seat]]
            if event.kind == "play":
                record.plays += 1
            elif event.kind == "pass":
                record.passes += 1
        # Read off the table for the same reason `_record_round` does, so the live totals and the
        # settled ones are the same quantity measured at two moments rather than two quantities.
        for play in self.round.table:
            if not play.revealed:
                continue
            record = live[self.seats[play.seat]]
            if self.round.is_play_honest(play):
                record.honest += 1
            else:
                record.lies += 1
        return live


def play_match(
    config: MatchConfig,
    policies: Sequence[object],
    rng: Optional[random.Random] = None,
) -> AnteMatch:
    """Run one match with one policy per **match seat**. For scripted play and quick checks."""
    match = AnteMatch(config, rng=rng)
    while not match.finished:
        seat = match.current_seat
        assert seat is not None
        match.apply(policies[seat].act(match))  # type: ignore[attr-defined]
    return match

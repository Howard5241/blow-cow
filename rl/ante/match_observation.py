"""The match observation: one round's view, plus everything the round does not know.

The round block is :class:`~ante.observation.ObservationEncoder` **unchanged and still exactly 200
wide**, which is deliberate. It keeps the one-round checkpoints loadable as opponents and as the
baseline every multi-round result has to beat, and it keeps the two encoders honest about which
questions belong to which layer.

Everything appended here is a fact a round boundary destroys or creates:

* **Gold and standing.** The score, the distance to elimination, and where the viewer sits in it.
  Maximising gold is not the same as winning: elimination ranks below every survivor, so a seat's
  last coin is worth much more than its fifth, and the gold-versus-placement gap is the thing this
  block makes visible.
* **The public record of every seat.** Who has been caught lying, how often they call, and how often
  they were right. This is the reason the file exists — the one-round agent's measured failure is
  opponent modelling, and a single round supplies under one honesty observation per opponent.
  `seat.lie_rate` is the statistic that was unavailable then and is available now.

The record is public by construction: :meth:`AnteMatch.live_records` is built from plays the table
watched go face up, so nothing here needs a hidden-information argument beyond the one the round
encoder already makes. `hidden information` in `rl/ante_check.py` covers both.

Width at the default five-seat config: **200 + 98 = 298 features**.
"""

from __future__ import annotations

import os
from typing import List, Tuple

import numpy as np

from .config import AnteConfig
from .match import AnteMatch, MatchConfig, SeatRecord
from .observation import ObservationEncoder

#: Zeroes every per-seat record column while leaving the observation the same width, the way
#: `BLOWCOW_ANTE_NO_LIE_FEATURE` does for the round block's analytic estimate. This is the control the
#: multi-round result has to be read against: it trains an identically shaped network, on identically
#: shaped data, over identically long matches, with the opponent record withheld. Without it a gain
#: could be the match context, the longer horizon, or the denser reward, and there would be no way to
#: tell which. The gold and standing columns are deliberately left alone — they are what makes it a
#: match rather than twenty rounds, and withholding them would ablate two things at once.
#:
#: **It is a process-global, so it can only ever be the default.** A table may hold an ablation arm
#: and a record-reading arm at once, and one environment variable cannot be right for both. The seat
#: that was trained without the record is therefore blinded *per agent* in
#: `ante/match_agents.py` off a flag the checkpoint carries, exactly as `rl/blowcow/agents.py` does
#: for the classic package's lie feature. This switch stays because it is what a *training* run sets.
NO_RECORD_FEATURES = os.environ.get("BLOWCOW_ANTE_NO_RECORD") == "1"

#: Pseudo-counts for the shrunk lie rate: `(lies + a) / (observations + 2a)`. With nothing seen the
#: estimate is 0.5, and it moves toward the truth at the rate the evidence justifies. A raw rate would
#: read 1.0 off a single caught lie, which over the first round or two is most of what there is.
LIE_RATE_PRIOR = 1.0

#: What a "confident" honesty record looks like, for the confidence feature's half-way point.
CONFIDENCE_SCALE = 6.0

_MATCH_GLOBAL_NAMES: Tuple[str, ...] = (
    "round_progress",
    "rounds_left",
    "is_first_round",
    "is_last_round",
    "my_gold",
    "my_gold_is_1",
    "my_gold_is_2",
    "my_gold_rank",
    "i_am_leading",
    "i_am_last",
    "gold_lead_over_best_other",
    "num_active",
    "num_eliminated",
    "total_gold",
    "mean_gold",
    "table_lie_rate",
    "my_lie_rate",
    "my_call_accuracy",
)

_MATCH_SEAT_NAMES: Tuple[str, ...] = (
    "row_valid",
    "is_eliminated",
    "gold",
    "gold_is_1",
    "gold_gap_to_me",
    "they_lead",
    "lie_rate",
    "lie_rate_raw",
    "lie_rate_vs_table",
    "record_confidence",
    "observations",
    "lies",
    "call_rate",
    "call_accuracy",
    "rounds_won_rate",
    "bs_loss_rate",
)

#: The columns the ablation withholds, named rather than indexed. Everything derived from
#: :class:`SeatRecord` is here; the gold and standing columns are not, deliberately — see
#: :data:`NO_RECORD_FEATURES`.
#:
#: This tuple pair is the **definition** of the ablation rather than a description of it.
#: :meth:`MatchObservationEncoder.encode` writes every feature unconditionally and then zeroes exactly
#: these columns, and the per-agent blinding in `ante/match_agents.py` zeroes exactly the same list.
#: The earlier arrangement — a scatter of `if not NO_RECORD_FEATURES` guards around individual writes
#: — had no single list to hand an agent, which is how a checkpoint trained on zeroed columns came to
#: be scored against live ones.
_RECORD_GLOBAL_NAMES: Tuple[str, ...] = ("table_lie_rate", "my_lie_rate", "my_call_accuracy")
_RECORD_SEAT_NAMES: Tuple[str, ...] = (
    "lie_rate",
    "lie_rate_raw",
    "lie_rate_vs_table",
    "record_confidence",
    "observations",
    "lies",
    "call_rate",
    "call_accuracy",
    "rounds_won_rate",
    "bs_loss_rate",
)
_RECORD_NAMES = frozenset(_RECORD_GLOBAL_NAMES + _RECORD_SEAT_NAMES)


def _shrunk_lie_rate(record: SeatRecord) -> float:
    return (record.lies + LIE_RATE_PRIOR) / (record.observations + 2.0 * LIE_RATE_PRIOR)


class MatchObservationEncoder:
    """One :class:`MatchConfig`'s encoder. Stateless apart from the sizes; safe to share."""

    def __init__(self, config: MatchConfig) -> None:
        self.config = config
        self.shape: AnteConfig = config.shape
        self.round_encoder = ObservationEncoder(config.shape)

        self.round_size = self.round_encoder.size
        self.match_size = (
            len(_MATCH_GLOBAL_NAMES) + config.num_players * len(_MATCH_SEAT_NAMES)
        )
        self.size = self.round_size + self.match_size

        self.names: List[str] = list(self.round_encoder.names)
        self.names.extend(f"match.{name}" for name in _MATCH_GLOBAL_NAMES)
        for offset in range(config.num_players):
            self.names.extend(f"match.seat+{offset}.{name}" for name in _MATCH_SEAT_NAMES)
        assert len(self.names) == self.size

        #: Absolute indices into the full observation of every column the ablation withholds. Read
        #: off the names, so a feature added to either name tuple joins or leaves the ablation by
        #: being named rather than by anyone remembering to update a second list.
        self.record_columns: Tuple[int, ...] = tuple(
            index
            for index, name in enumerate(self.names)
            if name.startswith("match.") and name.rsplit(".", 1)[-1] in _RECORD_NAMES
        )

    def encode(self, match: AnteMatch, viewer: int) -> np.ndarray:
        """``viewer`` is a **match** seat. Returns the full vector, round block first."""
        config = self.config
        out = np.zeros(self.size, dtype=np.float32)

        # The round block, from the viewer's seat in the round that is running. A viewer who is out
        # of the game, or between rounds, gets the zero vector the round encoder already returns for
        # a finished round — there is no position for them to be looking at.
        if match.round is not None and not match.round.finished and viewer in match.round_seat:
            out[: self.round_size] = self.round_encoder.encode(
                match.round, match.round_seat[viewer]
            )

        cursor = self.round_size
        gold = match.gold
        starting = float(config.starting_gold)
        records = match.live_records()
        active = match.active_seats

        others = [seat for seat in active if seat != viewer]
        best_other = max((gold[seat] for seat in others), default=gold[viewer])
        ahead = sum(1 for seat in others if gold[seat] > gold[viewer])
        behind = sum(1 for seat in others if gold[seat] < gold[viewer])

        table_observations = sum(records[seat].observations for seat in range(match.num_seats))
        table_lies = sum(records[seat].lies for seat in range(match.num_seats))
        table_lie_rate = (
            0.5 if table_observations == 0 else table_lies / table_observations
        )
        my_record = records[viewer]

        # -- match globals ----------------------------------------------------
        out[cursor + 0] = match.round_number / config.round_limit
        out[cursor + 1] = match.rounds_left / config.round_limit
        out[cursor + 2] = 1.0 if match.round_number <= 1 else 0.0
        out[cursor + 3] = 1.0 if match.rounds_left <= 1 else 0.0
        out[cursor + 4] = gold[viewer] / starting
        # One lost `Call BS` from leaving the game, which is the only cliff in the mode. `Ending 1` is
        # the only ending that takes gold, so this is exactly "one bad challenge from elimination".
        out[cursor + 5] = 1.0 if gold[viewer] == 1 else 0.0
        out[cursor + 6] = 1.0 if gold[viewer] == 2 else 0.0
        out[cursor + 7] = ahead / max(1, len(active) - 1)
        out[cursor + 8] = 1.0 if ahead == 0 else 0.0
        out[cursor + 9] = 1.0 if behind == 0 and len(active) > 1 else 0.0
        out[cursor + 10] = max(-1.0, min(1.0, (gold[viewer] - best_other) / starting))
        out[cursor + 11] = len(active) / match.num_seats
        out[cursor + 12] = (match.num_seats - len(active)) / match.num_seats
        out[cursor + 13] = sum(gold) / (match.num_seats * starting)
        out[cursor + 14] = (sum(gold[seat] for seat in active) / max(1, len(active))) / starting
        out[cursor + 15] = table_lie_rate
        out[cursor + 16] = _shrunk_lie_rate(my_record)
        out[cursor + 17] = my_record.calls_won / max(1, my_record.calls_made)
        cursor += len(_MATCH_GLOBAL_NAMES)

        # -- per seat ---------------------------------------------------------
        # Rows are aligned with the round block's: offset 0 is the viewer, offset k is whoever acts k
        # turns later. Seats already eliminated have no place in that order, so they fill the leftover
        # rows anonymously — `is_eliminated` and the two global counts carry everything about them a
        # policy can use, since their gold is frozen and they rank below every survivor whatever it is.
        order: List[int] = []
        if match.round is not None and not match.round.finished and viewer in match.round_seat:
            base = match.round_seat[viewer]
            order = [match.seats[(base + step) % match.round.n] for step in range(match.round.n)]
        else:
            order = [seat for seat in active]
        rows: List[int] = list(order)
        rows.extend(seat for seat in range(match.num_seats) if seat not in order)

        for offset, seat in enumerate(rows):
            record = records[seat]
            rounds_seen = max(1, len(match.outcomes))
            out[cursor + 0] = 1.0
            out[cursor + 1] = 1.0 if match.eliminated[seat] else 0.0
            out[cursor + 2] = gold[seat] / starting
            out[cursor + 3] = 1.0 if gold[seat] == 1 and not match.eliminated[seat] else 0.0
            out[cursor + 4] = max(-1.0, min(1.0, (gold[seat] - gold[viewer]) / starting))
            out[cursor + 5] = 1.0 if gold[seat] > gold[viewer] else 0.0
            if offset > 0:
                # Zero for the viewer's own row by construction, the way `claim_is_a_lie` is in
                # the round block: you do not need an estimate of your own honesty, and a
                # self-read would be a different quantity from the one every other row carries.
                out[cursor + 6] = _shrunk_lie_rate(record)
                out[cursor + 7] = record.lie_rate
                out[cursor + 8] = _shrunk_lie_rate(record) - table_lie_rate
            out[cursor + 9] = record.observations / (record.observations + CONFIDENCE_SCALE)
            out[cursor + 10] = min(1.0, record.observations / 20.0)
            out[cursor + 11] = min(1.0, record.lies / 10.0)
            out[cursor + 12] = min(1.0, record.calls_made / rounds_seen)
            out[cursor + 13] = record.calls_won / max(1, record.calls_made)
            out[cursor + 14] = min(1.0, record.rounds_won / rounds_seen)
            out[cursor + 15] = min(1.0, record.bs_losses / rounds_seen)
            cursor += len(_MATCH_SEAT_NAMES)

        assert cursor == self.size
        # One zeroing at the end rather than a guard around every write, so `record_columns` is what
        # the ablation *is* and an agent can be blinded by the identical list. See `_RECORD_NAMES`.
        if NO_RECORD_FEATURES:
            out[list(self.record_columns)] = 0.0
        return out

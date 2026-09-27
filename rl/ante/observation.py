"""The observation, and the promise that it carries nothing private.

Three rules govern it, the same three the classic encoder was built under:

* **Nothing private leaks.** A viewer sees their own hand, their own face-down pile, every face-up
  card, and every public tally. `hidden information` in `rl/ante_check.py` proves it by reshuffling
  everything the viewer cannot see and requiring the vector not to move by one bit.
* **Rank identity is gone already.** `game.py` numbers its ranks `0..R-1` and the deal is symmetric
  under permuting them, so there is no per-episode relabelling to do — unlike the classic encoder,
  which has to hide thirteen named ranks behind a bijection.
* **Counting is handed over rather than learned.** `unaccounted` per card type is the sufficient
  statistic for what the opponents can be holding, and the analytic lie estimate is the one
  hypergeometric the whole game turns on. Both are cheap; neither is something a placement reward is
  good at teaching. (In the classic game handing the lie estimate over changed nothing — see
  `rl/README.md`. That was measured against a reward dozens of decisions away from the call; here it
  is at most a few, so the question is worth asking again. `BLOWCOW_ANTE_NO_LIE_FEATURE=1` is the
  ablation, and it zeroes the column while leaving the width alone.)

Width at the default five-seat config: **200 features**.
"""

from __future__ import annotations

import os
from typing import List, Tuple

import numpy as np

from .config import AnteConfig, DEFAULT_CONFIG, DEFAULT_RECENT_EVENTS
from .game import AnteRound

#: Zeroes the analytic lie column while leaving the observation the same width, so the control trains
#: an identically shaped network on identically shaped data.
NO_LIE_FEATURE = os.environ.get("BLOWCOW_ANTE_NO_LIE_FEATURE") == "1"

#: How many public events the viewer is shown, by default. Long enough to cover a lap of the table
#: plus the reveals inside it **at five seats or fewer** — above that a lap is `2n` events and this
#: does not reach it, which is what `AnteConfig.recent_events` and `lap_events` exist to vary. Kept as
#: a module constant because it is the width every shipped checkpoint and the TypeScript port use.
RECENT_EVENTS = DEFAULT_RECENT_EVENTS

_GLOBAL_NAMES: Tuple[str, ...] = (
    "trump_selected",
    "trump_is_off_deck",
    "pass_streak",
    "pass_streak_is_0",
    "pass_streak_is_1",
    "pass_streak_is_2",
    "pass_streak_is_3",
    "pass_streak_is_4_plus",
    "pass_wins_now",
    "table_cards",
    "known_trump_on_table",
    "reverse_armed_by_known",
    "unknown_table_cards",
    "my_hand_size",
    "unseen_total",
    "turn_index",
)

_TYPE_NAMES: Tuple[str, ...] = (
    "is_trump",
    "is_joker",
    "my_count",
    "my_count_is_zero",
    "face_up_count",
    "unaccounted",
    "unaccounted_is_zero",
)

_SEAT_NAMES: Tuple[str, ...] = (
    "is_me",
    "is_current",
    "hand_size",
    "hand_is_empty",
    "hand_is_one",
    "hand_is_two",
    "face_down_in_front",
    "face_up_in_front",
    "is_last_non_passing",
    "is_bs_target",
    "claim_pending",
    "claim_size",
    "claim_is_a_lie",
    "revealed_lies",
    "revealed_honest",
    "turns_until_acts",
)

_EVENT_NAMES: Tuple[str, ...] = (
    "valid",
    "actor_offset",
    "is_play",
    "is_pass",
    "is_reveal",
    "card_count",
)


class ObservationEncoder:
    """One config's encoder. Stateless apart from the sizes; safe to share."""

    def __init__(self, config: AnteConfig = DEFAULT_CONFIG) -> None:
        self.config = config
        self.recent_events = config.recent_events
        self.size = (
            len(_GLOBAL_NAMES)
            + config.num_types * len(_TYPE_NAMES)
            + config.num_players * len(_SEAT_NAMES)
            + self.recent_events * len(_EVENT_NAMES)
        )
        self.names: List[str] = list(_GLOBAL_NAMES)
        for card_type in range(config.num_types):
            self.names.extend(f"type{card_type}.{name}" for name in _TYPE_NAMES)
        for offset in range(config.num_players):
            self.names.extend(f"seat+{offset}.{name}" for name in _SEAT_NAMES)
        for slot in range(self.recent_events):
            self.names.extend(f"event-{slot}.{name}" for name in _EVENT_NAMES)
        assert len(self.names) == self.size

    def encode(self, game: AnteRound, viewer: int) -> np.ndarray:
        config = self.config
        out = np.zeros(self.size, dtype=np.float32)
        if game.finished:
            return out

        # The *round's* seat count, which after an elimination is smaller than the config's. Every
        # rule read below — the pass trigger above all — is a rule about who is still in the game, so
        # taking it off the config would make `pass_wins_now` announce the wrong turn. The seat rows
        # keep `config.num_players` slots and leave the surplus all-zero, which no live row ever is:
        # offset 0 sets `is_me` and every other offset sets `turns_until_acts`.
        num_players = game.n
        num_seat_rows = config.num_players
        joker = config.joker_type
        hand = game.hands[viewer]
        unaccounted = game.unaccounted(viewer)
        unseen_total = sum(unaccounted)

        # Everything below reads plays through this split, which is the one place the encoder decides
        # what a viewer may look at: face-up to everyone, plus the viewer's own pile.
        visible_types: List[Tuple[int, Tuple[int, ...]]] = []
        face_down_count = [0] * num_seat_rows
        face_up_count = [0] * num_seat_rows
        unknown_table_cards = 0
        for play in game.table:
            if play.revealed:
                face_up_count[play.seat] += play.size
            else:
                face_down_count[play.seat] += play.size
            if play.revealed or play.seat == viewer:
                visible_types.append((play.seat, play.types))
            else:
                unknown_table_cards += play.size

        face_up_by_type = [0] * config.num_types
        known_trump_on_table = 0
        for _seat, types in visible_types:
            for card_type in types:
                face_up_by_type[card_type] += 1
                if game.trump is not None and card_type == game.trump and card_type != joker:
                    known_trump_on_table += 1

        cursor = 0

        # -- global -----------------------------------------------------------
        out[cursor + 0] = 1.0 if game.trump is not None else 0.0
        out[cursor + 1] = 1.0 if game.trump == config.off_deck_trump else 0.0
        out[cursor + 2] = game.pass_streak / num_players
        out[cursor + 3 + min(game.pass_streak, 4)] = 1.0
        # Handed over because it is a *rule*, not an inference: with the streak one short of `n`,
        # passing ends the round and the passer wins it. See `_apply_pass`.
        out[cursor + 8] = 1.0 if game.pass_streak == num_players - 1 else 0.0
        out[cursor + 9] = game.table_card_count() / config.deck_size
        out[cursor + 10] = known_trump_on_table / 4.0
        out[cursor + 11] = 1.0 if known_trump_on_table >= 4 else 0.0
        out[cursor + 12] = unknown_table_cards / 10.0
        out[cursor + 13] = sum(hand) / max(1, config.hand_size)
        out[cursor + 14] = unseen_total / config.deck_size
        out[cursor + 15] = game.turn / 40.0
        cursor += len(_GLOBAL_NAMES)

        # -- per card type ----------------------------------------------------
        for card_type in range(config.num_types):
            is_trump = game.trump is not None and (
                card_type == joker or card_type == game.trump
            )
            out[cursor + 0] = 1.0 if is_trump else 0.0
            out[cursor + 1] = 1.0 if card_type == joker else 0.0
            out[cursor + 2] = hand[card_type] / 4.0
            out[cursor + 3] = 1.0 if hand[card_type] == 0 else 0.0
            out[cursor + 4] = face_up_by_type[card_type] / 4.0
            out[cursor + 5] = unaccounted[card_type] / 4.0
            out[cursor + 6] = 1.0 if unaccounted[card_type] == 0 else 0.0
            cursor += len(_TYPE_NAMES)

        # -- per seat, ordered by how soon they act ---------------------------
        # Offset 0 is the viewer and offset 1 is whoever acts after them, which keeps a seat's row
        # meaning the same thing whoever is looking.
        revealed_lies = [0] * num_seat_rows
        revealed_honest = [0] * num_seat_rows
        for event in game.events:
            if event.kind == "reveal" and event.revealed_honest is not None:
                if event.revealed_honest:
                    revealed_honest[event.seat] += 1
                else:
                    revealed_lies[event.seat] += 1

        bs_target = game.bs_target() if game.current == viewer else None
        for offset in range(num_seat_rows):
            if offset >= num_players:
                cursor += len(_SEAT_NAMES)  # No such seat this round; the row stays all-zero.
                continue
            seat = (viewer + offset) % num_players
            claim_index = game.pending_play_index(seat)
            out[cursor + 0] = 1.0 if offset == 0 else 0.0
            out[cursor + 1] = 1.0 if seat == game.current else 0.0
            hand_size = sum(game.hands[seat])
            out[cursor + 2] = hand_size / max(1, config.hand_size)
            out[cursor + 3] = 1.0 if hand_size == 0 else 0.0
            out[cursor + 4] = 1.0 if hand_size == 1 else 0.0
            out[cursor + 5] = 1.0 if hand_size == 2 else 0.0
            out[cursor + 6] = face_down_count[seat] / 4.0
            out[cursor + 7] = face_up_count[seat] / 8.0
            out[cursor + 8] = 1.0 if seat == game.last_non_passing else 0.0
            out[cursor + 9] = 1.0 if seat == bs_target else 0.0
            out[cursor + 10] = 1.0 if claim_index is not None else 0.0
            out[cursor + 11] = (game.table[claim_index].size / 2.0) if claim_index is not None else 0.0
            if not NO_LIE_FEATURE:
                # Zero for the viewer's own seat by construction: you know whether you lied, and
                # `unaccounted` excludes your own cards, so a self-read would be a different quantity
                # from the one every other row carries. `claim_pending` is what keeps a real 0.0
                # estimate distinguishable from "no claim".
                out[cursor + 12] = game.claim_lie_probability(viewer, seat)
            out[cursor + 13] = revealed_lies[seat] / 3.0
            out[cursor + 14] = revealed_honest[seat] / 3.0
            out[cursor + 15] = offset / num_players
            cursor += len(_SEAT_NAMES)

        # -- recent public events, newest first --------------------------------
        recent = game.events[-self.recent_events :]
        for slot in range(self.recent_events):
            if slot < len(recent):
                event = recent[len(recent) - 1 - slot]
                out[cursor + 0] = 1.0
                out[cursor + 1] = ((event.seat - viewer) % num_players) / num_players
                out[cursor + 2] = 1.0 if event.kind == "play" else 0.0
                out[cursor + 3] = 1.0 if event.kind == "pass" else 0.0
                out[cursor + 4] = 1.0 if event.kind == "reveal" else 0.0
                out[cursor + 5] = event.size / 2.0
            cursor += len(_EVENT_NAMES)

        assert cursor == self.size
        return out

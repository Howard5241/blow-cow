"""The observation: what one seat can see, in canonical slots, as a fixed-length float vector.

Three rules govern everything here.

**Nothing private leaks.** The encoder is held to exactly what `hideSecretState` sends a real client:
the viewer's own hand, the viewer's *own* face-down cards on the table (a player knows what they
played), every face-up card, every hand *size*, points, scored sets, and the public round state.
Other seats' hands and face-down cards appear only as counts of what is unaccounted for.

**Suits are gone and rank identity is relabelled.** A hand is counts per canonical card type. See
`canonical.py` for why that is lossless and `rl/conformance.py --suit-invariance` for the check.

**Belief is handed over, not learned from scratch.** `unaccounted` per card type — copies neither in
the viewer's hand, nor face up, nor scored, nor in the viewer's own pile — is the sufficient
statistic for "what could the opponents be holding". The deck is small and shrinking, so this is most
of the inference problem, and a network should not have to rediscover subtraction.
"""

from __future__ import annotations

import os
from typing import List, Optional, Sequence, Tuple

import numpy as np

from .canonical import COPIES_PER_RANK, JOKER_TYPE, NUM_CARD_TYPES, NUM_RANK_SLOTS, RankMapping
from .engine import BlowCowEngine
from .spaces import off_deck_representative

#: Training is capped at six seats. The real game supports eight and the engine still does; the
#: observation does not, so a seven- or eight-handed table cannot be encoded.
MAX_SEATS = 6

#: How many public events the observation carries. Anything longer-range is recurrence's job.
RECENT_EVENTS = 6

EVENT_KINDS: Tuple[str, ...] = ("play", "pass", "callBS", "callReset", "reveal", "bsVerdict")

_GLOBAL_NAMES: Tuple[str, ...] = (
    "players_initial",
    "players_active",
    "deck_rank_count",
    "deck_size",
    "round_number",
    "direction_clockwise",
    "trump_selected",
    "table_count",
    "table_fill_ratio",
    "max_cards_on_table",
    "table_room_left",
    "table_full",
    "pass_streak",
    "passes_until_round_ends",
    "my_hand_size",
    "my_points",
    "my_points_vs_mean",
    "my_points_rank",
    "table_trump_face_up",
    "reverse_rule_armed",
    "reverse_rule_distance",
    "final_two_resolution",
    "my_face_down_on_table",
    "my_face_up_on_table",
    "i_am_starting_player",
    "i_am_last_non_passing",
    "off_deck_ranks_available",
    "unseen_cards",
)

#: How much likelier a player who *holds* trump is to play it than a blind draw would suggest. The
#: honest branch is scaled by this before the lie probability is taken as its complement.
HONEST_PLAY_BIAS = 4.0

#: Ablation switch for the per-seat lie read, set from ``BLOWCOW_NO_LIE_FEATURE``. It zeroes the two
#: features while leaving the observation **the same width**, so the control arm trains an identically
#: shaped network on identically shaped data and the only difference is whether those two columns
#: carry information. Narrowing the vector instead would confound the feature with a change of
#: architecture, and every checkpoint would then be tied to which arm produced it.
LIE_FEATURE_ENABLED = os.environ.get("BLOWCOW_NO_LIE_FEATURE", "") not in ("1", "true", "True")


def lie_probability_from_counts(claimed: int, trump_left: int, unseen: int) -> float:
    """Chance a claim of ``claimed`` hidden trump is a lie, given what the viewer cannot see.

    The arithmetic only, with no engine and no state, because it has **two** callers that must never
    drift: :func:`blowcow.agents.probability_claim_is_a_lie`, which is what the scripted bots and the
    determinization sampler read, and the per-seat observation feature below. Two transcriptions of a
    hypergeometric would disagree eventually and the disagreement would be invisible.
    """
    if claimed <= 0:
        return 0.0
    if trump_left < claimed:
        return 1.0  # They cannot be telling the truth; the cards are not there to be held.
    if unseen <= 0:
        return 0.0

    chance_all_trump = 1.0
    for offset in range(claimed):
        chance_all_trump *= max(0.0, (trump_left - offset)) / max(1.0, (unseen - offset))
    return 1.0 - min(1.0, chance_all_trump * HONEST_PLAY_BIAS)


_RANK_NAMES: Tuple[str, ...] = (
    "in_deck",
    "is_joker",
    "is_trump",
    "is_previous_trump",
    "is_off_deck_trump_option",
    "my_count",
    "my_count_is_three",
    "my_face_down_count",
    "face_up_count",
    "scored_out_of_play",
    "unaccounted",
    "unaccounted_any",
)

_SEAT_NAMES: Tuple[str, ...] = (
    "present",
    "is_me",
    "has_left",
    "hand_size",
    "hand_empty",
    "points",
    "points_minus_mine",
    "face_down_in_front",
    "face_up_in_front",
    "is_current_player",
    "is_bs_target",
    "is_last_non_passing",
    "is_starting_player",
    "cards_claimed_this_round",
    "revealed_trump_this_round",
    "revealed_lie_this_round",
    "turns_until_acts",
    # The analytic lie read, per seat. Every *ingredient* of this was already in the observation —
    # unaccounted trump, unseen cards, the seat's face-down pile — and an auxiliary head supervised
    # on the truth reached 78-85% accuracy from them within 12k decisions, while 2.5M decisions of
    # placement reward bought +0.8 points of call discrimination. What was missing is not the
    # evidence but the *combination*: a hypergeometric product is a hard function to discover from a
    # reward that arrives dozens of decisions later folded into a placement. So it is handed over
    # already computed. It is deliberately the counting estimate rather than a learned one, because
    # counting is what transfers — moved to an unseen opponent a learned belief collapses to 0.636
    # AUC while this rises to 0.829.
    "claim_pending",
    "claim_is_a_lie",
)

_EVENT_NAMES: Tuple[str, ...] = (
    *(f"actor_seat_{index}" for index in range(MAX_SEATS)),
    *(f"kind_{kind}" for kind in EVENT_KINDS),
    "card_count",
    "was_honest_known",
    "was_honest",
)


def feature_names() -> List[str]:
    """Every feature in order. Used by ``rl/check_env.py`` and worth having when a value looks odd."""
    names = list(_GLOBAL_NAMES)
    for card_type in range(NUM_CARD_TYPES):
        label = "joker" if card_type == JOKER_TYPE else f"slot{card_type}"
        names.extend(f"rank.{label}.{name}" for name in _RANK_NAMES)
    for seat in range(MAX_SEATS):
        names.extend(f"seat{seat}.{name}" for name in _SEAT_NAMES)
    for event in range(RECENT_EVENTS):
        names.extend(f"event{event}.{name}" for name in _EVENT_NAMES)
    return names


#: Block geometry, so a network can slice the flat vector back into its rows. The per-card-type block
#: is the one worth slicing: those fourteen rows are interchangeable, and a shared encoder over them
#: buys permutation equivariance on top of the relabelling in `canonical.py`.
GLOBAL_FEATURES = len(_GLOBAL_NAMES)
RANK_ROW_FEATURES = len(_RANK_NAMES)
SEAT_ROW_FEATURES = len(_SEAT_NAMES)
EVENT_ROW_FEATURES = len(_EVENT_NAMES)

RANK_BLOCK_START = GLOBAL_FEATURES
SEAT_BLOCK_START = RANK_BLOCK_START + NUM_CARD_TYPES * RANK_ROW_FEATURES
EVENT_BLOCK_START = SEAT_BLOCK_START + MAX_SEATS * SEAT_ROW_FEATURES

#: Every column the lie feature occupies, so a *single* agent can be blinded to it inside a process
#: where the encoder is producing it. `LIE_FEATURE_ENABLED` is a module-level global read at import,
#: which is the right shape for a training run and the wrong shape for an evaluation: a checkpoint
#: trained without the feature and one trained with it have to be able to sit at the same table, and
#: scoring them separately against a common opponent is exactly the mistake that a head-to-head
#: exists to avoid.
LIE_FEATURE_COLUMNS: Tuple[int, ...] = tuple(
    SEAT_BLOCK_START + seat * SEAT_ROW_FEATURES + offset
    for seat in range(MAX_SEATS)
    for offset in (_SEAT_NAMES.index("claim_pending"), _SEAT_NAMES.index("claim_is_a_lie"))
)

OBSERVATION_SIZE = EVENT_BLOCK_START + RECENT_EVENTS * EVENT_ROW_FEATURES


def encode(engine: BlowCowEngine, mapping: RankMapping, viewer_id: str) -> np.ndarray:
    """The viewer's observation. Reads only what a real client is sent."""
    if len(engine.seat_order) > MAX_SEATS:
        raise ValueError(
            f"Observation supports at most {MAX_SEATS} seats; this match has {len(engine.seat_order)}."
        )

    deck = engine.deck
    card_types = mapping.card_types
    type_copies = mapping.type_copies
    round_state = engine.round
    viewer = engine.players[viewer_id]
    active = engine.active_player_ids()
    active_count = len(active)
    initial_count = len(engine.seat_order)

    trump_slot = mapping.slot(round_state.trump_rank) if round_state.trump_rank else None
    previous_trump_slot = (
        mapping.slot(round_state.previous_trump_rank) if round_state.previous_trump_rank else None
    )
    representative_slot = off_deck_representative(mapping, previous_trump_slot)

    # ---- card-type tallies, all from what the viewer can legitimately see -------------------
    my_hand = [0] * NUM_CARD_TYPES
    for card in viewer.hand:
        my_hand[card_types[card]] += 1

    my_face_down = [0] * NUM_CARD_TYPES
    face_up = [0] * NUM_CARD_TYPES
    for play in engine.plays:
        for card in play.cards:
            card_type = card_types[card]
            if engine._is_card_face_up(play, card):
                face_up[card_type] += 1
            elif play.player_id == viewer_id:
                my_face_down[card_type] += 1

    scored_sets = [0] * NUM_CARD_TYPES
    for player in engine.players.values():
        for scored_set in player.scored_sets:
            scored_sets[mapping.slot(scored_set.rank)] += 1

    unaccounted = [
        max(
            0,
            type_copies[card_type]
            - my_hand[card_type]
            - my_face_down[card_type]
            - face_up[card_type]
            - COPIES_PER_RANK * scored_sets[card_type],
        )
        for card_type in range(NUM_CARD_TYPES)
    ]

    table_count = engine.table_card_count()
    max_cards = round_state.max_cards_on_table
    trump_face_up = face_up[trump_slot] if trump_slot is not None else 0

    points = [engine.players[player_id].points for player_id in engine.seat_order]
    mean_points = sum(points) / len(points)
    my_points = viewer.points
    better_than_me = sum(1 for value in points if value < my_points)

    my_table_face_down = sum(my_face_down)
    my_table_face_up = sum(
        1
        for play in engine.plays
        if play.player_id == viewer_id
        for card in play.cards
        if engine._is_card_face_up(play, card)
    )

    features: List[float] = [
        initial_count / MAX_SEATS,
        active_count / MAX_SEATS,
        mapping.in_deck_slot_count / NUM_RANK_SLOTS,
        deck.size / 54.0,
        min(round_state.round_number / 30.0, 1.0),
        1.0 if round_state.direction == "clockwise" else 0.0,
        1.0 if round_state.trump_rank else 0.0,
        table_count / 16.0,
        table_count / max_cards if max_cards else 0.0,
        max_cards / 16.0,
        max(0, max_cards - table_count) / 16.0,
        1.0 if table_count >= max_cards else 0.0,
        round_state.pass_streak / max(1, active_count),
        max(0, active_count - round_state.pass_streak) / max(1, active_count),
        len(viewer.hand) / 20.0,
        my_points / 10.0,
        (my_points - mean_points) / 10.0,
        better_than_me / max(1, initial_count - 1),
        trump_face_up / 4.0,
        1.0 if trump_face_up >= 4 else 0.0,
        max(0, 4 - trump_face_up) / 4.0,
        1.0 if engine.is_final_two_resolution_turn(viewer_id) else 0.0,
        my_table_face_down / 4.0,
        my_table_face_up / 8.0,
        1.0 if round_state.starting_player_id == viewer_id else 0.0,
        1.0 if round_state.last_non_passing_player_id == viewer_id else 0.0,
        (NUM_RANK_SLOTS - mapping.in_deck_slot_count) / NUM_RANK_SLOTS,
        sum(unaccounted) / 54.0,
    ]

    # ---- one row per canonical card type ---------------------------------------------------
    for card_type in range(NUM_CARD_TYPES):
        is_joker = card_type == JOKER_TYPE
        copies = type_copies[card_type]
        divisor = float(copies) if copies else 1.0
        features.extend(
            (
                1.0 if (is_joker or mapping.is_in_deck(card_type)) else 0.0,
                1.0 if is_joker else 0.0,
                1.0 if trump_slot == card_type else 0.0,
                1.0 if previous_trump_slot == card_type else 0.0,
                1.0 if representative_slot == card_type else 0.0,
                my_hand[card_type] / divisor,
                1.0 if (not is_joker and my_hand[card_type] == 3) else 0.0,
                my_face_down[card_type] / divisor,
                face_up[card_type] / divisor,
                float(scored_sets[card_type]),
                unaccounted[card_type] / divisor,
                1.0 if unaccounted[card_type] > 0 else 0.0,
            )
        )

    # ---- one row per seat, indexed relative to the viewer ----------------------------------
    bs_target = engine._get_default_bs_target(viewer_id)
    turn_distance = _turn_distances(engine, active)
    seat_rows: List[List[float]] = [[0.0] * len(_SEAT_NAMES) for _ in range(MAX_SEATS)]

    # Shared by every seat's lie read, so the O(deck) tally is walked once rather than six times.
    # `unaccounted` above is already exactly `agents.unaccounted_by_type` for this viewer.
    unseen_total = sum(unaccounted)
    trump_left = (
        0 if trump_slot is None else unaccounted[trump_slot] + unaccounted[JOKER_TYPE]
    )

    for player_id in engine.seat_order:
        player = engine.players[player_id]
        relative = (player.seat_index - viewer.seat_index) % initial_count
        front_face_down = 0
        front_face_up = 0
        claimed = 0
        revealed_trump = 0
        revealed_lie = 0

        for play in engine.plays:
            if play.player_id != player_id:
                continue
            claimed += play.declared_card_count
            for card in play.cards:
                if engine._is_card_face_up(play, card):
                    front_face_up += 1
                    if engine._is_trump(card, play.claimed_rank):
                        revealed_trump += 1
                    else:
                        revealed_lie += 1
                else:
                    front_face_down += 1

        # Strictly a read on *somebody else*: the viewer already knows whether their own claim was
        # honest, and handing them a hypergeometric guess about it would be both wrong (their own
        # held cards are excluded from `unaccounted`) and a different quantity from the one every
        # other seat's slot carries. `claim_pending` is what keeps a 0.0 estimate distinguishable
        # from "no claim to read".
        pending = None if player_id == viewer_id else engine._get_pending_play(player_id)
        claimed_hidden = 0 if pending is None else len(engine._hidden_cards(pending))
        if trump_slot is None or not LIE_FEATURE_ENABLED:
            claimed_hidden = 0  # Nothing has been claimed yet, so there is nothing to have lied about.
        lie_estimate = lie_probability_from_counts(claimed_hidden, trump_left, unseen_total)

        seat_rows[relative] = [
            1.0,
            1.0 if player_id == viewer_id else 0.0,
            1.0 if player.has_left else 0.0,
            len(player.hand) / 20.0,
            1.0 if not player.hand else 0.0,
            player.points / 10.0,
            (player.points - my_points) / 10.0,
            front_face_down / 6.0,
            front_face_up / 8.0,
            1.0 if engine.current_player == player_id else 0.0,
            1.0 if bs_target == player_id else 0.0,
            1.0 if round_state.last_non_passing_player_id == player_id else 0.0,
            1.0 if round_state.starting_player_id == player_id else 0.0,
            claimed / 8.0,
            revealed_trump / 6.0,
            revealed_lie / 6.0,
            turn_distance.get(player_id, MAX_SEATS) / MAX_SEATS,
            1.0 if claimed_hidden > 0 else 0.0,
            lie_estimate,
        ]

    for row in seat_rows:
        features.extend(row)

    # ---- the last few public events, newest first ------------------------------------------
    recent = [
        event for event in engine.public_events if event.kind in EVENT_KINDS
    ][-RECENT_EVENTS:]
    recent.reverse()

    for index in range(RECENT_EVENTS):
        if index >= len(recent):
            features.extend([0.0] * len(_EVENT_NAMES))
            continue

        event = recent[index]
        actor = engine.players.get(event.player_id)
        actor_row = [0.0] * MAX_SEATS
        if actor is not None:
            actor_row[(actor.seat_index - viewer.seat_index) % initial_count] = 1.0

        kind_row = [1.0 if event.kind == kind else 0.0 for kind in EVENT_KINDS]
        features.extend(actor_row)
        features.extend(kind_row)
        features.append(min(event.card_count, 16) / 8.0)
        features.append(1.0 if event.was_honest is not None else 0.0)
        features.append(1.0 if event.was_honest else 0.0)

    return np.asarray(features, dtype=np.float32)


def _turn_distances(engine: BlowCowEngine, active: Sequence[str]) -> dict[str, int]:
    """How many hand-overs until each active seat is on the clock, walking the current direction."""
    distances: dict[str, int] = {}
    if not active:
        return distances

    cursor: Optional[str] = engine.current_player
    for distance in range(len(active)):
        if cursor is None or cursor in distances:
            break
        distances[cursor] = distance
        cursor = engine._get_next_active_player_id(cursor, engine.round.direction, active)

    return distances

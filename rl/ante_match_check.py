"""The match layer, held to the round layer and to `RULES-ANTE.md`.

`rl/ante_conformance.py --rounds N` holds the simulator to the real engine. `rl/ante_check.py` holds
the one-round encoding to the one-round simulator. This is the third of the same kind: it holds
everything the match layer adds — gold, elimination, the deck resize, the public record, the match
observation and the incremental reward — to the round beneath it.

Two of these checks are load-bearing for claims made elsewhere and would otherwise rest on argument:

* **`round slice`** proves the first 200 features of a match observation are byte-identical to what
  the one-round encoder produces for the same position. That is what makes `RoundOnlyAgent` a fair
  control rather than a crippled one — the baseline every multi-round result is read against really
  is the one-round agent seeing exactly what it was trained on.
* **`disclosure`** proves the two disclosure modes now read the same table, because every ending turns
  it face up, and measures it: no ending leaves anything face down.

Usage::

    python rl/ante_match_check.py --games 40
"""

from __future__ import annotations

import argparse
import random
import sys
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    import numpy as np
except ImportError:  # pragma: no cover - a bare interpreter says so rather than tracebacking
    print("ante_match_check needs numpy. Activate the project virtualenv, or run it directly.")
    raise SystemExit(2)

from ante.config import AnteConfig, lap_events, standard_rank_count  # noqa: E402
from ante.game import ENDING_BS  # noqa: E402
from ante.match import AnteMatch, MatchConfig  # noqa: E402
from ante.match_env import AnteMatchEnv  # noqa: E402
from ante.match_observation import (  # noqa: E402
    NO_RECORD_FEATURES,
    MatchObservationEncoder,
)
from ante.observation import _EVENT_NAMES as _EVENT_ROW  # noqa: E402
from ante.observation import ObservationEncoder  # noqa: E402
from ante.spaces import CALL_BS_INDEX  # noqa: E402


class CheckFailure(AssertionError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise CheckFailure(message)


def play(config: MatchConfig, seed: int, collect=None) -> AnteMatch:
    """One match of uniform-random play, optionally calling ``collect(match)`` at each decision."""
    env = AnteMatchEnv(config, seed=seed)
    decision = env.reset()
    while not decision.terminated:
        if collect is not None:
            collect(env.match)
        decision = env.step(env.sample_action())
    return env.match


def base_config(shape: AnteConfig, disclosure: str = "round", rounds: int = 20, gold: int = 5) -> MatchConfig:
    return MatchConfig(shape=shape, round_limit=rounds, starting_gold=gold, disclosure=disclosure)


# --------------------------------------------------------------------------- checks


def check_observation_spec(shape: AnteConfig, games: int, seed: int) -> str:
    config = base_config(shape)
    encoder = MatchObservationEncoder(config)
    require(len(set(encoder.names)) == len(encoder.names), "Feature names are not unique")
    require(encoder.size == encoder.round_size + encoder.match_size, "Widths do not add up")

    seen = np.zeros(encoder.size, dtype=bool)
    lo = np.full(encoder.size, np.inf)
    hi = np.full(encoder.size, -np.inf)

    def look(match: AnteMatch) -> None:
        for viewer in range(match.num_seats):
            vector = encoder.encode(match, viewer)
            require(vector.shape == (encoder.size,), "Wrong observation width")
            require(bool(np.isfinite(vector).all()), "Observation held a non-finite value")
            np.minimum(lo, vector, out=lo)
            np.maximum(hi, vector, out=hi)
            seen[vector != 0.0] = True

    for index in range(games):
        play(config, seed + index, collect=look)

    dead = [encoder.names[i] for i in range(encoder.size) if not seen[i]]
    # The complete list of features that are zero **by construction** rather than because nothing
    # exercised them. Enumerated rather than pattern-matched, so that this doubles as the written-down
    # claim: anything else that never moves is a dead feature and a bug, and the check says so.
    allowed = {
        # A rank row is not the Joker row.
        *(f"type{index}.is_joker" for index in range(shape.num_types) if index != shape.joker_type),
        # Offset 0 is the viewer, so no other offset is.
        *(f"seat+{offset}.is_me" for offset in range(1, shape.num_players)),
        # You may not call BS on yourself, you know whether you lied, and you act in zero turns.
        "seat+0.is_bs_target",
        "seat+0.claim_is_a_lie",
        "seat+0.turns_until_acts",
        # Same three self-reads in the match block.
        "match.seat+0.lie_rate",
        "match.seat+0.lie_rate_raw",
        "match.seat+0.lie_rate_vs_table",
    }
    if NO_RECORD_FEATURES:
        allowed |= {name for name in encoder.names if "lie" in name or "record_" in name}
    unexpected = [name for name in dead if name not in allowed and not name.startswith("match.")]
    # **This check is weaker above five seats, and it is coverage rather than a bug.** The npm script
    # runs it at the default five, where it passes at `--games 12`. Run at seven or eight it reports
    # `pass_wins_now` and `seat+{1,2,3}.is_bs_target` dead, and both are artefacts of *uniform-random*
    # play at a big table: the first needs `n-1` consecutive passes, and the second needs the last
    # non-passing player to be one of the seats immediately after the viewer rather than the one just
    # before them. Sixty games at seven seats still misses both. Raise `--games` a long way, or read a
    # failure at those counts against this note before treating it as a regression.
    require(not unexpected, f"Round features never moved: {unexpected[:6]}")
    span = float(np.max(hi[np.isfinite(hi)] - lo[np.isfinite(lo)]))
    return f"{encoder.size} features ({encoder.round_size}+{encoder.match_size}), max span {span:.1f}"


def check_round_slice(shape: AnteConfig, games: int, seed: int) -> str:
    """The match observation's first block is exactly the one-round observation.

    Not a formality: `RoundOnlyAgent` in `ante/match_agents.py` is the control the whole multi-round
    result is read against, and it works by slicing this prefix. If the two encoders drifted, the
    control would be a differently-crippled agent and the comparison would mean nothing.
    """
    config = base_config(shape)
    match_encoder = MatchObservationEncoder(config)
    round_encoder = ObservationEncoder(shape)
    require(
        match_encoder.names[: round_encoder.size] == round_encoder.names,
        "The match encoder's prefix names do not match the round encoder's",
    )

    compared = 0
    seated = 0

    def look(match: AnteMatch) -> None:
        nonlocal compared, seated
        for viewer in range(match.num_seats):
            vector = match_encoder.encode(match, viewer)[: round_encoder.size]
            if viewer in match.round_seat:
                expected = round_encoder.encode(match.round, match.round_seat[viewer])
                require(bool(np.array_equal(vector, expected)), "The round block diverged")
                seated += 1
            else:
                require(not vector.any(), "An eliminated seat got a non-zero round block")
            compared += 1

    for index in range(games):
        play(config, seed + index, collect=look)
    require(seated > 0 and compared > seated, "No eliminated seat was ever encoded")
    return f"{compared} views, {compared - seated} of them from an eliminated seat"


def check_hidden_information(shape: AnteConfig, games: int, seed: int) -> str:
    """Reshuffle everything the viewer cannot see; the observation must not move by one bit.

    The match block is public by construction — gold is public, and the record is built from cards
    the table watched go face up — so this covers both halves at once. It is worth running over the
    match anyway, because `live_records` reads the *live* table and a mistake there would leak the
    face-down cards it walks past.
    """
    config = base_config(shape)
    encoder = MatchObservationEncoder(config)
    rng = random.Random(seed)
    tested = 0

    def look(match: AnteMatch) -> None:
        nonlocal tested
        game = match.round
        if game is None or game.finished:
            return
        for viewer in range(game.n):
            before = encoder.encode(match, match.seats[viewer])

            # Everything this viewer cannot place: other hands, and other seats' face-down piles.
            pool: List[int] = []
            for seat in range(game.n):
                if seat == viewer:
                    continue
                for card_type, count in enumerate(game.hands[seat]):
                    pool.extend([card_type] * count)
            for play_index, table_play in enumerate(game.table):
                if not table_play.revealed and table_play.seat != viewer:
                    pool.extend(table_play.types)
            if len(pool) < 2:
                continue
            rng.shuffle(pool)

            cursor = 0
            for seat in range(game.n):
                if seat == viewer:
                    continue
                size = sum(game.hands[seat])
                counts = [0] * shape.num_types
                for card_type in pool[cursor : cursor + size]:
                    counts[card_type] += 1
                game.hands[seat] = counts
                cursor += size
            for table_play in game.table:
                if not table_play.revealed and table_play.seat != viewer:
                    table_play.types = tuple(sorted(pool[cursor : cursor + table_play.size]))
                    cursor += table_play.size

            after = encoder.encode(match, match.seats[viewer])
            if not np.array_equal(before, after):
                moved = [encoder.names[i] for i in np.flatnonzero(before != after)]
                raise CheckFailure(f"Hidden cards moved the observation: {moved[:6]}")
            tested += 1

    for index in range(games):
        play(config, seed + index, collect=look)
    require(tested >= 50, f"Only {tested} reshuffles were possible")
    return f"{tested} reshuffles left every observation untouched"


def check_record(shape: AnteConfig, games: int, seed: int) -> str:
    """The public record equals a recount from the table, and never counts a card twice."""
    config = base_config(shape)
    total_seen = 0
    for index in range(games):
        env = AnteMatchEnv(config, seed=seed + index)
        decision = env.reset()
        expect_lies = [0] * shape.num_players
        expect_honest = [0] * shape.num_players
        while not decision.terminated:
            match = decision.match
            game, seats = match.round, list(match.seats)
            before = len(match.outcomes)
            decision = env.step(env.sample_action())
            done = decision.match if decision.match is not None else env.match
            if len(done.outcomes) > before:
                for table_play in game.table:
                    if not table_play.revealed:
                        continue
                    if game.is_play_honest(table_play):
                        expect_honest[seats[table_play.seat]] += 1
                    else:
                        expect_lies[seats[table_play.seat]] += 1
        match = env.match
        got_lies = [record.lies for record in match.records]
        got_honest = [record.honest for record in match.records]
        require(got_lies == expect_lies, f"Lie counts disagreed: {got_lies} vs {expect_lies}")
        require(got_honest == expect_honest, f"Honest counts disagreed: {got_honest} vs {expect_honest}")
        total_seen += sum(got_lies) + sum(got_honest)

        # `live_records` must equal `records` once a match is over: the round it adds is gone.
        for settled, live in zip(match.records, match.live_records()):
            require(
                (settled.lies, settled.honest) == (live.lies, live.honest),
                "live_records disagreed with records after the match ended",
            )
    require(total_seen > 200, f"Only {total_seen} honesty observations were recorded")
    return f"{total_seen} honesty observations recounted from the table"


def check_disclosure(shape: AnteConfig, games: int, seed: int) -> str:
    """No ending leaves a play face down, so `full` and `round` disclosure now read the same table.

    The measurement, not just the invariant: how many plays each mode leaves unrecorded, and under
    which ending. `RULES-ANTE.md` used to let `Ending 3` stop before any reveal ran, and this check
    proved it was the only ending that hid anything. All three now turn the table over — `Ending 2`
    and `Ending 3` walk the same reveal procedure `Call BS` uses — so the answer has to be nothing,
    under every ending, and the two disclosure modes have to agree exactly rather than by containment.
    """
    hidden_by_ending: Dict[str, int] = {}
    plays = 0
    hidden = 0
    endings: Dict[str, int] = {}

    for index in range(games):
        config = base_config(shape, disclosure="round")
        env = AnteMatchEnv(config, seed=seed + index)
        decision = env.reset()
        while not decision.terminated:
            match = decision.match
            game = match.round
            before = len(match.outcomes)
            decision = env.step(env.sample_action())
            done = decision.match if decision.match is not None else env.match
            if len(done.outcomes) > before:
                ending = done.outcomes[-1].ending
                down = sum(1 for table_play in game.table if not table_play.revealed)
                plays += len(game.table)
                hidden += down
                endings[ending] = endings.get(ending, 0) + 1
                hidden_by_ending[ending] = hidden_by_ending.get(ending, 0) + down

        # Same seed, same deals, same actions: only the record may differ.
        full = AnteMatchEnv(base_config(shape, disclosure="full"), seed=seed + index)
        decision = full.reset()
        while not decision.terminated:
            decision = full.step(full.sample_action())
        for lean, rich in zip(env.match.records, full.match.records):
            require(
                (rich.lies, rich.honest) == (lean.lies, lean.honest),
                "The two disclosure modes disagreed, so some play survived a round face down",
            )

    require(len(endings) >= 2, f"Only {sorted(endings)} were reached")
    leaky = {name: count for name, count in hidden_by_ending.items() if count}
    require(not leaky, f"An ending left cards face down: {leaky}")
    return f"{plays} plays across {sorted(endings)}, none left face down; both disclosure modes agree"


def check_standings(shape: AnteConfig, games: int, seed: int) -> str:
    """Gold, elimination, the deck resize and the final ranking, against `RULES-ANTE.md`."""
    config = base_config(shape, rounds=30, gold=2)
    eliminations = 0
    resizes = 0

    for index in range(games):
        env = AnteMatchEnv(config, seed=seed + index)
        decision = env.reset()
        ranks = env.match.active_ranks
        gold = list(env.match.gold)
        while not decision.terminated:
            match = decision.match
            before = len(match.outcomes)
            decision = env.step(env.sample_action())
            done = decision.match if decision.match is not None else env.match
            if len(done.outcomes) > before:
                outcome = done.outcomes[-1]
                # One winner, at most one loser, and only `Ending 1` has one.
                require(sum(1 for d in outcome.gold_delta if d > 0) == 1, "A round had not exactly one winner")
                losers = [seat for seat, d in enumerate(outcome.gold_delta) if d < 0]
                require(len(losers) <= 1, "A round took gold from more than one seat")
                require(
                    (outcome.ending == ENDING_BS) == bool(losers),
                    f"{outcome.ending} moved gold the wrong way",
                )
                expected = [gold[s] + outcome.gold_delta[s] for s in range(done.num_seats)]
                require([float(g) for g in done.gold] == expected, "Gold did not follow the delta")
                gold = list(done.gold)
                for seat in outcome.eliminated:
                    require(done.gold[seat] <= 0, "A seat with gold left was eliminated")
                eliminations += len(outcome.eliminated)
                require(done.active_ranks <= ranks, "The deck grew")
                if done.active_ranks < ranks:
                    resizes += 1
                    ranks = done.active_ranks
                if not done.finished:
                    require(
                        done.active_ranks == min(ranks, standard_rank_count(done.num_active)),
                        "The deck resize did not follow the rank table",
                    )
                    require(done.round.n == done.num_active, "The round seated the wrong number")

        match = env.match
        places = match.placements()
        survivors = [s for s in range(match.num_seats) if not match.eliminated[s]]
        gone = [s for s in range(match.num_seats) if match.eliminated[s]]
        for out in gone:
            for alive in survivors:
                require(places[out] > places[alive], "An eliminated seat outranked a survivor")
        for a in survivors:
            for b in survivors:
                if match.gold[a] > match.gold[b]:
                    require(places[a] < places[b], "More gold did not rank higher")
        for a in gone:
            for b in gone:
                if (match.left_at[a] or 0) > (match.left_at[b] or 0):
                    require(places[a] < places[b], "Leaving later did not rank higher")

    require(eliminations > 0, "No seat was eliminated, so the sweep went untested")
    require(resizes > 0, "The deck never resized, so that branch went untested")
    return f"{eliminations} elimination(s), {resizes} deck resize(s), rankings consistent"


def check_reward(shape: AnteConfig, games: int, seed: int) -> str:
    """The incremental reward sums to the gold that actually moved, and placement lands once."""
    config = base_config(shape)
    checked = 0
    for index in range(games):
        env = AnteMatchEnv(config, seed=seed + index, gold_weight=1.0, placement_weight=0.5)
        decision = env.reset()
        total = np.zeros(shape.num_players, dtype=np.float64)
        payouts = 0
        while not decision.terminated:
            decision = env.step(env.sample_action())
            total += decision.rewards
            payouts += int(bool(np.any(decision.rewards)))
        match = env.match
        expected = np.asarray(match.gold_rewards()) + 0.5 * np.asarray(match.placement_rewards())
        require(bool(np.allclose(total, expected)), f"Reward did not sum to the gold: {total} vs {expected}")
        require(payouts == len(match.outcomes), "A round settled without paying out")
        checked += 1
    return f"{checked} matches, reward summed to gold plus placement every time"


def check_warm_start(shape: AnteConfig, games: int, seed: int) -> str:
    """A match network warm-started from a one-round one must *be* that agent, not merely resemble it.

    `load_round_weights` zeroes the match block's columns in the first trunk layer, so the 98 extra
    features multiply by zero and cannot move a logit. That is what makes "did the match layer add
    anything" answerable: the alternative comparison — a from-scratch match agent against a
    longer-trained one-round agent — confounds the layer with the training budget, and did exactly
    that on the first attempt (`rl/ANTE.md`).

    Built from a randomly initialised one-round network rather than a saved checkpoint, so the check
    tests the mechanism and needs no artifact on disk. Skipped when torch is absent, since the rest of
    this script deliberately needs only numpy.
    """
    try:
        import torch
    except ImportError:  # pragma: no cover - reported, not failed
        return "skipped (needs torch)"

    from ante.nets import AnteNet, load_round_weights

    config = base_config(shape)
    env = AnteMatchEnv(config, seed=seed)
    torch.manual_seed(seed)
    reference = AnteNet(shape, extra_width=0)
    reference.eval()

    # Two loads: the default resets the value head (it predicts a different quantity in a match — see
    # `load_round_weights`), and the second keeps it, which is the exact-identity case.
    warm = AnteNet(shape, extra_width=env.extra_width, lie_head=True)
    load_round_weights(warm, reference.state_dict())
    warm.eval()
    exact = AnteNet(shape, extra_width=env.extra_width, lie_head=True)
    load_round_weights(exact, reference.state_dict(), reset_value_head=False)
    exact.eval()

    # Two comparisons, and only one of them can be exact.
    #
    # `worst_features` is the claim itself: the *same* network, on the same observation, with the
    # match block populated and with it zeroed. Identical shapes, identical kernel, so any difference
    # at all is the 98 features moving a logit — which is what the zeroed columns exist to forbid.
    # This one must be zero to the bit.
    #
    # `worst_policy` compares the warm network against the narrower one it was loaded from. That is a
    # matmul over 306 inputs against one over 208, so the summation order differs and the answer is
    # equal only up to float32. Requiring bit-identity there asserts something about the host's BLAS
    # rather than about this repo — it holds on one machine here and misses by 3e-8 on a Colab A100
    # box. Held to float32 noise instead.
    exact_zero = 0.0
    worst_features = 0.0
    worst_policy = 0.0
    worst_value = 0.0
    reset_moved_value = False
    compared = 0
    for index in range(max(2, games // 4)):
        decision = env.reset()
        while not decision.terminated:
            observation = torch.from_numpy(decision.observation).unsqueeze(0)
            blinded = observation.clone()
            blinded[:, reference.observation_size :] = 0.0
            mask = torch.from_numpy(decision.action_mask).unsqueeze(0)
            with torch.no_grad():
                got, reset_value, _ = warm.policy_and_lie(observation, mask)
                blank, _, _ = warm.policy_and_lie(blinded, mask)
                kept, kept_value, _ = exact.policy_and_lie(observation, mask)
                want, want_value = reference.policy(
                    observation[:, : reference.observation_size], mask
                )
            finite = torch.isfinite(want)
            worst_features = max(worst_features, float((got[finite] - blank[finite]).abs().max()))
            # The policy must match under *both* loads: resetting the value head must not disturb a
            # logit, or the control is no longer the agent it claims to be.
            worst_policy = max(
                worst_policy,
                float((got[finite] - want[finite]).abs().max()),
                float((kept[finite] - want[finite]).abs().max()),
            )
            worst_value = max(worst_value, float((kept_value - want_value).abs().max()))
            reset_moved_value = reset_moved_value or bool(
                (reset_value - want_value).abs().max() > 0
            )
            compared += 1
            decision = env.step(env.sample_action())

    tolerance = 1e-5
    require(
        worst_features == exact_zero,
        f"The match block moved a logit by {worst_features:.3e}, so its columns are not zeroed",
    )
    require(
        worst_policy <= tolerance,
        f"A warm-started policy differed from its source by {worst_policy:.3e}",
    )
    require(
        worst_value <= tolerance,
        f"reset_value_head=False still moved the value by {worst_value:.3e}",
    )
    require(reset_moved_value, "The value head reset did nothing, so it is not being applied")
    return (
        f"{compared} positions, match block moves nothing (0.0) and the policy tracks its source "
        f"to {worst_policy:.1e}; value head reset as intended"
    )


def check_event_window(shape: AnteConfig, games: int, seed: int) -> str:
    """A wider event window must add history and change nothing else.

    `AnteConfig.recent_events` was fixed at 8 for every run in `rl/runs/`, under a comment claiming it
    covers "a lap of the table plus the reveals inside it" — which is true at five seats and false
    above them, since a lap generates about `2n` events. `lap_events` is the opt-in that makes the
    claim hold at every count, and this is what holds *it*.

    Three things, and the third is the one a reader should not have to take on trust:

    * The width grows by exactly the extra event rows, and the round block is what grew.
    * The narrow encoding is a **prefix** of the wide one's round block. Event rows are newest-first
      and last in that block, so slot `s` means the same event at either width. That is why a *round*
      agent can still slice a wide table's vector — and why a *match* agent cannot, since its match
      block has moved, which is the case `MatchCheckpointAgent` re-encodes for.
    * At seven and eight seats the default window really does miss most of a lap, which is the
      motivation stated as a number rather than as an argument.
    """
    from dataclasses import replace

    wide_shape = replace(shape, recent_events=lap_events(shape.num_players))
    narrow = ObservationEncoder(shape)
    wide = ObservationEncoder(wide_shape)
    event_width = len(_EVENT_ROW)
    grew = (wide_shape.recent_events - shape.recent_events) * event_width
    require(
        wide.size == narrow.size + grew,
        f"A window of {wide_shape.recent_events} made the round block {wide.size - narrow.size} "
        f"wider, not {grew}",
    )

    config = base_config(shape)
    wide_config = replace(config, shape=wide_shape)
    env = AnteMatchEnv(config, seed=seed)
    wide_encoder = MatchObservationEncoder(wide_config)
    narrow_encoder = MatchObservationEncoder(config)

    worst_prefix = 0.0
    laps_missed = 0
    compared = 0
    for _ in range(max(2, games // 4)):
        decision = env.reset()
        while not decision.terminated:
            for viewer in range(shape.num_players):
                thin = narrow_encoder.encode(env.match, viewer)
                fat = wide_encoder.encode(env.match, viewer)
                worst_prefix = max(
                    worst_prefix, float(np.abs(thin[: narrow.size] - fat[: narrow.size]).max())
                )
                compared += 1
            if env.match.round is not None:
                laps_missed += int(len(env.match.round.events) > shape.recent_events)
            decision = env.step(env.sample_action())

    require(
        worst_prefix == 0.0,
        f"The narrow encoding is not a prefix of the wide one; it differs by {worst_prefix:.3e}",
    )
    return (
        f"{compared} views, window {shape.recent_events} is an exact prefix of "
        f"{wide_shape.recent_events}; {laps_missed} position(s) had more history than the default "
        f"window shows"
    )


def check_lie_feed(shape: AnteConfig, games: int, seed: int) -> str:
    """`--lie-to-policy` must start as a no-op and must reach the call logit once it is trained.

    Both halves matter and they pull in opposite directions, which is why they are one check.

    *It starts as a no-op* because the extra columns of `simple_head` and `context` are zeroed at
    construction. That is what makes the arm's own ablation a real control: the two networks are the
    same function at step zero, so a difference at the end is the feed rather than a re-rolled head.
    Held here to the bit, the way `warm start` holds the match block's zeroed columns.

    *It has to be reachable*, or the first half would be satisfied by a feed that is wired up wrong
    and silently does nothing for the whole run — the failure `check_record_blinding` guards against
    from the other side. So the columns are then filled in and the same positions re-read: the call
    logit must move, and it must move *because of the honesty prediction* rather than anything else,
    which is tested by moving that prediction alone.

    Skipped when torch is absent, since the rest of this script deliberately needs only numpy.
    """
    try:
        import torch
    except ImportError:  # pragma: no cover - reported, not failed
        return "skipped (needs torch)"

    from ante.nets import AnteNet, load_round_weights

    config = base_config(shape)
    env = AnteMatchEnv(config, seed=seed)
    torch.manual_seed(seed)

    plain = AnteNet(shape, extra_width=env.extra_width, lie_head=True)
    plain.eval()
    fed = AnteNet(shape, extra_width=env.extra_width, lie_head=True, lie_to_policy=True)
    # The warm start is the mechanism an arm would actually use: load a checkpoint that has no feed
    # into a network that does. `load_round_weights` pads the two head tensors, so this also covers
    # `COLUMN_PADDED` carrying more than the trunk.
    load_round_weights(fed, plain.state_dict(), reset_value_head=False)
    fed.eval()

    require(
        fed.simple_head.weight.shape[1] == plain.simple_head.weight.shape[1] + 1,
        "lie_to_policy did not widen simple_head, so nothing is being fed to it",
    )

    worst_zeroed = 0.0
    compared = 0
    observations = []
    masks = []
    for _ in range(max(2, games // 4)):
        decision = env.reset()
        while not decision.terminated:
            observation = torch.from_numpy(decision.observation).unsqueeze(0)
            mask = torch.from_numpy(decision.action_mask).unsqueeze(0)
            with torch.no_grad():
                got, _, _ = fed.policy_and_lie(observation, mask)
                want, _, _ = plain.policy_and_lie(observation, mask)
            finite = torch.isfinite(want)
            worst_zeroed = max(worst_zeroed, float((got[finite] - want[finite]).abs().max()))
            if len(observations) < 64 and bool(mask[0, CALL_BS_INDEX]):
                observations.append(observation)
                masks.append(mask)
            compared += 1
            decision = env.step(env.sample_action())

    require(
        worst_zeroed == 0.0,
        f"A zero-initialised honesty feed moved a logit by {worst_zeroed:.3e}, so it is not zeroed",
    )
    require(bool(observations), "No position offered Call BS, so the feed was never exercised")

    # Now make the feed live, and move only the honesty prediction. `lie_head`'s last bias is the one
    # parameter that shifts every prediction without touching anything else the trunk feeds.
    with torch.no_grad():
        fed.simple_head.weight[:, plain.simple_head.weight.shape[1] :] = 1.0
        stack = torch.cat(observations)
        stack_mask = torch.cat(masks)
        fed.lie_head[-1].bias.fill_(-8.0)
        honest, _, low = fed.policy_and_lie(stack, stack_mask)
        fed.lie_head[-1].bias.fill_(8.0)
        lying, _, high = fed.policy_and_lie(stack, stack_mask)

    swing = float((lying[:, CALL_BS_INDEX] - honest[:, CALL_BS_INDEX]).abs().max())
    require(
        swing > 1e-3,
        "Moving the honesty prediction did not move the Call BS logit, so the feed is not connected",
    )
    require(
        float(torch.sigmoid(low).max()) < 0.1 < 0.9 < float(torch.sigmoid(high).min()),
        "The honesty head's bias did not move its own prediction, so the probe proves nothing",
    )
    return (
        f"{compared} positions, zero-initialised feed moves nothing (0.0); once live it moves the "
        f"Call BS logit by up to {swing:.2f} over {len(observations)} call positions"
    )


def check_challenge_head(shape: AnteConfig, games: int, seed: int) -> str:
    """The challenge head must shape the trunk in training and change nothing at play time.

    That is the whole reason an arm carrying it can ship without a line moving in `anteNet.ts`, and
    it is exactly the property `export_ante_round.py` relies on when it deletes those tensors. Unlike
    the honesty head there is no `lie_to_policy` equivalent to make it load-bearing, so the claim is
    unconditional and worth asserting rather than reading off the code.

    Three claims, and the third is what stops the check passing vacuously:

    * a network with the head is **bit-identical** in policy and value to one without, on the same
      weights — so deleting the tensors is not a lossy export;
    * a warm start from a checkpoint that has no head produces exactly that network, which is the
      mechanism an arm actually uses (`--init` onto the shipped incumbent);
    * the head really does predict something, i.e. moving its own parameters moves its own output.

    Skipped when torch is absent, since the rest of this script deliberately needs only numpy.
    """
    try:
        import torch
    except ImportError:  # pragma: no cover - reported, not failed
        return "skipped (needs torch)"

    from ante.nets import AnteNet, infer_head_options, load_round_weights

    config = base_config(shape)
    env = AnteMatchEnv(config, seed=seed)
    torch.manual_seed(seed)

    plain = AnteNet(shape, extra_width=env.extra_width, lie_head=True)
    plain.eval()
    withhead = AnteNet(shape, extra_width=env.extra_width, lie_head=True, challenge_head=True)
    load_round_weights(withhead, plain.state_dict(), reset_value_head=False)
    withhead.eval()

    require(
        any(key.startswith("challenge_head.") for key in withhead.state_dict()),
        "The challenge head built no tensors, so there is nothing to check",
    )
    require(
        infer_head_options(withhead.state_dict(), 256)[2]
        and not infer_head_options(plain.state_dict(), 256)[2],
        "infer_head_options cannot tell a challenge-head checkpoint from one without",
    )

    worst_logit = 0.0
    worst_value = 0.0
    compared = 0
    stack = []
    masks = []
    for _ in range(max(2, games // 4)):
        decision = env.reset()
        while not decision.terminated:
            observation = torch.from_numpy(decision.observation).unsqueeze(0)
            mask = torch.from_numpy(decision.action_mask).unsqueeze(0)
            with torch.no_grad():
                got, got_value, _, challenge = withhead.policy_and_aux(observation, mask)
                want, want_value, _ = plain.policy_and_lie(observation, mask)
            require(challenge is not None, "The head produced no prediction on a live position")
            finite = torch.isfinite(want)
            worst_logit = max(worst_logit, float((got[finite] - want[finite]).abs().max()))
            worst_value = max(worst_value, float((got_value - want_value).abs().max()))
            if len(stack) < 64:
                stack.append(observation)
                masks.append(mask)
            compared += 1
            decision = env.step(env.sample_action())

    require(
        worst_logit == 0.0 and worst_value == 0.0,
        f"The challenge head moved a logit by {worst_logit:.3e} and the value by {worst_value:.3e}; "
        "it feeds nothing, so both must be exactly zero",
    )

    # It predicts something: its own last bias is the one parameter that shifts every prediction
    # without touching anything the trunk feeds.
    with torch.no_grad():
        batch = torch.cat(stack)
        batch_mask = torch.cat(masks)
        withhead.challenge_head[-1].bias.fill_(-8.0)
        _, _, _, low = withhead.policy_and_aux(batch, batch_mask)
        withhead.challenge_head[-1].bias.fill_(8.0)
        after, _, _, high = withhead.policy_and_aux(batch, batch_mask)
    require(
        float(torch.sigmoid(low).max()) < 0.1 < 0.9 < float(torch.sigmoid(high).min()),
        "Moving the challenge head's own bias did not move its prediction",
    )
    with torch.no_grad():
        reference, _, _ = plain.policy_and_lie(batch, batch_mask)
    finite = torch.isfinite(reference)
    require(
        float((after[finite] - reference[finite]).abs().max()) == 0.0,
        "Saturating the challenge head moved the policy, so its output is reaching the action heads",
    )
    return (
        f"{compared} positions, policy and value identical to the headless network (0.0), and the "
        f"head's own prediction spans {float(torch.sigmoid(low).max()):.3f}-"
        f"{float(torch.sigmoid(high).min()):.3f}"
    )


def check_record_blinding(shape: AnteConfig, games: int, seed: int) -> str:
    """A checkpoint trained without the opponent record must be blind to it wherever it is seated.

    `BLOWCOW_ANTE_NO_RECORD` is a process global, so a mixed table holding an ablation arm and a
    record-reading arm has no setting that is right for both — and scoring the ablation against live
    record columns asks it a question it never saw in training. Measured on `m-ante-norecord`, that
    was worth **+0.505 gold** and moved its elimination rate from 3.5% to 1.0%, which is most of the
    size of the effect the ablation exists to measure.

    So the flag rides in the checkpoint and the columns are zeroed for that seat alone. Three claims,
    and the second is what stops the check going vacuous:

    * a blinded agent decides identically whether or not the record columns are populated;
    * an unblinded one does **not**, on at least some positions, so the columns really do carry;
    * blinding does not edit the decision every other reader still holds — `torch.from_numpy` shares
      memory with the slice it is handed, so zeroing in place would corrupt the observation for the
      seats behind it.
    """
    if NO_RECORD_FEATURES:
        return "skipped (the encoder is already zeroing every record column)"
    try:
        import torch
    except ImportError:  # pragma: no cover - reported, not failed
        return "skipped (needs torch)"

    import tempfile
    from dataclasses import replace

    from ante.match_agents import MatchCheckpointAgent, make_match_agent
    from ante.nets import AnteNet

    config = base_config(shape)
    env = AnteMatchEnv(config, seed=seed)
    encoder = MatchObservationEncoder(config)
    columns = list(encoder.record_columns)
    require(bool(columns), "The encoder named no record columns, so nothing can be blinded")

    torch.manual_seed(seed)
    net = AnteNet(shape, extra_width=env.extra_width)
    with tempfile.TemporaryDirectory() as directory:
        path = str(Path(directory) / "ablation.pt")
        torch.save(
            {
                "model": net.state_dict(),
                "config": {"num_players": shape.num_players, "num_ranks": shape.num_ranks},
                "match": {
                    "round_limit": config.round_limit,
                    "starting_gold": config.starting_gold,
                    "disclosure": config.disclosure,
                },
                "hidden": 256,
                "type_dim": 32,
                "extra_width": env.extra_width,
                "value_scale": 1.0,
                "lie_head": False,
                "record_features": False,
            },
            path,
        )

        # The checkpoint says it was trained blind, so `ckpt:` must blind it without being told.
        blind = make_match_agent(f"ckpt:{path}", config, seed=seed)
        seeing = MatchCheckpointAgent(path, config, seed=seed, record_features=True)
        blind.temperature = 0.0  # greedy, so a difference is a difference and not a coin flip
        seeing.temperature = 0.0
        require(blind.name.startswith("norecord:"), "A blinded agent did not say so in its name")

        leaked = 0
        carried = 0
        mutated = 0
        compared = 0
        decision = env.reset()
        while not decision.terminated:
            live = decision.observation
            stripped = live.copy()
            stripped[columns] = 0.0
            blank = replace(decision, observation=stripped)

            before = live.copy()
            leaked += int(blind.act(decision) != blind.act(blank))
            carried += int(seeing.act(decision) != seeing.act(blank))
            mutated += int(not np.array_equal(live, before))

            compared += 1
            decision = env.step(env.sample_action())

        require(leaked == 0, f"A blinded agent changed its move on the record columns {leaked}x")
        require(mutated == 0, f"Blinding edited the decision in place at {mutated} position(s)")
        require(
            carried > 0,
            "An unblinded agent never moved on the record columns, so this check proves nothing",
        )

        # And the match config a checkpoint was trained under is checked rather than assumed: the
        # block normalises `rounds_left` by `round_limit` and every gold column by `starting_gold`.
        wrong = MatchConfig(
            shape=shape, round_limit=config.round_limit + 7, starting_gold=config.starting_gold
        )
        refused = False
        try:
            make_match_agent(f"ckpt:{path}", wrong, seed=seed)
        except ValueError:
            refused = True
        require(refused, "A checkpoint trained over a different round limit loaded without complaint")

    return (
        f"{compared} positions, blinded agent unmoved by {len(columns)} record columns "
        f"that moved the unblinded one {carried}x"
    )


def check_env_loop(shape: AnteConfig, games: int, seed: int) -> str:
    """Every decision offers a legal action, names a live seat, and the match terminates."""
    config = base_config(shape)
    steps = 0
    for index in range(games):
        env = AnteMatchEnv(config, seed=seed + index)
        decision = env.reset()
        while not decision.terminated:
            require(decision.action_mask.any(), "A decision offered no legal action")
            require(not env.match.eliminated[decision.seat], "An eliminated seat was asked to act")
            require(decision.seat in env.match.round_seat, "The acting seat is not in this round")
            reference = set(env.match.round.legal_actions())
            offered = {env.space.decompose(i) for i in np.flatnonzero(decision.action_mask)}
            require(offered == reference, "The flat mask disagreed with legal_actions")
            decision = env.step(env.sample_action())
            steps += 1
        require(env.match.finished, "The loop ended without the match finishing")
    return f"{steps} decisions, every mask agreed with legal_actions"


# --------------------------------------------------------------------------- runner


CHECKS: Tuple[Tuple[str, Callable[[AnteConfig, int, int], str]], ...] = (
    ("observation spec", check_observation_spec),
    ("round slice", check_round_slice),
    ("hidden information", check_hidden_information),
    ("public record", check_record),
    ("disclosure", check_disclosure),
    ("standings", check_standings),
    ("reward accounting", check_reward),
    ("warm start", check_warm_start),
    ("event window", check_event_window),
    ("lie feed", check_lie_feed),
    ("challenge head", check_challenge_head),
    ("record blinding", check_record_blinding),
    ("environment loop", check_env_loop),
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--games", type=int, default=20)
    parser.add_argument("--players", type=int, default=5)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--only", default=None, help="Substring of a check name")
    args = parser.parse_args()

    shape = AnteConfig.for_players(args.players)
    print(
        f"Ante match checks: {shape.num_players} players, {shape.num_ranks} ranks, "
        f"{shape.deck_size} cards"
    )
    if NO_RECORD_FEATURES:
        print("  BLOWCOW_ANTE_NO_RECORD=1: the opponent record columns are zeroed")

    failures = 0
    for name, check in CHECKS:
        if args.only and args.only not in name:
            continue
        try:
            print(f"  {name:22s} {check(shape, args.games, args.seed)}")
        except CheckFailure as failure:
            print(f"  {name:22s} FAIL {failure}")
            failures += 1

    print("\nOK" if failures == 0 else f"\n{failures} check(s) failed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())

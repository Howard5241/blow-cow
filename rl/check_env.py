"""Stage B validation: the canonical view, the action space, and the environment.

Stage A proved the simulator plays the same game as the engine. This proves the *encoding* of that
game is faithful — that the action space loses nothing a policy needs, that the observation leaks
nothing a seat may not see, and that rank identity really is invisible.

    python rl/check_env.py                 # everything except the oracle cross-check
    python rl/check_env.py --oracle         # also replay canonical play against the real engine
    python rl/check_env.py --games 40 --seed 3
"""

from __future__ import annotations

import argparse
import os
import random
import sys
import time
from typing import Dict, List, Optional, Sequence, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import numpy as np  # noqa: E402
except ModuleNotFoundError as missing:  # pragma: no cover - environment guidance
    raise SystemExit(
        f"Stage B needs {missing.name}, which this interpreter does not have.\n"
        "Activate the project virtualenv (or run this script with that interpreter) and retry.\n"
        "Stage A's rl/conformance.py has no third-party dependencies and runs on any interpreter."
    ) from missing

from blowcow.actions import Action  # noqa: E402
from blowcow.bridge import CanonicalTable  # noqa: E402
from blowcow.canonical import NUM_RANK_SLOTS, RankMapping  # noqa: E402
from blowcow.cards import RANKS, get_default_standard_rank_count, normalize_selected_ranks  # noqa: E402
from blowcow.engine import BlowCowEngine  # noqa: E402
from blowcow.env import BlowCowEnv, RewardConfig  # noqa: E402
from blowcow.observation import MAX_SEATS, OBSERVATION_SIZE, encode, feature_names  # noqa: E402
from blowcow.oracle_client import OracleClient  # noqa: E402
from blowcow.spaces import (  # noqa: E402
    NUM_ACTIONS,
    decompose,
    describe,
    off_deck_representative,
)


class CheckFailed(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise CheckFailed(message)


# --------------------------------------------------------------------------- 1

def check_spec() -> str:
    """The observation vector and its documented names have to be the same length."""
    names = feature_names()
    require(
        len(names) == OBSERVATION_SIZE,
        f"feature_names() has {len(names)} entries but OBSERVATION_SIZE is {OBSERVATION_SIZE}",
    )
    require(len(set(names)) == len(names), "feature names are not unique")

    engine = BlowCowEngine(4, seed=1)
    mapping = RankMapping.identity(engine.deck.selected_ranks)
    observation = encode(engine, mapping, engine.current_player)

    require(observation.shape == (OBSERVATION_SIZE,), f"observation shape {observation.shape}")
    require(observation.dtype == np.float32, f"observation dtype {observation.dtype}")
    return f"{OBSERVATION_SIZE} features, {NUM_ACTIONS} actions"


# --------------------------------------------------------------------------- 2

def check_mapping_bijection(rng: random.Random) -> str:
    """Every rank maps to exactly one slot and back, in-deck ranks first."""
    checked = 0
    for player_count in range(2, MAX_SEATS + 1):
        rank_count = get_default_standard_rank_count(player_count)
        for _ in range(20):
            selected = rng.sample(list(RANKS), rank_count)
            mapping = RankMapping.random(selected, rng)

            require(len(mapping.slot_to_rank) == NUM_RANK_SLOTS, "mapping is not 13 slots wide")
            require(
                sorted(mapping.slot_to_rank) == sorted(RANKS),
                "mapping is not a bijection over the thirteen ranks",
            )
            for slot, rank in enumerate(mapping.slot_to_rank):
                require(mapping.slot(rank) == slot, f"slot round-trip failed for {rank}")

            in_deck = set(normalize_selected_ranks(selected))
            for slot in range(NUM_RANK_SLOTS):
                expected = slot < len(in_deck)
                require(
                    mapping.is_in_deck(slot) == expected
                    and (mapping.rank(slot) in in_deck) == expected,
                    f"slot {slot} is on the wrong side of the in-deck boundary",
                )
            checked += 1

    return f"{checked} mappings"


# --------------------------------------------------------------------------- 3

def check_action_space(
    rng: random.Random, games: int, exhaustive_rate: float
) -> str:
    """The canonical mask must be a faithful, lossless re-indexing of the engine's own action list.

    Lossless with one deliberate exception: trump selections naming an off-deck rank all collapse onto
    one representative, because they are the same move. Every dropped one is checked to have a
    surviving twin.
    """
    decisions = 0
    collapsed = 0
    exhaustive = 0

    for game_index in range(games):
        player_count = 2 + game_index % (MAX_SEATS - 1)
        rank_count = get_default_standard_rank_count(player_count)
        selected = rng.sample(list(RANKS), rank_count)
        engine = BlowCowEngine(player_count, selected, seed=rng.randrange(1, 2**31))
        mapping = RankMapping.random(selected, rng)
        table = CanonicalTable(engine, mapping)

        for _ in range(20000):
            if engine.gameover is not None:
                break

            forced = engine.forced_move()
            if forced is not None:
                engine.apply_move(*forced)
                continue

            legal = engine.legal_actions()
            mask, action_table = table.build_actions()
            indices = set(int(index) for index in np.flatnonzero(mask))
            decisions += 1

            require(indices == set(action_table), "mask and action table disagree")

            previous = engine.round.previous_trump_rank
            previous_slot = mapping.slot(previous) if previous else None
            representative = off_deck_representative(mapping, previous_slot)

            for action in legal:
                index = table.index_for(action)
                if index is None:
                    collapsed += 1
                    require(
                        action.kind == "trumpPlay"
                        and action.trump_rank is not None
                        and not mapping.is_in_deck(mapping.slot(action.trump_rank)),
                        f"{action} was dropped but is not an off-deck trump selection",
                    )
                    twin = Action(
                        "trumpPlay",
                        mapping.rank(representative) if representative is not None else None,
                        action.cards,
                    )
                    require(
                        table.index_for(twin) in indices,
                        f"{action} was dropped with no surviving representative",
                    )
                    continue

                require(
                    index in indices,
                    f"{action} is legal for the engine but missing from the mask",
                )

            for index in indices:
                require(
                    action_table[index] in legal,
                    f"index {index} ({describe(index, mapping)}) is masked legal "
                    f"but {action_table[index]} is not",
                )
                kind, trump_slot, _choice = decompose(index)
                require(
                    kind == action_table[index].kind
                    or (kind == "trumpPlay" and action_table[index].kind == "trumpPlay"),
                    f"index {index} decomposes to {kind} but holds {action_table[index]}",
                )
                if kind == "trumpPlay":
                    require(
                        trump_slot is not None
                        and mapping.rank(trump_slot) == action_table[index].trump_rank,
                        f"index {index} names the wrong trump rank",
                    )

            # Every masked action, applied for real on a clone, has to be accepted.
            if indices and rng.random() < exhaustive_rate:
                for index in indices:
                    probe = engine.clone()
                    move_name, args = action_table[index].to_move()
                    require(
                        not probe.apply_move(probe.decision_player(), move_name, args),
                        f"the engine refused masked-legal index {index} "
                        f"({describe(index, mapping)})",
                    )
                exhaustive += len(indices)

            engine.apply_move(engine.decision_player(), *rng.choice(legal).to_move())

    return f"{decisions} decisions, {collapsed} off-deck duplicates collapsed, {exhaustive} applied"


# --------------------------------------------------------------------------- 4

def check_relabelling(rng: random.Random, games: int) -> str:
    """Two decks that differ only by a rank relabelling must produce identical canonical play.

    This is the claim the whole encoding rests on, and the one that decides whether a policy trained
    on canonical slots can sit down at a real table where the ranks were dealt at random. Both
    matches are driven by the same canonical action indices; if the abstraction were leaky, their
    observations would drift apart.
    """
    compared = 0

    for game_index in range(games):
        player_count = 2 + game_index % (MAX_SEATS - 1)
        rank_count = get_default_standard_rank_count(player_count)

        left_ranks = rng.sample(list(RANKS), rank_count)
        right_ranks = rng.sample(list(RANKS), rank_count)
        in_deck_order = list(range(rank_count))
        off_deck_order = list(range(len(RANKS) - rank_count))
        rng.shuffle(in_deck_order)
        rng.shuffle(off_deck_order)

        seed = rng.randrange(1, 2**31)
        left = BlowCowEngine(player_count, left_ranks, seed=seed)
        right = BlowCowEngine(player_count, right_ranks, seed=seed)
        left_table = CanonicalTable(
            left, RankMapping.from_permutation(left_ranks, in_deck_order, off_deck_order)
        )
        right_table = CanonicalTable(
            right, RankMapping.from_permutation(right_ranks, in_deck_order, off_deck_order)
        )

        for _ in range(20000):
            require(
                (left.gameover is None) == (right.gameover is None),
                "one relabelled match finished before the other",
            )
            if left.gameover is not None:
                break

            left_forced = left.forced_move()
            right_forced = right.forced_move()
            require(
                (left_forced is None) == (right_forced is None),
                "relabelled matches disagree on whether a move is forced",
            )

            if left_forced is not None and right_forced is not None:
                require(
                    left_forced[0] == right_forced[0] and left_forced[1] == right_forced[1],
                    f"forced moves diverged: {left_forced} vs {right_forced}",
                )
                left.apply_move(*left_forced)
                right.apply_move(*right_forced)
                continue

            require(
                left.decision_player() == right.decision_player(),
                "relabelled matches disagree on who acts",
            )

            for viewer in left.seat_order:
                left_observation = left_table.observation(viewer)
                right_observation = right_table.observation(viewer)
                if not np.array_equal(left_observation, right_observation):
                    names = feature_names()
                    where = np.flatnonzero(left_observation != right_observation)
                    detail = ", ".join(
                        f"{names[index]}: {left_observation[index]} vs {right_observation[index]}"
                        for index in where[:6]
                    )
                    raise CheckFailed(f"observations differ under relabelling — {detail}")
                compared += 1

            left_mask, left_actions = left_table.build_actions()
            right_mask, _right_actions = right_table.build_actions()
            require(
                np.array_equal(left_mask, right_mask),
                "action masks differ under relabelling",
            )

            index = int(rng.choice(np.flatnonzero(left_mask)))
            left.apply_move(left.decision_player(), *left_actions[index].to_move())
            right.apply_move(right.decision_player(), *_right_actions[index].to_move())

        require(
            left.gameover is not None and right.gameover is not None,
            "a relabelled match did not finish",
        )
        require(
            left.gameover.placements == right.gameover.placements
            and left.gameover.points_by_player == right.gameover.points_by_player,
            "relabelled matches produced different results",
        )

    return f"{compared} observation pairs identical"


# --------------------------------------------------------------------------- 5

def _permute_hidden_cards(
    engine: BlowCowEngine, viewer_id: str, rng: random.Random
) -> BlowCowEngine:
    """A clone with every card the viewer cannot see shuffled among the places it could be."""
    clone = engine.clone()
    slots: List[Tuple[str, object, int]] = []
    cards: List[int] = []

    for player_id in clone.seat_order:
        if player_id == viewer_id:
            continue
        for index in range(len(clone.players[player_id].hand)):
            slots.append(("hand", player_id, index))
            cards.append(clone.players[player_id].hand[index])

    for play_index, play in enumerate(clone.plays):
        if play.player_id == viewer_id:
            continue
        for card_index, card in enumerate(play.cards):
            if not clone._is_card_face_up(play, card):
                slots.append(("play", play_index, card_index))
                cards.append(card)

    rng.shuffle(cards)
    for (kind, owner, index), card in zip(slots, cards):
        if kind == "hand":
            clone.players[str(owner)].hand[index] = card
        else:
            clone.plays[int(owner)].cards[index] = card  # type: ignore[arg-type]

    return clone


def check_no_leak(rng: random.Random, games: int) -> str:
    """Reshuffling what the viewer cannot see must not move a single feature.

    If it does, the observation is telling a policy something a real client is never sent, and every
    number that comes out of training against it is worthless.
    """
    checks = 0

    for game_index in range(games):
        player_count = 2 + game_index % (MAX_SEATS - 1)
        rank_count = get_default_standard_rank_count(player_count)
        selected = rng.sample(list(RANKS), rank_count)
        engine = BlowCowEngine(player_count, selected, seed=rng.randrange(1, 2**31))
        mapping = RankMapping.random(selected, rng)

        for _ in range(20000):
            if engine.gameover is not None:
                break

            forced = engine.forced_move()
            if forced is not None:
                engine.apply_move(*forced)
                continue

            viewer = engine.decision_player()
            assert viewer is not None
            original = encode(engine, mapping, viewer)

            for _ in range(2):
                shuffled = _permute_hidden_cards(engine, viewer, rng)
                after = encode(shuffled, mapping, viewer)
                if not np.array_equal(original, after):
                    names = feature_names()
                    where = np.flatnonzero(original != after)
                    detail = ", ".join(
                        f"{names[index]}: {original[index]} vs {after[index]}"
                        for index in where[:6]
                    )
                    raise CheckFailed(f"hidden cards leaked into the observation — {detail}")
                checks += 1

            legal = engine.legal_actions()
            engine.apply_move(viewer, *rng.choice(legal).to_move())

    return f"{checks} reshuffles left the observation untouched"


def check_lie_feature(rng: random.Random, games: int) -> str:
    """The per-seat lie read in the observation must equal the estimator the bots use.

    They are two different computations of one number — the observation walks its own card tally and
    `probability_claim_is_a_lie` walks `unaccounted_by_type` — sharing only the arithmetic. Nothing
    else in the codebase would notice them drifting apart, and a network trained on a feature that no
    longer matches what the scripted opponents and the determinization sampler read is a silent
    mismatch rather than a crash.

    Note this rides on top of `hidden information`, which is what actually proves the feature is
    *legal*: every input to it (the count of hidden cards claimed, unaccounted trump, unseen total)
    is a tally the viewer can compute, so reshuffling what they cannot see leaves it untouched.
    """
    from blowcow.agents import probability_claim_is_a_lie
    from blowcow.observation import LIE_FEATURE_ENABLED, SEAT_BLOCK_START, SEAT_ROW_FEATURES

    names = feature_names()
    row_names = [name.split(".", 1)[1] for name in names[SEAT_BLOCK_START:][:SEAT_ROW_FEATURES]]
    pending_offset = row_names.index("claim_pending")
    lie_offset = row_names.index("claim_is_a_lie")

    compared = 0
    informative = 0  # Rows where a claim was actually standing, so the check cannot go vacuous.
    certain = 0      # Rows the counting proves are lies outright, the sharpest signal it gives.

    for game_index in range(games):
        player_count = 2 + game_index % (MAX_SEATS - 1)
        rank_count = get_default_standard_rank_count(player_count)
        selected = rng.sample(list(RANKS), rank_count)
        engine = BlowCowEngine(player_count, selected, seed=rng.randrange(1, 2**31))
        mapping = RankMapping.random(selected, rng)

        for _ in range(20000):
            if engine.gameover is not None:
                break
            forced = engine.forced_move()
            if forced is not None:
                engine.apply_move(*forced)
                continue

            viewer = engine.decision_player()
            assert viewer is not None
            observation = encode(engine, mapping, viewer)
            viewer_seat = engine.players[viewer].seat_index

            for player_id, player in engine.players.items():
                relative = (player.seat_index - viewer_seat) % len(engine.seat_order)
                base = SEAT_BLOCK_START + relative * SEAT_ROW_FEATURES
                pending = float(observation[base + pending_offset])
                actual = float(observation[base + lie_offset])

                if player_id == viewer:
                    # Never a read on yourself: you know, and `unaccounted` excludes your own cards.
                    if pending != 0.0 or actual != 0.0:
                        raise CheckFailed(
                            f"the viewer's own seat carries a lie read ({pending}, {actual})"
                        )
                    continue

                expected = probability_claim_is_a_lie(engine, mapping, viewer, player_id)
                if engine.round.trump_rank is None or not LIE_FEATURE_ENABLED:
                    expected = 0.0
                if abs(expected - actual) > 1e-6:
                    raise CheckFailed(
                        f"seat {relative} lie read {actual} but the estimator says {expected}"
                    )
                if pending not in (0.0, 1.0):
                    raise CheckFailed(f"claim_pending is not a flag: {pending}")
                if pending == 0.0 and actual != 0.0:
                    raise CheckFailed(f"a lie read of {actual} with no claim standing")
                compared += 1
                informative += int(pending == 1.0)
                certain += int(actual >= 1.0)

            legal = engine.legal_actions()
            engine.apply_move(viewer, *rng.choice(legal).to_move())

    if not LIE_FEATURE_ENABLED:
        # The ablation arm. Everything above still ran, so this proves the control really is blind
        # rather than merely differently-shaped: same width, same checks, both columns pinned to 0.
        return f"{compared} seat reads all zero, BLOWCOW_NO_LIE_FEATURE is set: feature is OFF"

    if informative < 50:
        raise CheckFailed(
            f"only {informative} seats had a claim standing — the comparison is close to vacuous, "
            "so agreement here would prove nothing"
        )
    if certain == 0:
        raise CheckFailed(
            "counting never once proved a claim impossible, so the branch that matters most "
            "to a caller was never exercised"
        )
    return f"{compared} seat reads agreed ({informative} with a live claim, {certain} certain lies)"


# --------------------------------------------------------------------------- 6

def check_env_loop(rng: random.Random, games: int) -> str:
    """Episodes finish, rewards are zero-sum, and the terminal signal agrees with the placements."""
    env = BlowCowEnv(seed=rng.randrange(1, 2**31))
    episodes = 0
    total_steps = 0
    truncations = 0
    finishes: Dict[int, int] = {}

    for game_index in range(games):
        # Cycled rather than sampled, so a short run still covers every table size.
        step = env.reset(num_players=2 + game_index % (MAX_SEATS - 1))
        totals = {agent: 0.0 for agent in env.agents}
        count = env.num_players

        while not step.done:
            require(step.agent is not None, "a non-terminal step named no agent")
            require(
                step.observation is not None and step.observation.shape == (OBSERVATION_SIZE,),
                "observation shape is wrong",
            )
            require(bool(step.action_mask.any()), "a decision point offered no legal action")
            require(
                float(np.abs(np.array(list(step.rewards.values()))).sum()) < 1e6,
                "rewards exploded",
            )
            require(
                abs(sum(step.rewards.values())) < 1e-6,
                f"mid-match rewards are not zero-sum: {step.rewards}",
            )
            for agent, value in step.rewards.items():
                totals[agent] += value

            step = env.step(env.sample_action(rng))
            total_steps += 1

        for agent, value in step.rewards.items():
            totals[agent] += value

        placements = step.info["placements"]
        require(len(placements) == count, "placements do not cover every seat")

        best, worst = placements[0], placements[-1]
        points = step.info["points"]
        require(
            points[best] <= points[worst],
            "the leading seat did not have the fewest points, which is the whole objective",
        )
        require(
            totals[best] > totals[worst],
            f"the leading seat ({best}) scored no better than the last seat ({worst})",
        )

        expected = -env.reward.truncation_penalty * count if step.truncated else 0.0
        require(
            abs(sum(step.rewards.values()) - expected) < 1e-6,
            f"final rewards should sum to {expected}, got {sum(step.rewards.values())}",
        )
        truncations += int(step.truncated)

        finishes[count] = finishes.get(count, 0) + 1
        episodes += 1

    spread = ", ".join(f"{count}p={value}" for count, value in sorted(finishes.items()))
    truncated_note = f", {truncations} truncated" if truncations else ""
    return f"{episodes} episodes, {total_steps} decisions ({spread}){truncated_note}"


# --------------------------------------------------------------------------- 7

def check_pettingzoo() -> str:
    """The optional AEC wrapper against PettingZoo's own conformance test, when it is installed."""
    try:
        import contextlib
        import io
        import warnings

        from pettingzoo.test import api_test  # type: ignore

        from blowcow.pettingzoo_env import BlowCowAECEnv
    except ImportError as missing:
        return f"skipped ({missing.name} is not installed)"

    with warnings.catch_warnings():
        # It would rather every observation were a Box; a masked action space needs a Dict.
        warnings.simplefilter("ignore", UserWarning)
        with contextlib.redirect_stdout(io.StringIO()):
            api_test(BlowCowAECEnv(seed=17), num_cycles=600, verbose_progress=False)

    return "PettingZoo api_test passed"


# --------------------------------------------------------------------------- 8

def check_against_oracle(rng: random.Random, games: int, node: str) -> str:
    """Drive a match entirely through the canonical action space, against the real engine.

    Every move a policy could make in canonical space is applied to the real `BlowCowGame` as well.
    This is what says a trained agent's chosen action is a move a live match would actually accept,
    with the ranks dealt at random and the mapping drawn fresh.
    """
    from blowcow.projection import diff, project

    applied = 0

    with OracleClient(node_executable=node) as oracle:
        for game_index in range(games):
            player_count = 2 + game_index % (MAX_SEATS - 1)
            rank_count = get_default_standard_rank_count(player_count)
            selected = normalize_selected_ranks(rng.sample(list(RANKS), rank_count))
            seed = rng.randrange(1, 2**31)

            oracle_projection = oracle.new_match(player_count, selected, seed)
            engine = BlowCowEngine(player_count, selected, seed=seed)
            mapping = RankMapping.random(selected, rng)
            table = CanonicalTable(engine, mapping)

            require(
                not diff(project(engine), oracle_projection, "state"),
                "the canonical run started from a different deal than the engine",
            )

            for _ in range(20000):
                if engine.gameover is not None:
                    break

                forced = engine.forced_move()
                if forced is not None:
                    player_id, move_name, args = forced
                else:
                    mask, action_table = table.build_actions()
                    index = int(rng.choice(np.flatnonzero(mask)))
                    player_id = engine.decision_player()
                    move_name, args = action_table[index].to_move()
                    applied += 1

                oracle_invalid, oracle_projection = oracle.apply(player_id, move_name, args)
                require(
                    not oracle_invalid,
                    f"the real engine refused a canonical action: {player_id} {move_name} {args}",
                )
                engine.apply_move(player_id, move_name, args)

                differences = diff(project(engine), oracle_projection, "state")
                require(not differences, f"canonical play diverged: {differences[:4]}")

            require(engine.gameover is not None, "a canonical match did not finish")

    return f"{applied} canonical actions accepted by the real engine"


# --------------------------------------------------------------------------- 8

def measure_throughput(seconds: float = 3.0) -> str:
    env = BlowCowEnv(seed=12345, reward=RewardConfig())
    rng = random.Random(0)
    decisions = 0
    episodes = 0

    started = time.perf_counter()
    while time.perf_counter() - started < seconds:
        step = env.reset()
        while not step.done:
            step = env.step(env.sample_action(rng))
            decisions += 1
        episodes += 1
    elapsed = time.perf_counter() - started

    return (
        f"{decisions / elapsed:,.0f} decisions/s with observations encoded, "
        f"{episodes / elapsed:,.1f} episodes/s"
    )


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--games", type=int, default=10, help="matches per check (default: 10)")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument(
        "--exhaustive-rate",
        type=float,
        default=0.02,
        help="fraction of decisions where every masked action is applied on a clone",
    )
    parser.add_argument(
        "--oracle", action="store_true", help="also replay canonical play against the real engine"
    )
    parser.add_argument("--node", default="node")
    parser.add_argument("--skip-throughput", action="store_true")
    args = parser.parse_args(argv)

    checks = [
        ("observation spec", lambda: check_spec()),
        ("rank mapping bijection", lambda: check_mapping_bijection(random.Random(args.seed))),
        (
            "action space fidelity",
            lambda: check_action_space(
                random.Random(args.seed + 1), args.games, args.exhaustive_rate
            ),
        ),
        ("rank relabelling invariance", lambda: check_relabelling(random.Random(args.seed + 2), args.games)),
        ("hidden information", lambda: check_no_leak(random.Random(args.seed + 3), max(2, args.games // 2))),
        ("analytic lie feature", lambda: check_lie_feature(random.Random(args.seed + 6), args.games)),
        ("environment loop", lambda: check_env_loop(random.Random(args.seed + 4), args.games)),
        ("pettingzoo wrapper", check_pettingzoo),
    ]

    if args.oracle:
        checks.append(
            (
                "canonical play vs real engine",
                lambda: check_against_oracle(
                    random.Random(args.seed + 5), max(2, args.games // 3), args.node
                ),
            )
        )

    failures = 0
    for name, run in checks:
        started = time.perf_counter()
        try:
            detail = run()
        except CheckFailed as failure:
            print(f"FAIL {name}\n     {failure}")
            failures += 1
            continue
        print(f"PASS {name:32s} {detail}  ({time.perf_counter() - started:.1f}s)")

    if not args.skip_throughput and not failures:
        print(f"     {'throughput':32s} {measure_throughput()}")

    if failures:
        print(f"\n{failures} check(s) failed.")
        return 1

    print("\nAll Stage B checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

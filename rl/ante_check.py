"""The encoding and the environment, held to the simulator.

`rl/ante_conformance.py` holds the simulator to the real engine. This holds everything built on top
of the simulator to the simulator: the flat action space, the observation, the reward, and two
symmetry claims the whole design rests on.

Usage::

    python rl/ante_check.py --games 40
"""

from __future__ import annotations

import argparse
import random
import sys
from pathlib import Path
from typing import Callable, Dict, List, Optional, Sequence, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    import numpy as np
except ImportError:  # pragma: no cover - a bare interpreter says so rather than tracebacking
    print("ante_check needs numpy. Activate the project virtualenv, or run that interpreter directly.")
    raise SystemExit(2)

from ante.config import AnteConfig  # noqa: E402
from ante.env import AnteEnv  # noqa: E402
from ante.game import (  # noqa: E402
    ACTION_PLAY,
    ENDING_ALL_PASS,
    ENDING_BS,
    ENDING_EMPTY_HAND,
    AnteRound,
    lie_probability_from_counts,
)
from ante.observation import NO_LIE_FEATURE, ObservationEncoder  # noqa: E402
from ante.spaces import ActionSpace  # noqa: E402


class CheckFailure(AssertionError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise CheckFailure(message)


# --------------------------------------------------------------------------- helpers


def random_positions(
    config: AnteConfig, games: int, seed: int, per_game: int = 6
) -> List[Tuple[AnteRound, int]]:
    """A spread of live positions, each paired with a seat to view it from."""
    rng = random.Random(seed)
    positions: List[Tuple[AnteRound, int]] = []

    # Alternated on purpose. Kind-first reaches the resolutions and the pass endings; flat fills a
    # table and reaches the long positions. Either alone leaves half the state space untouched.
    for game_index in range(games):
        game = AnteRound.deal(config, rng=rng)
        mode = "flat" if game_index % 2 == 0 else "kind"
        while not game.finished:
            if len(positions) < games * per_game and rng.random() < 0.6:
                positions.append((game.clone(), rng.randrange(config.num_players)))
            game.apply(sample_action(game, rng, mode))
    return positions


def sample_action(game: AnteRound, rng: random.Random, mode: str = "kind") -> Tuple:
    """Pick an action under one of three schedules, because no single one covers the game.

    One schedule per ending, because no single one reaches all three. ``flat`` is uniform over legal
    actions. ``kind`` picks a kind first, which is what reaches `Call BS` often. ``pass_heavy`` leans
    on `Pass`, the only way five in a row happens often enough to test `Ending 2`. ``play_heavy``
    refuses to challenge, which is what empties a hand and reaches `Ending 3`.
    """
    actions = game.legal_actions()
    if mode == "flat":
        return actions[rng.randrange(len(actions))]

    by_kind: Dict[str, List[Tuple]] = {}
    for action in actions:
        by_kind.setdefault(action[0], []).append(action)

    if mode == "pass_heavy" and rng.random() < 0.6:
        return ("pass",)
    if mode == "play_heavy" and "play" in by_kind and rng.random() < 0.9:
        bucket = by_kind["play"]
        return bucket[rng.randrange(len(bucket))]

    bucket = by_kind[rng.choice(sorted(by_kind))]
    return bucket[rng.randrange(len(bucket))]


def permute_types(game: AnteRound, permutation: Sequence[int]) -> AnteRound:
    """Relabel the standard ranks. The Joker keeps its slot; it is a different kind of card."""
    other = game.clone()
    joker = game.config.joker_type
    full = list(permutation) + [joker]

    other.hands = []
    for hand in game.hands:
        relabelled = [0] * game.config.num_types
        for card_type, count in enumerate(hand):
            relabelled[full[card_type]] = count
        other.hands.append(relabelled)

    for index, play in enumerate(game.table):
        other.table[index].types = tuple(sorted(full[card_type] for card_type in play.types))

    if game.trump is not None:
        other.trump = full[game.trump] if game.trump < len(permutation) else game.trump
    return other


# --------------------------------------------------------------------------- checks


def check_observation_spec(config: AnteConfig, games: int, seed: int) -> str:
    encoder = ObservationEncoder(config)
    require(len(encoder.names) == encoder.size, "Feature names do not match the vector width")
    require(len(set(encoder.names)) == encoder.size, "Feature names are not unique")

    for game, viewer in random_positions(config, games, seed):
        vector = encoder.encode(game, viewer)
        require(vector.shape == (encoder.size,), "Observation width moved")
        require(bool(np.isfinite(vector).all()), "Observation carries a non-finite value")
        again = encoder.encode(game, viewer)
        require(bool((vector == again).all()), "Observation is not deterministic")

    return f"{encoder.size} features, names unique and matching the vector"


def check_action_space(config: AnteConfig, games: int, seed: int) -> str:
    space = ActionSpace(config)
    for index in range(space.size):
        require(space.index(space.decompose(index)) == index, f"Index {index} did not round-trip")

    rng = random.Random(seed)
    decisions = 0
    for _ in range(games):
        game = AnteRound.deal(config, rng=rng)
        while not game.finished:
            reference = set(space.index(action) for action in game.legal_actions())
            mask = set(index for index, legal in enumerate(space.legal_mask(game)) if legal)
            require(
                reference == mask,
                f"Mask and enumeration disagree: {sorted(reference ^ mask)[:8]}",
            )
            for index in mask:
                require(game.is_legal(space.decompose(index)), f"Masked action {index} is not legal")
            decisions += 1
            actions = game.legal_actions()
            game.apply(actions[rng.randrange(len(actions))])

    return f"{decisions} decisions; mask, enumeration and per-action legality agree"


def scramble_hidden(
    game: AnteRound, viewer: int, rng: random.Random
) -> Optional[AnteRound]:
    """A legal rearrangement of everything ``viewer`` cannot see, or ``None`` if there is nothing.

    What a viewer cannot see is exactly the other seats' hands and the cards face down in front of
    them. Their *sizes* are public, so a rearrangement keeps every size and permutes the contents.
    """
    hidden: List[int] = []
    for seat in range(game.config.num_players):
        if seat == viewer:
            continue
        for card_type, count in enumerate(game.hands[seat]):
            hidden.extend([card_type] * count)
    hidden_plays = [
        index for index, play in enumerate(game.table) if not play.revealed and play.seat != viewer
    ]
    for index in hidden_plays:
        hidden.extend(game.table[index].types)
    if len(hidden) < 2:
        return None

    scrambled = game.clone()
    rng.shuffle(hidden)
    cursor = 0
    for seat in range(game.config.num_players):
        if seat == viewer:
            continue
        size = sum(game.hands[seat])
        counts = [0] * game.config.num_types
        for card_type in hidden[cursor : cursor + size]:
            counts[card_type] += 1
        scrambled.hands[seat] = counts
        cursor += size
    for index in hidden_plays:
        size = game.table[index].size
        scrambled.table[index].types = tuple(sorted(hidden[cursor : cursor + size]))
        cursor += size
    require(cursor == len(hidden), "The reshuffle lost cards")
    return scrambled


def check_scripted_agents(config: AnteConfig, games: int, seed: int) -> str:
    """The baselines see only what a player would.

    They read the position rather than the observation vector, which is convenient and is also how a
    bot quietly ends up peeking at a hand it cannot see — and a yardstick that cheats sets the bar
    somewhere no honest policy can reach. So the same test the encoder gets: reshuffle what the
    acting seat cannot see, and require the same decision.
    """
    from ante.agents import BASELINES

    rng = random.Random(seed)
    agents = {name: builder(config, seed=seed) for name, builder in BASELINES.items()}
    compared = 0

    for game, _viewer in random_positions(config, games, seed):
        if game.finished:
            continue
        viewer = game.current
        scrambled = scramble_hidden(game, viewer, rng)
        if scrambled is None:
            continue
        for name, agent in agents.items():
            agent._rng.seed(seed)
            before = agent.choose(game)
            agent._rng.seed(seed)
            after = agent.choose(scrambled)
            require(
                before == after,
                f"{name} changed its mind when cards it cannot see moved: {before!r} vs {after!r}",
            )
            compared += 1

    require(compared >= 100, f"Only {compared} agent decisions were compared")
    return f"{compared} decisions over {len(agents)} baselines survived a reshuffle unchanged"


def check_hidden_information(config: AnteConfig, games: int, seed: int) -> str:
    """Reshuffle everything the viewer cannot see and require the observation not to move.

    What a viewer cannot see is exactly: the other seats' hands, and the cards face down in front of
    them. Their *sizes* are public, so a legal rearrangement keeps every size and permutes the
    contents. If one feature moves, something private reached the vector.
    """
    encoder = ObservationEncoder(config)
    rng = random.Random(seed)
    reshuffles = 0
    checked = 0

    for game, viewer in random_positions(config, games, seed):
        baseline = encoder.encode(game, viewer)
        if scramble_hidden(game, viewer, rng) is None:
            continue
        checked += 1

        for _ in range(4):
            scrambled = scramble_hidden(game, viewer, rng)
            assert scrambled is not None
            moved = encoder.encode(scrambled, viewer)
            require(
                bool((moved == baseline).all()),
                "A reshuffle of hidden cards moved the observation: "
                + str([encoder.names[i] for i in np.flatnonzero(moved != baseline)][:6]),
            )
            reshuffles += 1

    require(checked >= 10, "Too few positions had anything hidden to reshuffle")
    return f"{reshuffles} reshuffles over {checked} positions moved not one feature"


def check_rank_relabelling(config: AnteConfig, games: int, seed: int) -> str:
    """Rank identity carries no information — the claim that lets the encoder skip a bijection.

    Two things are asserted. The *observation* moves only by permuting its per-type rows, and the
    *game* plays out identically under a relabelling: the same actions, translated, reach the same
    winner and the same reward.
    """
    encoder = ObservationEncoder(config)
    space = ActionSpace(config)
    rng = random.Random(seed)
    global_width = sum(1 for name in encoder.names if "." not in name)
    per_type = sum(1 for name in encoder.names if name.startswith("type0."))
    compared = 0
    episodes = 0

    for _ in range(games):
        permutation = list(range(config.num_ranks))
        rng.shuffle(permutation)

        original = AnteRound.deal(config, rng=rng)
        mirrored = permute_types(original, permutation)
        full = list(permutation) + [config.joker_type]

        while not original.finished:
            for viewer in range(config.num_players):
                left = encoder.encode(original, viewer)
                right = encoder.encode(mirrored, viewer)
                # Undo the row permutation and the two halves must be identical.
                reordered = right.copy()
                for card_type in range(config.num_types):
                    source = global_width + full[card_type] * per_type
                    target = global_width + card_type * per_type
                    reordered[target : target + per_type] = right[source : source + per_type]
                require(
                    bool(np.allclose(left, reordered, atol=1e-6)),
                    "A rank relabelling moved more than the per-type rows: "
                    + str([encoder.names[i] for i in np.flatnonzero(np.abs(left - reordered) > 1e-6)][:6]),
                )
                compared += 1

            actions = original.legal_actions()
            action = actions[rng.randrange(len(actions))]
            if action[0] == ACTION_PLAY:
                trump_slot = action[1]
                mirrored_action = (
                    ACTION_PLAY,
                    None if trump_slot is None else (full[trump_slot] if trump_slot < config.num_ranks else trump_slot),
                    tuple(sorted(full[card_type] for card_type in action[2])),
                )
            else:
                mirrored_action = action
            require(
                space.legal_mask(mirrored)[space.index(mirrored_action)],
                "A relabelled action was not legal in the relabelled game",
            )
            original.apply(action)
            mirrored.apply(mirrored_action)

        require(mirrored.finished, "The relabelled game did not finish with the original")
        require(original.rewards() == mirrored.rewards(), "A relabelling changed the reward")
        require(original.ending == mirrored.ending, "A relabelling changed the ending")
        episodes += 1

    return f"{compared} observation pairs over {episodes} episodes, to identical rewards"


def check_environment(config: AnteConfig, games: int, seed: int) -> str:
    env = AnteEnv(config, seed=seed)
    rng = random.Random(seed)
    space = ActionSpace(config)
    endings: Dict[str, int] = {}
    total_turns = 0

    for game_index in range(games):
        mode = ("flat", "kind", "pass_heavy", "play_heavy")[game_index % 4]
        decision = env.reset()
        while not decision.terminated:
            require(bool(decision.action_mask.any()), "A live position offered no legal action")
            assert env.game is not None
            decision = env.step(space.index(sample_action(env.game, rng, mode)))

        rewards = decision.rewards
        winners = int((rewards > 0).sum())
        losers = int((rewards < 0).sum())
        require(winners == 1, f"A round named {winners} winners")
        require(losers <= 1, f"A round named {losers} losers")
        require(
            float(rewards[decision.info["winner"]]) == 1.0,
            "The named winner did not take the gold",
        )
        ending = decision.info["ending"]
        require(
            (losers == 1) == (ending == ENDING_BS),
            "Only a lost Call BS may take gold away",
        )
        endings[ending] = endings.get(ending, 0) + 1
        total_turns += decision.info["turns"]

    require(set(endings) <= {ENDING_BS, ENDING_ALL_PASS, ENDING_EMPTY_HAND}, "Unknown ending")
    require(len(endings) == 3, f"Random play never reached all three endings: {endings}")
    summary = ", ".join(f"{name}={count}" for name, count in sorted(endings.items()))
    return f"{games} episodes, every one terminated ({summary}), {total_turns / games:.1f} turns each"


def check_pass_ending(config: AnteConfig, games: int, seed: int) -> str:
    """`n - 1` passes standing makes `Pass` a winning move. Asserted, because it is a dominant action.

    It follows from `Ending 2` rather than being a separate rule, and a policy that has not found it
    is leaving a free round on the table every time it comes up — so it is worth having a check that
    fails if the arithmetic ever moves.
    """
    rng = random.Random(seed)
    opportunities = 0

    for _ in range(games):
        game = AnteRound.deal(config, rng=rng)
        while not game.finished:
            if game.pass_streak == config.num_players - 1:
                probe = game.clone()
                seat = probe.current
                probe.apply(("pass",))
                require(probe.finished, "A pass at n-1 did not end the round")
                require(probe.winner == seat, "A pass at n-1 did not win the round")
                require(probe.ending == ENDING_ALL_PASS, "A pass at n-1 ended some other way")
                opportunities += 1
            game.apply(sample_action(game, rng, "pass_heavy"))

    require(opportunities >= 5, f"Only {opportunities} pass-to-win positions were reached")
    return f"{opportunities} positions where passing wins outright, all of them did"


def check_lie_feature(config: AnteConfig, games: int, seed: int) -> str:
    """The analytic column is the same number the bots read, and it can prove a claim impossible."""
    encoder = ObservationEncoder(config)
    per_seat = sum(1 for name in encoder.names if name.startswith("seat+0."))
    seat_offset = sum(1 for name in encoder.names if "." not in name) + config.num_types * sum(
        1 for name in encoder.names if name.startswith("type0.")
    )
    column = [
        name.split(".", 1)[1] for name in encoder.names if name.startswith("seat+0.")
    ].index("claim_is_a_lie")

    claims = 0
    impossible = 0
    for game, viewer in random_positions(config, games, seed):
        vector = encoder.encode(game, viewer)
        for offset in range(config.num_players):
            seat = (viewer + offset) % config.num_players
            expected = game.claim_lie_probability(viewer, seat)
            actual = float(vector[seat_offset + offset * per_seat + column])
            if NO_LIE_FEATURE:
                require(actual == 0.0, "The ablation left the lie column populated")
                continue
            require(
                abs(actual - expected) < 1e-6,
                f"The lie column drifted from claim_lie_probability: {actual} vs {expected}",
            )
            if game.pending_play_index(seat) is not None and seat != viewer:
                claims += 1
                if expected >= 1.0:
                    impossible += 1

    require(lie_probability_from_counts(2, 1, 20) == 1.0, "A claim of more trump than exists is not certain")
    require(lie_probability_from_counts(0, 5, 20) == 0.0, "A claim of nothing is not a lie")
    if NO_LIE_FEATURE:
        return "feature is OFF: the column is zero at unchanged width"
    require(claims >= 30, f"Only {claims} standing claims were seen")
    require(impossible >= 1, "Counting never once proved a claim impossible")
    return f"{claims} standing claims, {impossible} of them provably impossible"


# --------------------------------------------------------------------------- runner


CHECKS: Tuple[Tuple[str, Callable[[AnteConfig, int, int], str]], ...] = (
    ("observation spec", check_observation_spec),
    ("action space", check_action_space),
    ("hidden information", check_hidden_information),
    ("scripted agents", check_scripted_agents),
    ("rank relabelling", check_rank_relabelling),
    ("environment loop", check_environment),
    ("pass ending", check_pass_ending),
    ("analytic lie feature", check_lie_feature),
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--games", type=int, default=40)
    parser.add_argument("--players", type=int, default=5)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--only", default=None, help="Substring of a check name")
    args = parser.parse_args()

    config = AnteConfig.for_players(args.players)
    print(
        f"Ante checks: {config.num_players} players, {config.num_ranks} ranks, "
        f"{config.deck_size} cards, hands of {config.hand_size}"
    )
    if NO_LIE_FEATURE:
        print("  BLOWCOW_ANTE_NO_LIE_FEATURE=1: the analytic lie column is zeroed")

    failures = 0
    for name, check in CHECKS:
        if args.only and args.only not in name:
            continue
        try:
            print(f"  {name:24s} {check(config, args.games, args.seed)}")
        except CheckFailure as failure:
            print(f"  {name:24s} FAIL {failure}")
            failures += 1

    print("\nOK" if failures == 0 else f"\n{failures} check(s) failed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())

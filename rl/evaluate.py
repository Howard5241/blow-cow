"""Round-robin evaluation: how strong is an agent, really.

Self-play win rate is self-deluding in a bluffing game, so strength is measured against a fixed slate
of opponents instead. Seats rotate every match, because the starting player and the direction are not
symmetric and a fixed assignment would measure the chair as much as the agent.

    python rl/evaluate.py --agents heuristic random --games 200
    python rl/evaluate.py --agents ckpt:runs/ppo/final.pt heuristic --players 4 --games 300
    python rl/evaluate.py --round-robin random honest liar caller heuristic --games 120

Scores are the same placement value the environment pays: ``+1`` for first, ``-1`` for last, linear
in between, so a table of equal agents averages zero. A **truncated** match has no result — three of
the baselines never finish against copies of themselves — and is reported separately rather than
folded into the score.
"""

from __future__ import annotations

import argparse
import itertools
import math
import os
import random
import sys
from collections import defaultdict
from typing import Dict, List, Optional, Sequence

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import numpy as np  # noqa: F401,E402
except ModuleNotFoundError as missing:  # pragma: no cover - environment guidance
    raise SystemExit(
        f"Evaluation needs {missing.name}. Activate the project virtualenv and retry."
    ) from missing

from blowcow.agents import Decision, make_agent  # noqa: E402
from blowcow.env import BlowCowEnv, RewardConfig  # noqa: E402
from blowcow.observation import MAX_SEATS  # noqa: E402


class Tally:
    __slots__ = (
        "matches", "score", "wins", "points", "placements", "truncated", "scored", "square",
    )

    def __init__(self) -> None:
        self.matches = 0
        self.score = 0.0
        self.wins = 0
        self.points = 0
        self.placements = 0
        self.truncated = 0
        self.scored = 0
        self.square = 0.0

    def add(self, score: float, place: int, points: int, truncated: bool, count_it: bool) -> None:
        self.matches += 1
        self.truncated += int(truncated)
        if not count_it:
            return
        self.scored += 1
        self.score += score
        self.square += score * score
        self.wins += int(place == 0)
        self.points += points
        self.placements += place + 1

    def stderr(self) -> float:
        """Standard error of the mean score.

        Reported because a placement score without one invites reading noise as a result: at a
        hundred-odd matches the error here is around 0.1, which is the same size as several of the
        differences this repo has taken seriously. Matches are independent draws, so this is the
        ordinary sample-mean error — the seats within one match are not independent, but no agent's
        row mixes them.
        """
        if self.scored < 2:
            return float("nan")
        mean = self.score / self.scored
        variance = max(0.0, self.square / self.scored - mean * mean)
        return math.sqrt(variance / (self.scored - 1))


def play_match(
    env: BlowCowEnv,
    agents: Sequence,
    num_players: int,
    seat_offset: int,
    seed: Optional[int] = None,
) -> Dict[str, object]:
    """One match with ``agents[i]`` seated at ``(i + seat_offset) % num_players``."""
    step = env.reset(seed=seed, num_players=num_players)
    assert env.engine is not None

    by_seat: Dict[str, object] = {}
    for index, agent in enumerate(agents):
        seat_index = (index + seat_offset) % num_players
        seat_id = next(
            player_id
            for player_id in env.engine.seat_order
            if env.engine.players[player_id].seat_index == seat_index
        )
        by_seat[seat_id] = agent

    while not step.done:
        agent = by_seat[step.agent]
        action = agent.act(Decision(env, step.agent, step.observation, step.action_mask))
        step = env.step(action)

    return {
        "by_seat": by_seat,
        "placements": step.info["placements"],
        "points": step.info["points"],
        "truncated": step.truncated,
        "moves": step.info["moves"],
        "rounds": step.info["rounds"],
    }


def run_series(
    agent_specs: Sequence[str],
    games: int,
    player_counts: Sequence[int],
    seed: int,
    max_moves: int,
    device: Optional[str],
    score_truncated: bool = True,
) -> Dict[str, Tally]:
    # A three-way slate cannot sit at a two-seat table, so those counts are dropped rather than
    # refused: sweeping 2..6 with three agents should still tell you about 3..6.
    usable = [count for count in player_counts if count >= len(agent_specs)]
    if not usable:
        raise ValueError(
            f"{len(agent_specs)} agents need a table of at least that size; "
            f"none of {list(player_counts)} qualifies."
        )
    player_counts = usable

    rng = random.Random(seed)
    env = BlowCowEnv(seed=seed, reward=RewardConfig(terminal=1.0, dense_points=0.0), max_moves=max_moves)
    tallies: Dict[str, Tally] = defaultdict(Tally)

    # One instance per distinct spec, shared across seats. Every agent here is stateless apart from
    # its RNG, and a checkpoint costs a model load, so building six of each would be waste.
    built = {
        spec: make_agent(spec, seed=rng.randrange(1, 2**31), device=device)
        for spec in dict.fromkeys(agent_specs)
    }

    for game_index in range(games):
        num_players = player_counts[game_index % len(player_counts)]

        # Spare seats cycle the slate, so a 5-seat table with two agents is 3 v 2.
        specs = [agent_specs[index % len(agent_specs)] for index in range(num_players)]
        line_up = [built[spec] for spec in specs]

        result = play_match(env, line_up, num_players, game_index % num_players)
        placements: List[str] = result["placements"]  # type: ignore[assignment]
        points: Dict[str, int] = result["points"]  # type: ignore[assignment]
        # `by_seat` is built in line-up order, so its keys line up with `specs` positionally.
        seat_to_spec = dict(zip(result["by_seat"].keys(), specs))  # type: ignore[union-attr]

        truncated = bool(result["truncated"])
        for place, seat_id in enumerate(placements):
            spec = seat_to_spec[seat_id]
            score = 1.0 - 2.0 * place / (num_players - 1)
            tallies[spec].add(
                score, place, points[seat_id], truncated, score_truncated or not truncated
            )

    return tallies


def report(title: str, tallies: Dict[str, Tally]) -> None:
    print(f"\n{title}")
    print(
        f"  {'agent':<28} {'score':>7} {'+-':>6} {'win%':>7} {'avg place':>10} "
        f"{'avg pts':>8} {'trunc':>7} {'n':>5}"
    )
    ordered = sorted(tallies.items(), key=lambda item: -(item[1].score / max(1, item[1].scored)))
    for spec, tally in ordered:
        scored = max(1, tally.scored)
        print(
            f"  {spec:<28} {tally.score / scored:>7.3f} "
            f"{tally.stderr():>6.3f} "
            f"{100 * tally.wins / scored:>6.1f}% {tally.placements / scored:>10.2f} "
            f"{tally.points / scored:>8.2f} "
            f"{100 * tally.truncated / max(1, tally.matches):>6.1f}% "
            f"{tally.scored:>5d}"
        )


def parse_counts(value: str) -> List[int]:
    counts = [int(part) for part in value.split(",") if part.strip()]
    for count in counts:
        if not 2 <= count <= MAX_SEATS:
            raise argparse.ArgumentTypeError(f"Player counts must be 2..{MAX_SEATS}.")
    return counts


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--agents",
        nargs="+",
        default=["heuristic", "random"],
        help="agents to seat together: random | honest | liar | caller | heuristic | ckpt:<path>",
    )
    parser.add_argument(
        "--round-robin",
        nargs="+",
        default=None,
        help="run every head-to-head pair from this slate instead of one mixed table",
    )
    parser.add_argument("--games", type=int, default=200)
    parser.add_argument("--players", type=parse_counts, default=[2, 3, 4, 5, 6])
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--max-moves", type=int, default=3000)
    parser.add_argument("--device", default=None)
    parser.add_argument(
        "--skip-truncated",
        action="store_true",
        help=(
            "leave matches that hit the move limit out of the score entirely. Off by default:"
            " several baselines cycle forever against each other, so skipping would discard most of"
            " the sample. Scored ones are ranked on the standings at the limit."
        ),
    )
    args = parser.parse_args(argv)
    score_truncated = not args.skip_truncated

    if args.round_robin:
        overall: Dict[str, Tally] = defaultdict(Tally)
        for left, right in itertools.combinations(args.round_robin, 2):
            tallies = run_series(
                [left, right], args.games, args.players, args.seed, args.max_moves,
                args.device, score_truncated,
            )
            report(f"{left} vs {right}", tallies)
            for spec, tally in tallies.items():
                target = overall[spec]
                target.matches += tally.matches
                target.scored += tally.scored
                target.score += tally.score
                target.square += tally.square
                target.wins += tally.wins
                target.points += tally.points
                target.placements += tally.placements
                target.truncated += tally.truncated
        report("overall", overall)
        return 0

    tallies = run_series(
        args.agents, args.games, args.players, args.seed, args.max_moves, args.device,
        score_truncated,
    )
    report(" vs ".join(args.agents), tallies)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

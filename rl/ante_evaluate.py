"""Scoring agents against each other, with a standard error beside every number.

Two protocols, and the choice between them is not cosmetic.

``one-vs-rest`` seats one challenger against a table of the same opponent, rotating the challenger's
chair. That is the right shape for "is A better than B" and for exploitability, and it is what a
two-agent `--agents` list gets.

``table`` seats one named agent per chair and rotates the whole assignment. That is the right shape
for ranking a *population*, and the classic work found rankings that reverse between the two — an
agent can be first in a five-way field and third head to head. Both numbers are real; they answer
different questions.

Two rules this file exists to make easy to follow, both learned the hard way in `rl/README.md`:

* **Rank checkpoints head to head, never through a fixed scripted opponent.** `heuristic` there
  challenged 76-84% of the time, so a policy getting *better* at bluffing scored worse against it
  every step — the ordering came out exactly inverted.
* **Quote the standard error.** Several gaps that were taken seriously in the classic work are the
  same size as the noise at the sample they were measured on.

Usage::

    python rl/ante_evaluate.py --agents ckpt:rl/runs/ante-v1/final.pt heuristic --games 600
    python rl/ante_evaluate.py --round-robin random honest liar caller heuristic --games 400
"""

from __future__ import annotations

import argparse
import itertools
import math
import sys
from pathlib import Path
from typing import Dict, List, Sequence, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ante.agents import make_agent  # noqa: E402
from ante.config import AnteConfig  # noqa: E402
from ante.env import AnteEnv  # noqa: E402
from ante.game import ENDING_ALL_PASS, ENDING_BS, ENDING_EMPTY_HAND  # noqa: E402
from ante.spaces import CALL_BS_INDEX, PASS_INDEX  # noqa: E402


class Tally:
    """Per-agent scores, plus the behavioural counters the diagnosis is read off."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.scores: List[float] = []
        self.wins = 0
        self.losses = 0
        self.calls = 0
        self.call_opportunities = 0
        self.call_hits = 0
        self.lies_available = 0
        self.plays = 0
        self.discretionary_chances = 0
        self.discretionary_bluffs = 0

    @property
    def score(self) -> float:
        return sum(self.scores) / max(1, len(self.scores))

    @property
    def stderr(self) -> float:
        count = len(self.scores)
        if count < 2:
            return 0.0
        mean = self.score
        variance = sum((value - mean) ** 2 for value in self.scores) / (count - 1)
        return math.sqrt(variance / count)

    @property
    def call_rate(self) -> float:
        return 100.0 * self.calls / max(1, self.call_opportunities)

    @property
    def discrimination(self) -> float:
        """Hit rate minus the base rate of lies among the opportunities seen. The skill."""
        if self.calls == 0:
            return 0.0
        return 100.0 * self.call_hits / self.calls - 100.0 * self.lies_available / max(1, self.call_opportunities)

    @property
    def bluff_rate(self) -> float:
        return 100.0 * self.discretionary_bluffs / max(1, self.discretionary_chances)


def play(
    env: AnteEnv,
    agents: Sequence,
    tallies: Sequence[Tally],
    config: AnteConfig,
) -> str:
    """One round. ``agents[i]`` and ``tallies[i]`` are the actor and the book for seat ``i``."""
    decision = env.reset()
    while not decision.terminated:
        seat = decision.seat
        game = decision.game
        assert game is not None
        tally = tallies[seat]

        target = game.bs_target()
        claim_is_a_lie = False
        if target is not None:
            claim_is_a_lie = not game.claim_was_honest(target)
            tally.call_opportunities += 1
            tally.lies_available += int(claim_is_a_lie)

        action = int(agents[seat].act(decision))

        if action == CALL_BS_INDEX:
            tally.calls += 1
            tally.call_hits += int(claim_is_a_lie)
        elif action != PASS_INDEX:
            tally.plays += 1
            semantic = env.space.decompose(action)
            trump = semantic[1] if semantic[1] is not None else game.trump
            joker = config.joker_type
            honest = all(card_type in (joker, trump) for card_type in semantic[2])
            holds_trump = game.hands[seat][joker] > 0 or (
                trump is not None and trump != config.off_deck_trump and game.hands[seat][trump] > 0
            )
            # Only a lie told with a trump in hand is a choice; without one it is arithmetic.
            if holds_trump and game.trump is not None:
                tally.discretionary_chances += 1
                tally.discretionary_bluffs += int(not honest)

        decision = env.step(action)

    for seat, tally in enumerate(tallies):
        reward = float(decision.rewards[seat])
        tally.scores.append(reward)
        tally.wins += int(reward > 0)
        tally.losses += int(reward < 0)
    return str(decision.info["ending"])


def run(
    specs: Sequence[str],
    games: int,
    config: AnteConfig,
    seed: int,
    protocol: str,
) -> Tuple[Dict[str, Tally], Dict[str, int]]:
    env = AnteEnv(config, seed=seed)
    tallies = {spec: Tally(spec) for spec in specs}
    # One agent object per seat per spec: the scripted bots carry their own RNG, and sharing one
    # across chairs would correlate their choices.
    instances = {
        spec: [make_agent(spec, config, seed=seed + 977 * index) for index in range(config.num_players)]
        for spec in specs
    }
    endings: Dict[str, int] = {ENDING_BS: 0, ENDING_ALL_PASS: 0, ENDING_EMPTY_HAND: 0}

    for game_index in range(games):
        if protocol == "one-vs-rest":
            challenger = game_index % config.num_players
            seat_specs = [specs[0] if seat == challenger else specs[1] for seat in range(config.num_players)]
        else:
            offset = game_index % config.num_players
            seat_specs = [specs[(seat + offset) % len(specs)] for seat in range(config.num_players)]

        seat_agents = [instances[spec][seat] for seat, spec in enumerate(seat_specs)]
        seat_tallies = [tallies[spec] for spec in seat_specs]
        endings[play(env, seat_agents, seat_tallies, config)] += 1

    return tallies, endings


def report(tallies: Dict[str, Tally], endings: Dict[str, int], games: int) -> None:
    width = max(len(name) for name in tallies)
    print(f"  {'agent':{width}s}  {'score':>16s}  {'win%':>6s}  {'loss%':>6s}  {'call%':>6s}  {'disc':>6s}  {'bluff%':>7s}")
    for tally in sorted(tallies.values(), key=lambda item: -item.score):
        seats = max(1, len(tally.scores))
        print(
            f"  {tally.name:{width}s}  {tally.score:+7.3f} +- {tally.stderr:5.3f}  "
            f"{100.0 * tally.wins / seats:5.1f}  {100.0 * tally.losses / seats:5.1f}  "
            f"{tally.call_rate:5.1f}  {tally.discrimination:+5.1f}  {tally.bluff_rate:6.1f}"
        )
    total = max(1, sum(endings.values()))
    share = ", ".join(f"{name}={100.0 * count / total:.0f}%" for name, count in sorted(endings.items()))
    print(f"  endings over {games} rounds: {share}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--agents", nargs="*", default=None, help="Two for one-vs-rest, or one per seat")
    parser.add_argument("--round-robin", nargs="*", default=None, help="Every pair, one-vs-rest")
    parser.add_argument("--games", type=int, default=400)
    parser.add_argument("--players", type=int, default=5)
    parser.add_argument("--seed", type=int, default=17)
    args = parser.parse_args()

    config = AnteConfig.for_players(args.players)

    if args.round_robin:
        print(f"Round robin, one-vs-rest, {args.games} rounds per pair, {config.num_players} seats\n")
        overall: Dict[str, List[float]] = {spec: [] for spec in args.round_robin}
        for left, right in itertools.combinations(args.round_robin, 2):
            tallies, endings = run([left, right], args.games, config, args.seed, "one-vs-rest")
            print(f"{left} (1 seat) vs {right} (4 seats)")
            report(tallies, endings, args.games)
            overall[left].append(tallies[left].score)
            tallies, endings = run([right, left], args.games, config, args.seed + 1, "one-vs-rest")
            print(f"{right} (1 seat) vs {left} (4 seats)")
            report(tallies, endings, args.games)
            overall[right].append(tallies[right].score)
            print()
        print("challenger-seat average, best first:")
        for spec, scores in sorted(overall.items(), key=lambda item: -sum(item[1]) / max(1, len(item[1]))):
            print(f"  {spec:28s} {sum(scores) / max(1, len(scores)):+.3f}")
        return 0

    specs = args.agents or ["heuristic", "random"]
    protocol = "one-vs-rest" if len(specs) == 2 else "table"
    print(
        f"{protocol}: {' '.join(specs)}, {args.games} rounds, {config.num_players} seats, "
        f"{config.num_ranks} ranks\n"
    )
    tallies, endings = run(specs, args.games, config, args.seed, protocol)
    report(tallies, endings, args.games)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Score Ante **match** agents against each other.

`rl/ante_evaluate.py` is the one-round scorer and is left alone. Two protocols here, the same two:

``one-vs-rest``  one challenger seat against four of a field, seats rotated. The challenger's chair
                 is rotated because the seats are not symmetric — seat 0 opens the round and the last
                 seat in turn order takes a free round if everyone passes — so an unrotated score
                 measures the chair as much as the policy.
``table``        one named agent per seat, for reading a mixed population.

**`round:<path>` is the control that matters.** It seats a one-round checkpoint in a match by handing
it the round block and withholding the rest, which is exactly the agent that exists today playing
every round as if it were the only one. A multi-round agent that cannot beat that has bought nothing.

**Reading the score.** Gold is not zero-sum: two of the three endings mint a gold from the bank and
only `Call BS` removes one, so a table sums to `rounds x (1 - P(Call BS))` rather than to zero. With
one policy in every chair, symmetry therefore fixes the per-seat mean at exactly
`rounds x (1 - P(bs)) / 5`, which is printed as `self-play reference` — the line a challenger has to
clear, and never 0.

Usage::

    python rl/ante_match_evaluate.py --challenger ckpt:rl/runs/m-ante-v1/final.pt \\
        --field round:rl/runs/ante-s2-long/final.pt --games 400
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path
from typing import Dict, List, Optional, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np  # noqa: E402

from ante.config import AnteConfig  # noqa: E402
from ante.match import MatchConfig  # noqa: E402
from ante.match_agents import make_match_agent  # noqa: E402
from ante.match_env import AnteMatchEnv  # noqa: E402
from ante.spaces import CALL_BS_INDEX, PASS_INDEX  # noqa: E402


class Tally:
    """Everything measured about one seat's play, so a score always comes with its behaviour."""

    def __init__(self) -> None:
        self.gold: List[float] = []
        self.placement: List[float] = []
        self.wins = 0
        self.eliminated = 0
        self.calls = 0
        self.chances = 0
        self.hits = 0
        self.would_hit = 0
        self.calls_suspect = 0
        self.chances_suspect = 0
        self.calls_trusted = 0
        self.chances_trusted = 0
        self.bluffs = 0
        self.bluff_chances = 0
        self.endings: Counter = Counter()
        self.rounds = 0

    def watch(self, decision, action: int, space, record_min: int) -> None:
        match = decision.match
        game = decision.game
        seat = decision.seat
        target = game.bs_target()

        if target is not None:
            self.chances += 1
            was_a_lie = not game.claim_was_honest(target)
            self.would_hit += int(was_a_lie)
            called = action == CALL_BS_INDEX
            self.calls += int(called)
            self.hits += int(called and was_a_lie)

            records = match.live_records()
            seen = sum(r.observations for r in records)
            lies = sum(r.lies for r in records)
            table_rate = 0.5 if seen == 0 else lies / seen
            record = records[match.seats[target]]
            if record.observations >= record_min:
                if record.lie_rate > table_rate:
                    self.chances_suspect += 1
                    self.calls_suspect += int(called)
                else:
                    self.chances_trusted += 1
                    self.calls_trusted += int(called)

        if action not in (PASS_INDEX, CALL_BS_INDEX) and game.trump is not None:
            semantic = space.decompose(action)
            trump = semantic[1] if semantic[1] is not None else game.trump
            joker = game.config.joker_type
            honest = all(card_type in (joker, trump) for card_type in semantic[2])
            round_seat = match.round_seat[seat]
            holds = game.hands[round_seat][joker] > 0 or (
                trump < game.active_ranks and game.hands[round_seat][trump] > 0
            )
            # A player with no trump has to lie or pass; that is arithmetic, not bluffing.
            if holds:
                self.bluff_chances += 1
                self.bluffs += int(not honest)

    def report(self, label: str) -> str:
        gold = np.asarray(self.gold)
        stderr = float(gold.std() / max(1.0, np.sqrt(len(gold)))) if len(gold) else 0.0
        call_rate = 100.0 * self.calls / max(1, self.chances)
        hit = 100.0 * self.hits / max(1, self.calls)
        base = 100.0 * self.would_hit / max(1, self.chances)
        split = 100.0 * self.calls_suspect / max(1, self.chances_suspect) - 100.0 * self.calls_trusted / max(
            1, self.chances_trusted
        )
        return (
            f"  {label:<38} gold {gold.mean():+7.3f} +/- {stderr:.3f}   "
            f"win {100.0 * self.wins / max(1, len(self.gold)):5.1f}%  "
            f"place {np.mean(self.placement) if self.placement else 0.0:4.2f}  "
            f"out {100.0 * self.eliminated / max(1, len(self.gold)):4.1f}%  "
            f"call {call_rate:5.1f}%  disc {hit - base:+6.2f}  "
            f"split {split:+6.2f}  bluff {100.0 * self.bluffs / max(1, self.bluff_chances):5.1f}%"
        )


def run(
    config: MatchConfig,
    seats: Sequence[str],
    games: int,
    seed: int,
    rotate: bool,
    record_min: int,
) -> Dict[str, Tally]:
    env = AnteMatchEnv(config, seed=seed)
    num = config.num_players
    agents = [make_match_agent(spec, config, seed=seed + index) for index, spec in enumerate(seats)]
    tallies: Dict[str, Tally] = {}
    endings: Counter = Counter()
    rounds = 0

    for index in range(games):
        shift = (index % num) if rotate else 0
        # Seat `s` is played by `agents[(s + shift) % num]`, so every agent visits every chair.
        assignment = [(seat + shift) % num for seat in range(num)]
        decision = env.reset()
        while not decision.terminated:
            who = assignment[decision.seat]
            action = int(agents[who].act(decision))
            tallies.setdefault(seats[who], Tally()).watch(decision, action, env.space, record_min)
            decision = env.step(action)

        info = decision.info
        endings.update(info["endings"])
        rounds += int(info["rounds"])
        for seat in range(num):
            tally = tallies.setdefault(seats[assignment[seat]], Tally())
            tally.gold.append(float(info["gold"][seat] - config.starting_gold))
            tally.placement.append(float(info["placements"][seat]))
            tally.wins += int(info["placements"][seat] == 0)
            tally.eliminated += int(seat in info["eliminated"])

    total = sum(endings.values())
    share = ", ".join(f"{name} {100.0 * count / max(1, total):.1f}%" for name, count in sorted(endings.items()))
    print(f"  {rounds} rounds over {games} matches; endings {share}")
    # Measured rounds rather than `round_limit`, since a match that eliminates down to one seat ends
    # early and would otherwise inflate the line a challenger is asked to clear.
    reference = (rounds / max(1, games)) * (1.0 - endings.get("bs", 0) / max(1, total)) / num
    print(f"  self-play reference (one policy in every chair): {reference:+.3f} gold")
    return tallies


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--challenger", default=None, help="one-vs-rest: the seat being measured")
    parser.add_argument("--field", default=None, help="one-vs-rest: what fills the other four seats")
    parser.add_argument("--table", nargs="*", default=None, help="table: one agent per seat")
    parser.add_argument("--games", type=int, default=300)
    parser.add_argument("--players", type=int, default=5)
    parser.add_argument("--rounds", type=int, default=20)
    parser.add_argument("--gold", type=int, default=5)
    parser.add_argument("--disclosure", choices=("round", "full"), default="round")
    parser.add_argument("--record-min", type=int, default=3)
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()

    shape = AnteConfig.for_players(args.players)
    config = MatchConfig(
        shape=shape, round_limit=args.rounds, starting_gold=args.gold, disclosure=args.disclosure
    )

    if args.table:
        if len(args.table) != args.players:
            raise SystemExit(f"--table needs {args.players} agents, got {len(args.table)}")
        print(f"table: {' | '.join(args.table)}  ({args.games} matches, seats rotated)")
        tallies = run(config, args.table, args.games, args.seed, rotate=True, record_min=args.record_min)
    else:
        if not (args.challenger and args.field):
            raise SystemExit("Give --challenger and --field, or --table")
        seats = [args.challenger] + [args.field] * (args.players - 1)
        print(f"one-vs-rest: {args.challenger} against {args.players - 1}x {args.field}")
        print(f"  ({args.games} matches, {args.rounds} rounds, challenger seat rotated)")
        tallies = run(config, seats, args.games, args.seed, rotate=True, record_min=args.record_min)

    print()
    for label in sorted(tallies, key=lambda name: -float(np.mean(tallies[name].gold))):
        print(tallies[label].report(label))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

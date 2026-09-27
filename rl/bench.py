"""How fast the simulator plays itself, in the units reinforcement learning cares about.

Two numbers matter and they differ by an order of magnitude, so both are reported:

* **decisions/s** — points where a policy would be asked for an action. This is what an RL step
  budget is actually spent on.
* **moves/s** — every primitive the engine applies, forced procedure steps included. Roughly 3-4x the
  decisions, and the number to compare against the TypeScript engine.

    python rl/bench.py
    python rl/bench.py --players 4 --games 200
"""

from __future__ import annotations

import argparse
import os
import random
import sys
import time
from collections import Counter
from typing import Optional, Sequence

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from blowcow.cards import RANKS, get_default_standard_rank_count  # noqa: E402
from blowcow.engine import BlowCowEngine  # noqa: E402


def play_random_match(num_players: int, selected_ranks: Sequence[str], seed: int, rng: random.Random,
                      max_steps: int = 20000) -> Counter:
    engine = BlowCowEngine(num_players, selected_ranks, seed=seed)
    stats: Counter = Counter()

    for _ in range(max_steps):
        if engine.gameover is not None:
            break

        forced = engine.forced_move()
        if forced is not None:
            player_id, move_name, args = forced
            stats["forced"] += 1
        else:
            player_id = engine.decision_player()
            if player_id is None:
                raise RuntimeError("Stalled: no forced move and no decision.")
            actions = engine.legal_actions()
            if not actions:
                raise RuntimeError("Stalled: decision point with no legal action.")
            move_name, args = rng.choice(actions).to_move()
            stats["decisions"] += 1

        if engine.apply_move(player_id, move_name, args):
            raise RuntimeError(f"Refused: {player_id} {move_name} {args}")
        stats["moves"] += 1

    if engine.gameover is None:
        raise RuntimeError("Match did not finish within the step limit.")

    stats["games"] = 1
    stats["rounds"] = engine.round.round_number
    return stats


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--games", type=int, default=100)
    parser.add_argument("--players", type=int, default=None, help="fixed player count (default: sweep 2-8)")
    parser.add_argument("--seed", type=int, default=1)
    args = parser.parse_args(argv)

    counts = [args.players] if args.players else [2, 3, 4, 5, 6, 8]
    rng = random.Random(args.seed)
    totals: Counter = Counter()

    started = time.perf_counter()
    for game_index in range(args.games):
        num_players = counts[game_index % len(counts)]
        selected_ranks = list(RANKS[: get_default_standard_rank_count(num_players)])
        totals.update(
            play_random_match(num_players, selected_ranks, args.seed * 7919 + game_index, rng)
        )
    elapsed = time.perf_counter() - started

    print(f"{totals['games']} matches in {elapsed:.2f}s")
    print(f"  rounds/match     {totals['rounds'] / totals['games']:.1f}")
    print(f"  decisions/match  {totals['decisions'] / totals['games']:.1f}")
    print(f"  moves/match      {totals['moves'] / totals['games']:.1f}")
    print(f"  decisions/s      {totals['decisions'] / elapsed:,.0f}")
    print(f"  moves/s          {totals['moves'] / elapsed:,.0f}")
    print(f"  matches/s        {totals['games'] / elapsed:,.1f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

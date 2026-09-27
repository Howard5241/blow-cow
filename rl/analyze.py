"""What an agent actually *does*, rather than how often it wins.

A placement score says an agent is exploitable; it never says what the hole is. This plays matches
with full ground truth and counts the decisions a bluffing game turns on, per agent, normalised by
the chances each agent had to make them.

The number worth reading first is **discretionary bluff rate**. An agent holding no trump card has to
lie or pass — that is not bluffing, it is arithmetic. An agent holding a trump and choosing to lie
anyway has made the only genuinely strategic decision in the game. Lumping the two together is how a
policy that never bluffs on purpose can look like it bluffs half the time.

    python rl/analyze.py --agents ckpt:runs/ppo-v1/final.pt heuristic --games 200
    python rl/analyze.py --agents ckpt:runs/rnad-v1/final.pt ckpt:runs/x-rnad-v1/final.pt --games 200
"""

from __future__ import annotations

import argparse
import os
import random
import sys
from collections import defaultdict
from typing import Dict, List, Optional, Sequence

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import numpy as np
except ModuleNotFoundError as missing:  # pragma: no cover - environment guidance
    raise SystemExit(
        f"Analysis needs {missing.name}. Activate the project virtualenv and retry."
    ) from missing

from blowcow.agents import Decision, make_agent  # noqa: E402
from blowcow.env import BlowCowEnv, RewardConfig  # noqa: E402
from blowcow.observation import MAX_SEATS  # noqa: E402


class Behaviour:
    """Counters, all of them paired with the opportunities that made them possible."""

    __slots__ = (
        "decisions", "plays", "cards_played", "two_card_plays",
        "lies", "discretionary_chances", "discretionary_lies",
        "pass_chances", "passes", "bs_chances", "bs_calls", "bs_correct",
        "bs_good_chances", "bs_calls_good", "bs_reverse_armed",
        "reset_chances", "reset_calls", "trump_selections", "trump_off_deck",
        "score", "matches",
    )

    def __init__(self) -> None:
        for slot in self.__slots__:
            setattr(self, slot, 0)
        self.score = 0.0

    def row(self) -> Dict[str, float]:
        def ratio(top: int, bottom: int) -> float:
            return top / bottom if bottom else float("nan")

        return {
            "score": ratio(self.score, self.matches),
            "bluff%": 100 * ratio(self.lies, self.plays),
            "disc.bluff%": 100 * ratio(self.discretionary_lies, self.discretionary_chances),
            "call%": 100 * ratio(self.bs_calls, self.bs_chances),
            # `hit%` is whether the call actually punished the target, Reverse Rule included.
            # `lie%` is whether the target was merely lying — the two come apart exactly when the
            # rule is armed, and an agent that tracks the first is playing a different game from one
            # that tracks the second.
            "call.hit%": 100 * ratio(self.bs_calls_good, self.bs_calls),
            "call.lie%": 100 * ratio(self.bs_correct, self.bs_calls),
            "was.good%": 100 * ratio(self.bs_good_chances, self.bs_chances),
            "missed%": 100 * ratio(
                self.bs_good_chances - self.bs_calls_good, self.bs_good_chances
            ),
            "revarm%": 100 * ratio(self.bs_reverse_armed, self.bs_chances),
            "pass%": 100 * ratio(self.passes, self.pass_chances),
            "reset%": 100 * ratio(self.reset_calls, self.reset_chances),
            "cards/play": ratio(self.cards_played, self.plays),
            "offdeck%": 100 * ratio(self.trump_off_deck, self.trump_selections),
            # Rates alone hide whether a 99% uptake is on a hundred chances a match or on one.
            "bs.opp/m": ratio(self.bs_chances, self.matches),
            "rst.opp/m": ratio(self.reset_chances, self.matches),
            "dec/m": ratio(self.decisions, self.matches),
        }


def analyse(
    agent_specs: Sequence[str],
    games: int,
    player_counts: Sequence[int],
    seed: int,
    max_moves: int,
    device: Optional[str],
) -> Dict[str, Behaviour]:
    usable = [count for count in player_counts if count >= len(agent_specs)]
    if not usable:
        raise ValueError(f"{len(agent_specs)} agents need a table of at least that size.")

    rng = random.Random(seed)
    env = BlowCowEnv(
        seed=seed, reward=RewardConfig(terminal=1.0, dense_points=0.0), max_moves=max_moves
    )
    built = {
        spec: make_agent(spec, seed=rng.randrange(1, 2**31), device=device)
        for spec in dict.fromkeys(agent_specs)
    }
    stats: Dict[str, Behaviour] = defaultdict(Behaviour)

    for game_index in range(games):
        count = usable[game_index % len(usable)]
        specs = [agent_specs[index % len(agent_specs)] for index in range(count)]

        step = env.reset(num_players=count)
        engine = env.engine
        assert engine is not None

        seat_to_spec: Dict[str, str] = {}
        for index, spec in enumerate(specs):
            seat_index = (index + game_index % count) % count
            seat_id = next(
                player_id
                for player_id in engine.seat_order
                if engine.players[player_id].seat_index == seat_index
            )
            seat_to_spec[seat_id] = spec

        while not step.done:
            seat = step.agent
            spec = seat_to_spec[seat]
            record = stats[spec]
            record.decisions += 1

            parts = engine.legal_action_parts()
            would_punish_target = False
            if parts is not None:
                if parts.can_pass:
                    record.pass_chances += 1
                if parts.can_call_reset:
                    record.reset_chances += 1
                if parts.can_call_bs:
                    record.bs_chances += 1
                    # Ask the engine what a call would actually have done, rather than guessing from
                    # the target's honesty. `_create_bs_resolution` is a pure constructor, so this
                    # settles the Reverse Rule too.
                    target = engine._get_default_bs_target(seat)
                    play = engine._get_pending_play(target) if target else None
                    if play is not None and engine.round.trump_rank:
                        resolution = engine._create_bs_resolution(
                            seat, target, play, engine.round.trump_rank
                        )
                        would_punish_target = resolution.punished_player_id == target
                        record.bs_good_chances += int(would_punish_target)
                        record.bs_reverse_armed += int(resolution.reverse_rule_triggered)

            action = env._action_table[
                built[spec].act(Decision(env, seat, step.observation, step.action_mask))
            ]

            if action.kind in ("play", "trumpPlay"):
                claimed = action.trump_rank if action.kind == "trumpPlay" else engine.round.trump_rank
                record.plays += 1
                record.cards_played += len(action.cards)
                record.two_card_plays += int(len(action.cards) == 2)

                honest = claimed is not None and all(
                    engine._is_trump(card, claimed) for card in action.cards
                )
                record.lies += int(not honest)

                if action.kind == "trumpPlay":
                    record.trump_selections += 1
                    record.trump_off_deck += int(
                        claimed not in engine.deck.selected_ranks
                    )

                # Could this agent have told the truth instead? Only then is a lie a choice.
                if claimed is not None:
                    hand = engine.players[seat].hand
                    trumps = sum(1 for card in hand if engine._is_trump(card, claimed))
                    if trumps >= len(action.cards):
                        record.discretionary_chances += 1
                        record.discretionary_lies += int(not honest)

            elif action.kind == "pass":
                record.passes += 1
            elif action.kind == "callReset":
                record.reset_calls += 1
            elif action.kind == "callBS":
                record.bs_calls += 1
                record.bs_calls_good += int(would_punish_target)
                target = engine._get_default_bs_target(seat)
                play = engine._get_pending_play(target) if target else None
                if play is not None and engine.round.trump_rank:
                    record.bs_correct += int(
                        not all(
                            engine._is_trump(card, engine.round.trump_rank) for card in play.cards
                        )
                    )

            step = env.step(env.table.index_for(action))

        for place, seat_id in enumerate(step.info["placements"]):
            record = stats[seat_to_spec[seat_id]]
            record.matches += 1
            record.score += 1.0 - 2.0 * place / (count - 1)

    return stats


def report(stats: Dict[str, Behaviour]) -> None:
    columns = ["score", "bluff%", "disc.bluff%", "call%", "call.hit%", "call.lie%",
               "was.good%", "missed%", "revarm%", "pass%", "cards/play", "dec/m"]
    print(f"\n  {'agent':<30}" + "".join(f"{name:>11}" for name in columns))
    for spec, record in sorted(stats.items(), key=lambda item: -item[1].row()["score"]):
        row = record.row()
        print(f"  {spec:<30}" + "".join(f"{row[name]:>11.2f}" for name in columns))


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
    parser.add_argument("--agents", nargs="+", default=["heuristic", "random"])
    parser.add_argument("--games", type=int, default=200)
    parser.add_argument("--players", type=parse_counts, default=[4])
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--max-moves", type=int, default=3000)
    parser.add_argument("--device", default=None)
    args = parser.parse_args(argv)

    report(analyse(args.agents, args.games, args.players, args.seed, args.max_moves, args.device))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

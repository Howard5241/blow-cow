"""How good is the value head, really?

Three separate results all point at the critic rather than at the search:

* simulation count buys nothing — 64 simulations do not beat 16, head to head;
* a full one-ply sweep that leans on the value head *harder* is catastrophically worse
  (`lookahead` scores -0.647 against `heuristic` where the raw policy scores -0.304);
* search helps at two seats and does nothing at four.

Each is what you would expect if `V(s)` were accurate near the policy's own trajectories and wrong
elsewhere, since every one of those levers evaluates states the policy would not have reached. This
measures that directly instead of inferring it: play matches, record what the value head predicted at
every decision, and compare it against the placement the seat actually finished with.

    python rl/value_calibration.py --agents ckpt:runs/ppo-v1/final.pt --games 60

The number to look at is **skill**: the fraction of the outcome's variance the prediction explains,
against the trivial predictor that always answers zero. A critic that cannot beat "always zero" is
not carrying information a search can use, however many simulations are spent asking it.
"""

from __future__ import annotations

import argparse
import os
import random
import sys
from collections import defaultdict
from typing import Dict, List, Optional, Sequence, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import numpy as np
    import torch
except ModuleNotFoundError as missing:  # pragma: no cover - environment guidance
    raise SystemExit(
        f"This needs {missing.name}. Activate the project virtualenv and retry."
    ) from missing

from blowcow.agents import Decision, make_agent  # noqa: E402
from blowcow.env import BlowCowEnv, RewardConfig  # noqa: E402
from blowcow.nets import BlowCowNet  # noqa: E402
from blowcow.observation import MAX_SEATS  # noqa: E402


def load_network(path: str, device: torch.device) -> BlowCowNet:
    checkpoint = torch.load(path, map_location=device, weights_only=False)
    network = BlowCowNet(**checkpoint.get("net_kwargs", {}))
    network.load_state_dict(checkpoint["model"])
    return network.to(device).eval()


class Samples:
    """Predictions paired with the outcome the seat actually got."""

    __slots__ = ("predicted", "actual", "progress")

    def __init__(self) -> None:
        self.predicted: List[float] = []
        self.actual: List[float] = []
        #: How far into the match the prediction was made, 0..1. A critic is expected to be vague
        #: early and sharp late; without this a single number hides which half is broken.
        self.progress: List[float] = []

    def add(self, predicted: float, actual: float, progress: float) -> None:
        self.predicted.append(predicted)
        self.actual.append(actual)
        self.progress.append(progress)

    def stats(self) -> Dict[str, float]:
        predicted = np.array(self.predicted, dtype=np.float64)
        actual = np.array(self.actual, dtype=np.float64)
        if predicted.size < 2:
            return {}

        error = float(np.mean((predicted - actual) ** 2))
        # The trivial predictor is zero, not the mean: a table of equal agents averages zero by
        # construction, so zero is the honest "I know nothing" answer here.
        trivial = float(np.mean(actual**2))
        spread = float(np.std(actual))
        deviation = float(np.std(predicted))
        correlation = 0.0
        if deviation > 1e-9 and spread > 1e-9:
            correlation = float(np.corrcoef(predicted, actual)[0, 1])
        return {
            "mse": error,
            "zero_mse": trivial,
            "skill": 1.0 - error / trivial if trivial > 1e-12 else 0.0,
            "corr": correlation,
            "pred_sd": deviation,
            "true_sd": spread,
            "bias": float(np.mean(predicted - actual)),
            "n": float(predicted.size),
        }


def collect(
    agent_specs: Sequence[str],
    value_path: str,
    games: int,
    player_counts: Sequence[int],
    seed: int,
    max_moves: int,
    device: Optional[str],
) -> Tuple[Dict[int, Samples], Samples]:
    resolved = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
    network = load_network(value_path, resolved)

    rng = random.Random(seed)
    env = BlowCowEnv(
        seed=seed, reward=RewardConfig(terminal=1.0, dense_points=0.0), max_moves=max_moves
    )
    built = {
        spec: make_agent(spec, seed=rng.randrange(1, 2**31), device=device)
        for spec in dict.fromkeys(agent_specs)
    }

    by_seats: Dict[int, Samples] = defaultdict(Samples)
    overall = Samples()

    for game_index in range(games):
        num_players = player_counts[game_index % len(player_counts)]
        specs = [agent_specs[index % len(agent_specs)] for index in range(num_players)]

        step = env.reset(seed=None, num_players=num_players)
        assert env.engine is not None
        by_seat = {}
        for index, spec in enumerate(specs):
            seat_id = next(
                player_id
                for player_id in env.engine.seat_order
                if env.engine.players[player_id].seat_index == (index % num_players)
            )
            by_seat[seat_id] = built[spec]

        # (seat, predicted) in decision order, resolved against the standings at the end.
        pending: List[Tuple[str, float]] = []
        while not step.done:
            with torch.no_grad():
                row = torch.as_tensor(
                    step.observation[None, :], dtype=torch.float32, device=resolved
                )
                _logits, value = network(row)
            pending.append((step.agent, float(value[0])))

            agent = by_seat[step.agent]
            step = env.step(
                agent.act(Decision(env, step.agent, step.observation, step.action_mask))
            )

        placements: List[str] = step.info["placements"]
        outcome = {
            seat_id: 1.0 - 2.0 * place / (num_players - 1)
            for place, seat_id in enumerate(placements)
        }
        total = max(1, len(pending))
        for position, (seat_id, predicted) in enumerate(pending):
            actual = outcome.get(seat_id)
            if actual is None:
                continue
            progress = position / total
            by_seats[num_players].add(predicted, actual, progress)
            overall.add(predicted, actual, progress)

    return by_seats, overall


def report(by_seats: Dict[int, Samples], overall: Samples) -> None:
    columns = ["skill", "corr", "mse", "zero_mse", "pred_sd", "true_sd", "bias", "n"]
    print(f"\n  {'table':<10}" + "".join(f"{name:>10}" for name in columns))
    for seats in sorted(by_seats):
        stats = by_seats[seats].stats()
        if not stats:
            continue
        print(
            f"  {f'{seats} seats':<10}"
            + "".join(
                f"{stats[name]:>10.0f}" if name == "n" else f"{stats[name]:>10.3f}"
                for name in columns
            )
        )
    stats = overall.stats()
    if stats:
        print(
            f"  {'all':<10}"
            + "".join(
                f"{stats[name]:>10.0f}" if name == "n" else f"{stats[name]:>10.3f}"
                for name in columns
            )
        )

    # Split by how far into the match the prediction was made. A critic that is useless early and
    # good late is a different problem from one that is uniformly weak, and the fix differs.
    predicted = np.array(overall.predicted)
    actual = np.array(overall.actual)
    progress = np.array(overall.progress)
    print(f"\n  {'phase':<10}{'skill':>10}{'corr':>10}{'n':>10}")
    for name, low, high in (("first 3rd", 0.0, 1 / 3), ("mid 3rd", 1 / 3, 2 / 3), ("last 3rd", 2 / 3, 1.01)):
        window = (progress >= low) & (progress < high)
        if window.sum() < 2:
            continue
        error = float(np.mean((predicted[window] - actual[window]) ** 2))
        trivial = float(np.mean(actual[window] ** 2))
        skill = 1.0 - error / trivial if trivial > 1e-12 else 0.0
        deviation, spread = np.std(predicted[window]), np.std(actual[window])
        correlation = (
            float(np.corrcoef(predicted[window], actual[window])[0, 1])
            if deviation > 1e-9 and spread > 1e-9
            else 0.0
        )
        print(f"  {name:<10}{skill:>10.3f}{correlation:>10.3f}{int(window.sum()):>10d}")


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
    parser.add_argument("--agents", nargs="+", default=["ckpt:runs/ppo-v1/final.pt"])
    parser.add_argument(
        "--value",
        default=None,
        help="checkpoint whose value head is measured; defaults to the first ckpt: agent",
    )
    parser.add_argument("--games", type=int, default=60)
    parser.add_argument("--players", type=parse_counts, default=[2, 3, 4, 5, 6])
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--max-moves", type=int, default=3000)
    parser.add_argument("--device", default=None)
    args = parser.parse_args(argv)

    value_path = args.value
    if value_path is None:
        for spec in args.agents:
            if spec.startswith("ckpt:"):
                value_path = spec[len("ckpt:") :]
                break
            if spec.startswith(("ismcts:", "lookahead:")):
                from blowcow.ismcts import parse_spec

                value_path = parse_spec(spec)[0]
                break
    if value_path is None:
        raise SystemExit("No checkpoint to measure. Pass --value <path>.")

    by_seats, overall = collect(
        args.agents, value_path, args.games, args.players, args.seed, args.max_moves, args.device
    )
    print(f"\nvalue head: {value_path}   seated with: {' '.join(args.agents)}")
    report(by_seats, overall)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

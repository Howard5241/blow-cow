"""Can a belief model be learned, and does it survive meeting a new opponent?

The case for splitting inference off from decision-making is strong here: an auxiliary lie head
reaches 85% accuracy in 12k decisions where 2.5M decisions of placement reward bought almost nothing.
But "learnable" is not the same as "worth learning", and two questions decide the architecture:

**Does learning beat counting?** `heuristic` already estimates the same quantity in closed form from
unaccounted-trump counts (`probability_claim_is_a_lie`). If a network only matches it, the belief
module needs no training at all — compute it analytically and feed it in.

**Do the beliefs transfer?** A learned belief is calibrated to the behaviour it was trained on: it
knows how *this* opponent plays a trump. Counting is not — it assumes nothing about anyone. So the
learned model should win in-distribution, and the interesting number is what happens when the table
changes. A belief module that has to be retrained per opponent is a very different design from one
that does not.

    python rl/belief.py --train ckpt:runs/ppo-v1/final.pt --test heuristic liar --games 150
"""

from __future__ import annotations

import argparse
import os
import random
import sys
from typing import Dict, List, Optional, Sequence, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import numpy as np
    import torch
    from torch import nn
except ModuleNotFoundError as missing:  # pragma: no cover - environment guidance
    raise SystemExit(
        f"This needs {missing.name}. Activate the project virtualenv and retry."
    ) from missing

from blowcow.agents import Decision, make_agent, probability_claim_is_a_lie  # noqa: E402
from blowcow.env import BlowCowEnv, RewardConfig  # noqa: E402
from blowcow.observation import MAX_SEATS, OBSERVATION_SIZE  # noqa: E402


def collect(
    spec: str, games: int, players: int, seed: int, device: Optional[str], max_moves: int
) -> Dict[str, np.ndarray]:
    """Every decision that faced a live BS target, with the ground truth and the analytic estimate."""
    rng = random.Random(seed)
    env = BlowCowEnv(
        seed=seed, reward=RewardConfig(terminal=1.0, dense_points=0.0), max_moves=max_moves
    )
    agent = make_agent(spec, seed=rng.randrange(1, 2**31), device=device)

    observations: List[np.ndarray] = []
    labels: List[float] = []
    analytic: List[float] = []

    for _ in range(games):
        step = env.reset(num_players=players)
        engine = env.engine
        assert engine is not None

        while not step.done:
            seat = step.agent
            target = engine._get_default_bs_target(seat)
            trump = engine.round.trump_rank
            play = engine._get_pending_play(target) if target else None

            if play is not None and trump:
                observations.append(step.observation)
                labels.append(
                    0.0 if all(engine._is_trump(card, trump) for card in play.cards) else 1.0
                )
                analytic.append(
                    probability_claim_is_a_lie(engine, env.mapping, seat, target)
                )

            step = env.step(agent.act(Decision(env, seat, step.observation, step.action_mask)))

    return {
        "observation": np.stack(observations),
        "label": np.array(labels, dtype=np.float32),
        "analytic": np.array(analytic, dtype=np.float32),
    }


def auc(scores: np.ndarray, labels: np.ndarray) -> float:
    """Rank-based AUC. Ties share their averaged rank, which matters here: the analytic estimate
    returns exactly 0.0 or exactly 1.0 rather often, and scoring those as wins would flatter it."""
    positives, negatives = labels.sum(), (1 - labels).sum()
    if positives == 0 or negatives == 0:
        return float("nan")
    order = np.argsort(scores, kind="mergesort")
    ranks = np.empty(len(scores), dtype=np.float64)
    sorted_scores = scores[order]
    index = 0
    while index < len(scores):
        stop = index
        while stop + 1 < len(scores) and sorted_scores[stop + 1] == sorted_scores[index]:
            stop += 1
        ranks[order[index : stop + 1]] = 0.5 * (index + stop) + 1.0
        index = stop + 1
    return float((ranks[labels == 1].sum() - positives * (positives + 1) / 2) / (positives * negatives))


def score(name: str, probabilities: np.ndarray, labels: np.ndarray) -> Dict[str, float]:
    clipped = np.clip(probabilities, 1e-6, 1 - 1e-6)
    return {
        "name": name,
        "acc%": 100 * float(((probabilities > 0.5) == (labels > 0.5)).mean()),
        "auc": auc(probabilities, labels),
        "logloss": float(-(labels * np.log(clipped) + (1 - labels) * np.log(1 - clipped)).mean()),
        "base%": 100 * float(labels.mean()),
        "n": float(len(labels)),
    }


class Belief(nn.Module):
    def __init__(self, hidden: int = 256) -> None:
        super().__init__()
        self.body = nn.Sequential(
            nn.Linear(OBSERVATION_SIZE, hidden),
            nn.ReLU(),
            nn.Linear(hidden, hidden),
            nn.ReLU(),
            nn.Linear(hidden, 1),
        )

    def forward(self, observation: torch.Tensor) -> torch.Tensor:
        return self.body(observation).squeeze(-1)


def train(data: Dict[str, np.ndarray], device: torch.device, epochs: int, seed: int):
    torch.manual_seed(seed)
    count = len(data["label"])
    order = np.random.RandomState(seed).permutation(count)
    split = int(0.8 * count)
    train_index, test_index = order[:split], order[split:]

    observations = torch.as_tensor(data["observation"], dtype=torch.float32, device=device)
    labels = torch.as_tensor(data["label"], dtype=torch.float32, device=device)

    model = Belief().to(device)
    optimiser = torch.optim.Adam(model.parameters(), lr=1e-3)
    for _ in range(epochs):
        np.random.shuffle(train_index)
        for start in range(0, len(train_index), 512):
            chunk = torch.as_tensor(train_index[start : start + 512], device=device)
            loss = nn.functional.binary_cross_entropy_with_logits(
                model(observations[chunk]), labels[chunk]
            )
            optimiser.zero_grad(set_to_none=True)
            loss.backward()
            optimiser.step()
    return model, test_index


def predict(model: Belief, observations: np.ndarray, device: torch.device) -> np.ndarray:
    with torch.no_grad():
        tensor = torch.as_tensor(observations, dtype=torch.float32, device=device)
        return torch.sigmoid(model(tensor)).cpu().numpy()


def report(rows: Sequence[Dict[str, float]]) -> None:
    columns = ["acc%", "auc", "logloss", "base%", "n"]
    print(f"\n  {'source / model':<44}" + "".join(f"{name:>10}" for name in columns))
    for row in rows:
        print(
            f"  {row['name']:<44}"
            + "".join(
                f"{row[name]:>10.3f}" if name != "n" else f"{row[name]:>10.0f}" for name in columns
            )
        )


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--train", required=True, help="agent whose self-play trains the belief model")
    parser.add_argument("--test", nargs="*", default=[], help="other agents to transfer onto")
    parser.add_argument("--games", type=int, default=150)
    parser.add_argument("--players", type=int, default=4)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--max-moves", type=int, default=3000)
    parser.add_argument("--device", default=None)
    args = parser.parse_args(argv)

    if not 2 <= args.players <= MAX_SEATS:
        raise SystemExit(f"Player count must be 2..{MAX_SEATS}.")

    device = torch.device(args.device or ("cuda" if torch.cuda.is_available() else "cpu"))

    source = collect(args.train, args.games, args.players, args.seed, args.device, args.max_moves)
    model, held_out = train(source, device, args.epochs, args.seed)

    rows = [
        score(
            f"{args.train}  [learned, in-distribution]",
            predict(model, source["observation"][held_out], device),
            source["label"][held_out],
        ),
        score(
            f"{args.train}  [analytic counting]",
            source["analytic"][held_out],
            source["label"][held_out],
        ),
    ]

    for spec in args.test:
        other = collect(
            spec, args.games, args.players, args.seed + 5, args.device, args.max_moves
        )
        rows.append(
            score(
                f"{spec}  [learned, transferred]",
                predict(model, other["observation"], device),
                other["label"],
            )
        )
        rows.append(score(f"{spec}  [analytic counting]", other["analytic"], other["label"]))

    report(rows)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

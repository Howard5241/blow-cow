"""How predictable is an agent? Behavioural cloning accuracy, as a proxy for exploitability.

Stage D produced a pair of numbers that do not line up: `heuristic` has by far the best call
discrimination of any agent here and is also the *most* exploitable thing measured. So "plays well"
and "cannot be beaten by a specialist" are not the same axis, and this measures the second one
directly — an exploiter's whole job is to predict you, so train a network to do only that and see how
far it gets.

The score to read is **lift**: cloning accuracy minus what you would get by guessing uniformly among
the legal actions. An agent whose next move can be read off the public state hands a best-responder
everything it needs, however good those moves are.

    python rl/predictability.py --agents heuristic ckpt:runs/ppo-v1/final.pt --games 150
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

from blowcow.agents import Decision, make_agent  # noqa: E402
from blowcow.env import BlowCowEnv, RewardConfig  # noqa: E402
from blowcow.nets import MASKED_LOGIT  # noqa: E402
from blowcow.observation import MAX_SEATS, OBSERVATION_SIZE  # noqa: E402
from blowcow.spaces import NUM_ACTIONS  # noqa: E402


def collect(
    spec: str, games: int, players: int, seed: int, device: Optional[str], max_moves: int
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Every decision one agent makes at a table of copies of itself — the exploiter's own setting."""
    rng = random.Random(seed)
    env = BlowCowEnv(
        seed=seed, reward=RewardConfig(terminal=1.0, dense_points=0.0), max_moves=max_moves
    )
    agent = make_agent(spec, seed=rng.randrange(1, 2**31), device=device)

    observations: List[np.ndarray] = []
    masks: List[np.ndarray] = []
    actions: List[int] = []

    for _ in range(games):
        step = env.reset(num_players=players)
        while not step.done:
            action = agent.act(Decision(env, step.agent, step.observation, step.action_mask))
            observations.append(step.observation)
            masks.append(step.action_mask)
            actions.append(int(action))
            step = env.step(action)

    return np.stack(observations), np.stack(masks), np.array(actions, dtype=np.int64)


class Cloner(nn.Module):
    """Deliberately plain. The question is how much signal is there, not how cleverly it can be dug
    out — a fancier model would measure the model."""

    def __init__(self, hidden: int = 512) -> None:
        super().__init__()
        self.body = nn.Sequential(
            nn.Linear(OBSERVATION_SIZE, hidden),
            nn.ReLU(),
            nn.Linear(hidden, hidden),
            nn.ReLU(),
            nn.Linear(hidden, NUM_ACTIONS),
        )

    def forward(self, observation: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
        logits = self.body(observation)
        return torch.where(mask, logits, torch.full_like(logits, MASKED_LOGIT))


def clone_accuracy(
    observations: np.ndarray,
    masks: np.ndarray,
    actions: np.ndarray,
    device: torch.device,
    epochs: int,
    seed: int,
) -> Dict[str, float]:
    torch.manual_seed(seed)
    count = len(actions)
    split = int(0.8 * count)
    order = np.random.RandomState(seed).permutation(count)
    train, test = order[:split], order[split:]

    tensors = {
        "observation": torch.as_tensor(observations, dtype=torch.float32, device=device),
        "mask": torch.as_tensor(masks, device=device),
        "action": torch.as_tensor(actions, device=device),
    }

    model = Cloner().to(device)
    optimiser = torch.optim.Adam(model.parameters(), lr=1e-3)

    for _ in range(epochs):
        np.random.shuffle(train)
        for start in range(0, len(train), 512):
            chunk = torch.as_tensor(train[start : start + 512], device=device)
            logits = model(tensors["observation"][chunk], tensors["mask"][chunk])
            loss = nn.functional.cross_entropy(logits, tensors["action"][chunk])
            optimiser.zero_grad(set_to_none=True)
            loss.backward()
            optimiser.step()

    with torch.no_grad():
        chunk = torch.as_tensor(test, device=device)
        logits = model(tensors["observation"][chunk], tensors["mask"][chunk])
        predicted = logits.argmax(dim=1)
        accuracy = float((predicted == tensors["action"][chunk]).float().mean())
        legal = tensors["mask"][chunk].sum(dim=1).float()
        # What guessing uniformly among the legal actions would score, on the same rows.
        chance = float((1.0 / legal).mean())
        # And what always naming that agent's single most common action would score.
        counts = torch.bincount(tensors["action"][chunk], minlength=NUM_ACTIONS)
        majority = float(counts.max()) / len(test)

    return {
        "clone%": 100 * accuracy,
        "chance%": 100 * chance,
        "lift": 100 * (accuracy - chance),
        "majority%": 100 * majority,
        "samples": float(count),
        "legal": float(legal.mean()),
    }


def parse_counts(value: str) -> int:
    count = int(value)
    if not 2 <= count <= MAX_SEATS:
        raise argparse.ArgumentTypeError(f"Player count must be 2..{MAX_SEATS}.")
    return count


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--agents", nargs="+", required=True)
    parser.add_argument("--games", type=int, default=150)
    parser.add_argument("--players", type=parse_counts, default=4)
    parser.add_argument("--epochs", type=int, default=25)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--max-moves", type=int, default=3000)
    parser.add_argument("--device", default=None)
    args = parser.parse_args(argv)

    device = torch.device(args.device or ("cuda" if torch.cuda.is_available() else "cpu"))
    columns = ["clone%", "chance%", "lift", "majority%", "legal", "samples"]
    print(f"\n  {'agent':<32}" + "".join(f"{name:>11}" for name in columns))

    for spec in args.agents:
        observations, masks, actions = collect(
            spec, args.games, args.players, args.seed, args.device, args.max_moves
        )
        row = clone_accuracy(observations, masks, actions, device, args.epochs, args.seed)
        print(f"  {spec:<32}" + "".join(f"{row[name]:>11.2f}" for name in columns))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

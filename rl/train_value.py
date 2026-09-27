"""Is the weak critic a capacity problem or a learning-signal problem?

`value_calibration.py` says the PPO value head has no skill at all in the opening third of a match.
Two explanations are worth telling apart before spending anything on either:

* **capacity** — the network is too small, or the features too thin, to predict placement;
* **signal** — the information is there and reachable, but a placement reward arriving forty
  decisions later, filtered through GAE, is a poor way to teach it.

The experiment separates them by removing the reinforcement learning entirely. Play matches, label
every decision with the placement the seat actually finished with, and fit that by supervised
regression — an exact target instead of a bootstrapped one. Then sweep the trunk width. If a
supervised head at the *current* size beats the PPO head, the problem is signal. If skill only
arrives with a wider trunk, the problem is capacity. The two are not exclusive and the sweep says
which dominates.

Everything is scored on one held-out split with the same statistic `value_calibration.py` reports —
skill against the trivial always-zero predictor — so the numbers are directly comparable to it.

    python rl/train_value.py --games 400 --hidden 128 256 512 1024
    python rl/train_value.py --data runs/value/data.npz --hidden 256   # reuse a collection
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
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
from blowcow.nets import BlowCowNet  # noqa: E402
from blowcow.observation import MAX_SEATS, OBSERVATION_SIZE  # noqa: E402


# ------------------------------------------------------------------ collection

def collect(
    agent_specs: Sequence[str],
    games: int,
    player_counts: Sequence[int],
    seed: int,
    max_moves: int,
    device: Optional[str],
    all_seats: bool = True,
) -> Dict[str, np.ndarray]:
    """One row per decision: the observation, the placement that seat finished with, and where in
    the match it happened.

    The label is the *outcome*, not a return: no discounting, no bootstrap, no advantage. That is
    the entire point — it is the quantity the value head is supposed to predict, measured rather
    than estimated.
    """
    rng = random.Random(seed)
    env = BlowCowEnv(
        seed=seed, reward=RewardConfig(terminal=1.0, dense_points=0.0), max_moves=max_moves
    )
    built = {
        spec: make_agent(spec, seed=rng.randrange(1, 2**31), device=device)
        for spec in dict.fromkeys(agent_specs)
    }

    observations: List[np.ndarray] = []
    labels: List[float] = []
    progress: List[float] = []
    seats: List[int] = []
    match_ids: List[int] = []
    truncated_matches = 0

    started = time.perf_counter()
    for game_index in range(games):
        num_players = player_counts[game_index % len(player_counts)]
        # Rotated so an agent is not welded to one chair, exactly as `evaluate.py` does.
        specs = [
            agent_specs[(index + game_index) % len(agent_specs)] for index in range(num_players)
        ]

        step = env.reset(seed=None, num_players=num_players)
        assert env.engine is not None
        by_seat = {}
        for index, spec in enumerate(specs):
            seat_id = next(
                player_id
                for player_id in env.engine.seat_order
                if env.engine.players[player_id].seat_index == index
            )
            by_seat[seat_id] = built[spec]

        pending: List[Tuple[str, np.ndarray]] = []
        while not step.done:
            if all_seats:
                # Every seat's view of this position, not just the one on the clock. ISMCTS
                # evaluates a leaf from the *searching* seat's perspective, and at a leaf that seat
                # is usually not the one to move — so a critic trained only on acting-seat
                # observations would be asked something it has never seen at exactly the moment it
                # is relied on. Encoding all of them also multiplies the data for free.
                for seat_id in env.engine.seat_order:
                    pending.append((seat_id, env.table.observation(seat_id)))
            else:
                pending.append((step.agent, step.observation.copy()))
            agent = by_seat[step.agent]
            step = env.step(
                agent.act(Decision(env, step.agent, step.observation, step.action_mask))
            )

        truncated_matches += int(step.truncated)
        placements: List[str] = step.info["placements"]
        outcome = {
            seat_id: 1.0 - 2.0 * place / (num_players - 1)
            for place, seat_id in enumerate(placements)
        }
        # Progress is measured in *positions*, so every seat's view of the same position shares a
        # value. Dividing by the row count instead would make it drift with the seat count.
        stride = num_players if all_seats else 1
        total = max(1, len(pending) // stride)
        for position, (seat_id, observation) in enumerate(pending):
            if seat_id not in outcome:
                continue
            observations.append(observation)
            labels.append(outcome[seat_id])
            progress.append((position // stride) / total)
            seats.append(num_players)
            match_ids.append(game_index)

        if (game_index + 1) % 50 == 0:
            rate = len(observations) / max(1e-9, time.perf_counter() - started)
            print(
                f"  {game_index + 1}/{games} matches, {len(observations):,} decisions "
                f"({rate:,.0f}/s)",
                flush=True,
            )

    print(f"  collected {len(observations):,} decisions, {100 * truncated_matches / max(1, games):.1f}% truncated")
    return {
        "observations": np.asarray(observations, dtype=np.float32),
        "labels": np.asarray(labels, dtype=np.float32),
        "progress": np.asarray(progress, dtype=np.float32),
        "seats": np.asarray(seats, dtype=np.int64),
        # Recorded rather than inferred. The held-out split has to be by match, and reading match
        # boundaries back out of `progress` breaks the moment a position emits more than one row.
        "match": np.asarray(match_ids, dtype=np.int64),
    }


# -------------------------------------------------------------------- scoring

def skill(predicted: np.ndarray, actual: np.ndarray) -> Tuple[float, float]:
    """Variance explained against the always-zero predictor, and correlation."""
    if predicted.size < 2:
        return float("nan"), float("nan")
    error = float(np.mean((predicted - actual) ** 2))
    trivial = float(np.mean(actual**2))
    value = 1.0 - error / trivial if trivial > 1e-12 else 0.0
    spread, deviation = float(np.std(actual)), float(np.std(predicted))
    correlation = (
        float(np.corrcoef(predicted, actual)[0, 1])
        if spread > 1e-9 and deviation > 1e-9
        else 0.0
    )
    return value, correlation


def phase_report(name: str, predicted: np.ndarray, data: Dict[str, np.ndarray]) -> Dict[str, float]:
    actual, progress = data["labels"], data["progress"]
    overall, correlation = skill(predicted, actual)
    row = {"skill": overall, "corr": correlation}
    for label, low, high in (("first", 0.0, 1 / 3), ("mid", 1 / 3, 2 / 3), ("last", 2 / 3, 1.01)):
        window = (progress >= low) & (progress < high)
        row[label] = skill(predicted[window], actual[window])[0] if window.sum() > 1 else float("nan")
    return row


# ------------------------------------------------------------------- training

def train_value(
    data: Dict[str, np.ndarray],
    split: np.ndarray,
    hidden: int,
    epochs: int,
    batch: int,
    lr: float,
    device: torch.device,
    seed: int,
) -> Tuple[np.ndarray, int, BlowCowNet]:
    """Fit `BlowCowNet`'s value head supervised. Returns held-out predictions, size, and the net.

    The whole network is built rather than a bare MLP so the trunk, the shared card-type encoder and
    the value head are *identical* to the ones PPO trains. Only the value loss is backpropagated, so
    the policy heads sit at their initialisation — they are not part of the question.
    """
    torch.manual_seed(seed)
    network = BlowCowNet(hidden=hidden).to(device)
    optimiser = torch.optim.Adam(network.parameters(), lr=lr)

    observations = torch.as_tensor(data["observations"])
    labels = torch.as_tensor(data["labels"])
    train_index = np.flatnonzero(~split)
    test_index = np.flatnonzero(split)

    for epoch in range(epochs):
        network.train()
        order = np.random.default_rng(seed + epoch).permutation(train_index)
        total, seen = 0.0, 0
        for start in range(0, len(order), batch):
            rows = order[start : start + batch]
            x = observations[rows].to(device)
            y = labels[rows].to(device)
            _logits, value = network(x)
            loss = nn.functional.mse_loss(value.squeeze(-1), y)
            optimiser.zero_grad(set_to_none=True)
            loss.backward()
            nn.utils.clip_grad_norm_(network.parameters(), 0.5)
            optimiser.step()
            total += float(loss) * len(rows)
            seen += len(rows)
        print(f"    hidden={hidden} epoch {epoch + 1}/{epochs} train mse {total / max(1, seen):.4f}", flush=True)

    network.eval()
    predictions: List[np.ndarray] = []
    with torch.no_grad():
        for start in range(0, len(test_index), 4096):
            rows = test_index[start : start + 4096]
            _logits, value = network(observations[rows].to(device))
            predictions.append(value.squeeze(-1).cpu().numpy())
    return (
        np.concatenate(predictions),
        sum(p.numel() for p in network.parameters()),
        network,
    )


def score_checkpoint(
    path: str, data: Dict[str, np.ndarray], split: np.ndarray, device: torch.device
) -> np.ndarray:
    checkpoint = torch.load(path, map_location=device, weights_only=False)
    network = BlowCowNet(**checkpoint.get("net_kwargs", {}))
    network.load_state_dict(checkpoint["model"])
    network.to(device).eval()

    observations = torch.as_tensor(data["observations"])
    test_index = np.flatnonzero(split)
    predictions: List[np.ndarray] = []
    with torch.no_grad():
        for start in range(0, len(test_index), 4096):
            rows = test_index[start : start + 4096]
            _logits, value = network(observations[rows].to(device))
            predictions.append(value.squeeze(-1).cpu().numpy())
    return np.concatenate(predictions)


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
        default=["ckpt:runs/ppo-v1/final.pt", "heuristic", "ckpt:runs/ppo-v1/final.pt"],
        help="who generates the states; a mix widens coverage beyond one policy's trajectories",
    )
    parser.add_argument("--baseline", default="runs/ppo-v1/final.pt",
                        help="checkpoint whose PPO value head is scored on the same held-out split")
    parser.add_argument("--games", type=int, default=400)
    parser.add_argument("--players", type=parse_counts, default=[2, 3, 4, 5, 6])
    parser.add_argument("--hidden", type=int, nargs="+", default=[128, 256, 512, 1024])
    parser.add_argument("--epochs", type=int, default=6)
    parser.add_argument("--batch", type=int, default=1024)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--holdout", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--max-moves", type=int, default=3000)
    parser.add_argument("--device", default=None)
    parser.add_argument("--data", default=None, help="load/save the collected dataset here (.npz)")
    parser.add_argument(
        "--acting-seat-only",
        action="store_true",
        help="record only the seat on the clock; the default records every seat's view, which is "
             "what a search leaf actually asks for",
    )
    parser.add_argument(
        "--out",
        default=None,
        help="save the best-scoring value network here, for `ismcts:<policy>:value=<path>`",
    )
    args = parser.parse_args(argv)

    device = torch.device(args.device or ("cuda" if torch.cuda.is_available() else "cpu"))

    if args.data and os.path.exists(args.data):
        print(f"loading {args.data}")
        loaded = np.load(args.data)
        data = {key: loaded[key] for key in loaded.files}
    else:
        print(f"collecting {args.games} matches with: {' '.join(args.agents)}")
        data = collect(
            args.agents, args.games, args.players, args.seed, args.max_moves, args.device,
            all_seats=not args.acting_seat_only,
        )
        if args.data:
            os.makedirs(os.path.dirname(args.data) or ".", exist_ok=True)
            np.savez_compressed(args.data, **data)
            print(f"saved {args.data}")

    if data["observations"].shape[1] != OBSERVATION_SIZE:
        raise SystemExit(
            f"dataset has {data['observations'].shape[1]} features, this build expects "
            f"{OBSERVATION_SIZE} — recollect it."
        )

    # Held out by *match*, not by decision: consecutive decisions in one match share an outcome
    # label, so a random split over rows would leak the answer across the boundary and flatter
    # every model equally.
    if "match" in data:
        match_id = data["match"]
    else:
        # Older collections predate the recorded index; infer it from `progress` falling back.
        progress = data["progress"]
        match_id = np.cumsum(np.concatenate([[True], progress[1:] < progress[:-1]])) - 1
    generator = np.random.default_rng(args.seed)
    held = generator.random(int(match_id.max()) + 1) < args.holdout
    split = held[match_id]
    print(
        f"\n{len(split):,} decisions over {int(match_id.max()) + 1:,} matches; "
        f"{int(split.sum()):,} held out"
    )

    rows: List[Tuple[str, int, Dict[str, float]]] = []
    if args.baseline and os.path.exists(args.baseline):
        predicted = score_checkpoint(args.baseline, data, split, device)
        rows.append(("ppo critic (as trained)", 0, phase_report("ppo", predicted, {
            "labels": data["labels"][split], "progress": data["progress"][split]})))

    best: Optional[Tuple[float, int, BlowCowNet]] = None
    for hidden in args.hidden:
        predicted, parameters, network = train_value(
            data, split, hidden, args.epochs, args.batch, args.lr, device, args.seed
        )
        row = phase_report(
            f"h{hidden}", predicted,
            {"labels": data["labels"][split], "progress": data["progress"][split]})
        rows.append((f"supervised hidden={hidden}", parameters, row))
        # Selected on held-out skill. Since the sweep is flat, this will usually pick the largest by
        # a hair — pass a single `--hidden` when the checkpoint is the point rather than the sweep.
        if best is None or row["skill"] > best[0]:
            best = (row["skill"], hidden, network)

    print(f"\n  {'model':<26}{'params':>10}{'skill':>9}{'corr':>8}{'first':>9}{'mid':>8}{'last':>8}")
    for name, parameters, row in rows:
        print(
            f"  {name:<26}{parameters:>10,}{row['skill']:>9.3f}{row['corr']:>8.3f}"
            f"{row['first']:>9.3f}{row['mid']:>8.3f}{row['last']:>8.3f}"
        )
    print(
        "\n  skill is variance explained against always-zero, on held-out matches."
        "\n  first/mid/last are that same statistic within each third of a match."
    )

    if args.out and best is not None:
        _skill, hidden, network = best
        os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
        # Saved in the same shape every other checkpoint here uses, so `load_ismcts_agent` and
        # friends can read it without a special case. The policy heads in it are *untrained* — this
        # is a value network and nothing else, which is why `ismcts:` takes it as `value=` rather
        # than as the network.
        torch.save(
            {
                "model": network.state_dict(),
                "net_kwargs": {"hidden": hidden},
                "observation_size": OBSERVATION_SIZE,
                "value_only": True,
                "heldout_skill": _skill,
                "trained_on": list(args.agents),
                "decisions": int(len(split)),
            },
            args.out,
        )
        print(f"\nsaved {args.out}  (hidden={hidden}, held-out skill {_skill:.3f}, value head only)")
    print("\n" + json.dumps({name: row for name, _p, row in rows}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Expert iteration: train the policy on what the search decided, and the value on what happened.

Every precondition for this was measured before it was built, which is the only reason it is worth
the compute:

* the search beats the policy it searches with (**+0.360 ± 0.066** at two seats);
* a critic that covers off-turn states is worth **+0.150** to the search at a fixed budget;
* with that critic, simulation budget scales — **+0.57 per 4x**, no saturation yet.

So the search is a stronger player than its own prior, and improving the prior improves the search.
That is the loop: generate games with the full search, fit the policy to the search's visit counts
and the value to the placement that actually happened, and use the result as the next generation's
prior and critic.

Both targets are exact rather than bootstrapped, which is the same reason `train_value.py` works:
the visit counts are what the search really decided, and the placement is what really happened.

**Two things keep the loop honest, and the first version of this script had neither.** An iteration
*fine-tunes* the current policy rather than fitting a fresh network — a round of targets is a
thousand-odd matches against the 2.5M PPO steps it is refining, and training from scratch produced a
policy **0.240 ± 0.049 worse than its own starting point**. And a new checkpoint is only adopted if
it beats the incumbent head to head, so a bad round costs one iteration instead of poisoning every
round after it. The caveat that remains: the promoted network serves as both prior and critic, so the
value head stops being the purely supervised thing `value_calibration.py` measured — watch it across
iterations rather than assuming.

The scope caveat worth remembering: search is only *measurably* better than its prior at two seats.
At four it is level or slightly behind, so targets generated at larger tables are distilling a search
that is not clearly an expert.

    python rl/train_expert.py --iterations 3 --games 600 --workers 8
    python rl/train_expert.py --generate --shard 0 --games 40 --out runs/expert/it0   # one worker

Generation is spread over worker **subprocesses** rather than threads: the simulator is pure Python,
so cores are the only way to make it faster, and a subprocess sidesteps having to ship torch models
between processes on Windows.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
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
from blowcow.nets import BlowCowNet, MASKED_LOGIT  # noqa: E402
from blowcow.observation import MAX_SEATS, OBSERVATION_SIZE  # noqa: E402
from blowcow.spaces import NUM_ACTIONS  # noqa: E402

#: Visit counts are stored sparsely. A root offers a few hundred legal actions out of 1,669 and the
#: search visits a few dozen of them, so a dense row per decision would be almost all zeros.
MAX_TARGET_ACTIONS = 64


# ----------------------------------------------------------------- generation

def generate(
    spec: str,
    games: int,
    player_counts: Sequence[int],
    seed: int,
    max_moves: int,
    device: Optional[str],
) -> Dict[str, np.ndarray]:
    """Self-play with the search in every seat, recording what it decided and what happened."""
    agent = make_agent(spec, seed=seed, device=device)
    env = BlowCowEnv(
        seed=seed, reward=RewardConfig(terminal=1.0, dense_points=0.0), max_moves=max_moves
    )

    observations: List[np.ndarray] = []
    target_actions: List[np.ndarray] = []
    target_counts: List[np.ndarray] = []
    value_rows: List[np.ndarray] = []
    value_labels: List[float] = []
    value_match: List[int] = []
    policy_labels: List[float] = []
    truncated_matches = 0

    for game_index in range(games):
        num_players = player_counts[game_index % len(player_counts)]
        step = env.reset(seed=None, num_players=num_players)
        assert env.engine is not None

        # (seat, observation) for the value head, and (seat, obs, actions, counts) for the policy.
        value_pending: List[Tuple[str, np.ndarray]] = []
        policy_pending: List[Tuple[str, np.ndarray, np.ndarray, np.ndarray]] = []

        while not step.done:
            for seat_id in env.engine.seat_order:
                value_pending.append((seat_id, env.table.observation(seat_id)))

            legal = [int(index) for index in np.flatnonzero(step.action_mask)]
            if len(legal) == 1:
                # Nothing to record and nothing to search: a forced choice teaches the policy only
                # that the mask exists, which it already knows.
                step = env.step(legal[0])
                continue

            # Searched once, and the action is drawn from *these* counts. Calling `act` here would
            # run a second, independent search, so the recorded target would be a distribution the
            # move it is paired with never came from — and it would double the cost of generation.
            visits = agent.search(env.engine, env.mapping, step.agent)
            visits = {a: c for a, c in visits.items() if a in set(legal) and c > 0}
            if not visits:
                step = env.step(int(agent.act(
                    Decision(env, step.agent, step.observation, step.action_mask)
                )))
                continue

            ordered = sorted(visits.items(), key=lambda item: -item[1])[:MAX_TARGET_ACTIONS]
            if len(ordered) > 1:
                policy_pending.append((
                    step.agent,
                    step.observation.copy(),
                    np.array([a for a, _c in ordered], dtype=np.int32),
                    np.array([c for _a, c in ordered], dtype=np.float32),
                ))

            counts = np.array([c for _a, c in ordered], dtype=np.float64)
            if agent.temperature <= 0:
                action = ordered[0][0]
            else:
                weights = counts ** (1.0 / agent.temperature)
                action = int(np.random.default_rng(
                    agent.rng.randrange(1, 2**31)
                ).choice([a for a, _c in ordered], p=weights / weights.sum()))
            step = env.step(int(action))

        truncated_matches += int(step.truncated)
        placements: List[str] = step.info["placements"]
        outcome = {
            seat_id: 1.0 - 2.0 * place / (num_players - 1)
            for place, seat_id in enumerate(placements)
        }

        for seat_id, observation in value_pending:
            if seat_id not in outcome:
                continue
            value_rows.append(observation)
            value_labels.append(outcome[seat_id])
            value_match.append(game_index)
        for seat_id, observation, actions, counts in policy_pending:
            if seat_id not in outcome:
                continue
            observations.append(observation)
            padded_actions = np.full(MAX_TARGET_ACTIONS, -1, dtype=np.int32)
            padded_counts = np.zeros(MAX_TARGET_ACTIONS, dtype=np.float32)
            padded_actions[: len(actions)] = actions
            padded_counts[: len(counts)] = counts
            target_actions.append(padded_actions)
            target_counts.append(padded_counts)
            policy_labels.append(outcome[seat_id])

    return {
        "observations": np.asarray(observations, dtype=np.float32),
        "target_actions": np.asarray(target_actions, dtype=np.int32),
        "target_counts": np.asarray(target_counts, dtype=np.float32),
        "value_rows": np.asarray(value_rows, dtype=np.float32),
        "value_labels": np.asarray(value_labels, dtype=np.float32),
        "value_match": np.asarray(value_match, dtype=np.int64),
        "truncated": np.asarray([truncated_matches, games], dtype=np.int64),
    }


# -------------------------------------------------------------------- training

def train(
    shards: Sequence[Dict[str, np.ndarray]],
    hidden: int,
    epochs: int,
    batch: int,
    lr: float,
    value_coef: float,
    device: torch.device,
    seed: int,
    init: Optional[str],
) -> Tuple[BlowCowNet, Dict[str, float]]:
    """Fit the policy to the search's visit counts and the value to the realised placement."""
    torch.manual_seed(seed)
    if init:
        checkpoint = torch.load(init, map_location=device, weights_only=False)
        kwargs = dict(checkpoint.get("net_kwargs", {"hidden": hidden}))
        network = BlowCowNet(**kwargs).to(device)
        network.load_state_dict(checkpoint["model"])
    else:
        network = BlowCowNet(hidden=hidden).to(device)

    observations = torch.as_tensor(np.concatenate([s["observations"] for s in shards]))
    actions = torch.as_tensor(np.concatenate([s["target_actions"] for s in shards]).astype(np.int64))
    counts = torch.as_tensor(np.concatenate([s["target_counts"] for s in shards]))
    value_rows = torch.as_tensor(np.concatenate([s["value_rows"] for s in shards]))
    value_labels = torch.as_tensor(np.concatenate([s["value_labels"] for s in shards]))

    # Visit counts become a distribution over the actions the search actually considered. Anything
    # it never visited is left out of the target rather than pushed to zero: an unvisited action is
    # one the search had no opinion about, not one it rejected.
    weights = counts / counts.sum(dim=1, keepdim=True).clamp(min=1e-9)
    valid = actions >= 0
    safe_actions = actions.clamp(min=0)

    optimiser = torch.optim.Adam(network.parameters(), lr=lr)
    stats: Dict[str, float] = {}

    for epoch in range(epochs):
        network.train()
        order = np.random.default_rng(seed + epoch).permutation(len(observations))
        policy_total = value_total = seen = 0.0

        for start in range(0, len(order), batch):
            rows = torch.as_tensor(order[start : start + batch])
            logits, _value = network(observations[rows].to(device))

            # Only the considered actions are scored, so the softmax is taken over those columns.
            picked = torch.gather(logits, 1, safe_actions[rows].to(device))
            picked = picked.masked_fill(~valid[rows].to(device), MASKED_LOGIT)
            log_probabilities = torch.log_softmax(picked, dim=1)
            policy_loss = -(weights[rows].to(device) * log_probabilities).sum(dim=1).mean()

            value_index = torch.as_tensor(
                np.random.default_rng(seed + epoch + start).integers(
                    0, len(value_rows), size=min(batch, len(value_rows))
                )
            )
            _logits, values = network(value_rows[value_index].to(device))
            value_loss = nn.functional.mse_loss(
                values.squeeze(-1), value_labels[value_index].to(device)
            )

            loss = policy_loss + value_coef * value_loss
            optimiser.zero_grad(set_to_none=True)
            loss.backward()
            nn.utils.clip_grad_norm_(network.parameters(), 0.5)
            optimiser.step()

            policy_total += float(policy_loss.detach()) * len(rows)
            value_total += float(value_loss.detach()) * len(rows)
            seen += len(rows)

        stats = {
            "policy_loss": policy_total / max(1.0, seen),
            "value_loss": value_total / max(1.0, seen),
        }
        print(
            f"    epoch {epoch + 1}/{epochs} policy {stats['policy_loss']:.4f} "
            f"value {stats['value_loss']:.4f}",
            flush=True,
        )

    network.eval()
    return network, stats


def evaluate_promotion(
    challenger: str,
    incumbent: str,
    games: int,
    player_counts: Sequence[int],
    seed: int,
    device: Optional[str],
) -> Tuple[float, Dict[int, float]]:
    """Challenger's mean placement score against the incumbent, as raw policies.

    Deliberately *without* search on either side. What the iteration changed is the network, so the
    network is what is compared; wrapping both in the same search would add cost and noise to measure
    the same difference. It is also far cheaper, which is what makes gating affordable every round.

    Returns the pooled margin *and* one margin per table size. The gate decides on the pooled figure
    because that is the one with enough matches behind it to mean anything, but a pooled number can
    hide a +0.2/-0.2 split, and a run whose whole failure mode was a two-seat specialist has to be
    able to show that split rather than merely be blocked by it.
    """
    from evaluate import run_series

    counts = list(player_counts)
    per_count: Dict[int, float] = {}
    total, scored = 0.0, 0
    for index, count in enumerate(counts):
        tallies = run_series(
            [f"ckpt:{challenger}", f"ckpt:{incumbent}"],
            max(1, games // len(counts)),
            [count],
            seed + 7919 * index,
            3000,
            device,
            score_truncated=True,
        )
        tally = tallies[f"ckpt:{challenger}"]
        per_count[count] = tally.score / max(1, tally.scored)
        total += tally.score
        scored += tally.scored
    return total / max(1, scored), per_count


def parse_counts(value: str) -> List[int]:
    counts = [int(part) for part in value.split(",") if part.strip()]
    for count in counts:
        if not 2 <= count <= MAX_SEATS:
            raise argparse.ArgumentTypeError(f"Player counts must be 2..{MAX_SEATS}.")
    return counts


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--policy", default="runs/ppo-v1/final.pt")
    parser.add_argument("--critic", default="runs/value/critic-256.pt")
    parser.add_argument("--run", default="runs/expert")
    parser.add_argument("--iterations", type=int, default=3)
    parser.add_argument("--games", type=int, default=600, help="matches per iteration, all workers")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--sims", type=int, default=64)
    parser.add_argument("--belief", type=float, default=1.0)
    parser.add_argument("--temperature", type=float, default=1.0,
                        help="visit-count temperature while generating. Above 0 so self-play does "
                             "not replay one line; the *targets* are the raw counts either way")
    parser.add_argument("--players", type=parse_counts, default=[2, 3, 4])
    parser.add_argument("--hidden", type=int, default=256)
    parser.add_argument("--epochs", type=int, default=4)
    parser.add_argument("--batch", type=int, default=512)
    parser.add_argument("--lr", type=float, default=1e-4,
                        help="fine-tuning rate. Lower than PPO's because each iteration starts from "
                             "an already-trained policy and a round of targets is small")
    parser.add_argument("--promote-games", type=int, default=400,
                        help="head-to-head matches deciding whether an iteration is adopted")
    parser.add_argument("--promote-margin", type=float, default=0.05,
                        help="score the challenger must exceed to replace the incumbent. NOT zero, "
                             "and the reason is selection bias: the gate is a noisy measurement "
                             "(+-0.06 at 300 matches) and promoting on `> 0` adopts half of all "
                             "neutral changes while reporting whatever positive noise carried them "
                             "through. Three rounds gated at zero reported +0.133/+0.067/+0.073 and "
                             "delivered +0.035 +- 0.029 end to end")
    parser.add_argument("--promote-players", type=parse_counts, default=[2, 3, 4],
                        help="table sizes the gate measures. Deliberately wider than --players: "
                             "gating only on the size you generated at cannot see a regression "
                             "anywhere else, and one run trained at 2 seats gained +0.035 there "
                             "while losing 0.186 at four with nothing to catch it")
    parser.add_argument("--value-coef", type=float, default=1.0)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--max-moves", type=int, default=3000)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--generate", action="store_true", help="worker mode: one shard, then exit")
    parser.add_argument("--shard", type=int, default=0)
    parser.add_argument("--out", default=None)
    return parser


def spec_for(args: argparse.Namespace, policy: str, critic: str) -> str:
    return (
        f"ismcts:{policy}:sims={args.sims}:batch={max(16, args.sims // 4)}"
        f":value={critic}:belief={args.belief}:temperature={args.temperature}"
    )


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)

    if args.generate:
        data = generate(
            spec_for(args, args.policy, args.critic),
            args.games,
            args.players,
            args.seed + 1000 * args.shard,
            args.max_moves,
            args.device,
        )
        target = args.out or os.path.join(args.run, f"shard-{args.shard}.npz")
        os.makedirs(os.path.dirname(target) or ".", exist_ok=True)
        np.savez_compressed(target, **data)
        print(f"shard {args.shard}: {len(data['observations']):,} policy targets -> {target}")
        return 0

    os.makedirs(args.run, exist_ok=True)
    device = torch.device(args.device)
    policy, critic = args.policy, args.critic
    history = []

    for iteration in range(args.iterations):
        folder = os.path.join(args.run, f"it{iteration}")
        os.makedirs(folder, exist_ok=True)
        per_worker = max(1, args.games // args.workers)
        print(
            f"\n=== iteration {iteration}: {args.workers} workers x {per_worker} matches "
            f"@ {args.sims} sims, policy={policy}, critic={critic}",
            flush=True,
        )

        started = time.perf_counter()
        processes = []
        for shard in range(args.workers):
            command = [
                sys.executable, os.path.abspath(__file__), "--generate",
                "--shard", str(shard), "--games", str(per_worker),
                "--policy", policy, "--critic", critic,
                "--sims", str(args.sims), "--belief", str(args.belief),
                "--temperature", str(args.temperature),
                "--players", ",".join(str(c) for c in args.players),
                "--seed", str(args.seed + iteration * 97),
                "--max-moves", str(args.max_moves), "--device", args.device,
                "--out", os.path.join(folder, f"shard-{shard}.npz"),
            ]
            environment = dict(os.environ, OMP_NUM_THREADS="1", MKL_NUM_THREADS="1")
            processes.append(subprocess.Popen(command, env=environment))
        failures = sum(1 for process in processes if process.wait() != 0)
        if failures:
            raise SystemExit(f"{failures}/{args.workers} generation workers failed")

        shards = []
        for shard in range(args.workers):
            loaded = np.load(os.path.join(folder, f"shard-{shard}.npz"))
            shards.append({key: loaded[key] for key in loaded.files})
        policy_rows = sum(len(s["observations"]) for s in shards)
        truncated = sum(int(s["truncated"][0]) for s in shards)
        played = sum(int(s["truncated"][1]) for s in shards)
        print(
            f"  generated {policy_rows:,} policy targets from {played} matches "
            f"({100 * truncated / max(1, played):.1f}% truncated) "
            f"in {(time.perf_counter() - started) / 60:.1f} min",
            flush=True,
        )

        # Fine-tuned from the current policy, never trained from scratch. An iteration produces on
        # the order of a thousand matches of targets; the policy it is improving on cost 2.5M steps
        # of PPO. Starting from random weights throws that away and tries to relearn the game from
        # the smaller dataset, which measured at **-0.240 ± 0.049 against its own starting point** at
        # two seats — expert iteration is supposed to *refine* a policy, not replace it.
        network, stats = train(
            shards, args.hidden, args.epochs, args.batch, args.lr, args.value_coef,
            device, args.seed + iteration, init=policy,
        )
        checkpoint = os.path.join(args.run, f"it{iteration}.pt")
        torch.save(
            {
                "model": network.state_dict(),
                # The width comes from whatever was fine-tuned, not from `--hidden`, so a run
                # started off a checkpoint of a different size still reloads correctly.
                "net_kwargs": dict(
                    torch.load(policy, map_location="cpu", weights_only=False).get(
                        "net_kwargs", {"hidden": args.hidden}
                    )
                ),
                "observation_size": OBSERVATION_SIZE,
                "action_size": NUM_ACTIONS,
                "iteration": iteration,
                "policy_targets": int(policy_rows),
                **stats,
            },
            checkpoint,
        )

        # **Gated promotion.** An iteration is only adopted if it actually beats what it replaces,
        # head to head as raw policies. Without this the loop compounds its own mistakes: the first
        # version of this script trained from scratch each round, produced a policy 0.240 worse than
        # its own starting point, and immediately began generating the next round's data with it.
        margin, per_count = evaluate_promotion(
            checkpoint, policy, args.promote_games, args.promote_players,
            args.seed + iteration, args.device,
        )
        promoted = margin > args.promote_margin
        breakdown = ", ".join(f"{count}p {value:+.3f}" for count, value in sorted(per_count.items()))
        print(
            f"  {checkpoint}: {margin:+.3f} against {policy} over {args.promote_games} matches "
            f"at {args.promote_players} seats ({breakdown}) "
            f"-> {'PROMOTED' if promoted else 'REJECTED, keeping the incumbent'}",
            flush=True,
        )
        history.append({"iteration": iteration, "checkpoint": checkpoint,
                        "policy_targets": int(policy_rows), "margin": margin,
                        "margin_by_players": {str(k): v for k, v in sorted(per_count.items())},
                        "promoted": promoted, **stats})
        if promoted:
            # The new network becomes both the next prior and the next critic.
            policy = critic = checkpoint
        with open(os.path.join(args.run, "history.json"), "w", encoding="utf-8") as handle:
            json.dump(history, handle, indent=2)

    print(f"\nfinal: {policy}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

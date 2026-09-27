"""PPO self-play with a frozen opponent pool.

Naive self-play is not enough in a bluffing game. Bluff rate and call rate chase each other in a
rock-paper-scissors cycle, and a policy trained only against its current self will happily converge
onto whatever its current self happens to be bad at. So most episodes seat the learner against
*snapshots* of itself taken earlier in training — fictitious play, roughly — and the rest are pure
self-play for sample efficiency.

Two details that turn-based multi-agent RL gets wrong easily, and this does not:

* **A seat's reward arrives long after its action.** Other seats act in between, and the punishment
  for a bad play lands several turns later. Rewards are therefore accumulated onto the acting seat's
  own most recent transition, and GAE runs along each seat's own trajectory rather than along wall
  clock.
* **Truncation is endogenous, so it is scored rather than bootstrapped.** Cards only leave the game
  through scoring and through players leaving, so a table that never challenges cycles for ever — an
  agent therefore *decides* whether the match ends. Bootstrapping the value function at the move
  limit, the textbook treatment, lets a losing agent prefer stalling to a terminal ``-1``; the first
  run of this trainer learned exactly that. The environment pays a standings-based payoff minus a
  penalty instead, so finishing beats stalling for every seat, and truncation is treated as terminal
  here. See `RewardConfig`.

    python rl/train_ppo.py --steps 2000000 --run runs/ppo
    python rl/train_ppo.py --steps 500000 --players 4 --baseline-prob 0.25
    python rl/train_ppo.py --steps 1000000 --opponent ckpt:runs/ppo/final.pt --exploiter
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional, Sequence, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import numpy as np
    import torch
    from torch import nn
except ModuleNotFoundError as missing:  # pragma: no cover - environment guidance
    raise SystemExit(
        f"Training needs {missing.name}. Activate the project virtualenv and retry."
    ) from missing

from blowcow.agents import BASELINES, Decision, make_agent  # noqa: E402
from blowcow.env import DEFAULT_PLAYER_COUNTS, BlowCowEnv, RewardConfig  # noqa: E402
from blowcow.nets import BlowCowNet  # noqa: E402
from blowcow.observation import LIE_FEATURE_ENABLED, MAX_SEATS, OBSERVATION_SIZE  # noqa: E402
from blowcow.spaces import NUM_ACTIONS  # noqa: E402
from evaluate import play_match  # noqa: E402

LEARNER = "learner"


@dataclass
class Transition:
    observation: np.ndarray
    mask: np.ndarray
    action: int
    log_prob: float
    value: float
    reward: float = 0.0
    terminated: bool = False
    #: 1.0 if the seat's current BS target is lying, 0.0 if honest, None where there is no target.
    #: Ground truth, used only as an auxiliary label during training — never read at inference.
    lie_label: Optional[float] = None


#: Who is playing each seat this episode: ``LEARNER``, ``("pool", i)``, ``("frozen", 0)`` or
#: ``("baseline", name)``.
SeatOwners = Dict[str, Any]


class Trainer:
    #: Columns printed each update. `train_rnad.py` extends it; anything logged but not listed here
    #: still reaches `log.jsonl`.
    progress_keys = ("step", "sps", "return", "entropy", "approx_kl", "truncated", "rounds", "pool",
                     "lie_acc")

    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.device = torch.device(
            args.device or ("cuda" if torch.cuda.is_available() else "cpu")
        )
        self.rng = random.Random(args.seed)
        torch.manual_seed(args.seed)
        np.random.seed(args.seed)  # minibatch shuffling

        self.net_kwargs = {"hidden": args.hidden, "type_dim": args.type_dim}
        if args.aux_lie_coef:
            # Rides in the checkpoint, so a network saved without it still rebuilds without it.
            self.net_kwargs["aux_lie_head"] = True
        if getattr(args, "init", None):
            # Continue from a finished run rather than redoing it. The width comes from the
            # checkpoint, not from `--hidden`, for the same reason `train_expert` takes it that way.
            loaded = torch.load(args.init, map_location="cpu", weights_only=False)
            self.net_kwargs = dict(loaded.get("net_kwargs", self.net_kwargs))
        self.network = BlowCowNet(**self.net_kwargs).to(self.device)
        if getattr(args, "init", None):
            self.network.load_state_dict(loaded["model"])
            print(f"--init: resumed from {args.init} at {loaded.get('steps', 0):,} steps", flush=True)
        if getattr(args, "init_value", None):
            self._init_from_value_network(args.init_value)

        # A *fixed* reference policy to measure progress against. Scoring against `heuristic` was
        # measured to rank checkpoints backwards — it calls BS on 76-84% of its chances, so it
        # rewards honesty rather than strength. An anchor from this same family cannot invert that
        # way, and when the anchor is the checkpoint a run started from, `eval_anchor` reads directly
        # as "how much has this training bought", with zero meaning nothing.
        self.eval_anchor = None
        if getattr(args, "eval_anchor", None):
            anchor = torch.load(args.eval_anchor, map_location=self.device, weights_only=False)
            self.eval_anchor = BlowCowNet(**anchor.get("net_kwargs", self.net_kwargs)).to(self.device)
            self.eval_anchor.load_state_dict(anchor["model"])
            self.eval_anchor.eval()
            for parameter in self.eval_anchor.parameters():
                parameter.requires_grad_(False)
        self.optimizer = torch.optim.Adam(self.network.parameters(), lr=args.lr, eps=1e-5)

        self.envs = [
            BlowCowEnv(
                player_counts=args.players,
                reward=RewardConfig(
                    terminal=args.terminal_reward,
                    dense_points=args.dense_reward,
                    truncation_penalty=args.truncation_penalty,
                    step_cost=args.step_cost,
                ),
                seed=args.seed * 7919 + index,
                max_moves=args.max_moves,
            )
            for index in range(args.num_envs)
        ]

        # Live modules rather than state dicts: the pool is small, the network is small, and loading
        # a state dict on every forward pass would cost more than holding them.
        self.pool: Deque[BlowCowNet] = deque(maxlen=args.pool_size)
        self.frozen_opponent: Optional[BlowCowNet] = None
        # `--opponent` may name a scripted bot rather than a checkpoint. That is what puts a scale
        # under an exploitability number: "+0.199" means nothing until you know what a *handcrafted*
        # opponent gives up over the same budget.
        self.frozen_baseline: Optional[str] = args.opponent if args.opponent in BASELINES else None
        if args.opponent and self.frozen_baseline is None:
            self.frozen_opponent = self._load_frozen(args.opponent)

        self.baselines = {
            name: make_agent(name, seed=args.seed + index)
            for index, name in enumerate(args.baselines)
        }
        if self.frozen_baseline and self.frozen_baseline not in self.baselines:
            self.baselines[self.frozen_baseline] = make_agent(
                self.frozen_baseline, seed=args.seed + 101
            )

        self.steps_done = 0
        self.episodes_done = 0
        self.updates_done = 0
        self.recent_returns: Deque[float] = deque(maxlen=400)
        self.recent_truncations: Deque[int] = deque(maxlen=400)
        self.recent_rounds: Deque[int] = deque(maxlen=400)

        self.run_dir = Path(args.run)
        self.run_dir.mkdir(parents=True, exist_ok=True)
        (self.run_dir / "args.json").write_text(json.dumps(vars(args), indent=2, default=str))
        self.log_path = self.run_dir / "log.jsonl"

        self.steps = [env.reset() for env in self.envs]
        self.owners = [self._assign_seats(env) for env in self.envs]
        self.open_traj: List[Dict[str, List[Transition]]] = [
            defaultdict(list) for _ in self.envs
        ]
        self.finished: List[Tuple[List[Transition], float]] = []

    # ------------------------------------------------------------------ setup

    #: Heads that belong to the policy alone. Everything else in `BlowCowNet` — the card-type, seat
    #: and event encoders, the trunk, the context projection and the value head — is shared
    #: representation, and is what `--init-value` transfers.
    POLICY_ONLY_MODULES = (
        "base_head",
        "choice_head",
        "choice_head_trump",
        "trump_head",
        "trump_u",
        "choice_v",
        "lie_head",
    )

    def _init_from_value_network(self, path: str) -> None:
        """Start from a critic that was trained on placement directly.

        The PPO critic is a by-product of advantage estimation and measures as one: no skill in the
        opening third of a match, and worse still on the off-turn observations a search leaf asks
        for. A supervised head on the same architecture scores 2.4x better, so beginning from its
        representation gives PPO a trunk that already predicts the outcome and a critic that is
        useful from step one rather than after a million.

        The policy heads are deliberately *not* copied: a value network's policy head is untrained
        noise. They keep their own small-gain orthogonal init, which is what stops a random policy
        from immediately tearing up a trunk that is worth keeping.
        """
        checkpoint = torch.load(path, map_location=self.device, weights_only=False)
        kwargs = checkpoint.get("net_kwargs", {})
        source = BlowCowNet(**kwargs).to(self.device)
        source.load_state_dict(checkpoint["model"])

        target = self.network.state_dict()
        copied, skipped = 0, []
        for name, tensor in source.state_dict().items():
            if name.split(".")[0] in self.POLICY_ONLY_MODULES:
                continue
            if name not in target:
                skipped.append(name)
                continue
            if target[name].shape != tensor.shape:
                # Almost always `--hidden` disagreeing with the checkpoint's width. Loud, because a
                # silently half-transferred trunk would look like the intervention simply not working.
                raise SystemExit(
                    f"--init-value: {name} is {tuple(tensor.shape)} in {path} but "
                    f"{tuple(target[name].shape)} here. Rebuild the critic with "
                    f"--hidden {self.args.hidden}, or train with the checkpoint's width."
                )
            target[name] = tensor.clone()
            copied += 1
        self.network.load_state_dict(target)
        if copied == 0:
            raise SystemExit(f"--init-value: {path} shared no parameters with this network.")
        print(
            f"initialised {copied} shared tensors from {path} "
            f"(held-out skill {checkpoint.get('heldout_skill', float('nan')):.3f}); "
            f"policy heads left at init"
            + (f"; ignored {len(skipped)} unmatched" if skipped else "")
        )

    def _load_frozen(self, spec: str) -> BlowCowNet:
        path = spec[len("ckpt:") :] if spec.startswith("ckpt:") else spec
        checkpoint = torch.load(path, map_location=self.device, weights_only=False)
        network = BlowCowNet(**checkpoint.get("net_kwargs", self.net_kwargs)).to(self.device)
        network.load_state_dict(checkpoint["model"])
        network.eval()
        for parameter in network.parameters():
            parameter.requires_grad_(False)
        return network

    def _snapshot(self) -> None:
        clone = BlowCowNet(**self.net_kwargs).to(self.device)
        clone.load_state_dict(self.network.state_dict())
        clone.eval()
        for parameter in clone.parameters():
            parameter.requires_grad_(False)
        self.pool.append(clone)

    def _assign_seats(self, env: BlowCowEnv) -> SeatOwners:
        """Decide who plays each seat for the episode that just started."""
        seats = env.agents

        if self.args.exploiter:
            # One learner against a wall of the frozen opponent: this measures how much the frozen
            # policy can be beaten for, which is the only honest read on how exploitable it is.
            learner_seat = self.rng.choice(seats)
            wall = ("baseline", self.frozen_baseline) if self.frozen_baseline else ("frozen", 0)
            return {seat: (LEARNER if seat == learner_seat else wall) for seat in seats}

        # Early on there is nothing to play against but itself, which is fine: the pool fills in.
        if (not self.pool and not self.baselines) or self.rng.random() < self.args.self_play_prob:
            return {seat: LEARNER for seat in seats}

        owner: Dict[str, Any] = {}
        learner_seat = self.rng.choice(seats)
        for seat in seats:
            if seat == learner_seat:
                owner[seat] = LEARNER
            elif self.baselines and (
                not self.pool or self.rng.random() < self.args.baseline_prob
            ):
                owner[seat] = ("baseline", self.rng.choice(list(self.baselines)))
            else:
                owner[seat] = ("pool", self.rng.randrange(len(self.pool)))
        return owner

    def _network_for(self, owner: Any) -> Optional[BlowCowNet]:
        if owner == LEARNER:
            return self.network
        kind, key = owner
        if kind == "pool":
            return self.pool[key]
        if kind == "frozen":
            return self.frozen_opponent
        return None

    # ------------------------------------------------------------------ hooks

    def _log_ratios(
        self,
        owner: Any,
        observations: torch.Tensor,
        masks: torch.Tensor,
        chosen: torch.Tensor,
        log_probs: torch.Tensor,
    ) -> Optional[List[float]]:
        """``log pi/pi_reg`` for each row of one owner's batch, or ``None`` to regularise nothing.

        PPO regularises nothing. `train_rnad.py` is the reason this is a seam rather than a branch:
        the ratio has to be measured against the acting policy, at the moment the action is taken,
        and there is exactly one place in the rollout where both are in hand. ``owner`` is passed
        because ``log_probs`` belongs to whichever network holds that seat, learner or snapshot.
        """
        return None

    def _regularise(self, index: int, seat: str, log_ratio: float) -> None:
        """Charge the acting seat and credit the rest of its table. A no-op without a ratio."""

    def _after_update(self) -> Dict[str, float]:
        """Anything the algorithm does between updates — the R-NaD fixed point lives here."""
        return {}

    # --------------------------------------------------------------- rollout

    def collect(self, rollout_steps: int) -> int:
        self.finished = []
        learner_steps = 0

        for _ in range(rollout_steps):
            by_owner: Dict[Any, List[int]] = defaultdict(list)
            for index, step in enumerate(self.steps):
                by_owner[self.owners[index][step.agent]].append(index)

            actions: Dict[int, int] = {}
            learner_records: Dict[int, Tuple[int, float, float]] = {}
            learner_ratios: Dict[int, float] = {}

            for owner, env_indices in by_owner.items():
                network = self._network_for(owner)
                if network is None:
                    agent = self.baselines[owner[1]]
                    for index in env_indices:
                        step = self.steps[index]
                        actions[index] = agent.act(
                            Decision(self.envs[index], step.agent, step.observation, step.action_mask)
                        )
                    continue

                observations = torch.as_tensor(
                    np.stack([self.steps[index].observation for index in env_indices]),
                    dtype=torch.float32,
                    device=self.device,
                )
                masks = torch.as_tensor(
                    np.stack([self.steps[index].action_mask for index in env_indices]),
                    device=self.device,
                )
                with torch.no_grad():
                    chosen, log_probs, _entropy, values = network.act(observations, masks)

                chosen_list = chosen.tolist()
                # Every network-backed seat, not only the learner: a frozen snapshot has a policy and
                # therefore a log-ratio, which is the whole reason a pool can be seated under R-NaD
                # where a scripted bot cannot.
                ratios = self._log_ratios(owner, observations, masks, chosen, log_probs)
                if owner == LEARNER:
                    log_list = log_probs.tolist()
                    value_list = values.tolist()
                    for position, index in enumerate(env_indices):
                        actions[index] = chosen_list[position]
                        learner_records[index] = (
                            chosen_list[position],
                            log_list[position],
                            value_list[position],
                        )
                else:
                    for position, index in enumerate(env_indices):
                        actions[index] = chosen_list[position]
                if ratios is not None:
                    for position, index in enumerate(env_indices):
                        learner_ratios[index] = ratios[position]

            for index, action in actions.items():
                step = self.steps[index]
                seat = step.agent

                if index in learner_records:
                    chosen, log_prob, value = learner_records[index]
                    self.open_traj[index][seat].append(
                        Transition(
                            observation=step.observation,
                            mask=step.action_mask,
                            action=chosen,
                            log_prob=log_prob,
                            value=value,
                            lie_label=(
                                self._lie_label(self.envs[index], seat)
                                if self.args.aux_lie_coef
                                else None
                            ),
                        )
                    )
                    learner_steps += 1

                # After any append, so a charge lands on the transition that earned it, and before
                # the environment's own rewards, which land in the same places. Outside the learner
                # branch because a snapshot seat is charged too — it just has nowhere to keep it, and
                # what matters is the credit that reaches everybody else.
                if index in learner_ratios:
                    self._regularise(index, seat, learner_ratios[index])

                next_step = self.envs[index].step(action)

                # A seat's reward lands on its own latest transition, however many other seats acted
                # in between. That is what makes GAE below run along the seat's trajectory.
                for reward_seat, reward in next_step.rewards.items():
                    trajectory = self.open_traj[index].get(reward_seat)
                    if trajectory:
                        trajectory[-1].reward += reward

                self.steps[index] = next_step
                if next_step.done:
                    self._close_episode(index, next_step)

        self._flush_open(bootstrap=True)
        return learner_steps

    def _close_episode(self, index: int, step) -> None:
        env = self.envs[index]
        for seat, trajectory in self.open_traj[index].items():
            if not trajectory:
                continue
            # Truncation is terminal here, not bootstrapped: the environment pays a defined,
            # standings-based payoff for it, precisely so that stalling cannot beat finishing. See
            # `RewardConfig` for what bootstrapping it did instead.
            trajectory[-1].terminated = True
            self.finished.append((trajectory, 0.0))

            if self.owners[index].get(seat) == LEARNER:
                self.recent_returns.append(sum(entry.reward for entry in trajectory))

        self.recent_truncations.append(int(step.truncated))
        self.recent_rounds.append(int(step.info.get("rounds", 0)))
        self.episodes_done += 1

        self.open_traj[index] = defaultdict(list)
        self.steps[index] = env.reset()
        self.owners[index] = self._assign_seats(env)

    def _flush_open(self, bootstrap: bool) -> None:
        """Cut every in-flight trajectory at the rollout boundary, bootstrapping from where it is.

        Every open seat's bootstrap goes through one forward pass. One call each was 22% of the whole
        rollout: a hundred single-row passes cost far more than the arithmetic in them.
        """
        pending: List[Tuple[List[Transition], np.ndarray]] = []
        for index, env in enumerate(self.envs):
            for seat, trajectory in list(self.open_traj[index].items()):
                if not trajectory:
                    continue
                pending.append((trajectory, env.observation_for(seat) if bootstrap else None))
            self.open_traj[index] = defaultdict(list)

        if not pending:
            return

        if not bootstrap:
            self.finished.extend((trajectory, 0.0) for trajectory, _ in pending)
            return

        values = self._values_of([observation for _trajectory, observation in pending])
        self.finished.extend(
            (trajectory, value) for (trajectory, _observation), value in zip(pending, values)
        )

    def _values_of(self, observations: Sequence[np.ndarray]) -> List[float]:
        if not observations:
            return []
        with torch.no_grad():
            tensor = torch.as_tensor(
                np.stack(observations), dtype=torch.float32, device=self.device
            )
            _logits, value = self.network(tensor)
        return value.tolist()

    def _value_of(self, observation: np.ndarray) -> float:
        return self._values_of([observation])[0]

    # ---------------------------------------------------------------- update

    def _batch(self) -> Optional[Dict[str, torch.Tensor]]:
        observations: List[np.ndarray] = []
        masks: List[np.ndarray] = []
        actions: List[int] = []
        log_probs: List[float] = []
        values: List[float] = []
        advantages: List[float] = []
        returns: List[float] = []
        lie_labels: List[float] = []
        lie_valid: List[bool] = []

        gamma, lam = self.args.gamma, self.args.gae_lambda

        for trajectory, bootstrap in self.finished:
            running = 0.0
            local_advantages = [0.0] * len(trajectory)
            for position in reversed(range(len(trajectory))):
                entry = trajectory[position]
                if position == len(trajectory) - 1:
                    next_value = bootstrap
                    non_terminal = 0.0 if entry.terminated else 1.0
                else:
                    next_value = trajectory[position + 1].value
                    non_terminal = 1.0
                delta = entry.reward + gamma * next_value * non_terminal - entry.value
                running = delta + gamma * lam * non_terminal * running
                local_advantages[position] = running

            for position, entry in enumerate(trajectory):
                observations.append(entry.observation)
                masks.append(entry.mask)
                actions.append(entry.action)
                log_probs.append(entry.log_prob)
                values.append(entry.value)
                advantages.append(local_advantages[position])
                returns.append(local_advantages[position] + entry.value)
                lie_labels.append(entry.lie_label if entry.lie_label is not None else 0.0)
                lie_valid.append(entry.lie_label is not None)

        if not observations:
            return None

        return {
            "observations": torch.as_tensor(np.stack(observations), dtype=torch.float32, device=self.device),
            "masks": torch.as_tensor(np.stack(masks), device=self.device),
            "actions": torch.as_tensor(actions, dtype=torch.long, device=self.device),
            "log_probs": torch.as_tensor(log_probs, dtype=torch.float32, device=self.device),
            "values": torch.as_tensor(values, dtype=torch.float32, device=self.device),
            "advantages": torch.as_tensor(advantages, dtype=torch.float32, device=self.device),
            "returns": torch.as_tensor(returns, dtype=torch.float32, device=self.device),
            "lie_labels": torch.as_tensor(lie_labels, dtype=torch.float32, device=self.device),
            "lie_valid": torch.as_tensor(lie_valid, dtype=torch.bool, device=self.device),
        }

    @staticmethod
    def _lie_label(env: BlowCowEnv, seat: str) -> Optional[float]:
        """Is the seat's current BS target lying? Ground truth, from the simulator.

        This is the one fact the whole game turns on and the one a policy has to *infer*: the
        observation carries what it needs — unaccounted trump, unseen cards, the target's face-down
        pile — but the inference is a hypergeometric argument, and a placement reward arriving forty
        decisions later is a very thin thread to learn it down. Supervising it directly costs nothing
        in self-play, where the cards are already in hand.
        """
        engine = env.engine
        if engine is None or not engine.round.trump_rank:
            return None
        target = engine._get_default_bs_target(seat)
        if target is None:
            return None
        play = engine._get_pending_play(target)
        if play is None:
            return None
        honest = all(engine._is_trump(card, engine.round.trump_rank) for card in play.cards)
        return 0.0 if honest else 1.0

    def _aux_loss(
        self, batch: Dict[str, torch.Tensor], chunk: torch.Tensor
    ) -> Tuple[torch.Tensor, Dict[str, float]]:
        """Binary cross-entropy on the transitions that had a BS target. Zero where none did."""
        if not self.args.aux_lie_coef:
            return torch.zeros((), device=self.device), {}

        labels = batch["lie_labels"][chunk]
        valid = batch["lie_valid"][chunk]
        if not bool(valid.any()):
            return torch.zeros((), device=self.device), {}

        logits = self.network.lie_logit(batch["observations"][chunk])[valid]
        targets = labels[valid]
        loss = nn.functional.binary_cross_entropy_with_logits(logits, targets)
        with torch.no_grad():
            accuracy = ((logits > 0).float() == targets).float().mean()
        return loss, {"lie_loss": float(loss), "lie_acc": float(accuracy)}

    def _policy_weight(self) -> float:
        """Zero while the critic warms up, one after.

        An advantage read off an untrained value head is noise with a bias in it, and the update that
        noise buys is usually harmless — a random policy has nothing to lose. The exception is a warm
        start, where the policy being wrecked is one that already worked: seeding this trainer from a
        Stage C checkpoint moved 3.5 nats away from it on the *first* update, before the critic had
        seen a single return. Training the critic alone first costs a few tens of thousands of
        decisions and removes that entirely.
        """
        return 0.0 if self.steps_done < self.args.value_warmup else 1.0

    def _losses(
        self, batch: Dict[str, torch.Tensor], chunk: torch.Tensor, advantages: torch.Tensor
    ) -> Tuple[torch.Tensor, Dict[str, float]]:
        """One minibatch's total loss, and what to log about it.

        Split out because it is the only part of the update that an algorithm change touches — the
        batching, the normalisation, the epochs and the clipping around it are the same either way.
        """
        new_log_probs, entropy, values = self.network.evaluate(
            batch["observations"][chunk], batch["masks"][chunk], batch["actions"][chunk]
        )

        ratio = (new_log_probs - batch["log_probs"][chunk]).exp()
        chunk_advantages = advantages[chunk]
        unclipped = ratio * chunk_advantages
        clipped = torch.clamp(ratio, 1 - self.args.clip, 1 + self.args.clip) * chunk_advantages
        policy_loss = -torch.min(unclipped, clipped).mean()

        value_loss = 0.5 * (values - batch["returns"][chunk]).pow(2).mean()
        entropy_loss = -entropy.mean()

        weight = self._policy_weight()
        aux_loss, aux_stats = self._aux_loss(batch, chunk)
        loss = (
            weight * policy_loss
            + self.args.value_coef * value_loss
            + weight * self.args.entropy_coef * entropy_loss
            + self.args.aux_lie_coef * aux_loss
        )

        with torch.no_grad():
            approx_kl = ((ratio - 1) - (new_log_probs - batch["log_probs"][chunk])).mean()
            stats = {
                "policy_loss": float(policy_loss),
                "value_loss": float(value_loss),
                "entropy": float(entropy.mean()),
                "approx_kl": float(approx_kl),
                **aux_stats,
            }
        return loss, stats

    def update(self) -> Dict[str, float]:
        batch = self._batch()
        if batch is None:
            return {}

        size = batch["observations"].shape[0]
        indices = np.arange(size)
        advantages = batch["advantages"]
        advantages = (advantages - advantages.mean()) / (advantages.std() + 1e-8)

        stats = defaultdict(float)
        batches = 0

        for _ in range(self.args.epochs):
            np.random.shuffle(indices)
            for start in range(0, size, self.args.minibatch):
                chunk = torch.as_tensor(
                    indices[start : start + self.args.minibatch], device=self.device
                )
                loss, chunk_stats = self._losses(batch, chunk, advantages)

                self.optimizer.zero_grad(set_to_none=True)
                loss.backward()
                nn.utils.clip_grad_norm_(self.network.parameters(), self.args.max_grad_norm)
                self.optimizer.step()

                for key, value in chunk_stats.items():
                    stats[key] += value
                batches += 1

        self.updates_done += 1
        return {key: value / max(1, batches) for key, value in stats.items()}

    # ------------------------------------------------------------------ loop

    def evaluate_against(self, opponents: Sequence[str], games: int) -> Dict[str, float]:
        """Seat the live network against a slate of opponents. No file round-trip.

        ``opponent`` is the frozen checkpoint itself, which in exploiter mode is the only number that
        matters: how far above zero a fresh learner can get against it is how exploitable it is.
        """
        from blowcow.agents import PolicyAgent

        self.network.eval()
        policy = PolicyAgent(self.network, self.device, name="policy")
        env = BlowCowEnv(
            player_counts=self.args.players,
            reward=RewardConfig(terminal=1.0, dense_points=0.0),
            seed=self.args.seed + 991,
            max_moves=self.args.max_moves,
        )

        scores: Dict[str, float] = {}
        for spec in opponents:
            if spec == "anchor":
                if self.eval_anchor is None:
                    continue
                bot = PolicyAgent(self.eval_anchor, self.device, name="anchor")
            elif spec == "opponent":
                if self.frozen_baseline:
                    bot = make_agent(self.frozen_baseline, seed=self.args.seed + 13)
                elif self.frozen_opponent is None:
                    continue
                else:
                    bot = PolicyAgent(self.frozen_opponent, self.device, name="opponent")
            else:
                bot = make_agent(spec, seed=self.args.seed + 13)
            total = 0.0
            truncated = 0
            for game_index in range(games):
                count = self.args.players[game_index % len(self.args.players)]
                line_up = [policy if index == 0 else bot for index in range(count)]
                result = play_match(env, line_up, count, game_index % count)
                placements = result["placements"]
                seat_ids = list(result["by_seat"].keys())
                place = placements.index(seat_ids[0])
                total += 1.0 - 2.0 * place / (count - 1)
                truncated += int(bool(result["truncated"]))
            scores[spec] = total / games
            scores[f"{spec}_trunc"] = truncated / games

        self.network.train()
        return scores

    def run(self) -> None:
        args = self.args
        self.best_eval = float("-inf")
        started = time.perf_counter()
        next_eval = args.eval_every
        next_snapshot = args.snapshot_every

        while self.steps_done < args.steps:
            learner_steps = self.collect(args.rollout)
            self.steps_done += learner_steps
            stats = self.update()
            stats.update(self._after_update())

            if self.steps_done >= next_snapshot:
                self._snapshot()
                next_snapshot += args.snapshot_every

            elapsed = time.perf_counter() - started
            record = {
                "step": self.steps_done,
                "episodes": self.episodes_done,
                "updates": self.updates_done,
                "sps": round(self.steps_done / max(1e-9, elapsed)),
                "return": round(float(np.mean(self.recent_returns)), 4) if self.recent_returns else 0.0,
                "truncated": round(float(np.mean(self.recent_truncations)), 3) if self.recent_truncations else 0.0,
                "rounds": round(float(np.mean(self.recent_rounds)), 1) if self.recent_rounds else 0.0,
                "pool": len(self.pool),
                **{key: round(value, 4) for key, value in stats.items()},
            }

            if self.steps_done >= next_eval:
                scores = self.evaluate_against(args.eval_opponents, args.eval_games)
                record.update({f"eval_{key}": round(value, 3) for key, value in scores.items()})
                next_eval += args.eval_every
                self.save(self.run_dir / "latest.pt")

                # **Keep the peak.** `runs/ppo-v1` topped out against `heuristic` at 1.5M steps and
                # finished at 2.5M worse than it had been at 500k, and because only `latest.pt` was
                # ever written and `final.pt` is simply the last step, that peak was unrecoverable —
                # the run could not even see it, since `--eval-games 40` carries a standard error of
                # about 0.15, which was the entire signal. So: one keep-forever file per evaluation,
                # and a `best.pt` chosen on the score rather than on the clock.
                # Scores only: `evaluate_against` also returns a `<spec>_trunc` rate per opponent,
                # and averaging a truncation fraction into a placement score would select on a
                # different quantity than the one being reported.
                only_scores = [value for key, value in scores.items() if not key.endswith("_trunc")]
                mean_score = float(np.mean(only_scores)) if only_scores else 0.0
                record["eval_mean"] = round(mean_score, 3)
                self.save(self.run_dir / f"eval-{self.steps_done}.pt")
                if mean_score > self.best_eval:
                    self.best_eval = mean_score
                    self.save(self.run_dir / "best.pt")
                    record["eval_best"] = True

            with self.log_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(record) + "\n")
            print(
                "  ".join(
                    f"{key}={value}"
                    for key, value in record.items()
                    if key in self.progress_keys or key.startswith("eval_")
                ),
                flush=True,
            )

        self.save(self.run_dir / "final.pt")
        final = self.evaluate_against(args.eval_opponents, max(args.eval_games, 100))
        print("\nfinal evaluation:")
        for key, value in final.items():
            print(f"  {key:<24} {value:+.3f}")
        (self.run_dir / "final_eval.json").write_text(json.dumps(final, indent=2))

    def _checkpoint(self) -> Dict[str, Any]:
        """What `save` writes. `PolicyAgent` needs ``model`` and ``net_kwargs``; the rest is context,
        and an algorithm that carries extra state extends this rather than re-reading the file."""
        return {
            "model": self.network.state_dict(),
            "net_kwargs": self.net_kwargs,
            "steps": self.steps_done,
            "observation_size": OBSERVATION_SIZE,
            "action_size": NUM_ACTIONS,
            # Which side of the ablation this is. Recorded because it cannot be recovered from the
            # weights or the args: it came from an environment variable, and a control checkpoint
            # evaluated as though it could read the lie columns is being asked about inputs it never
            # saw in training.
            "lie_feature": LIE_FEATURE_ENABLED,
        }

    def save(self, path: Path) -> None:
        torch.save(self._checkpoint(), path)


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
    parser.add_argument("--run", default="runs/ppo", help="output directory")
    parser.add_argument("--steps", type=int, default=1_000_000, help="learner decisions to train on")
    parser.add_argument("--players", type=parse_counts, default=list(DEFAULT_PLAYER_COUNTS))
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--device", default=None)

    parser.add_argument("--num-envs", type=int, default=64)
    parser.add_argument("--rollout", type=int, default=64, help="env steps per env per update")
    parser.add_argument("--max-moves", type=int, default=3000)

    parser.add_argument("--lr", type=float, default=3e-4)
    # Undiscounted on purpose. Episodes are finite and the reward that matters is the one at the end,
    # so any gamma below 1 pays an agent to make the match longer: at 0.997 a 500-decision match
    # discounts its own terminal +-1 down to a fifth, which is a direct incentive to stall. That
    # showed up in training as rounds climbing without limit.
    parser.add_argument("--gamma", type=float, default=1.0)
    parser.add_argument("--gae-lambda", type=float, default=0.98)
    parser.add_argument("--clip", type=float, default=0.2)
    parser.add_argument("--epochs", type=int, default=4)
    parser.add_argument("--minibatch", type=int, default=1024)
    parser.add_argument("--value-coef", type=float, default=0.5)
    parser.add_argument("--entropy-coef", type=float, default=0.01)
    parser.add_argument("--max-grad-norm", type=float, default=0.5)
    parser.add_argument("--aux-lie-coef", type=float, default=0.0,
                        help="weight on an auxiliary head predicting whether the current BS target "
                             "is lying. Supervised from the simulator during training only; the "
                             "head is never consulted at play time. 0 disables it entirely, "
                             "including the extra output, so checkpoints stay interchangeable")
    parser.add_argument("--value-warmup", type=int, default=0,
                        help="learner decisions during which only the critic trains; worth setting "
                             "whenever the policy is seeded from a checkpoint")
    parser.add_argument("--init", default=None,
                        help="checkpoint to continue training from. Takes its width from the file, "
                             "so a run resumed off a differently-sized network still loads")
    parser.add_argument("--eval-anchor", default=None,
                        help="checkpoint used as a fixed reference opponent, reported as "
                             "`eval_anchor`. Prefer this to `heuristic`, which ranks checkpoints "
                             "BACKWARDS: it calls BS on 76-84% of its chances, so it scores honesty "
                             "rather than strength and a policy learning to bluff well looks worse "
                             "against it every step. Set it to whatever `--init` resumed from and "
                             "the number reads as 'what has this training bought', zero for nothing")
    parser.add_argument("--init-value", default=None,
                        help="start from a critic trained on placement by rl/train_value.py. Copies "
                             "the encoders, trunk and value head; the policy heads keep their own "
                             "init. The PPO critic measures at 2.4x worse than a supervised one, so "
                             "this begins with a representation that already predicts the outcome")

    parser.add_argument("--hidden", type=int, default=256)
    parser.add_argument("--type-dim", type=int, default=64)

    parser.add_argument("--terminal-reward", type=float, default=1.0)
    parser.add_argument("--dense-reward", type=float, default=0.1)
    parser.add_argument("--truncation-penalty", type=float, default=1.0,
                        help="docked from every seat when a match hits the move limit")
    parser.add_argument("--step-cost", type=float, default=0.003,
                        help="charged to the acting seat per decision; the local argument against "
                             "a table that never resolves anything")

    parser.add_argument("--self-play-prob", type=float, default=0.5,
                        help="chance a whole table is the current policy")
    parser.add_argument("--pool-size", type=int, default=5)
    parser.add_argument("--snapshot-every", type=int, default=150_000)
    parser.add_argument("--baselines", nargs="*", default=["heuristic", "caller"],
                        help="scripted opponents that may be seated during training")
    parser.add_argument("--baseline-prob", type=float, default=0.25,
                        help="chance a non-learner seat is a scripted bot rather than a snapshot")

    parser.add_argument("--eval-every", type=int, default=200_000)
    parser.add_argument("--eval-games", type=int, default=300,
                        help="matches per eval opponent. NOT small: at 40 the standard error is "
                             "about 0.15, which was the size of the entire signal in runs/ppo-v1, "
                             "so the run could not see its own peak and selected nothing")
    parser.add_argument("--eval-opponents", nargs="+", default=["heuristic", "random"])

    parser.add_argument("--opponent", default=None,
                        help="frozen checkpoint to train against, or a baseline name "
                             "(random|honest|liar|caller|heuristic) to measure how exploitable "
                             "a handcrafted opponent is")
    parser.add_argument("--exploiter", action="store_true",
                        help="one learner against a full table of --opponent, to measure exploitability")
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    if args.exploiter and not args.opponent:
        raise SystemExit("--exploiter needs --opponent to point at a checkpoint.")
    if args.exploiter and "opponent" not in args.eval_opponents:
        # The only number an exploitability run is actually measuring.
        args.eval_opponents = ["opponent", *args.eval_opponents]
    Trainer(args).run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

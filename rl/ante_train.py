"""PPO self-play over one Ante round.

The reward is terminal and the episode is finite, which deletes most of what the classic trainer had
to be careful about:

* **No discounting and no GAE.** Every reward arrives at the end, `gamma` is 1, and the Monte-Carlo
  return for a seat is simply the gold it finished with. GAE at `lambda = 1` reduces to exactly that,
  so the advantage is `R - V(s)` with no bootstrap anywhere. The classic trainer's two stalling
  pathologies — bootstrapping an endogenous truncation, and any `gamma < 1` paying an agent to
  lengthen the match — cannot arise here, because the round cannot be lengthened and cannot fail to
  end.
* **No move limit and no truncation term.** See `ante/env.py`.

What is kept is the one thing that did matter: **opponents must not be only your current self.** Bluff
rate and call rate chase each other in a rock-paper-scissors cycle, so most episodes seat the learner
against snapshots taken earlier in training plus a share of scripted bots. Stage C was the only agent
in the classic work that was hard to best-respond to, and the population is the one lever the
evidence there actually supports.

Usage::

    python rl/ante_train.py --steps 2000000 --run rl/runs/ante-v1
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np  # noqa: E402
import torch  # noqa: E402
import torch.nn.functional as F  # noqa: E402

from ante.agents import BASELINES, make_agent  # noqa: E402
from ante.config import AnteConfig  # noqa: E402
from ante.env import AnteEnv, Decision  # noqa: E402
from ante.game import ENDING_ALL_PASS, ENDING_BS, ENDING_EMPTY_HAND  # noqa: E402
from ante.nets import AnteNet  # noqa: E402
from ante.spaces import CALL_BS_INDEX, PASS_INDEX  # noqa: E402

LEARNER = "learner"


# --------------------------------------------------------------------------- rollout buffer


@dataclass
class Transition:
    observation: np.ndarray
    mask: np.ndarray
    action: int
    log_probability: float
    value: float
    seat: int


@dataclass
class EpisodeStats:
    ending: str = ""
    learner_rewards: List[float] = field(default_factory=list)
    calls: int = 0
    call_opportunities: int = 0
    call_hits: int = 0
    call_would_have_hit: int = 0
    bluffs: int = 0
    discretionary_bluffs: int = 0
    discretionary_chances: int = 0
    plays: int = 0
    turns: int = 0


class Trainer:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.config = AnteConfig.for_players(args.players)
        self.device = torch.device(args.device)
        # Seeded before the network is built. Building first left the initial weights drawn from
        # torch's process-default generator, so `--seed` governed the environments, the seating and
        # the action sampling but not one parameter, and no run reproduced from its own manifest.
        # Numpy is seeded too, because the minibatch shuffle in `update` uses its global generator.
        self.rng = random.Random(args.seed)
        torch.manual_seed(args.seed)
        np.random.seed(args.seed & 0xFFFFFFFF)
        self.net = AnteNet(self.config, hidden=args.hidden, type_dim=args.type_dim).to(self.device)
        if args.init:
            # Continue a run rather than start one. Safe here in a way it was not for R-NaD, where a
            # warm policy against an untrained critic moved 3.5 nats on the first update: this loads
            # the value head out of the same checkpoint, so the advantages are as well-founded on
            # step one as they were on the last step of the run being continued.
            checkpoint = torch.load(args.init, map_location=self.device, weights_only=False)
            self.net.load_state_dict(checkpoint["model"])
            print(f"initialised from {args.init} at {checkpoint.get('steps', '?')} steps", flush=True)
        self.optimizer = torch.optim.Adam(self.net.parameters(), lr=args.lr, eps=1e-5)

        self.pool: List[Dict[str, torch.Tensor]] = []
        self.pool_nets: List[AnteNet] = []
        self.baselines = {
            name: make_agent(name, self.config, seed=args.seed + index)
            for index, name in enumerate(args.baselines)
        }
        self.opponent = (
            make_agent(args.opponent, self.config, seed=args.seed + 31) if args.opponent else None
        )
        if args.exploiter and self.opponent is None:
            raise SystemExit("--exploiter needs --opponent to say what it is exploiting")
        # A frozen checkpoint fills four of the five seats in an exploiter run, so it is asked for a
        # move far more often than the learner is. Lifted out of its agent wrapper and driven like a
        # pool snapshot so those calls batch into one forward instead of ~77 of them per step.
        self.opponent_net: Optional[AnteNet] = None
        if self.opponent is not None and hasattr(self.opponent, "net"):
            self.opponent_net = self.opponent.net.to(self.device)
            self.opponent_net.eval()

        # Checkpoints the population starts with, and never evicts. The one lever the classic work's
        # evidence actually supports is the opposition: an agent that only ever meets itself and its
        # own past never has to answer for a habit its copies share. Seeding the pool with agents
        # trained under a *different* seed puts a genuinely different strategy in front of it —
        # `rl/ANTE.md` records two seeds that converged on never bluffing and on bluffing a quarter
        # of the time, and each beats the other's yardstick.
        self.permanent_pool = 0
        for path in args.pool_init or []:
            frozen = make_agent(f"ckpt:{path}", self.config, seed=args.seed)
            net = frozen.net.to(self.device)
            net.eval()
            self.pool_nets.append(net)
            self.pool.append({})
            self.permanent_pool += 1

        self.envs = [AnteEnv(self.config, seed=args.seed * 7919 + index) for index in range(args.num_envs)]
        self.decisions: List[Decision] = [env.reset() for env in self.envs]
        self.buffers: List[List[Transition]] = [[] for _ in self.envs]
        self.stats: List[EpisodeStats] = [EpisodeStats() for _ in self.envs]
        self.seat_actors: List[List[Any]] = [self._assign_seats() for _ in self.envs]

        self.run = Path(args.run)
        self.run.mkdir(parents=True, exist_ok=True)
        (self.run / "args.json").write_text(json.dumps(vars(args), indent=2), encoding="utf-8")
        self.log_path = self.run / "log.jsonl"
        self.steps = 0
        self.recent: deque = deque(maxlen=400)

    # ----------------------------------------------------------------- seating

    def _assign_seats(self) -> List[Any]:
        """One actor per seat. At least one is the learner, so every episode teaches something."""
        if self.args.exploiter:
            # Exactly one learner seat against a table of the frozen target. Self-play win rate is
            # self-deluding in a bluffing game, so the only measurement that means anything is to
            # freeze an agent and train a fresh learner specifically against it: a policy that played
            # exactly like the target would score 0, and whatever it reaches above that is a lower
            # bound on how exploitable the target is, indexed by the budget it was given.
            assert self.opponent is not None
            seat: Any = ("frozen", 0) if self.opponent_net is not None else self.opponent
            actors = [seat] * self.config.num_players
            actors[self.rng.randrange(self.config.num_players)] = LEARNER
            return actors

        actors: List[Any] = []
        for _ in range(self.config.num_players):
            roll = self.rng.random()
            if roll < self.args.self_play_prob or not (self.pool_nets or self.baselines):
                actors.append(LEARNER)
            elif roll < self.args.self_play_prob + self.args.baseline_prob and self.baselines:
                actors.append(self.baselines[self.rng.choice(sorted(self.baselines))])
            elif self.pool_nets:
                actors.append(("pool", self.rng.randrange(len(self.pool_nets))))
            else:
                actors.append(LEARNER)

        if LEARNER not in actors:
            actors[self.rng.randrange(len(actors))] = LEARNER
        return actors

    # ----------------------------------------------------------------- acting

    @torch.no_grad()
    def _forward(self, net: AnteNet, decisions: Sequence[Decision]) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        observations = torch.from_numpy(np.stack([d.observation for d in decisions])).to(self.device)
        masks = torch.from_numpy(np.stack([d.action_mask for d in decisions])).to(self.device)
        logits, values = net.policy(observations, masks)
        probabilities = F.softmax(logits, dim=-1)
        actions = torch.multinomial(probabilities, 1).squeeze(-1)
        log_probabilities = torch.log(probabilities.gather(-1, actions.unsqueeze(-1)).squeeze(-1) + 1e-12)
        return (
            actions.cpu().numpy(),
            log_probabilities.cpu().numpy(),
            values.cpu().numpy(),
        )

    def collect(self, target: int) -> Tuple[List[Transition], List[float], List[EpisodeStats]]:
        """Gather at least ``target`` learner transitions, all from episodes that finished."""
        transitions: List[Transition] = []
        returns: List[float] = []
        finished: List[EpisodeStats] = []

        while len(transitions) < target:
            groups: Dict[Any, List[int]] = {}
            for index, decision in enumerate(self.decisions):
                actor = self.seat_actors[index][decision.seat]
                key = actor if isinstance(actor, str) else (actor if isinstance(actor, tuple) else id(actor))
                groups.setdefault(key, []).append(index)

            chosen: Dict[int, int] = {}
            for key, indices in groups.items():
                if key == LEARNER:
                    actions, log_probabilities, values = self._forward(
                        self.net, [self.decisions[index] for index in indices]
                    )
                    for offset, index in enumerate(indices):
                        decision = self.decisions[index]
                        chosen[index] = int(actions[offset])
                        self.buffers[index].append(
                            Transition(
                                observation=decision.observation,
                                mask=decision.action_mask,
                                action=int(actions[offset]),
                                log_probability=float(log_probabilities[offset]),
                                value=float(values[offset]),
                                seat=decision.seat,
                            )
                        )
                elif isinstance(key, tuple):
                    net = self.opponent_net if key[0] == "frozen" else self.pool_nets[key[1]]
                    assert net is not None
                    actions, _, _ = self._forward(net, [self.decisions[index] for index in indices])
                    for offset, index in enumerate(indices):
                        chosen[index] = int(actions[offset])
                else:
                    for index in indices:
                        agent = self.seat_actors[index][self.decisions[index].seat]
                        chosen[index] = int(agent.act(self.decisions[index]))

            for index, action in chosen.items():
                self._record_behaviour(index, action)
                self.decisions[index] = self.envs[index].step(action)
                if self.decisions[index].terminated:
                    finished.append(self._finish(index, transitions, returns))

        return transitions, returns, finished

    def _record_behaviour(self, index: int, action: int) -> None:
        """Behavioural counters, taken with ground truth so the diagnosis is not a guess.

        `call discrimination` — the hit rate minus the base rate of lies among the opportunities the
        agent saw — is the number the classic work identified as the skill the learned agents did not
        have. It is measured here for the learner's seats only.
        """
        decision = self.decisions[index]
        if self.seat_actors[index][decision.seat] is not LEARNER:
            return
        game = decision.game
        assert game is not None
        stats = self.stats[index]
        target = game.bs_target()

        if target is not None:
            stats.call_opportunities += 1
            was_a_lie = not game.claim_was_honest(target)
            if was_a_lie:
                stats.call_would_have_hit += 1
            if action == CALL_BS_INDEX:
                stats.calls += 1
                if was_a_lie:
                    stats.call_hits += 1

        if action not in (PASS_INDEX, CALL_BS_INDEX):
            stats.plays += 1
            semantic = self.envs[index].space.decompose(action)
            trump = semantic[1] if semantic[1] is not None else game.trump
            joker = self.config.joker_type
            honest = all(card_type in (joker, trump) for card_type in semantic[2])
            holds_trump = game.hands[game.current][joker] > 0 or (
                trump is not None and trump != self.config.off_deck_trump and game.hands[game.current][trump] > 0
            )
            if not honest:
                stats.bluffs += 1
            # A player with no trump has to lie or pass; that is arithmetic, not bluffing. Only a lie
            # told with a trump card in hand is a choice.
            if holds_trump and game.trump is not None:
                stats.discretionary_chances += 1
                if not honest:
                    stats.discretionary_bluffs += 1

    def _finish(self, index: int, transitions: List[Transition], returns: List[float]) -> EpisodeStats:
        decision = self.decisions[index]
        rewards = decision.rewards
        stats = self.stats[index]
        stats.ending = decision.info["ending"]
        stats.turns = decision.info["turns"]

        for transition in self.buffers[index]:
            transitions.append(transition)
            returns.append(float(rewards[transition.seat]))
        for seat, actor in enumerate(self.seat_actors[index]):
            if actor is LEARNER:
                stats.learner_rewards.append(float(rewards[seat]))

        self.buffers[index] = []
        self.stats[index] = EpisodeStats()
        self.seat_actors[index] = self._assign_seats()
        self.decisions[index] = self.envs[index].reset()
        return stats

    # ----------------------------------------------------------------- learning

    def update(self, transitions: List[Transition], returns: List[float]) -> Dict[str, float]:
        observations = torch.from_numpy(np.stack([t.observation for t in transitions])).to(self.device)
        masks = torch.from_numpy(np.stack([t.mask for t in transitions])).to(self.device)
        actions = torch.tensor([t.action for t in transitions], dtype=torch.long, device=self.device)
        old_log = torch.tensor([t.log_probability for t in transitions], dtype=torch.float32, device=self.device)
        old_value = torch.tensor([t.value for t in transitions], dtype=torch.float32, device=self.device)
        target = torch.tensor(returns, dtype=torch.float32, device=self.device)

        advantage = target - old_value
        if self.args.normalise_advantage:
            advantage = (advantage - advantage.mean()) / (advantage.std() + 1e-8)

        size = observations.shape[0]
        indices = np.arange(size)
        metrics = {"policy_loss": 0.0, "value_loss": 0.0, "entropy": 0.0, "clip_fraction": 0.0}
        batches = 0

        for _ in range(self.args.epochs):
            np.random.shuffle(indices)
            for start in range(0, size, self.args.minibatch):
                batch = torch.from_numpy(indices[start : start + self.args.minibatch]).to(self.device)
                logits, values = self.net.policy(observations[batch], masks[batch])
                log_probabilities = F.log_softmax(logits, dim=-1)
                chosen = log_probabilities.gather(-1, actions[batch].unsqueeze(-1)).squeeze(-1)
                ratio = torch.exp(chosen - old_log[batch])

                clipped = torch.clamp(ratio, 1.0 - self.args.clip, 1.0 + self.args.clip)
                policy_loss = -torch.min(ratio * advantage[batch], clipped * advantage[batch]).mean()
                value_loss = F.mse_loss(values, target[batch])

                probabilities = log_probabilities.exp()
                entropy = -(probabilities * log_probabilities.masked_fill(~masks[batch], 0.0)).sum(-1).mean()

                loss = policy_loss + self.args.value_coef * value_loss - self.args.entropy_coef * entropy
                self.optimizer.zero_grad(set_to_none=True)
                loss.backward()
                torch.nn.utils.clip_grad_norm_(self.net.parameters(), self.args.max_grad_norm)
                self.optimizer.step()

                metrics["policy_loss"] += float(policy_loss.item())
                metrics["value_loss"] += float(value_loss.item())
                metrics["entropy"] += float(entropy.item())
                metrics["clip_fraction"] += float(((ratio - 1.0).abs() > self.args.clip).float().mean().item())
                batches += 1

        for key in metrics:
            metrics[key] /= max(1, batches)
        metrics["explained_variance"] = float(
            1.0 - ((target - old_value).var() / (target.var() + 1e-8)).item()
        )
        return metrics

    # ----------------------------------------------------------------- evaluation

    @torch.no_grad()
    def evaluate(self, opponent: str, games: int) -> Dict[str, float]:
        """One learner seat against a table of ``opponent``, seats rotated.

        Rotated because seat 0 opens the round and the last seat in turn order takes a free round if
        everyone passes — the positions are not symmetric, and an unrotated score would measure the
        chair as much as the policy.
        """
        env = AnteEnv(self.config, seed=self.args.seed + 1_000_003)
        others = [make_agent(opponent, self.config, seed=self.args.seed + index) for index in range(self.config.num_players)]
        total = 0.0
        wins = 0
        for game_index in range(games):
            learner_seat = game_index % self.config.num_players
            decision = env.reset()
            while not decision.terminated:
                if decision.seat == learner_seat:
                    actions, _, _ = self._forward(self.net, [decision])
                    action = int(actions[0])
                else:
                    action = int(others[decision.seat].act(decision))
                decision = env.step(action)
            total += float(decision.rewards[learner_seat])
            wins += int(decision.info["winner"] == learner_seat)
        return {"score": total / games, "win_rate": wins / games}

    # ----------------------------------------------------------------- loop

    def snapshot(self) -> None:
        state = {key: value.detach().clone() for key, value in self.net.state_dict().items()}
        self.pool.append(state)
        net = AnteNet(self.config, hidden=self.args.hidden, type_dim=self.args.type_dim).to(self.device)
        net.load_state_dict(state)
        net.eval()
        self.pool_nets.append(net)
        # Evict the oldest *snapshot*; anything from `--pool-init` stays for the whole run.
        if len(self.pool_nets) > self.args.pool_size + self.permanent_pool:
            self.pool_nets.pop(self.permanent_pool)
            self.pool.pop(self.permanent_pool)

    def save(self, name: str) -> None:
        torch.save(
            {
                "model": self.net.state_dict(),
                "config": {"num_players": self.config.num_players, "num_ranks": self.config.num_ranks},
                "hidden": self.args.hidden,
                "type_dim": self.args.type_dim,
                "steps": self.steps,
            },
            self.run / name,
        )

    def train(self) -> None:
        started = time.time()
        next_snapshot = self.args.snapshot_every
        next_eval = self.args.eval_every

        while self.steps < self.args.steps:
            transitions, returns, episodes = self.collect(self.args.rollout)
            self.steps += len(transitions)
            metrics = self.update(transitions, returns)
            self.recent.extend(episodes)

            record: Dict[str, Any] = {
                "step": self.steps,
                "elapsed": round(time.time() - started, 1),
                "decisions_per_s": round(self.steps / max(1e-6, time.time() - started)),
                **{key: round(value, 4) for key, value in metrics.items()},
                **self._behaviour_summary(),
            }

            if self.steps >= next_snapshot:
                self.snapshot()
                next_snapshot += self.args.snapshot_every
                record["pool"] = len(self.pool_nets)

            if self.steps >= next_eval:
                for opponent in self.args.eval_opponents:
                    result = self.evaluate(opponent, self.args.eval_games)
                    record[f"eval_{opponent}"] = round(result["score"], 3)
                    record[f"eval_{opponent}_win"] = round(result["win_rate"], 3)
                self.save(f"eval-{self.steps}.pt")
                next_eval += self.args.eval_every

            self.save("latest.pt")
            with self.log_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(record) + "\n")
            print(" ".join(f"{key}={value}" for key, value in record.items()), flush=True)

        self.save("final.pt")

    def _behaviour_summary(self) -> Dict[str, float]:
        if not self.recent:
            return {}
        rewards = [reward for stats in self.recent for reward in stats.learner_rewards]
        opportunities = sum(stats.call_opportunities for stats in self.recent)
        calls = sum(stats.calls for stats in self.recent)
        hits = sum(stats.call_hits for stats in self.recent)
        lies_available = sum(stats.call_would_have_hit for stats in self.recent)
        chances = sum(stats.discretionary_chances for stats in self.recent)
        endings = {name: 0 for name in (ENDING_BS, ENDING_ALL_PASS, ENDING_EMPTY_HAND)}
        for stats in self.recent:
            endings[stats.ending] = endings.get(stats.ending, 0) + 1

        summary = {
            "score": round(float(np.mean(rewards)) if rewards else 0.0, 3),
            "turns": round(float(np.mean([stats.turns for stats in self.recent])), 1),
            "call%": round(100.0 * calls / max(1, opportunities), 1),
            "bluff%": round(
                100.0
                * sum(stats.discretionary_bluffs for stats in self.recent)
                / max(1, chances),
                1,
            ),
        }
        if calls:
            # hit rate minus the base rate of lies in the opportunities seen: how much better than
            # chance the agent picks its challenges. This is the skill, and it is the one the classic
            # agents never acquired.
            summary["call_disc"] = round(
                100.0 * hits / calls - 100.0 * lies_available / max(1, opportunities), 1
            )
        summary["end"] = "/".join(str(endings[name]) for name in (ENDING_BS, ENDING_ALL_PASS, ENDING_EMPTY_HAND))
        return summary


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--steps", type=int, default=1_000_000, help="Learner decisions")
    parser.add_argument("--run", default="rl/runs/ante-v1")
    parser.add_argument("--players", type=int, default=5)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    parser.add_argument(
        "--init",
        default=None,
        help="Checkpoint to start the policy and value head from, for continuing a run.",
    )

    parser.add_argument("--num-envs", type=int, default=96)
    parser.add_argument("--rollout", type=int, default=4096, help="Learner transitions per update")
    parser.add_argument("--minibatch", type=int, default=1024)
    parser.add_argument("--epochs", type=int, default=4)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--clip", type=float, default=0.2)
    parser.add_argument("--value-coef", type=float, default=0.5)
    parser.add_argument("--entropy-coef", type=float, default=0.01)
    parser.add_argument("--max-grad-norm", type=float, default=0.5)
    parser.add_argument("--normalise-advantage", action="store_true", default=True)

    parser.add_argument("--hidden", type=int, default=256)
    parser.add_argument("--type-dim", type=int, default=32)

    parser.add_argument("--self-play-prob", type=float, default=0.45)
    parser.add_argument("--baseline-prob", type=float, default=0.25)
    parser.add_argument("--pool-size", type=int, default=8, help="Snapshots kept, beyond --pool-init")
    parser.add_argument(
        "--pool-init",
        nargs="*",
        default=None,
        help="Checkpoint paths seated in the opponent pool for the whole run and never evicted.",
    )
    parser.add_argument("--snapshot-every", type=int, default=150_000)
    parser.add_argument(
        "--baselines",
        nargs="*",
        default=["heuristic", "caller", "honest", "random"],
        choices=sorted(BASELINES),
    )

    parser.add_argument(
        "--opponent",
        default=None,
        help="A baseline name or ckpt:<path>. With --exploiter it fills every non-learner seat.",
    )
    parser.add_argument(
        "--exploiter",
        action="store_true",
        help="Train one learner seat against a table of --opponent; the score it reaches is a "
        "lower bound on how exploitable that opponent is, at this budget.",
    )
    parser.add_argument("--eval-every", type=int, default=200_000)
    parser.add_argument("--eval-games", type=int, default=400)
    parser.add_argument("--eval-opponents", nargs="*", default=["heuristic", "random"])
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.exploiter and args.opponent:
        # The only score an exploiter run is about is the one against its target.
        args.eval_opponents = [args.opponent]
    Trainer(args).train()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

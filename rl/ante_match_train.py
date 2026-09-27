"""PPO self-play over a whole Ante match.

`rl/ante_train.py` is the one-round trainer and is left **byte-identical** on purpose: it is the
control every result here is read against, and a shared file that drifted would quietly invalidate
the comparison. Three things genuinely differ, and they are the reason this is a second file rather
than a flag.

**Reward arrives many times, so returns need GAE.** One round pays out once and the Monte-Carlo
return is the gold; a match pays out every five to ten decisions, twenty times over. A seat's
trajectory is therefore a proper multi-step problem, and `--gae-lambda` is the dial that says how far
credit is allowed to travel: at `1.0` a decision in round 1 is credited with the whole match, at
`0.0` only with its own round plus the value function's opinion. That dial is the direct heir of the
classic work's diagnosis — see `rl/README.md` — so it is exposed rather than fixed, and the default
of `0.95` is a compromise that leans toward the short horizon that made the subgame work.

**The value head has to reach further than ±1.** `AnteNet` bounds it with a `tanh`, which was exactly
right when a round paid `{-1, 0, +1}`. Over a match the bound is the number of rounds, so
`value_scale` is set to it; left at 1 the head saturates on the first good match and flattens every
advantage behind it.

**The behavioural counters ask a new question.** The one-round agent's measured failure is opponent
modelling (`rl/ANTE.md`), so the number that matters here is not the call rate but `call_split`: how
much *more* often the agent challenges a seat with a bad honesty record than a seat with a good one.
That is the whole point of the match block, stated as a measurement.

Usage::

    python rl/ante_match_train.py --steps 3000000 --run rl/runs/m-ante-v1
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

from ante.agents import BASELINES  # noqa: E402
from ante.config import DEFAULT_RECENT_EVENTS, AnteConfig, lap_events  # noqa: E402
from ante.match import MatchConfig  # noqa: E402
from ante.match_agents import make_match_agent  # noqa: E402
from ante.match_env import AnteMatchEnv, MatchDecision  # noqa: E402
from ante.match_observation import NO_RECORD_FEATURES  # noqa: E402
from ante.nets import AnteNet, infer_head_options, load_round_weights  # noqa: E402
from ante.spaces import CALL_BS_INDEX, PASS_INDEX  # noqa: E402

LEARNER = "learner"


def _auc(scores: np.ndarray, labels: np.ndarray) -> float:
    """Rank AUC, ties averaged. 0.5 is no signal. Used to log the honesty head against the truth."""
    positives = int(labels.sum())
    negatives = len(labels) - positives
    if positives == 0 or negatives == 0:
        return float("nan")
    order = np.argsort(scores, kind="mergesort")
    ranks = np.empty(len(scores), dtype=np.float64)
    ranks[order] = np.arange(1, len(scores) + 1)
    return float((ranks[labels == 1].sum() - positives * (positives + 1) / 2) / (positives * negatives))


# --------------------------------------------------------------------------- rollout buffer


@dataclass
class Transition:
    observation: np.ndarray
    mask: np.ndarray
    action: int
    log_probability: float
    value: float
    seat: int
    advantage: float = 0.0
    target: float = 0.0
    #: 1.0 if the live `Call BS` target was lying, 0.0 if honest, -1.0 if there was no target. Read
    #: off ground truth at collection time, which costs nothing — `_record_behaviour` already reads it
    #: for the call counters. It supervises a head, never an observation.
    lie_label: float = -1.0
    #: 1.0 if the play made at this decision was challenged before the round ended, 0.0 if it stood,
    #: -1.0 if the decision was a `Pass` or a `Call BS` and so made no play to challenge. Unlike the
    #: honesty label this one is **deferred**: whether a play is challenged is not known when it is
    #: made, so it is written back onto the transition when the challenge lands. Default 0.0 is
    #: therefore assigned at the play and only ever raised to 1.0 — a play nobody challenges keeps
    #: the label it was born with, which is the correct one.
    challenge_label: float = -1.0


@dataclass
class MatchStats:
    """One finished match, from the learner's seats."""

    rounds: int = 0
    gold: List[float] = field(default_factory=list)
    placement: List[float] = field(default_factory=list)
    # The seats the learner is *not* in, from the same matches. Gold is censored in a match — you
    # cannot lose more than you hold, because reaching zero ends your game — so an exploiter that is
    # being crushed bottoms out at `-StartingGold` and stops reporting how badly. Placement does not
    # censor, and the difference between these two lists is a reference-free exploitability number:
    # one policy in every chair would score zero by symmetry, whatever the endings did.
    other_gold: List[float] = field(default_factory=list)
    other_placement: List[float] = field(default_factory=list)
    endings: Dict[str, int] = field(default_factory=dict)
    calls: int = 0
    call_opportunities: int = 0
    call_hits: int = 0
    call_would_have_hit: int = 0
    # The measurement this layer exists for: challenges split by what the record said about the
    # target. A one-round agent cannot move these apart, because it has no record to read.
    calls_vs_suspect: int = 0
    chances_vs_suspect: int = 0
    calls_vs_trusted: int = 0
    chances_vs_trusted: int = 0
    lies_vs_suspect: int = 0
    lies_vs_trusted: int = 0
    bluffs: int = 0
    discretionary_bluffs: int = 0
    discretionary_chances: int = 0


def resolve_recent_events(args: argparse.Namespace) -> int:
    """``--recent-events``: an integer, or ``lap`` for a window that covers a lap of the table.

    Returns the default when the flag is absent, so a run that does not mention it trains the network
    every checkpoint in `rl/runs/` was trained as.
    """
    setting = getattr(args, "recent_events", None)
    if setting is None:
        return DEFAULT_RECENT_EVENTS
    if str(setting) == "lap":
        return lap_events(args.players)
    return int(setting)


def checkpoint_recent_events(checkpoint: Dict[str, Any]) -> int:
    """The window a saved checkpoint was trained at. Absent means it predates the field, so default."""
    return int((checkpoint.get("config") or {}).get("recent_events", DEFAULT_RECENT_EVENTS))


class Trainer:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.shape = AnteConfig.for_players(args.players, recent_events=resolve_recent_events(args))
        self.config = MatchConfig(
            shape=self.shape,
            round_limit=args.rounds,
            starting_gold=args.gold,
            disclosure=args.disclosure,
        )
        self.device = torch.device(args.device)

        probe = AnteMatchEnv(self.config)
        self.extra_width = probe.extra_width
        # The exact bound on a return: each round moves at most one gold, and placement lands once.
        self.value_scale = abs(args.gold_weight) * args.rounds + abs(args.placement_weight)

        # Seeded **before** the network is built, which is the whole point of the ordering. Building
        # first left the initial weights drawn from torch's process-default generator, so `--seed`
        # governed the environments, the seating and the action sampling but not a single parameter,
        # and no run could be reproduced from its own manifest. Numpy is seeded too, because the
        # minibatch shuffle in `update` runs on its global generator.
        self.rng = random.Random(args.seed)
        torch.manual_seed(args.seed)
        np.random.seed(args.seed & 0xFFFFFFFF)

        self.net = AnteNet(
            self.shape,
            hidden=args.hidden,
            type_dim=args.type_dim,
            extra_width=self.extra_width,
            value_scale=self.value_scale,
            lie_head=args.lie_coef > 0.0,
            lie_to_policy=args.lie_to_policy,
            challenge_head=args.challenge_coef > 0.0,
        ).to(self.device)
        if args.init and args.resume:
            raise SystemExit("--init starts a new run from a policy; --resume continues one. Not both.")
        if args.init:
            checkpoint = torch.load(args.init, map_location=self.device, weights_only=False)
            # A one-round checkpoint is padded rather than refused: see `load_round_weights`. It makes
            # the network *exactly* the one-round agent at step zero, so anything gained afterwards is
            # the match layer rather than the extra training the one-round lineage had.
            width = checkpoint.get("extra_width", 0)
            kind = "one-round" if width == 0 else "match"
            # Refused rather than padded. `load_round_weights` zero-pads the *right* of the first
            # trunk layer, which is exactly right for the match block — it is appended. A wider event
            # window is not appended: it grows the round block in the middle, so padding on the right
            # would slide every seat and match column onto the wrong inputs and train on nonsense
            # without erroring. Nothing needs that today, since the window experiment's arms train
            # from scratch against a common pool; a remap belongs here if one ever ships.
            saved_window = checkpoint_recent_events(checkpoint)
            if saved_window != self.shape.recent_events:
                raise SystemExit(
                    f"{args.init} was trained with an event window of {saved_window}, not "
                    f"{self.shape.recent_events}. Warm-starting across window widths would need a "
                    "column remap, not the right-hand padding load_round_weights does."
                )
            # The value head is reset because a *round* checkpoint predicts a different quantity —
            # a return in {-1, 0, +1} read through `1.0 * tanh`, against a match return read through
            # `value_scale * tanh`. That reasoning does not apply to a **match** checkpoint trained
            # at the same scale: there the critic already answers this exact question, and it is the
            # part that takes longest to fit (`explained_variance` reaches ~0.5 over 2M decisions).
            # Throwing it away would make a generational warm start start blind for no reason.
            same_question = (
                width == self.net.extra_width
                and abs(float(checkpoint.get("value_scale", 0.0)) - self.value_scale) < 1e-6
            )
            load_round_weights(self.net, checkpoint["model"], reset_value_head=not same_question)
            print(
                f"initialised from a {kind} checkpoint {args.init} "
                f"at {checkpoint.get('steps', '?')} steps"
                + (
                    f" (value head carried over at scale {self.value_scale:g})"
                    if same_question
                    else " (value head reset)"
                ),
                flush=True,
            )
        self.optimizer = torch.optim.Adam(self.net.parameters(), lr=args.lr, eps=1e-5)
        self._resumed: Optional[Dict[str, Any]] = None
        if args.resume:
            self._resumed = self._restore(args.resume)

        self.pool: List[Dict[str, torch.Tensor]] = []
        self.pool_nets: List[AnteNet] = []
        self.baselines = {
            name: make_match_agent(name, self.config, seed=args.seed + index)
            for index, name in enumerate(args.baselines)
        }
        self.opponent = (
            make_match_agent(args.opponent, self.config, seed=args.seed + 31) if args.opponent else None
        )
        if args.exploiter and self.opponent is None:
            raise SystemExit("--exploiter needs --opponent to say what it is exploiting")
        self.opponent_net: Optional[AnteNet] = None
        self.opponent_width = self.net.observation_size
        self.opponent_blind: List[int] = []
        if self.opponent is not None and hasattr(self.opponent, "net"):
            self.opponent_net = self.opponent.net.to(self.device)
            self.opponent_net.eval()
            self.opponent_width = self.opponent.width
            self.opponent_blind = list(getattr(self.opponent, "_blind", []))
            if self.opponent_blind:
                print(
                    f"the target was trained without the opponent record; blinding "
                    f"{len(self.opponent_blind)} columns for it",
                    flush=True,
                )

        self.permanent_pool = 0
        for path in args.pool_init or []:
            # A bare path is a match policy, as it always was; `round:` seats a one-round checkpoint,
            # which is the only kind of genuinely different strategy this repo has more than one of.
            # `norecord:` is refused rather than accepted: the pool is driven through `_forward`,
            # which blinds only the `--exploiter` target, so an ablation seated here would be fed the
            # very columns it was trained to see as zero.
            spec = path if path.startswith(("ckpt:", "round:", "norecord:")) else f"ckpt:{path}"
            if spec.startswith("norecord:"):
                raise SystemExit(
                    f"--pool-init cannot seat {path}: a pooled opponent is not blinded, so an "
                    "ablation checkpoint would play out of distribution"
                )
            frozen = make_match_agent(spec, self.config, seed=args.seed)
            # Same reason, one layer down. A pooled opponent is driven through `_forward`, which
            # slices this environment's observation to the opponent's width — so a checkpoint trained
            # at a different event window would be handed a vector whose seat and match columns have
            # moved. `MatchCheckpointAgent` re-encodes for exactly this case, but the pool bypasses
            # `act` and uses the bare network, so it is refused here rather than silently mis-fed.
            frozen_window = getattr(frozen.net.config, "recent_events", DEFAULT_RECENT_EVENTS)
            if frozen_window != self.shape.recent_events:
                raise SystemExit(
                    f"--pool-init cannot seat {path}: it was trained with an event window of "
                    f"{frozen_window}, not {self.shape.recent_events}, and a pooled opponent is fed "
                    "this run's observation directly"
                )
            net = frozen.net.to(self.device)
            net.eval()
            self.pool_nets.append(net)
            self.pool.append({})
            self.permanent_pool += 1

        # Restored before the seats are assigned, since `_assign_seats` reads the pool. A resumed run
        # that started with an empty pool would spend `pool_size * snapshot_every` steps playing a
        # different opponent distribution from the run it is continuing, which for a replication is
        # the one thing that must not happen.
        if self._resumed is not None:
            self._restore_pool(self._resumed)

        self.envs = [
            AnteMatchEnv(
                self.config,
                seed=args.seed * 7919 + index,
                gold_weight=args.gold_weight,
                placement_weight=args.placement_weight,
            )
            for index in range(args.num_envs)
        ]
        self.decisions: List[MatchDecision] = [env.reset() for env in self.envs]
        self.buffers: List[Dict[int, List[Transition]]] = [{} for _ in self.envs]
        self.pending: List[Dict[int, List[float]]] = [{} for _ in self.envs]
        # The learner transition whose play is currently the one a `Call BS` would land on, per env,
        # or None when the standing play belongs to somebody else. `bs_target()` is by definition the
        # last non-passing player, so exactly one play is challengeable at a time and a pass never
        # changes which — that is what makes a single slot per env correct rather than a map.
        self.challengeable: List[Optional[Transition]] = [None for _ in self.envs]
        self.stats: List[MatchStats] = [MatchStats() for _ in self.envs]
        self.seat_actors: List[List[Any]] = [self._assign_seats() for _ in self.envs]

        self.run = Path(args.run)
        self.run.mkdir(parents=True, exist_ok=True)
        # The ablation is an environment variable, so it is written into the manifest alongside the
        # flags. Without it there is nothing on disk that says whether a given run was the ablation.
        manifest = dict(vars(args), record_features=not NO_RECORD_FEATURES)
        (self.run / "args.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        self.log_path = self.run / "log.jsonl"
        self.steps = 0
        self.recent: deque = deque(maxlen=200)
        if self._resumed is not None:
            self.steps = int(self._resumed.get("steps", 0))
            # Re-seeded off the step count so a resume from a given checkpoint is itself
            # deterministic. It does **not** reproduce the uninterrupted run bit for bit — the
            # environments, the in-flight matches and the 200-match reporting window all restart —
            # which is why the resume point is a checkpoint boundary rather than anywhere.
            torch.manual_seed(self.args.seed + self.steps)
            np.random.seed((self.args.seed + self.steps) & 0xFFFFFFFF)
            print(
                f"resumed {self.args.resume} at {self.steps} steps "
                f"with {len(self.pool_nets)} pooled snapshot(s)",
                flush=True,
            )
            # A marker line, so the log says where the run rewound to rather than merely jumping.
            # `rl/colab_ante.py` splices a mirrored log onto the local one at the first step the
            # mirrored one covers, and without this that boundary is the first *training* line —
            # several thousand steps above the checkpoint, which leaves a couple of lines from the
            # trajectory that died with the VM sitting in the record of the one that replaced it.
            with self.log_path.open("a", encoding="utf-8") as handle:
                handle.write(
                    json.dumps(
                        {"steps": self.steps, "minutes": 0.0, "resumed_from": str(self.args.resume)}
                    )
                    + "\n"
                )
        self._resumed = None

    # ----------------------------------------------------------------- resuming

    def _restore(self, path: str) -> Dict[str, Any]:
        """Continue an interrupted run: the policy, the critic, Adam's moments and the step count.

        Distinct from ``--init``, which *starts* a run from somebody else's policy and deliberately
        resets the value head — see `load_round_weights`. Here the value head is exactly what has to
        survive: it is answering the same question it was a minute ago, and throwing away a trained
        critic mid-run would poison every advantage until it was relearned.

        Adam's moments matter for the same reason at a smaller scale. Dropping them restarts the
        bias correction, so the first few updates after every resume take outsized steps — which over
        a run interrupted every hour by a reclaimed VM is not a rounding error.
        """
        checkpoint = torch.load(path, map_location=self.device, weights_only=False)
        width = int(checkpoint.get("extra_width", 0))
        if width != self.extra_width:
            raise SystemExit(
                f"{path} has an observation block {width} wide, not {self.extra_width}; "
                "--resume continues a run, it does not change its shape"
            )
        saved_window = checkpoint_recent_events(checkpoint)
        if saved_window != self.shape.recent_events:
            raise SystemExit(
                f"{path} was trained with an event window of {saved_window}, not "
                f"{self.shape.recent_events}; --resume continues a run, it does not change its shape"
            )
        if bool(checkpoint.get("lie_head", False)) != (self.args.lie_coef > 0.0):
            raise SystemExit(
                f"{path} was trained {'with' if checkpoint.get('lie_head') else 'without'} the "
                "honesty head; --lie-coef has to agree with it"
            )
        if bool(checkpoint.get("lie_to_policy", False)) != bool(self.args.lie_to_policy):
            raise SystemExit(
                f"{path} was trained "
                f"{'with' if checkpoint.get('lie_to_policy') else 'without'} the honesty feed into "
                "the action heads; --lie-to-policy has to agree with it"
            )
        if bool(checkpoint.get("challenge_head", False)) != (self.args.challenge_coef > 0.0):
            raise SystemExit(
                f"{path} was trained {'with' if checkpoint.get('challenge_head') else 'without'} the "
                "challenge head; --challenge-coef has to agree with it"
            )
        if bool(checkpoint.get("record_features", True)) == NO_RECORD_FEATURES:
            raise SystemExit(
                f"{path} was trained with record_features="
                f"{checkpoint.get('record_features', True)}, which BLOWCOW_ANTE_NO_RECORD "
                "contradicts. Resuming an ablation into a non-ablation is not a resume."
            )
        self.net.load_state_dict(checkpoint["model"])
        state = checkpoint.get("optimizer")
        if state is None:
            print(
                f"warning: {path} carries no optimizer state, so Adam restarts cold", flush=True
            )
        else:
            self.optimizer.load_state_dict(state)
        return checkpoint

    def _restore_pool(self, checkpoint: Dict[str, Any]) -> None:
        """Put the opponent pool back, replacing anything ``--pool-init`` built.

        The saved pool already contains whatever `--pool-init` seated when the run first started, and
        `permanent_pool` records how many of its leading entries those were, so restoring wholesale is
        what keeps the eviction order correct. Re-applying the flag on top would double them.

        **The pool is not one shape.** `--pool-init` may seat a *one-round* checkpoint (200 features,
        no honesty head) beside the run's own 298-feature snapshots — `_forward` already slices each
        opponent to its own `observation_size`, so it plays correctly, but rebuilding every entry at
        the learner's width would refuse to load it. Each entry's shape is therefore read back off its
        own tensors rather than assumed. `value_scale` is deliberately left at the learner's: a pooled
        opponent is only ever asked for an action, and its value output is discarded.
        """
        pool = checkpoint.get("pool")
        if not pool:
            return
        base_trunk_in = self.net.trunk[0].in_features - self.extra_width
        self.pool_nets = []
        self.pool = []
        for state in pool:
            lie_head, lie_to_policy, challenge_head = infer_head_options(state, self.args.hidden)
            net = AnteNet(
                self.shape,
                hidden=self.args.hidden,
                type_dim=self.args.type_dim,
                extra_width=int(state["trunk.0.weight"].shape[1]) - base_trunk_in,
                value_scale=self.value_scale,
                lie_head=lie_head,
                lie_to_policy=lie_to_policy,
                challenge_head=challenge_head,
            ).to(self.device)
            net.load_state_dict(state)
            net.eval()
            self.pool_nets.append(net)
            self.pool.append({})
        self.permanent_pool = int(checkpoint.get("permanent_pool", 0))

    # ----------------------------------------------------------------- seating

    def _assign_seats(self) -> List[Any]:
        if self.args.exploiter:
            assert self.opponent is not None
            seat: Any = ("frozen", 0) if self.opponent_net is not None else self.opponent
            actors = [seat] * self.shape.num_players
            actors[self.rng.randrange(self.shape.num_players)] = LEARNER
            return actors

        actors: List[Any] = []
        for _ in range(self.shape.num_players):
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
    def _forward(
        self,
        net: AnteNet,
        decisions: Sequence[MatchDecision],
        width: Optional[int] = None,
        blind: Optional[Sequence[int]] = None,
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        # Sliced, because a one-round opponent's network reads the round block only. See
        # `ante/match_agents.py`.
        cut = width or net.observation_size
        stacked = np.stack([d.observation[:cut] for d in decisions])
        if blind:
            # A frozen opponent trained under the record ablation has to be blinded here too. The
            # agent wrapper does it in `act`, but this path takes `agent.net` and drives it directly
            # for the batching, so it would otherwise hand an ablation target the very columns it was
            # trained to see as zero — which is exactly the confound `record blinding` exists to stop,
            # reintroduced on the one path that measures how exploitable that target is.
            stacked[:, list(blind)] = 0.0
        observations = torch.from_numpy(stacked).to(self.device)
        masks = torch.from_numpy(np.stack([d.action_mask for d in decisions])).to(self.device)
        logits, values = net.policy(observations, masks)
        probabilities = F.softmax(logits, dim=-1)
        actions = torch.multinomial(probabilities, 1).squeeze(-1)
        log_probabilities = torch.log(probabilities.gather(-1, actions.unsqueeze(-1)).squeeze(-1) + 1e-12)
        return actions.cpu().numpy(), log_probabilities.cpu().numpy(), values.cpu().numpy()

    def collect(self, target: int) -> Tuple[List[Transition], List[MatchStats]]:
        """Gather at least ``target`` learner transitions, all from matches that finished."""
        transitions: List[Transition] = []
        finished: List[MatchStats] = []

        while len(transitions) < target:
            groups: Dict[Any, List[int]] = {}
            for index, decision in enumerate(self.decisions):
                actor = self.seat_actors[index][decision.seat]
                key = actor if isinstance(actor, (str, tuple)) else id(actor)
                groups.setdefault(key, []).append(index)

            chosen: Dict[int, int] = {}
            # The transition the learner just appended, per env, so the step loop below can write the
            # deferred challenge label onto it. One entry per env per iteration, since an env takes
            # exactly one action per iteration; absent when this env's actor is not the learner.
            acted: Dict[int, Transition] = {}
            for key, indices in groups.items():
                if key == LEARNER:
                    actions, log_probabilities, values = self._forward(
                        self.net, [self.decisions[index] for index in indices]
                    )
                    for offset, index in enumerate(indices):
                        decision = self.decisions[index]
                        chosen[index] = int(actions[offset])
                        seat = decision.seat
                        game = decision.game
                        bs_target = None if game is None else game.bs_target()
                        label = (
                            -1.0 if bs_target is None else float(not game.claim_was_honest(bs_target))
                        )
                        transition = Transition(
                            observation=decision.observation,
                            mask=decision.action_mask,
                            action=int(actions[offset]),
                            log_probability=float(log_probabilities[offset]),
                            value=float(values[offset]),
                            seat=seat,
                            lie_label=label,
                        )
                        self.buffers[index].setdefault(seat, []).append(transition)
                        acted[index] = transition
                        # Opens the bucket this action's reward accrues into, up to the seat's next
                        # decision. Everything the match pays out in between belongs here.
                        self.pending[index].setdefault(seat, []).append(0.0)
                elif isinstance(key, tuple):
                    net = self.opponent_net if key[0] == "frozen" else self.pool_nets[key[1]]
                    assert net is not None
                    frozen = key[0] == "frozen"
                    actions, _, _ = self._forward(
                        net,
                        [self.decisions[index] for index in indices],
                        self.opponent_width if frozen else None,
                        self.opponent_blind if frozen else None,
                    )
                    for offset, index in enumerate(indices):
                        chosen[index] = int(actions[offset])
                else:
                    for index in indices:
                        agent = self.seat_actors[index][self.decisions[index].seat]
                        chosen[index] = int(agent.act(self.decisions[index]))

            for index, action in chosen.items():
                self._record_behaviour(index, action)
                # The deferred half of the challenge label, written before the action is applied
                # because the standing play is the one `bs_target()` names *now*.
                if action == CALL_BS_INDEX:
                    standing = self.challengeable[index]
                    if standing is not None:
                        standing.challenge_label = 1.0
                    # A `Call BS` ends the round, so nothing is challengeable after it either way.
                    self.challengeable[index] = None
                elif action != PASS_INDEX:
                    # A play replaces whatever was standing as the only claim a challenge can land
                    # on. What it replaces keeps the 0.0 it was born with, which is the right answer:
                    # nobody ever challenged it. A pass changes nothing, which is why it is excluded.
                    played = acted.get(index)
                    if played is not None:
                        played.challenge_label = 0.0
                    self.challengeable[index] = played
                decision = self.envs[index].step(action)
                self.decisions[index] = decision
                for seat, buckets in self.pending[index].items():
                    if buckets:
                        buckets[-1] += float(decision.rewards[seat])
                if decision.terminated:
                    finished.append(self._finish(index, transitions))

        return transitions, finished

    def _record_behaviour(self, index: int, action: int) -> None:
        decision = self.decisions[index]
        if self.seat_actors[index][decision.seat] is not LEARNER:
            return
        game = decision.game
        match = decision.match
        assert game is not None and match is not None
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

            # Split by what the *record* said about this target before the decision, which is exactly
            # the input the match block adds. A one-round agent has to score the same on both halves;
            # anything else is opponent modelling, and the size of the gap is how much of it there is.
            records = match.live_records()
            target_seat = match.seats[target]
            seen = sum(records[seat].observations for seat in range(match.num_seats))
            lies = sum(records[seat].lies for seat in range(match.num_seats))
            table_rate = 0.5 if seen == 0 else lies / seen
            record = records[target_seat]
            if record.observations >= self.args.record_min:
                suspect = record.lie_rate > table_rate
                if suspect:
                    stats.chances_vs_suspect += 1
                    stats.lies_vs_suspect += int(was_a_lie)
                    stats.calls_vs_suspect += int(action == CALL_BS_INDEX)
                else:
                    stats.chances_vs_trusted += 1
                    stats.lies_vs_trusted += int(was_a_lie)
                    stats.calls_vs_trusted += int(action == CALL_BS_INDEX)

        if action not in (PASS_INDEX, CALL_BS_INDEX):
            semantic = self.envs[index].space.decompose(action)
            trump = semantic[1] if semantic[1] is not None else game.trump
            joker = self.shape.joker_type
            honest = all(card_type in (joker, trump) for card_type in semantic[2])
            holds_trump = game.hands[game.current][joker] > 0 or (
                trump is not None and trump < game.active_ranks and game.hands[game.current][trump] > 0
            )
            if not honest:
                stats.bluffs += 1
            if holds_trump and game.trump is not None:
                stats.discretionary_chances += 1
                if not honest:
                    stats.discretionary_bluffs += 1

    def _finish(self, index: int, transitions: List[Transition]) -> MatchStats:
        decision = self.decisions[index]
        info = decision.info
        stats = self.stats[index]
        stats.rounds = int(info["rounds"])
        stats.endings = dict(info["endings"])

        gamma = self.args.gamma
        lam = self.args.gae_lambda
        for seat, buffer in self.buffers[index].items():
            rewards = self.pending[index].get(seat, [])
            assert len(rewards) == len(buffer)
            # Per-seat GAE. `value[t + 1]` is that seat's own next decision, which is the only
            # bootstrap that means anything in a turn-based game: between the two, four other seats
            # acted and the position they hand back is what the value head is being asked about.
            advantage = 0.0
            for step in range(len(buffer) - 1, -1, -1):
                next_value = buffer[step + 1].value if step + 1 < len(buffer) else 0.0
                delta = rewards[step] + gamma * next_value - buffer[step].value
                advantage = delta + gamma * lam * advantage
                buffer[step].advantage = advantage
                buffer[step].target = advantage + buffer[step].value
            transitions.extend(buffer)

        for seat, actor in enumerate(self.seat_actors[index]):
            if actor is LEARNER:
                stats.gold.append(float(info["gold"][seat] - self.args.gold))
                stats.placement.append(float(info["placements"][seat]))
            else:
                stats.other_gold.append(float(info["gold"][seat] - self.args.gold))
                stats.other_placement.append(float(info["placements"][seat]))

        self.buffers[index] = {}
        self.pending[index] = {}
        self.challengeable[index] = None
        self.stats[index] = MatchStats()
        self.seat_actors[index] = self._assign_seats()
        self.decisions[index] = self.envs[index].reset()
        return stats

    # ----------------------------------------------------------------- learning

    def update(self, transitions: List[Transition]) -> Dict[str, float]:
        observations = torch.from_numpy(np.stack([t.observation for t in transitions])).to(self.device)
        masks = torch.from_numpy(np.stack([t.mask for t in transitions])).to(self.device)
        actions = torch.tensor([t.action for t in transitions], dtype=torch.long, device=self.device)
        old_log = torch.tensor([t.log_probability for t in transitions], dtype=torch.float32, device=self.device)
        old_value = torch.tensor([t.value for t in transitions], dtype=torch.float32, device=self.device)
        target = torch.tensor([t.target for t in transitions], dtype=torch.float32, device=self.device)
        advantage = torch.tensor([t.advantage for t in transitions], dtype=torch.float32, device=self.device)
        lie_label = torch.tensor([t.lie_label for t in transitions], dtype=torch.float32, device=self.device)
        lie_mask = lie_label >= 0.0
        challenge_label = torch.tensor(
            [t.challenge_label for t in transitions], dtype=torch.float32, device=self.device
        )
        challenge_mask = challenge_label >= 0.0

        if self.args.normalise_advantage:
            advantage = (advantage - advantage.mean()) / (advantage.std() + 1e-8)

        size = observations.shape[0]
        indices = np.arange(size)
        metrics = {
            "policy_loss": 0.0,
            "value_loss": 0.0,
            "entropy": 0.0,
            "clip_fraction": 0.0,
            "lie_loss": 0.0,
            "challenge_loss": 0.0,
        }
        batches = 0
        # The value loss lives in gold units and the policy loss in normalised advantage, so without
        # this the two would be balanced differently at every `--rounds`. Dividing by the square of
        # the head's own scale makes `--value-coef` mean the same thing whatever the match length.
        value_norm = max(1e-6, self.value_scale**2)

        for _ in range(self.args.epochs):
            np.random.shuffle(indices)
            for start in range(0, size, self.args.minibatch):
                batch = torch.from_numpy(indices[start : start + self.args.minibatch]).to(self.device)
                logits, values, lie_logit, challenge_logit = self.net.policy_and_aux(
                    observations[batch], masks[batch]
                )
                log_probabilities = F.log_softmax(logits, dim=-1)
                chosen = log_probabilities.gather(-1, actions[batch].unsqueeze(-1)).squeeze(-1)
                ratio = torch.exp(chosen - old_log[batch])

                clipped = torch.clamp(ratio, 1.0 - self.args.clip, 1.0 + self.args.clip)
                policy_loss = -torch.min(ratio * advantage[batch], clipped * advantage[batch]).mean()
                value_loss = F.mse_loss(values, target[batch]) / value_norm

                probabilities = log_probabilities.exp()
                entropy = -(probabilities * log_probabilities.masked_fill(~masks[batch], 0.0)).sum(-1).mean()

                loss = policy_loss + self.args.value_coef * value_loss - self.args.entropy_coef * entropy

                # The auxiliary honesty loss, over the decisions that had a `Call BS` target. It
                # shapes the shared trunk, which is the point: the defect being attacked is that the
                # policy gradient alone does not teach this representation, while a dense label does.
                lie_loss = torch.zeros((), device=self.device)
                if lie_logit is not None:
                    keep = lie_mask[batch]
                    if bool(keep.any()):
                        lie_loss = F.binary_cross_entropy_with_logits(
                            lie_logit[keep], lie_label[batch][keep]
                        )
                        loss = loss + self.args.lie_coef * lie_loss

                # The second auxiliary loss, over the decisions that made a play. Same principle and
                # the other side of it: the honesty head is supervised on whether the *opponent* is
                # lying, this one on whether the table is about to challenge *us*.
                challenge_loss = torch.zeros((), device=self.device)
                if challenge_logit is not None:
                    keep = challenge_mask[batch]
                    if bool(keep.any()):
                        challenge_loss = F.binary_cross_entropy_with_logits(
                            challenge_logit[keep], challenge_label[batch][keep]
                        )
                        loss = loss + self.args.challenge_coef * challenge_loss

                self.optimizer.zero_grad(set_to_none=True)
                loss.backward()
                torch.nn.utils.clip_grad_norm_(self.net.parameters(), self.args.max_grad_norm)
                self.optimizer.step()

                metrics["policy_loss"] += float(policy_loss.item())
                metrics["value_loss"] += float(value_loss.item())
                metrics["entropy"] += float(entropy.item())
                metrics["clip_fraction"] += float(((ratio - 1.0).abs() > self.args.clip).float().mean().item())
                metrics["lie_loss"] += float(lie_loss.item())
                metrics["challenge_loss"] += float(challenge_loss.item())
                batches += 1

        for key in metrics:
            metrics[key] /= max(1, batches)
        metrics["explained_variance"] = float(
            1.0 - ((target - old_value).var() / (target.var() + 1e-8)).item()
        )
        if self.net.lie_head is not None and bool(lie_mask.any()):
            # The head's own AUC on this batch, which is directly comparable to the supervised probe
            # in `rl/ANTE.md` and to the policy's call-probability AUC beside it.
            with torch.no_grad():
                _, _, lie_logit = self.net.policy_and_lie(observations[lie_mask], masks[lie_mask])
            metrics["lie_auc"] = _auc(
                lie_logit.detach().cpu().numpy(), lie_label[lie_mask].cpu().numpy()
            )
        if self.net.challenge_head is not None and bool(challenge_mask.any()):
            # The same reading for the challenge head, plus the base rate it is scored against —
            # `challenge_base` is how often a play is challenged at all, which is what says whether
            # an AUC near 0.5 means the head failed or that there was nothing to separate.
            with torch.no_grad():
                _, _, _, challenge_logit = self.net.policy_and_aux(
                    observations[challenge_mask], masks[challenge_mask]
                )
            labels = challenge_label[challenge_mask].cpu().numpy()
            metrics["challenge_auc"] = _auc(challenge_logit.detach().cpu().numpy(), labels)
            metrics["challenge_base"] = round(100.0 * float(labels.mean()), 2)
        return metrics

    # ----------------------------------------------------------------- evaluation

    @torch.no_grad()
    def evaluate(self, opponent: str, games: int) -> Dict[str, float]:
        """One learner seat against a table of ``opponent``, seats rotated."""
        env = AnteMatchEnv(
            self.config,
            seed=self.args.seed + 1_000_003,
            gold_weight=self.args.gold_weight,
            placement_weight=self.args.placement_weight,
        )
        others = [
            make_match_agent(opponent, self.config, seed=self.args.seed + index)
            for index in range(self.shape.num_players)
        ]
        gold = 0.0
        wins = 0
        for game_index in range(games):
            seat = game_index % self.shape.num_players
            decision = env.reset()
            while not decision.terminated:
                if decision.seat == seat:
                    actions, _, _ = self._forward(self.net, [decision])
                    action = int(actions[0])
                else:
                    action = int(others[decision.seat].act(decision))
                decision = env.step(action)
            gold += float(decision.info["gold"][seat] - self.args.gold)
            wins += int(decision.info["placements"][seat] == 0)
        return {"gold": gold / games, "win_rate": wins / games}

    # ----------------------------------------------------------------- driving

    def save(self, name: str, resumable: bool = False) -> None:
        """``resumable`` adds Adam's moments and the opponent pool, which only ``--resume`` reads.

        Off by default because `final.pt` is an *artifact* — it gets loaded as an agent by
        `ante_match_evaluate.py` and seated in other runs' pools — and the pool alone is eight more
        copies of the network. `latest.pt` is the resume point and carries the lot.
        """
        pool = (
            [{key: value.cpu() for key, value in net.state_dict().items()} for net in self.pool_nets]
            if resumable
            else None
        )
        torch.save(
            {
                "model": self.net.state_dict(),
                **({"optimizer": self.optimizer.state_dict()} if resumable else {}),
                **({"pool": pool, "permanent_pool": self.permanent_pool} if resumable else {}),
                "config": {
                    "num_players": self.shape.num_players,
                    "num_ranks": self.shape.num_ranks,
                    # Read back by `ante/match_agents.py` to decide whether this seat has to re-encode
                    # the table's observation. Absent means the default, which is what every
                    # checkpoint written before the field carries.
                    "recent_events": self.shape.recent_events,
                },
                "match": {
                    "round_limit": self.config.round_limit,
                    "starting_gold": self.config.starting_gold,
                    "disclosure": self.config.disclosure,
                },
                "hidden": self.args.hidden,
                "type_dim": self.args.type_dim,
                "extra_width": self.extra_width,
                "value_scale": self.value_scale,
                "lie_head": self.args.lie_coef > 0.0,
                "lie_to_policy": bool(self.args.lie_to_policy),
                "challenge_head": self.args.challenge_coef > 0.0,
                # So a seat trained without the opponent record is blinded wherever it is seated,
                # rather than depending on whoever evaluates it setting the same global. Nothing about
                # the weights gives it away — the ablation zeroes columns, it does not drop them.
                "record_features": not NO_RECORD_FEATURES,
                "steps": self.steps,
            },
            self.run / name,
        )

    def train(self) -> None:
        started = time.time()
        # Offset by wherever a resume put us, or a run continued at 1.2M would snapshot on its first
        # iteration and then every iteration after it.
        next_snapshot = self.steps + self.args.snapshot_every
        next_eval = self.steps + self.args.eval_every

        while self.steps < self.args.steps:
            transitions, finished = self.collect(self.args.batch)
            self.steps += len(transitions)
            metrics = self.update(transitions)
            self.recent.extend(finished)

            gold = [value for stats in self.recent for value in stats.gold]
            placement = [value for stats in self.recent for value in stats.placement]
            others = [value for stats in self.recent for value in stats.other_placement]
            other_gold = [value for stats in self.recent for value in stats.other_gold]
            opportunities = sum(stats.call_opportunities for stats in self.recent)
            calls = sum(stats.calls for stats in self.recent)
            hits = sum(stats.call_hits for stats in self.recent)
            would = sum(stats.call_would_have_hit for stats in self.recent)
            chances = sum(stats.discretionary_chances for stats in self.recent)
            bluffs = sum(stats.discretionary_bluffs for stats in self.recent)
            suspect = sum(stats.chances_vs_suspect for stats in self.recent)
            trusted = sum(stats.chances_vs_trusted for stats in self.recent)
            calls_suspect = sum(stats.calls_vs_suspect for stats in self.recent)
            calls_trusted = sum(stats.calls_vs_trusted for stats in self.recent)

            record = {
                "steps": self.steps,
                "minutes": round((time.time() - started) / 60.0, 2),
                "gold": round(float(np.mean(gold)) if gold else 0.0, 4),
                "placement": round(float(np.mean(placement)) if placement else 0.0, 3),
                # Negative means the learner finishes ahead of the seats it is playing against. In an
                # `--exploiter` run this *is* the exploitability, with no reference to compute.
                "edge": round(
                    (float(np.mean(placement)) - float(np.mean(others))) if (placement and others) else 0.0,
                    3,
                ),
                "gold_edge": round(
                    (float(np.mean(gold)) - float(np.mean(other_gold))) if (gold and other_gold) else 0.0,
                    3,
                ),
                "rounds": round(float(np.mean([s.rounds for s in self.recent])) if self.recent else 0.0, 2),
                "call_rate": round(100.0 * calls / max(1, opportunities), 2),
                "call_hit": round(100.0 * hits / max(1, calls), 2),
                "lie_base": round(100.0 * would / max(1, opportunities), 2),
                "discrimination": round(
                    100.0 * hits / max(1, calls) - 100.0 * would / max(1, opportunities), 2
                ),
                # The number this layer exists to move: how much more often a seat with a bad record
                # is challenged than one with a good record, in percentage points.
                "call_split": round(
                    100.0 * calls_suspect / max(1, suspect) - 100.0 * calls_trusted / max(1, trusted), 2
                ),
                "suspect_n": suspect,
                "bluff_rate": round(100.0 * bluffs / max(1, chances), 2),
                **{key: round(value, 4) for key, value in metrics.items()},
            }

            if self.steps >= next_eval:
                for opponent in self.args.eval_against:
                    result = self.evaluate(opponent, self.args.eval_games)
                    record[f"eval_{opponent}"] = round(result["gold"], 4)
                    record[f"win_{opponent}"] = round(result["win_rate"], 4)
                next_eval += self.args.eval_every

            with self.log_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(record) + "\n")
            print(json.dumps(record), flush=True)

            if self.steps >= next_snapshot:
                self._snapshot()
                next_snapshot += self.args.snapshot_every

        self.save("final.pt")

    def _snapshot(self) -> None:
        net = AnteNet(
            self.shape,
            hidden=self.args.hidden,
            type_dim=self.args.type_dim,
            extra_width=self.extra_width,
            value_scale=self.value_scale,
            lie_head=self.args.lie_coef > 0.0,
            lie_to_policy=self.args.lie_to_policy,
            challenge_head=self.args.challenge_coef > 0.0,
        ).to(self.device)
        net.load_state_dict(self.net.state_dict())
        net.eval()
        self.pool_nets.append(net)
        self.pool.append({})
        while len(self.pool_nets) > self.args.pool_size:
            # Never evict what `--pool-init` seated: those are the only genuinely different
            # strategies in the population, and a queue would push them out first.
            self.pool_nets.pop(self.permanent_pool)
            self.pool.pop(self.permanent_pool)
        self.save("latest.pt", resumable=True)


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", default="rl/runs/m-ante")
    parser.add_argument("--steps", type=int, default=3_000_000)
    parser.add_argument("--players", type=int, default=5)
    parser.add_argument("--rounds", type=int, default=20, help="`RoundLimit`")
    parser.add_argument("--gold", type=int, default=5, help="`StartingGold`")
    parser.add_argument(
        "--disclosure",
        choices=("round", "full"),
        default="round",
        help="what the honesty record is built from; `full` reveals every play at the end of a round",
    )
    parser.add_argument("--gold-weight", type=float, default=1.0)
    parser.add_argument("--placement-weight", type=float, default=0.0)
    parser.add_argument("--gamma", type=float, default=1.0)
    parser.add_argument("--gae-lambda", type=float, default=0.95)
    parser.add_argument("--record-min", type=int, default=3,
                        help="honesty observations before a target counts toward `call_split`")
    # The auxiliary honesty head. 0 disables it, and the network is then tensor-for-tensor the one
    # every earlier run used. See `AnteNet.lie_head`: the ceiling measured in `rl/ANTE.md` is
    # extraction rather than information, and this is the intervention aimed at it.
    parser.add_argument("--lie-coef", type=float, default=0.0,
                        help="weight on the supervised 'is the BS target lying' auxiliary loss")
    # Hands that head's *output* to the action heads instead of leaving it to shape the trunk and
    # hoping the policy reads it back. `rl/ANTE.md`'s "what is next" names this as the obvious next
    # increment and it had never been built. Needs `--lie-coef`, and the arm's control is the same
    # recipe with this off — the extra columns are zero-initialised so the two are the same network
    # at step zero.
    parser.add_argument("--lie-to-policy", action="store_true",
                        help="feed the honesty head's prediction into the action heads")
    # The second auxiliary head, and the second dense free label `rl/ANTE.md` names. The honesty head
    # is the only component in this layer ever to ship on its own merit, and the reason it worked is a
    # property this label shares exactly: the answer arrives for free a few turns later. 0 disables it
    # and the network is then tensor-for-tensor the one every earlier run used, so an arm's control is
    # the same recipe with this off. Unlike `--lie-to-policy` it has no feed variant — the prediction
    # is never read at play time, which is why shipping one needs nothing in the browser.
    parser.add_argument("--challenge-coef", type=float, default=0.0,
                        help="weight on the supervised 'will my play be challenged' auxiliary loss")
    # The event window. Fixed at 8 for every run in `rl/runs/`, with a comment claiming it covers "a
    # lap of the table plus the reveals inside it" — true at five seats, and false above them, since a
    # lap generates about 2n events. `lap` is the opt-in that makes the claim true at every count.
    # Changing it changes the observation width, so an arm trained at one cannot be warm-started from
    # a checkpoint trained at another, and shipping one needs `anteObservation.ts` widened to match.
    parser.add_argument("--recent-events", default=None,
                        help="event window: an integer, or 'lap' for max(8, 2*players). Default 8")

    parser.add_argument("--num-envs", type=int, default=32)
    parser.add_argument("--batch", type=int, default=8192)
    parser.add_argument("--minibatch", type=int, default=1024)
    parser.add_argument("--epochs", type=int, default=4)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--clip", type=float, default=0.2)
    parser.add_argument("--value-coef", type=float, default=0.5)
    parser.add_argument("--entropy-coef", type=float, default=0.02)
    parser.add_argument("--max-grad-norm", type=float, default=0.5)
    parser.add_argument("--normalise-advantage", action="store_true", default=True)
    parser.add_argument("--hidden", type=int, default=256)
    parser.add_argument("--type-dim", type=int, default=32)

    parser.add_argument("--self-play-prob", type=float, default=0.5)
    parser.add_argument("--baseline-prob", type=float, default=0.15)
    parser.add_argument("--baselines", nargs="*", default=sorted(BASELINES))
    parser.add_argument("--pool-size", type=int, default=8)
    parser.add_argument("--pool-init", nargs="*", default=None)
    parser.add_argument("--snapshot-every", type=int, default=250_000)
    parser.add_argument("--opponent", default=None)
    parser.add_argument("--exploiter", action="store_true")
    parser.add_argument("--init", default=None)
    parser.add_argument(
        "--resume",
        default=None,
        help="continue an interrupted run from its latest.pt: policy, critic, Adam and the pool",
    )

    parser.add_argument("--eval-every", type=int, default=250_000)
    parser.add_argument("--eval-games", type=int, default=120)
    parser.add_argument("--eval-against", nargs="*", default=["heuristic"])
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    args = parser.parse_args(argv)
    if args.lie_to_policy and args.lie_coef <= 0.0:
        parser.error("--lie-to-policy needs --lie-coef: there is no prediction to hand over")
    return args


def main() -> int:
    Trainer(parse_args()).train()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""R-NaD self-play, on the rollout and the network `train_ppo.py` already has.

PPO against a pool of frozen snapshots is fictitious play: it converges on beating what it has seen,
which is why the Stage C agent beats four baselines and still hands a from-scratch exploiter two
tenths of a placement point. R-NaD is the other kind of method — it aims at the equilibrium itself,
and the difference lives in three places:

* **The table is nothing but the learner.** No pool, no baselines, no snapshots. That is not a
  simplification: the reward transform needs a log-ratio for *every* seat's action, and a scripted
  bot does not have one. The pool was standing in for an equilibrium and R-NaD does not need a
  stand-in.
* **The payoff is regularised toward a frozen policy**, charged per decision and credited to the rest
  of the table so it stays zero-sum. See `blowcow/rnad.py` for why the credit half is not optional.
* **The frozen policy is replaced by the answer**, every ``--rnad-period`` decisions. That outer
  iteration is what removes the regularisation again; without it this is just a policy on a leash.

`--solver neurd` additionally swaps PPO's clipped ratio for NeuRD, which moves logits instead of
log-probabilities. That matters here specifically: a bluff that the current opponent has learned to
call gets squeezed toward probability zero, and a softmax policy gradient cannot bring it back
because the gradient reaching its logit is scaled by its own probability. The actions R-NaD needs to
keep alive are exactly the ones a policy gradient buries.

    python rl/train_rnad.py --steps 2000000 --run runs/rnad
    python rl/train_rnad.py --steps 2000000 --init runs/ppo-v1/final.pt --run runs/rnad-warm
    python rl/train_rnad.py --steps 1500000 --solver neurd --rnad-eta 0.03 --run runs/rnad-neurd

Measuring it is the same job as before, and deliberately uses the *other* trainer, so the number is
comparable with Stage C's +0.199:

    python rl/train_ppo.py --steps 700000 --opponent runs/rnad/final.pt --exploiter --run runs/x-rnad
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Any, Dict, List, Optional, Sequence, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import torch
except ModuleNotFoundError as missing:  # pragma: no cover - environment guidance
    raise SystemExit(
        f"Training needs {missing.name}. Activate the project virtualenv and retry."
    ) from missing

from blowcow.env import BlowCowEnv  # noqa: E402
from blowcow.nets import BlowCowNet  # noqa: E402
from blowcow.rnad import (  # noqa: E402
    RNAD_DEFAULTS,
    RNaDConfig,
    masked_entropy,
    neurd_policy_loss,
    regularisation_shares,
)
from train_ppo import LEARNER, SeatOwners, Trainer, build_parser  # noqa: E402


class RNaDTrainer(Trainer):
    progress_keys = Trainer.progress_keys + ("eta", "rnad_cost", "reg_kl", "reg_iter")

    def __init__(self, args: argparse.Namespace) -> None:
        super().__init__(args)

        self.config = RNaDConfig(
            eta=args.rnad_eta,
            eta_final=args.rnad_eta_final if args.rnad_eta_final is not None else args.rnad_eta,
            period=args.rnad_period,
            beta=args.rnad_beta,
            ratio_clip=args.rnad_ratio_clip,
            weight_clip=args.rnad_weight_clip,
        )
        self.eta = self.config.eta

        if args.init:
            checkpoint = torch.load(args.init, map_location=self.device, weights_only=False)
            self.network.load_state_dict(checkpoint["model"])

        # pi_reg starts equal to pi, which makes the first inner solve a plain unregularised one —
        # the transform is identically zero until the policy has moved away from where it began.
        self.reg_network = BlowCowNet(**self.net_kwargs).to(self.device)
        self._freeze_regulariser()

        self.reg_iteration = 0
        self.next_reg_update = args.rnad_period
        self._ratio_sum = 0.0
        self._ratio_absolute = 0.0
        self._ratio_count = 0

    # ------------------------------------------------------------------ setup

    def _freeze_regulariser(self) -> None:
        self.reg_network.load_state_dict(self.network.state_dict())
        self.reg_network.eval()
        for parameter in self.reg_network.parameters():
            parameter.requires_grad_(False)

    def _assign_seats(self, env: BlowCowEnv) -> SeatOwners:
        """Pure self-play, or the learner against frozen snapshots of itself.

        A snapshot is the one kind of opponent R-NaD can seat: it has a policy, so it has a
        ``log pi/pi_reg`` to be charged for, and the transform stays defined at every seat. A scripted
        bot does not, which is why `main` still refuses ``--baselines``. Stage D's control said the
        exploitability regression came from losing the pool rather than from the regularisation, and
        ``--rnad-pool-prob`` is the knob that tests it.
        """
        seats = env.agents
        if not self.pool or self.rng.random() >= self.args.rnad_pool_prob:
            return {seat: LEARNER for seat in seats}

        learner_seat = self.rng.choice(seats)
        return {
            seat: (LEARNER if seat == learner_seat else ("pool", self.rng.randrange(len(self.pool))))
            for seat in seats
        }

    # ------------------------------------------------------------------ hooks

    def _log_ratios(
        self,
        owner: Any,
        observations: torch.Tensor,
        masks: torch.Tensor,
        chosen: torch.Tensor,
        log_probs: torch.Tensor,
    ) -> Optional[List[float]]:
        """One extra forward per batch. ``log_probs`` is already whichever policy holds that seat."""
        with torch.no_grad():
            logits, _value = self.reg_network(observations)
            reg_log_probs = torch.log_softmax(
                BlowCowNet.masked_logits(logits, masks), dim=1
            ).gather(1, chosen.unsqueeze(1)).squeeze(1)
        return (log_probs - reg_log_probs).tolist()

    def _regularise(self, index: int, seat: str, log_ratio: float) -> None:
        trajectories = self.open_traj[index]
        own, other = regularisation_shares(log_ratio, self.eta, self.envs[index].num_players)

        # A snapshot seat is charged like any other and simply has nowhere to keep it — it is not
        # learning. Its credit to everybody else still lands, which is the half that matters.
        if trajectories[seat]:
            trajectories[seat][-1].reward += own
        for other_seat, trajectory in trajectories.items():
            # A seat that has not acted yet this rollout has nowhere to put its credit, so it is
            # dropped rather than deferred. Same as the environment's own rewards, and the same few
            # transitions at the very start of an episode.
            if other_seat != seat and trajectory:
                trajectory[-1].reward += other

        self._ratio_sum += log_ratio
        self._ratio_absolute += abs(log_ratio)
        self._ratio_count += 1

    def _losses(
        self, batch: Dict[str, torch.Tensor], chunk: torch.Tensor, advantages: torch.Tensor
    ) -> Tuple[torch.Tensor, Dict[str, float]]:
        if self.args.solver != "neurd":
            return super()._losses(batch, chunk, advantages)

        observations = batch["observations"][chunk]
        masks = batch["masks"][chunk]
        actions = batch["actions"][chunk]

        logits, values = self.network(observations)
        policy_loss, ratio = neurd_policy_loss(
            logits,
            masks,
            actions,
            advantages[chunk],
            batch["log_probs"][chunk],
            beta=self.config.beta,
            ratio_clip=self.config.ratio_clip,
            weight_clip=self.config.weight_clip,
        )
        value_loss = 0.5 * (values - batch["returns"][chunk]).pow(2).mean()
        entropy = masked_entropy(logits, masks)

        # The entropy bonus stays available but defaults off: R-NaD's whole job is to decide how far
        # the policy may move, and an entropy term is a second, uncoordinated opinion about that.
        weight = self._policy_weight()
        loss = (
            weight * policy_loss
            + self.args.value_coef * value_loss
            - weight * self.args.entropy_coef * entropy.mean()
        )

        with torch.no_grad():
            log_ratio = ratio.clamp(min=1e-8).log()
            stats = {
                "policy_loss": float(policy_loss),
                "value_loss": float(value_loss),
                "entropy": float(entropy.mean()),
                "approx_kl": float(((ratio - 1) - log_ratio).mean()),
            }
        return loss, stats

    def _after_update(self) -> Dict[str, float]:
        progress = min(1.0, self.steps_done / max(1, self.args.steps))
        self.eta = self.config.eta + (self.config.eta_final - self.config.eta) * progress

        if self.steps_done >= self.next_reg_update:
            # The fixed point: this inner solve is over, and its answer becomes the thing the next
            # one is measured against.
            self._freeze_regulariser()
            self.reg_iteration += 1
            self.next_reg_update += self.config.period
            if self.args.rnad_checkpoints:
                self.save(self.run_dir / f"reg-{self.reg_iteration:02d}.pt")

        count = max(1, self._ratio_count)
        stats = {
            "eta": round(self.eta, 5),
            # The measured charge per decision. Compare it against `return`: if a seat takes ~100
            # decisions a match, this times 100 is what the regularisation is worth next to a
            # placement payoff of at most +-1. See `RNaDConfig`.
            "rnad_cost": round(self.eta * self._ratio_absolute / count, 5),
            "reg_kl": round(self._ratio_sum / count, 4),
            "reg_iter": self.reg_iteration,
        }
        self._ratio_sum = 0.0
        self._ratio_absolute = 0.0
        self._ratio_count = 0
        return stats

    def _checkpoint(self) -> Dict[str, Any]:
        # The regulariser rides along so a run can be resumed mid-iteration rather than only between
        # them. `PolicyAgent` reads `model` and ignores the rest, so these files stay drop-in
        # replacements for a Stage C one everywhere else.
        payload = super()._checkpoint()
        payload["reg_model"] = self.reg_network.state_dict()
        payload["rnad"] = {
            "iteration": self.reg_iteration,
            "eta": self.eta,
            "solver": self.args.solver,
        }
        return payload


def build_rnad_parser() -> argparse.ArgumentParser:
    parser = build_parser()
    parser.description = __doc__

    parser.add_argument("--solver", choices=("ppo", "neurd"), default="ppo",
                        help="inner solver for the regularised game; the R-NaD part is the same "
                             "either way")
    parser.add_argument("--init", default=None,
                        help="checkpoint to start pi and pi_reg from, e.g. a Stage C agent")
    parser.add_argument("--rnad-eta", type=float, default=RNAD_DEFAULTS.eta,
                        help="regularisation charged per decision; read RNaDConfig before raising it")
    parser.add_argument("--rnad-eta-final", type=float, default=None,
                        help="anneal eta linearly to this by --steps (default: no annealing)")
    parser.add_argument("--rnad-period", type=int, default=RNAD_DEFAULTS.period,
                        help="learner decisions per inner solve, i.e. between pi_reg replacements")
    parser.add_argument("--rnad-beta", type=float, default=RNAD_DEFAULTS.beta,
                        help="NeuRD logit threshold; ignored by --solver ppo")
    parser.add_argument("--rnad-ratio-clip", type=float, default=RNAD_DEFAULTS.ratio_clip,
                        help="NeuRD importance-ratio ceiling; ignored by --solver ppo")
    parser.add_argument("--rnad-weight-clip", type=float, default=RNAD_DEFAULTS.weight_clip,
                        help="ceiling on 1/mu(a); below 1/this an action gets a policy-gradient-sized "
                             "update rather than a NeuRD-sized one")
    parser.add_argument("--rnad-checkpoints", action="store_true",
                        help="save the policy at every fixed-point iteration")
    parser.add_argument("--rnad-pool-prob", type=float, default=0.0,
                        help="chance a table is the learner against frozen snapshots of itself "
                             "rather than pure self-play. Snapshots have a log-ratio, so unlike a "
                             "scripted bot they do not break the transform. 0 is pure self-play")

    # The pool, the baselines and the snapshots are what R-NaD replaces, so they are off rather than
    # merely unused: leaving them on would seat a policy with no log-ratio and silently break the
    # transform's zero-sum property.
    # Scripted baselines stay off rather than merely unused: seating a policy with no log-ratio would
    # silently break the transform's zero-sum property. Snapshots are the exception, above.
    parser.set_defaults(
        run="runs/rnad",
        self_play_prob=1.0,
        baselines=[],
        baseline_prob=0.0,
        pool_size=5,
        snapshot_every=150_000,
        entropy_coef=0.0,
        epochs=2,
    )
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_rnad_parser().parse_args(argv)
    if args.exploiter:
        raise SystemExit(
            "--exploiter measures a frozen checkpoint and belongs to train_ppo.py.\n"
            "  python rl/train_ppo.py --opponent <ckpt> --exploiter"
        )
    if args.baselines:
        raise SystemExit(
            "R-NaD seats only the learner: a scripted bot has no policy to take a log-ratio "
            "against, and seating one breaks the transform. Drop --baselines."
        )
    RNaDTrainer(args).run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

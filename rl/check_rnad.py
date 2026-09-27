"""Stage D validation: the reward transform, the NeuRD update, and the fixed point.

Stage B held the encoding to the simulator. This holds R-NaD to its own arithmetic — every claim the
method rests on is a claim about a formula, and each one below is checked against the formula rather
than against a training curve, because a training curve cannot tell you which of them you got wrong.

    python rl/check_rnad.py
    python rl/check_rnad.py --skip-train      # formulas only, no rollout
"""

from __future__ import annotations

import argparse
import math
import os
import random
import sys
import time
from typing import Optional, Sequence

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import numpy as np
    import torch
except ModuleNotFoundError as missing:  # pragma: no cover - environment guidance
    raise SystemExit(
        f"Stage D needs {missing.name}, which this interpreter does not have.\n"
        "Activate the project virtualenv (or run this script with that interpreter) and retry."
    ) from missing

from blowcow.nets import MASKED_LOGIT, BlowCowNet  # noqa: E402
from blowcow.observation import OBSERVATION_SIZE  # noqa: E402
from blowcow.rnad import neurd_policy_loss, regularisation_shares  # noqa: E402
from blowcow.spaces import NUM_ACTIONS  # noqa: E402
from train_ppo import Transition  # noqa: E402
from train_rnad import RNaDTrainer, build_rnad_parser  # noqa: E402


class CheckFailed(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise CheckFailed(message)


def _random_state(rng: random.Random, actions: int = 12, batch: int = 5):
    """A batch of masked logits, one sampled action each, and their behaviour log-probs."""
    logits = torch.randn(batch, actions, generator=torch.Generator().manual_seed(rng.randrange(2**31)))
    mask = torch.zeros(batch, actions, dtype=torch.bool)
    for row in range(batch):
        legal = rng.sample(range(actions), rng.randint(2, actions))
        mask[row, legal] = True
    masked = torch.where(mask, logits, torch.full_like(logits, MASKED_LOGIT))
    log_probabilities = torch.log_softmax(masked, dim=1)
    chosen = torch.multinomial(log_probabilities.exp(), 1).squeeze(1)
    return logits, mask, chosen, log_probabilities


# --------------------------------------------------------------------------- 1

def check_transform_zero_sum(rng: random.Random) -> str:
    """The charge to the actor and the credits to everyone else have to cancel exactly.

    This is the property that makes the regularised game zero-sum, and a zero-sum regularised game is
    the only kind with the unique equilibrium the outer iteration converges onto. Get it wrong and
    R-NaD degrades into an arbitrary per-seat shaping term that happens to be stable.
    """
    checked = 0
    for _ in range(4000):
        players = rng.randint(2, 6)
        eta = rng.choice([0.0, 0.005, 0.02, 0.2, 1.0])
        log_ratio = rng.uniform(-12.0, 12.0)

        own, other = regularisation_shares(log_ratio, eta, players)
        total = own + (players - 1) * other
        require(abs(total) < 1e-12, f"transform is not zero-sum: {total} at {players} players")
        require(
            math.isclose(own, -eta * log_ratio, rel_tol=1e-12, abs_tol=1e-12),
            "the actor is not charged eta times its own log-ratio",
        )
        # A policy that has moved away from pi_reg pays; one that has not is untouched.
        require(
            (log_ratio > 0 and own < 0) or (log_ratio < 0 and own > 0) or log_ratio == 0 or eta == 0,
            "the charge has the wrong sign",
        )
        checked += 1
    return f"{checked} transforms cancel across the table"


# --------------------------------------------------------------------------- 2

def check_neurd_gradient(rng: random.Random) -> str:
    """``d loss / d logit`` must be the negated advantage, spread against the legal mean.

    The loss centres the taken logit on the mean of its legal siblings, so the exact gradient is
    ``-w (1 - 1/m)`` on the action taken and ``+w/m`` on each other legal action, and nothing at all on
    an illegal one. If a masked action ever picked up a gradient the mask would be a suggestion.
    """
    checked = 0
    for _ in range(200):
        logits, mask, chosen, behaviour = _random_state(rng)
        logits = logits.clone().requires_grad_(True)
        batch, _actions = mask.shape
        advantages = torch.randn(batch)
        behaviour_log_probs = behaviour.gather(1, chosen.unsqueeze(1)).squeeze(1)

        # beta wide open and the weight cap raised, so this measures the gradient and not the guards.
        loss, ratio = neurd_policy_loss(
            logits, mask, chosen, advantages, behaviour_log_probs,
            beta=1e9, ratio_clip=1e9, weight_clip=1e9,
        )
        loss.backward()

        require(torch.allclose(ratio, torch.ones_like(ratio), atol=1e-5), "on-policy ratio is not 1")

        inverse = (-behaviour_log_probs).exp()
        weight = (ratio * inverse * advantages).detach() / batch
        legal_count = mask.sum(dim=1).to(torch.float32)

        for row in range(batch):
            grad = logits.grad[row]
            action = int(chosen[row])
            expected_taken = -float(weight[row]) * (1.0 - 1.0 / float(legal_count[row]))
            require(
                abs(float(grad[action]) - expected_taken) < 1e-4,
                f"taken logit gradient {float(grad[action])} != {expected_taken}",
            )
            for other in range(mask.shape[1]):
                if other == action:
                    continue
                expected = (
                    float(weight[row]) / float(legal_count[row]) if bool(mask[row, other]) else 0.0
                )
                require(
                    abs(float(grad[other]) - expected) < 1e-4,
                    f"logit {other} gradient {float(grad[other])} != {expected} "
                    f"(legal={bool(mask[row, other])})",
                )
        checked += batch
    return f"{checked} rows match the closed form exactly"


# --------------------------------------------------------------------------- 3

def check_neurd_beats_policy_gradient() -> str:
    """The property the whole solver swap is for: a collapsed action stays recoverable.

    A softmax policy gradient's expected pull on a logit carries a factor of that action's own
    probability, so an action squeezed to 1% gets 1% of the update and can never climb back. NeuRD's
    ``1/mu`` weight removes that factor outright, and ``weight_clip`` bounds it, leaving an expected
    pull of ``min(1, clip * mu) * A``. Both halves are asserted here, over four orders of magnitude of
    ``mu``, because "it recovers faster" is not a number and this is.
    """
    clip = 10.0
    rows = []

    # From an action played half the time down to one played once in ten thousand. A probability of
    # exactly 1 is left out on purpose: there is nothing left to gain there, both pulls go to zero,
    # and their ratio stops meaning anything.
    for probability in (0.5, 0.1, 0.01, 1e-3, 1e-4):
        # Two actions, a rare one and its complement, built to hit `probability` exactly.
        rare = math.log(probability)
        common = math.log(1.0 - probability)
        logits = torch.tensor([[rare, common]], requires_grad=True)
        mask = torch.ones(1, 2, dtype=torch.bool)
        chosen = torch.zeros(1, dtype=torch.long)
        advantage = torch.tensor([1.0])
        behaviour_log_probs = torch.tensor([rare])

        loss, _ratio = neurd_policy_loss(
            logits, mask, chosen, advantage, behaviour_log_probs,
            beta=1e9, ratio_clip=1e9, weight_clip=clip,
        )
        loss.backward()
        # Expected update = (chance of sampling it) x (pull when it is sampled).
        neurd_pull = -float(logits.grad[0, 0]) * probability

        # The same quantity for REINFORCE: loss = -log pi(a) * A.
        pg_logits = torch.tensor([[rare, common]], requires_grad=True)
        pg_log = torch.log_softmax(pg_logits, dim=1)
        (-(pg_log[0, 0] * advantage[0])).backward()
        pg_pull = -float(pg_logits.grad[0, 0]) * probability

        expected = min(1.0, clip * probability) * (1.0 - 0.5)  # the (1 - 1/m) centring term, m = 2
        require(
            abs(neurd_pull - expected) < 1e-4,
            f"at mu={probability:g} NeuRD's expected pull is {neurd_pull:.6f}, not {expected:.6f}",
        )
        require(
            pg_pull < neurd_pull + 1e-9,
            f"at mu={probability:g} the policy gradient pulled harder than NeuRD",
        )
        rows.append((probability, neurd_pull, pg_pull))

    # Where the cap binds, the advantage over a policy gradient stops growing and settles on
    # `clip * (1 - 1/m)` — here 10 x 0.5, the centring term being what the other half is. Asserting
    # the saturation value rather than "it is bigger" is what would catch the weight silently
    # cancelling against the ratio.
    saturated = clip * (1.0 - 0.5)
    rarest = rows[-1]
    measured = rarest[1] / max(rarest[2], 1e-12)
    require(
        abs(measured - saturated) < 0.05,
        f"at mu={rarest[0]:g} NeuRD is {measured:.2f}x the policy gradient, not the {saturated:.2f}x "
        "the weight cap should saturate at",
    )
    # And the ratio itself has a closed form all the way along, not only at the ends. It rises with
    # rarity until the cap binds and then settles; the small overshoot at mu = 0.1 is the `1 - mu` in
    # the policy gradient's own pull, not a bug in either.
    for probability, neurd_pull, pg_pull in rows:
        expected = min(1.0, clip * probability) * 0.5 / (probability * (1.0 - probability))
        require(
            abs(neurd_pull / max(pg_pull, 1e-12) - expected) < 0.05,
            f"at mu={probability:g} the advantage over a policy gradient is "
            f"{neurd_pull / max(pg_pull, 1e-12):.3f}, not {expected:.3f}",
        )
    ratios = ", ".join(f"mu={probability:g}:{a / max(b, 1e-12):.1f}x" for probability, a, b in rows)
    return f"vs a policy gradient: {ratios}"


# --------------------------------------------------------------------------- 4

def check_neurd_threshold(rng: random.Random) -> str:
    """``beta`` has to gate one direction only, never both, and never the useful one."""
    checked = 0
    for _ in range(400):
        beta = 2.0
        # A logit already far past beta above the legal mean, with an advantage that wants it higher.
        far = rng.uniform(beta + 0.5, beta + 8.0)
        logits = torch.tensor([[far, -far]], requires_grad=True)
        mask = torch.ones(1, 2, dtype=torch.bool)
        chosen = torch.zeros(1, dtype=torch.long)
        behaviour = torch.log_softmax(logits.detach(), dim=1)[0, 0].reshape(1)

        loss, _ratio = neurd_policy_loss(
            logits, mask, chosen, torch.tensor([1.0]), behaviour, beta=beta, weight_clip=1e9
        )
        loss.backward()
        require(
            float(logits.grad.abs().sum()) == 0.0,
            "an advantage pushed a logit further past beta in the direction it was already past",
        )

        # The same logit with a negative advantage must still be free to come back.
        logits = torch.tensor([[far, -far]], requires_grad=True)
        loss, _ratio = neurd_policy_loss(
            logits, mask, chosen, torch.tensor([-1.0]), behaviour, beta=beta, weight_clip=1e9
        )
        loss.backward()
        require(
            float(logits.grad.abs().sum()) > 0.0,
            "beta blocked a logit from moving back toward the pack, which would be a one-way door",
        )
        checked += 1
    return f"{checked} thresholds gate one direction only"


# --------------------------------------------------------------------------- 5

def _trainer(overrides: Sequence[str] = (), steps: int = 4000) -> RNaDTrainer:
    parser = build_rnad_parser()
    args = parser.parse_args(
        [
            "--steps", str(steps),
            "--num-envs", "8",
            "--rollout", "16",
            "--minibatch", "256",
            "--players", "3,4",
            "--device", "cpu",
            "--run", os.path.join(os.path.dirname(os.path.abspath(__file__)), "runs", "_check"),
            *overrides,
        ]
    )
    return RNaDTrainer(args)


def check_identity_regulariser() -> str:
    """With ``pi_reg == pi`` the transform must be exactly zero, on real rollout data.

    This is the sanity condition of the whole scheme: at the start of every inner solve the frozen
    policy *is* the policy, so the first gradient step has to see the unmodified game. A log-ratio
    that is not zero here means the two networks are being fed differently — a mask, a device, an eval
    flag — and the regularisation would be charging for nothing.
    """
    trainer = _trainer()
    trainer.steps_done += trainer.collect(4)
    stats = trainer._after_update()

    require(
        abs(stats["reg_kl"]) < 1e-6,
        f"an identical regulariser charged a mean log-ratio of {stats['reg_kl']}",
    )
    require(
        abs(stats["rnad_cost"]) < 1e-6,
        f"an identical regulariser cost {stats['rnad_cost']} per decision",
    )
    require(stats["reg_iter"] == 0, "the fixed point advanced before its period elapsed")
    return "pi_reg == pi charges nothing over a live rollout"


# --------------------------------------------------------------------------- 6

def check_fixed_point() -> str:
    """Moving the policy must open a gap; replacing the regulariser must close it again."""
    trainer = _trainer(["--rnad-period", "1"])

    with torch.no_grad():
        for parameter in trainer.network.parameters():
            parameter.add_(torch.randn_like(parameter) * 0.05)

    trainer.steps_done += trainer.collect(4)
    drifted = trainer._after_update()
    require(
        abs(drifted["rnad_cost"]) > 1e-6,
        "the policy moved but the regulariser charged nothing for it",
    )
    require(drifted["reg_iter"] == 1, "the fixed point did not advance at its period")

    for key, value in trainer.network.state_dict().items():
        require(
            torch.equal(value, trainer.reg_network.state_dict()[key]),
            f"pi_reg did not take pi's weights at the fixed point ({key})",
        )
    require(
        not any(parameter.requires_grad for parameter in trainer.reg_network.parameters()),
        "the regulariser is still carrying gradients",
    )

    trainer.steps_done += trainer.collect(4)
    closed = trainer._after_update()
    require(
        abs(closed["reg_kl"]) < 1e-6,
        f"the gap did not close after the swap: {closed['reg_kl']}",
    )
    return f"charge {drifted['rnad_cost']:.5f}/decision before the swap, {closed['rnad_cost']:.5f} after"


# --------------------------------------------------------------------------- 7

def check_table_credit() -> str:
    """The charge and the credits have to land on the right seats' latest transitions."""
    trainer = _trainer()
    index = 0
    seats = trainer.envs[index].agents
    players = len(seats)

    for seat in seats:
        trainer.open_traj[index][seat].append(
            Transition(
                observation=np.zeros(1, dtype=np.float32),
                mask=np.zeros(1, dtype=bool),
                action=0,
                log_prob=0.0,
                value=0.0,
            )
        )

    trainer.eta = 0.05
    trainer._regularise(index, seats[0], 3.0)

    rewards = {seat: trainer.open_traj[index][seat][-1].reward for seat in seats}
    require(
        abs(sum(rewards.values())) < 1e-12,
        f"the table's rewards did not cancel: {rewards}",
    )
    require(
        abs(rewards[seats[0]] - (-0.05 * 3.0)) < 1e-12,
        f"the actor was charged {rewards[seats[0]]}, not {-0.05 * 3.0}",
    )
    for seat in seats[1:]:
        require(
            abs(rewards[seat] - (0.05 * 3.0 / (players - 1))) < 1e-12,
            f"{seat} was credited {rewards[seat]}",
        )
    return f"{players} seats, actor charged and table credited"


# --------------------------------------------------------------------------- 8

def check_snapshot_pool() -> str:
    """A seated snapshot must be charged like any other seat, and must not crash for having no
    trajectory to keep the charge in.

    This is the one asymmetry the pool introduces: the learner keeps both halves of the transform, a
    snapshot keeps neither, and what has to survive is the *credit* reaching the learner when a
    snapshot deviates. If only learner seats produced ratios, seating a pool would quietly turn the
    transform into a one-sided shaping term.
    """
    trainer = _trainer(["--rnad-pool-prob", "1.0", "--rnad-eta", "0.05"])
    trainer._snapshot()
    with torch.no_grad():
        for parameter in trainer.network.parameters():
            parameter.add_(torch.randn_like(parameter) * 0.05)

    for index, env in enumerate(trainer.envs):
        trainer.owners[index] = trainer._assign_seats(env)

    seated = [
        sum(1 for owner in owners.values() if owner != "learner") for owners in trainer.owners
    ]
    require(sum(seated) > 0, "no snapshot was seated at --rnad-pool-prob 1.0")
    require(
        all(sum(1 for owner in owners.values() if owner == "learner") == 1 for owners in trainer.owners),
        "a pooled table did not seat exactly one learner",
    )

    trainer.steps_done += trainer.collect(6)
    stats = trainer._after_update()
    require(
        abs(stats["rnad_cost"]) > 1e-9,
        "a table of snapshots and a moved policy charged nothing",
    )
    # Ratios are produced for every network-backed seat, so the count has to exceed the learner's own
    # decisions rather than match them.
    return f"{sum(seated)} snapshot seats, charge {stats['rnad_cost']:.5f}/decision"


# --------------------------------------------------------------------------- 9

def check_training_step(solver: str) -> str:
    """Both solvers have to complete a rollout, an update, and a fixed point without diverging."""
    trainer = _trainer(["--solver", solver, "--rnad-period", "200", "--rnad-eta", "0.05"])
    before = [parameter.detach().clone() for parameter in trainer.network.parameters()]

    for _ in range(3):
        trainer.steps_done += trainer.collect(8)
        stats = trainer.update()
        stats.update(trainer._after_update())

    require(bool(stats), "an update produced no statistics")
    for key, value in stats.items():
        require(
            not (isinstance(value, float) and (math.isnan(value) or math.isinf(value))),
            f"{solver} produced a non-finite {key}: {value}",
        )
    moved = any(
        not torch.equal(old, new)
        for old, new in zip(before, trainer.network.parameters())
    )
    require(moved, f"{solver} left every parameter untouched")

    for parameter in trainer.network.parameters():
        require(torch.isfinite(parameter).all(), f"{solver} produced non-finite weights")

    return (
        f"{trainer.steps_done} decisions, entropy {stats.get('entropy', 0.0):.2f}, "
        f"cost {stats.get('rnad_cost', 0.0):.5f}/decision"
    )


# --------------------------------------------------------------------------- 9

def check_action_space_sanity() -> str:
    """The NeuRD loss is written against the full action space; a stale head would go unnoticed."""
    network = BlowCowNet()
    observation = torch.zeros(2, OBSERVATION_SIZE)
    mask = torch.zeros(2, NUM_ACTIONS, dtype=torch.bool)
    mask[:, :6] = True
    logits, value = network(observation)
    require(logits.shape == (2, NUM_ACTIONS), f"logits are {tuple(logits.shape)}")
    require(value.shape == (2,), f"value is {tuple(value.shape)}")

    loss, _ratio = neurd_policy_loss(
        logits,
        mask,
        torch.zeros(2, dtype=torch.long),
        torch.ones(2),
        torch.full((2,), math.log(1 / 6)),
    )
    require(torch.isfinite(loss), "the NeuRD loss is not finite on a fresh network")
    return f"{NUM_ACTIONS} actions through the NeuRD loss"


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--skip-train", action="store_true", help="formulas only, no rollout")
    args = parser.parse_args(argv)

    torch.manual_seed(args.seed)

    checks = [
        ("transform is zero-sum", lambda: check_transform_zero_sum(random.Random(args.seed))),
        ("neurd gradient", lambda: check_neurd_gradient(random.Random(args.seed + 1))),
        ("collapsed actions recover", check_neurd_beats_policy_gradient),
        ("neurd threshold", lambda: check_neurd_threshold(random.Random(args.seed + 2))),
        ("action space through the loss", check_action_space_sanity),
    ]

    if not args.skip_train:
        checks += [
            ("identity regulariser", check_identity_regulariser),
            ("fixed point", check_fixed_point),
            ("table credit", check_table_credit),
            ("snapshot pool", check_snapshot_pool),
            ("training step (ppo)", lambda: check_training_step("ppo")),
            ("training step (neurd)", lambda: check_training_step("neurd")),
        ]

    failures = 0
    for name, run in checks:
        started = time.perf_counter()
        try:
            detail = run()
        except CheckFailed as failure:
            print(f"FAIL {name}\n     {failure}")
            failures += 1
            continue
        print(f"PASS {name:32s} {detail}  ({time.perf_counter() - started:.1f}s)")

    if failures:
        print(f"\n{failures} check(s) failed.")
        return 1

    print("\nAll Stage D checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""R-NaD — Regularised Nash Dynamics, the equilibrium method that PPO plus a pool is not.

Three pieces. Only the first two are the algorithm; the third is a solver and is replaceable.

**The reward transform.** Every seat is charged ``eta`` times the log-ratio between the policy being
learned and a frozen *regularisation policy*, on each of its own actions, and credited its share of
everybody else's charge. The credit half is the part that is easy to leave out and the part that
matters: without it the transform is a shaping term each seat can be measured against separately,
and with it the transform is zero-sum, so the regularised game is still a zero-sum game — which is
what gives it a unique equilibrium for the fixed point below to converge onto.

**The fixed point.** Solve the regularised game, set the regularisation policy to the answer, solve
again. That iteration converges on a Nash equilibrium of the *original* game. The regularisation is
not a bias being tolerated for stability; it is what makes each inner problem have one solution
instead of a cycle, and the outer iteration is what removes it again.

**NeuRD**, the inner solver. Its whole difference from a policy gradient is which quantity the
advantage is applied to: a softmax policy gradient moves ``log pi(a|s)``, so the gradient reaching the
logit carries a factor of ``pi(a|s)`` and an action that has collapsed to near-zero probability can no
longer be revived by any finite advantage. NeuRD moves the **logit** directly — replicator dynamics
says ``d(logit_a)/dt = q_a - v`` — so a collapsed action recovers at full speed the moment it is worth
playing again. In a bluffing game that is not a technicality: the actions that get squeezed to zero
against the current opponent are exactly the ones an exploiter will punish you for not having.

`rl/check_rnad.py` holds all of this to its own arithmetic.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Tuple

import torch

from .nets import MASKED_LOGIT


@dataclass(frozen=True, slots=True)
class RNaDConfig:
    """``eta`` is the one number that has to be reasoned about rather than copied.

    The published Stratego setting is 0.2, and porting that here without thinking gives a policy that
    never moves. The transform charges ``eta * log(pi/pi_reg)`` **per decision**, so what the inner
    problem actually trades off is the *episode total* of that against a terminal payoff of at most
    ``+-1``. A Blow Cow match runs a few hundred decisions and a seat takes something like a hundred
    of them, so at ``eta = 0.2`` a per-step log-ratio of a quarter already outweighs winning the match
    by an order of magnitude: the regularised game becomes "stay where you are", every inner solve
    returns ``pi_reg``, and the outer iteration stands still.

    The default below is scaled to that: roughly a third of a placement point of regularisation over a
    seat's whole episode, which leaves the payoff in charge while still pinning the solution down.
    ``rnad_cost`` in the training log is the measured number — the mean per-decision charge — and it is
    there so this can be tuned against what is happening rather than guessed twice.

    ``period`` is how many learner decisions each inner solve gets before ``pi_reg`` is replaced.
    ``beta`` is NeuRD's logit threshold: a legal action whose logit has already drifted this far from
    the mean of its legal siblings stops being pushed further out, which is what stops the
    unnormalised update running away. ``weight_clip`` is the ceiling on ``1 / mu(a)`` — see
    `neurd_policy_loss`, where it is the whole difference between NeuRD and a policy gradient.
    """

    eta: float = 0.02
    eta_final: float = 0.02
    period: int = 200_000
    beta: float = 2.0
    ratio_clip: float = 1.0
    weight_clip: float = 10.0


#: The defaults as values. ``RNaDConfig`` uses ``slots``, so reading a field off the class itself
#: hands back a descriptor rather than the default — which is silent until something tries arithmetic
#: on it several thousand decisions into a run.
RNAD_DEFAULTS = RNaDConfig()


def regularisation_shares(log_ratio: float, eta: float, num_players: int) -> Tuple[float, float]:
    """The charge to the acting seat and the credit to each of the others.

    Returned as a pair rather than applied here so the caller can put each half where its own reward
    goes. They sum to zero across the table by construction — ``own + (n - 1) * other == 0`` — which
    is the property `check_rnad.py` asserts and the property the whole method rests on.
    """
    own = -eta * log_ratio
    return own, -own / max(1, num_players - 1)


def neurd_policy_loss(
    logits: torch.Tensor,
    mask: torch.Tensor,
    actions: torch.Tensor,
    advantages: torch.Tensor,
    behaviour_log_probs: torch.Tensor,
    beta: float = 2.0,
    ratio_clip: float = 1.0,
    weight_clip: float = 10.0,
) -> Tuple[torch.Tensor, torch.Tensor]:
    """Sampled NeuRD. Returns ``(loss, importance_ratio)``.

    Replicator dynamics wants ``d(logit_a)/dt = A(s, a)`` for **every** action, and only one action per
    state was sampled. Weighting that one sample by ``1 / mu(a)`` is what makes the expectation come
    out right, and it is not decoration: drop it and the expected logit gradient picks up a factor of
    ``mu(a)``, which is precisely the policy-gradient behaviour NeuRD exists to avoid — an action at
    one percent probability gets one percent of the pull, so it can never climb back.

    That weight is unbounded as ``mu(a) -> 0``, and with up to 1,669 legal actions an untrained policy
    would hand out weights in the hundreds. ``weight_clip`` caps it, and the cap is exactly where the
    bias is: the expected logit gradient becomes ``min(1, weight_clip * mu(a)) * A``, so any action the
    policy plays at least ``1 / weight_clip`` of the time gets the true NeuRD update, and anything
    rarer gets ``weight_clip`` times what a policy gradient would give it rather than the unbounded
    correction. `check_rnad.py` asserts that formula rather than trusting it.

    Two more guards, neither of which changes what is being estimated:

    * ``ratio_clip`` caps ``pi/mu`` the way V-trace's ``rho`` does. It only bites from the second epoch,
      when the batch has drifted off-policy.
    * the logits are centred on the mean of the **legal** ones — the softmax discards an overall
      level, so the update should be about differences between the actions on offer — and ``beta``
      gates: an advantage that would push a logit further than ``beta`` from that mean, in the
      direction it is already past, is dropped. An unnormalised update has no self-limiting term of
      its own, and this is it.
    """
    masked = torch.where(mask, logits, torch.full_like(logits, MASKED_LOGIT))
    log_probabilities = torch.log_softmax(masked, dim=1)
    chosen = actions.unsqueeze(1)

    ratio = (log_probabilities.gather(1, chosen).squeeze(1) - behaviour_log_probs).exp()
    ratio = ratio.clamp(max=ratio_clip)
    inverse_behaviour = (-behaviour_log_probs).exp().clamp(max=weight_clip)
    weighted = (ratio * inverse_behaviour * advantages).detach()

    legal = mask.to(logits.dtype)
    centre = (logits * legal).sum(dim=1, keepdim=True) / legal.sum(dim=1, keepdim=True).clamp(min=1.0)
    centred = (logits - centre).gather(1, chosen).squeeze(1)

    # Gates, not clamps: the advantage keeps its size, it just stops applying in one direction.
    can_increase = (centred < beta).detach().to(logits.dtype)
    can_decrease = (centred > -beta).detach().to(logits.dtype)
    gated = can_increase * weighted.clamp(min=0.0) + can_decrease * weighted.clamp(max=0.0)

    return -(gated * centred).mean(), ratio


def masked_entropy(logits: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    """Entropy of the legal-action distribution, for logging. R-NaD does not optimise it."""
    masked = torch.where(mask, logits, torch.full_like(logits, MASKED_LOGIT))
    log_probabilities = torch.log_softmax(masked, dim=1)
    return -(log_probabilities.exp() * log_probabilities).sum(dim=1)

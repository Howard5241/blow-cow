"""The self-play environment over a whole Ante match.

The one difference from `ante/env.py` that changes anything for a learner: **reward is incremental,
not terminal.** Each step carries the gold that moved since the last one, which is zero except at a
round boundary. A twenty-round match is twenty ±1 payoffs rather than one, and a seat's return is the
sum of the ones that come after it acts.

That is the whole reason this environment can exist without reopening the credit-assignment problem
the classic work died on. The classic game folded its reward into a placement across ~90 rounds; this
one pays out every five to ten decisions, exactly as the one-round subgame does, and the match layer
only decides what those payouts are worth. Two settings say what "worth" means:

* ``gold_weight`` on the per-round gold, which is dense and is what a round is actually played for.
* ``placement_weight`` on the finishing place, which is the real objective and arrives once.

They are not the same objective. Elimination ranks below every survivor however the gold fell, so a
seat's last coin is worth far more than its fifth — which is precisely the risk-appetite question a
gold-only agent has no way to ask. Keeping both as weights is what lets the gap be measured instead
of assumed.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence

import numpy as np

from .match import AnteMatch, MatchConfig
from .match_observation import MatchObservationEncoder
from .spaces import ActionSpace


@dataclass
class MatchDecision:
    """Whose turn it is, what they see, and what they may do. ``seat`` is a **match** seat.

    ``rewards`` is the gold that moved *since the previous decision*, per match seat — not the
    running total and not the final one. A trainer accumulates it per seat, which is what lets a seat
    eliminated in round 4 still be paid its placement in round 20.
    """

    seat: int
    observation: np.ndarray
    action_mask: np.ndarray
    terminated: bool
    rewards: np.ndarray
    match: Optional[AnteMatch] = None
    info: Dict[str, Any] = field(default_factory=dict)

    @property
    def game(self):
        """The live round, for scripted baselines and behavioural counters.

        Named `game` rather than `round` so `ante/agents.py` works here untouched: every scripted
        baseline reads `decision.game` and nothing else, so the same five bots that set the bar in
        the one-round subgame set it in a match without a line changing.
        """
        return None if self.match is None else self.match.round

    @property
    def round_seat(self) -> Optional[int]:
        if self.match is None or self.seat not in self.match.round_seat:
            return None
        return self.match.round_seat[self.seat]


class AnteMatchEnv:
    """One whole match per episode."""

    def __init__(
        self,
        config: MatchConfig,
        seed: Optional[int] = None,
        gold_weight: float = 1.0,
        placement_weight: float = 0.0,
    ) -> None:
        self.config = config
        self.space = ActionSpace(config.shape)
        self.encoder = MatchObservationEncoder(config)
        self.rng = random.Random(seed)
        self.gold_weight = gold_weight
        self.placement_weight = placement_weight
        self.match: Optional[AnteMatch] = None
        self._settled_rounds = 0

    # ----------------------------------------------------------------- sizes

    @property
    def observation_size(self) -> int:
        return self.encoder.size

    @property
    def extra_width(self) -> int:
        return self.encoder.match_size

    @property
    def action_size(self) -> int:
        return self.space.size

    @property
    def num_players(self) -> int:
        return self.config.num_players

    # ----------------------------------------------------------------- loop

    def reset(self) -> MatchDecision:
        self.match = AnteMatch(self.config, rng=self.rng)
        self._settled_rounds = len(self.match.outcomes)
        return self._decision(np.zeros(self.num_players, dtype=np.float32))

    def step(self, action_index: int) -> MatchDecision:
        match = self.match
        assert match is not None, "reset() first"
        if match.finished:
            raise RuntimeError("The match is over; reset() before stepping again.")

        match.apply(self.space.decompose(int(action_index)))

        # Any round that settled inside that move — normally none or one, but written as a sweep so
        # nothing depends on `_settle_round` being unable to cascade.
        rewards = np.zeros(self.num_players, dtype=np.float32)
        for outcome in match.outcomes[self._settled_rounds :]:
            rewards += self.gold_weight * np.asarray(outcome.gold_delta, dtype=np.float32)
        self._settled_rounds = len(match.outcomes)

        if match.finished and self.placement_weight:
            rewards += self.placement_weight * np.asarray(
                match.placement_rewards(), dtype=np.float32
            )
        return self._decision(rewards)

    def _decision(self, rewards: np.ndarray) -> MatchDecision:
        match = self.match
        assert match is not None

        if match.finished:
            return MatchDecision(
                seat=0,
                observation=np.zeros(self.encoder.size, dtype=np.float32),
                action_mask=np.zeros(self.space.size, dtype=bool),
                terminated=True,
                rewards=rewards,
                info=match.summary(),
            )

        seat = match.current_seat
        assert seat is not None and match.round is not None
        return MatchDecision(
            seat=seat,
            observation=self.encoder.encode(match, seat),
            action_mask=np.asarray(self.space.legal_mask(match.round), dtype=bool),
            terminated=False,
            rewards=rewards,
            match=match,
        )

    # ----------------------------------------------------------------- helpers

    def observe_all(self) -> np.ndarray:
        """Every seat's view, eliminated ones included — their rows are the zero round block."""
        assert self.match is not None
        return np.stack(
            [self.encoder.encode(self.match, seat) for seat in range(self.num_players)]
        )

    def sample_action(self) -> int:
        assert self.match is not None and self.match.round is not None
        legal = np.flatnonzero(np.asarray(self.space.legal_mask(self.match.round), dtype=bool))
        return int(legal[self.rng.randrange(legal.size)])


def play_match(
    env: AnteMatchEnv,
    policies: Sequence[Any],
    collect: Optional[List[MatchDecision]] = None,
) -> MatchDecision:
    """Run one match with one policy per match seat. ``policies[i].act(decision) -> action index``."""
    decision = env.reset()
    while not decision.terminated:
        if collect is not None:
            collect.append(decision)
        decision = env.step(policies[decision.seat].act(decision))
    return decision

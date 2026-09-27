"""The self-play environment: one seat acts at a time, forced procedures drive themselves.

Turn-based and sequential, so it is shaped like a PettingZoo AEC env rather than a Gym one — each
:meth:`BlowCowEnv.step` names the seat that acts next and hands back the rewards everyone accrued in
between. `pettingzoo_env.py` wraps it for anyone who wants the real interface; nothing here depends
on it.

**Points are a penalty.** Fewest points wins, so the reward for gaining a point is negative and the
reward for making somebody else gain one is positive. Getting that sign wrong is the single easiest
way to train an agent to lose this game confidently.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence

import numpy as np

from .actions import Action
from .bridge import CanonicalTable
from .canonical import RankMapping
from .cards import RANKS, get_default_standard_rank_count
from .engine import BlowCowEngine
from .observation import MAX_SEATS, OBSERVATION_SIZE
from .spaces import NUM_ACTIONS, describe

#: Training tables. The engine still supports seven and eight; the observation does not.
DEFAULT_PLAYER_COUNTS = (2, 3, 4, 5, 6)


@dataclass(frozen=True, slots=True)
class RewardConfig:
    """``terminal`` is the objective: final placement, best to worst, mapped onto ``+1 .. -1``.
    ``dense_points`` is the same objective decomposed — a point gained is a point toward losing — and
    exists because a match runs for dozens of rounds and the terminal signal alone is a thin thread to
    push through all of them. Set it to 0 to train on the objective and nothing else. Both are
    zero-sum across the seats, so neither can be farmed by the table as a whole.

    ``truncation_penalty`` is the one that is not, and it is deliberate. A match that hits the move
    limit is scored on the standings at that moment and then every seat is docked this much, so
    finishing is strictly better than stalling *for every seat* — the seat that is winning gets less
    than a win, and the seat that is losing gets worse than a loss.

    That is not a stylistic choice. Truncation here is **endogenous**: a table that never challenges
    cycles for ever, so an agent decides whether the match ends. Bootstrapping the value function at
    the limit — the textbook treatment of a time limit — is only sound when truncation is exogenous.
    Try it here and a losing agent learns that stalling beats a terminal ``-1``, the value function
    is never anchored by a real ending, and the whole table converges on refusing to finish. That is
    not a hypothetical: the first training run did exactly this, reaching 206 rounds a match and 49%
    truncation before it was stopped.

    ``step_cost`` is charged to whichever seat is acting, once per decision, and defaults to zero so
    that evaluation scores stay pure placement. Training turns it on. It exists because the
    truncation penalty alone arrives four hundred decisions after the passivity that earned it, and
    an agent cannot credit that: a table where nobody lies and nobody challenges scores nothing,
    loses nothing, and drifts there because no *local* signal argues against it. A per-decision cost
    is the same argument delivered immediately.
    """

    terminal: float = 1.0
    dense_points: float = 0.1
    truncation_penalty: float = 1.0
    step_cost: float = 0.0


@dataclass
class TimeStep:
    agent: Optional[str]
    observation: Optional[np.ndarray]
    action_mask: Optional[np.ndarray]
    rewards: Dict[str, float] = field(default_factory=dict)
    terminated: bool = False
    #: Hit the move limit instead of finishing. Not the same thing as terminated, and a learner must
    #: bootstrap here rather than treat it as an ending — see `max_moves`.
    truncated: bool = False
    info: Dict[str, Any] = field(default_factory=dict)

    @property
    def done(self) -> bool:
        return self.terminated or self.truncated


class BlowCowEnv:
    observation_size = OBSERVATION_SIZE
    action_size = NUM_ACTIONS

    def __init__(
        self,
        player_counts: Sequence[int] = DEFAULT_PLAYER_COUNTS,
        reward: RewardConfig = RewardConfig(),
        randomize_ranks: bool = True,
        seed: Optional[int] = None,
        max_moves: int = 3000,
    ) -> None:
        """``max_moves`` is not just a safety net.

        Cards only leave the game through four-of-a-kind scoring and through a player leaving, and
        both of those need cards to *move* — which needs a challenge or a Reset. A table where nobody
        ever calls BS therefore cycles for ever: every round ends on an all-pass, every card goes
        back to the hand it came from, and nothing changes. Three of the five baselines in
        `agents.py` do exactly that. Random play, by contrast, finishes in ~490 moves at the median
        and has never been seen past 1,400, so this default leaves plenty of headroom for a real
        match while bounding a degenerate one.
        """
        for count in player_counts:
            if not 2 <= count <= MAX_SEATS:
                raise ValueError(f"Training tables run from 2 to {MAX_SEATS} seats; got {count}.")

        self.player_counts = tuple(player_counts)
        self.reward = reward
        self.randomize_ranks = randomize_ranks
        self.max_moves = max_moves
        self._rng = random.Random(seed)

        self.engine: Optional[BlowCowEngine] = None
        self.table: Optional[CanonicalTable] = None
        self.mapping: Optional[RankMapping] = None
        self._action_table: Dict[int, Action] = {}
        self._mask = np.zeros(NUM_ACTIONS, dtype=bool)
        self._points: Dict[str, int] = {}
        self._moves = 0
        self._truncated = False

    # ------------------------------------------------------------------ episode

    @property
    def agents(self) -> List[str]:
        return list(self.engine.seat_order) if self.engine else []

    @property
    def num_players(self) -> int:
        return len(self.engine.seat_order) if self.engine else 0

    def reset(self, seed: Optional[int] = None, num_players: Optional[int] = None) -> TimeStep:
        rng = random.Random(seed) if seed is not None else self._rng

        count = num_players if num_players is not None else rng.choice(self.player_counts)
        if not 2 <= count <= MAX_SEATS:
            raise ValueError(f"Training tables run from 2 to {MAX_SEATS} seats; got {count}.")

        rank_count = get_default_standard_rank_count(count)
        # The real game picks its default ranks with a shuffle too, so a random subset is what a live
        # match actually looks like. Canonically it changes nothing, which is the point of checking it.
        selected_ranks = (
            rng.sample(list(RANKS), rank_count) if self.randomize_ranks else list(RANKS[:rank_count])
        )

        self.mapping = RankMapping.random(selected_ranks, rng)
        self.engine = BlowCowEngine(count, selected_ranks, seed=rng.randrange(1, 2**31))
        self.table = CanonicalTable(self.engine, self.mapping)
        self._points = {player_id: 0 for player_id in self.engine.seat_order}
        self._moves = 0
        self._truncated = False

        self._drive_forced()
        rewards = self._collect_rewards()
        return self._time_step(rewards)

    def step(self, action_index: int) -> TimeStep:
        if self.engine is None or self.table is None:
            raise RuntimeError("Call reset() before step().")
        if self.engine.gameover is not None or self._truncated:
            raise RuntimeError("The match is over; call reset().")

        action = self._action_table.get(int(action_index))
        if action is None:
            raise ValueError(
                f"Action {action_index} ({describe(int(action_index), self.mapping)}) is not legal here."
            )

        player_id = self.engine.decision_player()
        assert player_id is not None
        move_name, args = action.to_move()
        if self.engine.apply_move(player_id, move_name, args):
            raise RuntimeError(f"The engine refused a masked-legal action: {action}")
        self._moves += 1

        self._drive_forced()
        rewards = self._collect_rewards()
        # Charged to the seat that just spent a decision, so the cost of a long match lands on the
        # actions that made it long rather than on the ending it eventually reaches.
        if self.reward.step_cost:
            rewards[player_id] -= self.reward.step_cost
        return self._time_step(rewards)

    # ------------------------------------------------------------------ helpers

    def observation_for(self, player_id: str) -> np.ndarray:
        """Any seat's view, for a centralised critic. Still only what that seat may legally see."""
        if self.table is None:
            raise RuntimeError("Call reset() before observing.")
        return self.table.observation(player_id)

    def _drive_forced(self) -> None:
        assert self.engine is not None
        while self.engine.gameover is None and not self._truncated:
            if self._moves >= self.max_moves:
                self._truncated = True
                return
            forced = self.engine.forced_move()
            if forced is None:
                break
            if self.engine.apply_move(*forced):
                raise RuntimeError(f"The engine refused its own forced move: {forced}")
            self._moves += 1

    def standings(self) -> List[str]:
        """Seats best to worst as they stand: fewest points, then earliest to leave, then seat.

        The same order `buildGameOverSummary` uses. Meaningful mid-match only as a snapshot, which is
        exactly what a truncated match has to be scored on.
        """
        assert self.engine is not None
        engine = self.engine
        return sorted(
            engine.seat_order,
            key=lambda player_id: (
                engine.players[player_id].points,
                engine.players[player_id].leave_order
                if engine.players[player_id].leave_order is not None
                else 2**53,
                engine.players[player_id].seat_index,
            ),
        )

    def _collect_rewards(self) -> Dict[str, float]:
        """Zero-sum on both channels: a point gained is a point everybody else did not gain."""
        assert self.engine is not None
        seats = self.engine.seat_order
        count = len(seats)
        rewards = {player_id: 0.0 for player_id in seats}

        if self.reward.dense_points:
            deltas = {
                player_id: self.engine.players[player_id].points - self._points[player_id]
                for player_id in seats
            }
            total = sum(deltas.values())
            if total:
                for player_id in seats:
                    others = (total - deltas[player_id]) / (count - 1)
                    rewards[player_id] += self.reward.dense_points * (others - deltas[player_id])

        for player_id in seats:
            self._points[player_id] = self.engine.players[player_id].points

        if self.reward.terminal:
            if self.engine.gameover is not None:
                for place, player_id in enumerate(self.engine.gameover.placements):
                    rewards[player_id] += self.reward.terminal * (1.0 - 2.0 * place / (count - 1))
            elif self._truncated:
                # Scored on the standings, then everyone is docked. See `RewardConfig`.
                for place, player_id in enumerate(self.standings()):
                    rewards[player_id] += self.reward.terminal * (1.0 - 2.0 * place / (count - 1))
                for player_id in seats:
                    rewards[player_id] -= self.reward.truncation_penalty

        return rewards

    def _time_step(self, rewards: Dict[str, float]) -> TimeStep:
        assert self.engine is not None and self.table is not None

        if self.engine.gameover is not None or self._truncated:
            self._action_table = {}
            self._mask = np.zeros(NUM_ACTIONS, dtype=bool)
            finished = self.engine.gameover is not None
            placements = (
                list(self.engine.gameover.placements) if finished else self.standings()
            )
            return TimeStep(
                agent=None,
                observation=None,
                action_mask=None,
                rewards=rewards,
                terminated=finished,
                truncated=not finished,
                info={
                    "placements": placements,
                    "points": {
                        player_id: self.engine.players[player_id].points
                        for player_id in self.engine.seat_order
                    },
                    "rounds": self.engine.round.round_number,
                    "moves": self._moves,
                    "num_players": len(self.engine.seat_order),
                    "truncated": not finished,
                },
            )

        self._mask, self._action_table = self.table.build_actions()
        agent = self.engine.decision_player()
        assert agent is not None

        return TimeStep(
            agent=agent,
            observation=self.table.observation(agent),
            action_mask=self._mask,
            rewards=rewards,
            terminated=False,
            info={
                "round": self.engine.round.round_number,
                "turn": self.engine.ctx_turn,
                "legal_actions": int(self._mask.sum()),
            },
        )

    # ------------------------------------------------------------------ sampling

    def sample_action(self, rng: Optional[random.Random] = None) -> int:
        """A uniformly random legal action. The floor every baseline has to beat."""
        legal = np.flatnonzero(self._mask)
        if legal.size == 0:
            raise RuntimeError("No legal action available.")
        rng = rng or self._rng
        return int(legal[rng.randrange(legal.size)])

"""An optional PettingZoo AEC wrapper around :class:`~blowcow.env.BlowCowEnv`.

Nothing in the package depends on this; ``pettingzoo`` and ``gymnasium`` are imported here and
nowhere else, so the core environment stays dependency-free apart from numpy. Use it when you want
the standard interface — wrappers, the API conformance test, existing trainers.

The seat count varies per episode, so ``possible_agents`` is the six-seat maximum and ``agents``
holds however many sat down. Matches end for everyone at once: when the last seat leaves, the whole
table terminates together, because a placement is only decided once every seat has stopped scoring.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

import numpy as np
from gymnasium import spaces
from pettingzoo import AECEnv

from .env import DEFAULT_PLAYER_COUNTS, BlowCowEnv, RewardConfig
from .observation import MAX_SEATS, OBSERVATION_SIZE
from .spaces import NUM_ACTIONS


class BlowCowAECEnv(AECEnv):
    metadata = {"render_modes": ["ansi"], "name": "blow_cow_vanilla_v0", "is_parallelizable": False}

    def __init__(
        self,
        player_counts: Sequence[int] = DEFAULT_PLAYER_COUNTS,
        reward: RewardConfig = RewardConfig(),
        randomize_ranks: bool = True,
        seed: Optional[int] = None,
        render_mode: Optional[str] = None,
    ) -> None:
        super().__init__()
        self._env = BlowCowEnv(
            player_counts=player_counts,
            reward=reward,
            randomize_ranks=randomize_ranks,
            seed=seed,
        )
        self.render_mode = render_mode
        # PettingZoo's naming convention; the engine's own seat ids are the bare numbers.
        self.possible_agents: List[str] = [f"player_{index}" for index in range(MAX_SEATS)]

        self._observation_space = spaces.Dict(
            {
                "observation": spaces.Box(
                    low=-np.inf, high=np.inf, shape=(OBSERVATION_SIZE,), dtype=np.float32
                ),
                "action_mask": spaces.MultiBinary(NUM_ACTIONS),
            }
        )
        self._action_space = spaces.Discrete(NUM_ACTIONS)
        self._skip_agent_selection: Optional[str] = None

    def observation_space(self, agent: str) -> spaces.Space:
        return self._observation_space

    def action_space(self, agent: str) -> spaces.Space:
        return self._action_space

    @staticmethod
    def _seat(agent: str) -> str:
        return agent.split("_", 1)[1]

    @staticmethod
    def _agent(seat: str) -> str:
        return f"player_{seat}"

    # ------------------------------------------------------------------ episode

    def reset(self, seed: Optional[int] = None, options: Optional[Dict[str, Any]] = None) -> None:
        num_players = (options or {}).get("num_players")
        step = self._env.reset(seed=seed, num_players=num_players)

        self.agents = [self._agent(seat) for seat in self._env.agents]
        self.rewards = {agent: 0.0 for agent in self.agents}
        self._cumulative_rewards = {agent: 0.0 for agent in self.agents}
        self.terminations = {agent: False for agent in self.agents}
        self.truncations = {agent: False for agent in self.agents}
        self.infos = {agent: {} for agent in self.agents}
        self._skip_agent_selection = None

        assert step.agent is not None
        self.agent_selection = self._agent(step.agent)
        self._latest = step

    def observe(self, agent: str) -> Dict[str, np.ndarray]:
        """Any seat's view. The mask is only meaningful for the seat on the clock; every other seat
        gets an empty one, since they have no move to make."""
        observation = self._env.observation_for(self._seat(agent))
        mask = (
            self._latest.action_mask
            if self._latest.action_mask is not None and agent == self.agent_selection
            else np.zeros(NUM_ACTIONS, dtype=bool)
        )
        return {"observation": observation, "action_mask": mask.astype(np.int8)}

    def step(self, action: Optional[int]) -> None:
        agent = self.agent_selection
        if self.terminations[agent] or self.truncations[agent]:
            self._was_dead_step(action)
            return

        # Cleared before the step, so `last()` reports what this seat earned while it was away rather
        # than that plus whatever it is about to earn. This is the AEC contract.
        self._cumulative_rewards[agent] = 0.0

        step = self._env.step(int(action))
        self._latest = step

        self._clear_rewards()
        for seat, value in step.rewards.items():
            self.rewards[self._agent(seat)] = value

        for other in self.agents:
            self.infos[other] = dict(step.info)

        if step.done:
            for other in self.agents:
                self.terminations[other] = step.terminated
                self.truncations[other] = step.truncated
            self._accumulate_rewards()
            # Any seat will do: every one of them is terminated, and the dead-step protocol walks
            # the rest from here.
            self.agent_selection = self.agents[0]
            return

        self._accumulate_rewards()
        assert step.agent is not None
        self.agent_selection = self._agent(step.agent)

    def render(self) -> Optional[str]:
        if self.render_mode != "ansi" or self._env.engine is None:
            return None

        engine = self._env.engine
        lines = [
            f"round {engine.round.round_number}  turn {engine.ctx_turn}  "
            f"trump {engine.round.trump_rank}  table {engine.table_card_count()}"
            f"/{engine.round.max_cards_on_table}  direction {engine.round.direction}"
        ]
        for player_id in engine.seat_order:
            player = engine.players[player_id]
            marker = ">" if player_id == engine.current_player else " "
            state = "left" if player.has_left else f"{len(player.hand)} cards"
            lines.append(f" {marker} seat {player_id}: {state}, {player.points} points")
        return "\n".join(lines)

    def close(self) -> None:
        return None


def env(**kwargs: Any) -> BlowCowAECEnv:
    return BlowCowAECEnv(**kwargs)

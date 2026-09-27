"""The self-play environment over one Ante round.

Turn-based and sequential: each :meth:`AnteEnv.step` names the seat that acts next. Reward is
terminal and arrives at most a few dozen decisions after the action that caused it, which is the
whole reason this subgame exists — the classic game's diagnosis was **credit assignment**, a
placement folded over ninety rounds (see `rl/README.md`). Here a `Call BS` is answered immediately.

Two properties the classic environment does not have, and both are worth stating because they delete
machinery it needed:

* **Every episode terminates.** Hands only shrink and `n` consecutive passes end the round, so there
  is no non-terminating cycle, no move limit, and nothing to truncate. Discounting is therefore
  unnecessary as well as harmful, and `gamma` is 1.
* **The reward is the rules' own.** `+1` to the round's winner, `-1` to a lost `Call BS`, `0`
  otherwise — literally the gold that changes hands, with no shaping to get a sign wrong.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence

import numpy as np

from .config import AnteConfig, DEFAULT_CONFIG
from .game import AnteRound
from .observation import ObservationEncoder
from .spaces import ActionSpace


@dataclass
class Decision:
    """What the environment hands back: whose turn it is, what they see, and what they may do.

    ``game`` is the live round, carried for the scripted baselines — they read the position rather
    than the vector, the way `rl/blowcow/agents.py` reads the engine. It is *not* a licence to look
    at another seat's hand: `scripted agents are honest` in `rl/ante_check.py` reshuffles everything
    the acting seat cannot see and requires each baseline to choose the same action, so a bot that
    peeks fails a check rather than quietly setting the bar somewhere unreachable.
    """

    seat: int
    observation: np.ndarray
    action_mask: np.ndarray
    terminated: bool
    rewards: np.ndarray
    game: Optional[AnteRound] = None
    info: Dict[str, Any] = field(default_factory=dict)


class AnteEnv:
    """One Ante round per episode."""

    def __init__(
        self,
        config: AnteConfig = DEFAULT_CONFIG,
        seed: Optional[int] = None,
    ) -> None:
        self.config = config
        self.space = ActionSpace(config)
        self.encoder = ObservationEncoder(config)
        self.rng = random.Random(seed)
        self.game: Optional[AnteRound] = None

    # ----------------------------------------------------------------- sizes

    @property
    def observation_size(self) -> int:
        return self.encoder.size

    @property
    def action_size(self) -> int:
        return self.space.size

    @property
    def num_players(self) -> int:
        return self.config.num_players

    # ----------------------------------------------------------------- loop

    def reset(self, hands: Optional[Sequence[Sequence[int]]] = None) -> Decision:
        self.game = AnteRound.deal(self.config, rng=self.rng, hands=hands)
        return self._decision()

    def step(self, action_index: int) -> Decision:
        assert self.game is not None, "reset() first"
        if self.game.finished:
            raise RuntimeError("The round is over; reset() before stepping again.")
        self.game.apply(self.space.decompose(int(action_index)))
        return self._decision()

    def _decision(self) -> Decision:
        game = self.game
        assert game is not None

        if game.finished:
            return Decision(
                seat=game.current,
                observation=np.zeros(self.encoder.size, dtype=np.float32),
                action_mask=np.zeros(self.space.size, dtype=bool),
                terminated=True,
                rewards=np.asarray(game.rewards(), dtype=np.float32),
                info={
                    "ending": game.ending,
                    "winner": game.winner,
                    "loser": game.loser,
                    "turns": game.turn,
                },
            )

        return Decision(
            seat=game.current,
            observation=self.encoder.encode(game, game.current),
            action_mask=np.asarray(self.space.legal_mask(game), dtype=bool),
            terminated=False,
            rewards=np.zeros(self.config.num_players, dtype=np.float32),
            game=game,
        )

    # ----------------------------------------------------------------- helpers

    def observe_all(self) -> np.ndarray:
        """Every seat's view of the current position, for a critic trained off-turn.

        The classic work found its value head was only ever trained where it was the player to move,
        while a search leaf is always a position somebody else is on the clock for — an
        off-distribution question at essentially every leaf. Recording all seats costs nothing here.
        """
        assert self.game is not None
        return np.stack(
            [self.encoder.encode(self.game, seat) for seat in range(self.config.num_players)]
        )

    def sample_action(self) -> int:
        assert self.game is not None
        legal = np.flatnonzero(np.asarray(self.space.legal_mask(self.game), dtype=bool))
        return int(legal[self.rng.randrange(legal.size)])


def play_episode(
    env: AnteEnv,
    policies: Sequence[Any],
    collect: Optional[List[Decision]] = None,
) -> Decision:
    """Run one round with one policy per seat. ``policies[i].act(decision) -> action index``."""
    decision = env.reset()
    while not decision.terminated:
        if collect is not None:
            collect.append(decision)
        decision = env.step(policies[decision.seat].act(decision))
    return decision

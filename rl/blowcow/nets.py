"""The policy and value network.

Two things shape it.

**The card-type rows are interchangeable.** `canonical.py` already relabels rank identity away per
episode; running one shared encoder over the fourteen card-type rows makes the network *structurally*
indifferent to which slot a rank landed in, so it learns "three of something and the trump is
elsewhere" once instead of thirteen times.

**The action space is a product, not a list.** 1,669 logits from a dense head would be a 1,669-way
lookup that has to rediscover that ``trumpPlay(slot 4, two Jokers)`` and ``trumpPlay(slot 9, two
Jokers)`` are the same card decision. Instead the head is built out of the pieces: a per-choice logit
assembled from the embeddings of the one or two card types it sends, a per-slot trump logit, and a
low-rank interaction between them. That keeps the trump and card decisions correlated — which they
are, since the rank you name decides which of your cards are honest — without materialising a
13 x 119 head.
"""

from __future__ import annotations

from typing import Optional, Tuple

import torch
from torch import nn

from .canonical import NUM_CARD_TYPES, NUM_RANK_SLOTS
from .observation import (
    EVENT_BLOCK_START,
    EVENT_ROW_FEATURES,
    GLOBAL_FEATURES,
    MAX_SEATS,
    OBSERVATION_SIZE,
    RANK_BLOCK_START,
    RANK_ROW_FEATURES,
    RECENT_EVENTS,
    SEAT_BLOCK_START,
    SEAT_ROW_FEATURES,
)
from .spaces import CARD_CHOICES, NUM_ACTIONS, NUM_CARD_CHOICES, PLAY_BASE, TRUMP_PLAY_BASE

#: Logits below this are treated as impossible. Not -inf, which turns into NaN the moment an
#: optimiser touches it.
MASKED_LOGIT = -1e9


def _mlp(sizes: Tuple[int, ...], activation: type[nn.Module] = nn.ReLU) -> nn.Sequential:
    layers: list[nn.Module] = []
    for index in range(len(sizes) - 1):
        layers.append(nn.Linear(sizes[index], sizes[index + 1]))
        if index < len(sizes) - 2:
            layers.append(activation())
    return nn.Sequential(*layers)


def _orthogonal_init(module: nn.Module, gain: float = 1.0) -> nn.Module:
    for layer in module.modules():
        if isinstance(layer, nn.Linear):
            nn.init.orthogonal_(layer.weight, gain)
            nn.init.zeros_(layer.bias)
    return module


class BlowCowNet(nn.Module):
    def __init__(
        self,
        hidden: int = 256,
        type_dim: int = 64,
        seat_dim: int = 32,
        event_dim: int = 16,
        interaction_rank: int = 16,
        aux_lie_head: bool = False,
    ) -> None:
        """``aux_lie_head`` adds a second output: is the current BS target lying?

        Off by default, and off is what makes a checkpoint saved before it existed still load — the
        flag rides in ``net_kwargs``. It exists because "is that claim a lie" is the one inference the
        whole game turns on, it is computable from public information the observation already
        carries, and a placement reward arriving forty decisions later is a very thin way to teach it.
        The label is free during self-play and is never needed at inference.
        """
        super().__init__()
        self.type_dim = type_dim

        self.type_encoder = _orthogonal_init(_mlp((RANK_ROW_FEATURES, type_dim, type_dim)), 2**0.5)
        self.seat_encoder = _orthogonal_init(_mlp((SEAT_ROW_FEATURES, seat_dim, seat_dim)), 2**0.5)
        self.event_encoder = _orthogonal_init(_mlp((EVENT_ROW_FEATURES, event_dim)), 2**0.5)

        trunk_input = (
            GLOBAL_FEATURES
            + 2 * type_dim  # mean and max over the interchangeable card-type rows
            + MAX_SEATS * seat_dim  # concatenated: seat order carries meaning, unlike rank order
            + RECENT_EVENTS * event_dim
        )
        self.trunk = _orthogonal_init(
            nn.Sequential(
                nn.Linear(trunk_input, hidden),
                nn.ReLU(),
                nn.Linear(hidden, hidden),
                nn.ReLU(),
            ),
            2**0.5,
        )

        # The context is mixed back into each card-type row, so a row's embedding can depend on the
        # table as well as on the hand.
        self.context_to_type = _orthogonal_init(nn.Linear(hidden, type_dim), 1.0)

        self.base_head = _orthogonal_init(nn.Linear(hidden, 3), 0.01)
        self.choice_head = _orthogonal_init(_mlp((type_dim + 3, type_dim, 1)), 0.01)
        self.choice_head_trump = _orthogonal_init(_mlp((type_dim + 3, type_dim, 1)), 0.01)
        self.trump_head = _orthogonal_init(_mlp((type_dim, type_dim, 1)), 0.01)
        self.trump_u = _orthogonal_init(nn.Linear(type_dim, interaction_rank), 0.01)
        self.choice_v = _orthogonal_init(nn.Linear(type_dim + 3, interaction_rank), 0.01)
        self.value_head = _orthogonal_init(_mlp((hidden, hidden, 1)), 1.0)
        self.lie_head = (
            _orthogonal_init(_mlp((hidden, hidden // 2, 1)), 1.0) if aux_lie_head else None
        )

        first = torch.tensor([choice[0] for choice in CARD_CHOICES], dtype=torch.long)
        second = torch.tensor([choice[-1] for choice in CARD_CHOICES], dtype=torch.long)
        # Three flags per choice: one card, two of different types, two of the same type.
        kinds = torch.zeros(NUM_CARD_CHOICES, 3)
        for index, choice in enumerate(CARD_CHOICES):
            kinds[index, 0 if len(choice) == 1 else (2 if choice[0] == choice[1] else 1)] = 1.0

        self.register_buffer("choice_first", first, persistent=False)
        self.register_buffer("choice_second", second, persistent=False)
        self.register_buffer("choice_kind", kinds, persistent=False)

    def forward(self, observation: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        """Returns unmasked logits over the full action space, and the value estimate."""
        batch = observation.shape[0]

        global_block = observation[:, :RANK_BLOCK_START]
        type_rows = observation[:, RANK_BLOCK_START:SEAT_BLOCK_START].view(
            batch, NUM_CARD_TYPES, RANK_ROW_FEATURES
        )
        seat_rows = observation[:, SEAT_BLOCK_START:EVENT_BLOCK_START].view(
            batch, MAX_SEATS, SEAT_ROW_FEATURES
        )
        event_rows = observation[:, EVENT_BLOCK_START:].view(
            batch, RECENT_EVENTS, EVENT_ROW_FEATURES
        )

        type_h = self.type_encoder(type_rows)  # (B, 14, D)
        seat_h = self.seat_encoder(seat_rows).flatten(1)
        event_h = self.event_encoder(event_rows).flatten(1)

        context = self.trunk(
            torch.cat(
                [global_block, type_h.mean(dim=1), type_h.amax(dim=1), seat_h, event_h], dim=1
            )
        )
        type_h = torch.relu(type_h + self.context_to_type(context).unsqueeze(1))

        # One representation per card choice, built from the types it sends. Adding the two
        # embeddings keeps a pair symmetric, which it is: sending A then B is sending B then A.
        choice_repr = torch.cat(
            [
                type_h[:, self.choice_first] + type_h[:, self.choice_second],
                self.choice_kind.unsqueeze(0).expand(batch, -1, -1),
            ],
            dim=2,
        )  # (B, 119, D + 3)

        play_logits = self.choice_head(choice_repr).squeeze(-1)  # (B, 119)
        trump_choice_logits = self.choice_head_trump(choice_repr).squeeze(-1)  # (B, 119)
        trump_logits = self.trump_head(type_h[:, :NUM_RANK_SLOTS]).squeeze(-1)  # (B, 13)

        interaction = torch.einsum(
            "bsr,bcr->bsc",
            self.trump_u(type_h[:, :NUM_RANK_SLOTS]),
            self.choice_v(choice_repr),
        )  # (B, 13, 119)

        trump_play_logits = (
            trump_logits.unsqueeze(2) + trump_choice_logits.unsqueeze(1) + interaction
        ).flatten(1)

        logits = torch.cat([self.base_head(context), play_logits, trump_play_logits], dim=1)
        return logits, self.value_head(context).squeeze(-1)

    def lie_logit(self, observation: torch.Tensor) -> torch.Tensor:
        """The auxiliary head's raw logit. Shares the trunk, which is the entire point — the gradient
        is meant to shape the representation the policy reads, not to be consulted at play time."""
        if self.lie_head is None:
            raise RuntimeError("This network was built without an auxiliary lie head.")
        batch = observation.shape[0]
        global_block = observation[:, :RANK_BLOCK_START]
        type_rows = observation[:, RANK_BLOCK_START:SEAT_BLOCK_START].view(
            batch, NUM_CARD_TYPES, RANK_ROW_FEATURES
        )
        seat_rows = observation[:, SEAT_BLOCK_START:EVENT_BLOCK_START].view(
            batch, MAX_SEATS, SEAT_ROW_FEATURES
        )
        event_rows = observation[:, EVENT_BLOCK_START:].view(
            batch, RECENT_EVENTS, EVENT_ROW_FEATURES
        )
        type_h = self.type_encoder(type_rows)
        context = self.trunk(
            torch.cat(
                [
                    global_block,
                    type_h.mean(dim=1),
                    type_h.amax(dim=1),
                    self.seat_encoder(seat_rows).flatten(1),
                    self.event_encoder(event_rows).flatten(1),
                ],
                dim=1,
            )
        )
        return self.lie_head(context).squeeze(-1)

    @staticmethod
    def masked_logits(logits: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
        return torch.where(mask, logits, torch.full_like(logits, MASKED_LOGIT))

    def act(
        self,
        observation: torch.Tensor,
        mask: torch.Tensor,
        deterministic: bool = False,
        generator: Optional[torch.Generator] = None,
        with_entropy: bool = False,
    ) -> Tuple[torch.Tensor, torch.Tensor, Optional[torch.Tensor], torch.Tensor]:
        """Sample an action. Returns ``(action, log_prob, entropy, value)``.

        Entropy is off by default: a rollout never uses it, and computing it over 1,669 classes for
        every step of every environment is pure waste. The PPO update gets it from ``evaluate``.
        """
        logits, value = self.forward(observation)
        logits = self.masked_logits(logits, mask)
        log_probabilities = torch.log_softmax(logits, dim=1)

        if deterministic:
            action = logits.argmax(dim=1)
        else:
            action = torch.multinomial(
                log_probabilities.exp(), 1, generator=generator
            ).squeeze(1)

        chosen = log_probabilities.gather(1, action.unsqueeze(1)).squeeze(1)
        entropy = None
        if with_entropy:
            entropy = -(log_probabilities.exp() * log_probabilities).sum(dim=1)

        return action, chosen, entropy, value

    def evaluate(
        self, observation: torch.Tensor, mask: torch.Tensor, action: torch.Tensor
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        logits, value = self.forward(observation)
        distribution = torch.distributions.Categorical(logits=self.masked_logits(logits, mask))
        return distribution.log_prob(action), distribution.entropy(), value


def action_space_sanity() -> None:
    """The head's layout has to line up with `spaces.py`. Cheap enough to assert on import."""
    assert PLAY_BASE == 3
    assert TRUMP_PLAY_BASE == PLAY_BASE + NUM_CARD_CHOICES
    assert NUM_ACTIONS == TRUMP_PLAY_BASE + NUM_RANK_SLOTS * NUM_CARD_CHOICES
    assert OBSERVATION_SIZE == EVENT_BLOCK_START + RECENT_EVENTS * EVENT_ROW_FEATURES


action_space_sanity()

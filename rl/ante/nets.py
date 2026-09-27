"""The policy/value network, and the wrapper that plays a saved one.

Two structural choices, both aimed at the same thing: the network should not have to rediscover that
rank identity means nothing and that a play is honest exactly when its cards are trump.

**A shared encoder over the card-type rows.** The same small MLP runs over every type row, so the
network is *structurally* indifferent to which slot a rank landed in — "three of something, and the
trump is elsewhere" is learned once rather than seven times. The rows are pooled into the trunk and
kept per-row for the head.

**A factored action head with the honesty structure supplied.** A flat head over `2 + C + T*C` logits
would be a lookup table that has to rediscover that `trumpPlay(slot 3, two of type 3)` and
`trumpPlay(slot 5, two of type 5)` are the same decision. Instead the trump-play logit is assembled
from a per-slot logit, a per-choice logit, and a learned gate over a **static** table saying, for
each (slot, choice), how many of those cards would be trump. That table is exact and free: it depends
on nothing but the two indices, and it is the one thing a trump-selecting play turns on that the
observation cannot show — the candidate rank is not marked as trump yet, because it is not trump yet.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional, Tuple

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from .config import AnteConfig, DEFAULT_CONFIG
from .env import Decision
from .observation import ObservationEncoder
from .spaces import ActionSpace

#: What the static (slot, choice) table carries. Six numbers, all exact.
STATIC_FEATURES = 6

#: The tensors whose input width can grow, and which `load_round_weights` therefore zero-pads on the
#: right rather than refusing. `trunk.0.weight` grows by the match block; the two head tensors grow by
#: the one honesty column `lie_to_policy` appends. In every case the new columns are *appended*, so
#: the incoming weights keep their meaning and the padding contributes nothing until it is trained.
COLUMN_PADDED = ("trunk.0.weight", "simple_head.weight", "context.weight")


def build_static_table(config: AnteConfig, space: ActionSpace) -> np.ndarray:
    """For every trump slot and card choice: how honest that play would be, and what it spends."""
    joker = config.joker_type
    table = np.zeros((config.num_trump_slots, space.num_choices, STATIC_FEATURES), dtype=np.float32)

    for slot in range(config.num_trump_slots):
        off_deck = slot == config.off_deck_trump
        for choice_index, choice in enumerate(space.choices):
            trump_cards = sum(
                1 for card_type in choice if card_type == joker or (not off_deck and card_type == slot)
            )
            table[slot, choice_index] = (
                trump_cards / 2.0,
                1.0 if trump_cards == len(choice) else 0.0,
                1.0 if trump_cards == 0 else 0.0,
                len(choice) / 2.0,
                1.0 if off_deck else 0.0,
                sum(1 for card_type in choice if card_type == joker) / 2.0,
            )
    return table


def mlp(sizes: Tuple[int, ...]) -> nn.Sequential:
    layers: list[nn.Module] = []
    for index in range(len(sizes) - 1):
        layers.append(nn.Linear(sizes[index], sizes[index + 1]))
        if index < len(sizes) - 2:
            layers.append(nn.ReLU())
    return nn.Sequential(*layers)


class AnteNet(nn.Module):
    def __init__(
        self,
        config: AnteConfig = DEFAULT_CONFIG,
        hidden: int = 256,
        type_dim: int = 32,
        head_dim: int = 64,
        extra_width: int = 0,
        value_scale: float = 1.0,
        lie_head: bool = False,
        lie_to_policy: bool = False,
        challenge_head: bool = False,
    ) -> None:
        """``extra_width`` is the match block appended by `ante/match_observation.py`, or 0.

        It rides into the trunk with the seat and event rows rather than getting a path of its own,
        which is what keeps a one-round checkpoint loadable: at 0 this builds exactly the network the
        one-round runs were trained with, tensor for tensor. The match block gets no shared encoder
        because its rows are not interchangeable — they are ordered by how soon that seat acts, the
        same ordering the round's seat rows already use flat.
        """
        super().__init__()
        if lie_to_policy and not lie_head:
            raise ValueError("lie_to_policy needs lie_head: there is no prediction to hand over")
        self.config = config
        self.space = ActionSpace(config)
        encoder = ObservationEncoder(config)
        self.extra_width = extra_width
        self.lie_to_policy = lie_to_policy
        # The value head is `value_scale * tanh(...)`, so this is the largest return it can express.
        # One round pays out in {-1, 0, +1} and `1.0` covers it exactly, which is why the one-round
        # runs never needed the parameter. A match pays out once a round, so the bound is the number
        # of rounds — leaving it at 1.0 there would saturate the head on the first good match and
        # flatten every advantage behind it.
        self.value_scale = value_scale
        self.observation_size = encoder.size + extra_width
        self.action_size = self.space.size

        self.global_width = sum(1 for name in encoder.names if "." not in name)
        self.type_width = sum(1 for name in encoder.names if name.startswith("type0."))
        self.seat_width = sum(1 for name in encoder.names if name.startswith("seat+0."))
        self.event_width = sum(1 for name in encoder.names if name.startswith("event-0."))
        self.num_types = config.num_types
        self.num_slots = config.num_trump_slots
        self.num_choices = self.space.num_choices

        self.type_encoder = mlp((self.type_width, type_dim, type_dim))
        trunk_in = (
            self.global_width
            + 2 * type_dim
            + config.num_players * self.seat_width
            + config.recent_events * self.event_width
            + extra_width
        )
        self.trunk = nn.Sequential(nn.Linear(trunk_in, hidden), nn.ReLU(), nn.Linear(hidden, hidden), nn.ReLU())
        # One extra input column when the honesty prediction is handed to the heads: see
        # `lie_to_policy` below. It is appended, never inserted, so the first `hidden` columns of both
        # of these are the ones a network without it was trained with.
        head_in = hidden + (1 if lie_to_policy else 0)
        self.context = nn.Linear(head_in, head_dim)

        self.simple_head = nn.Linear(head_in, 2)  # Pass, Call BS
        # Two outputs each: the logit for a plain `Play`, and the choice half of a trump-selecting one.
        self.single_head = mlp((head_dim + type_dim, head_dim, 2))
        self.pair_head = mlp((head_dim + 2 * type_dim, head_dim, 2))
        self.slot_head = mlp((head_dim + type_dim, head_dim, 1))
        self.off_deck_slot = nn.Parameter(torch.zeros(type_dim))
        self.static_gate = nn.Linear(hidden, STATIC_FEATURES)
        self.value_head = mlp((hidden, head_dim, 1))
        # An auxiliary head predicting "is the current `Call BS` target's live claim a lie".
        #
        # It exists because the measured ceiling turned out to be *extraction*, not information: a
        # supervised probe on these very features reaches 0.851 AUC on a homogeneous table where the
        # trained policy's own call probability reaches 0.675, and 0.401 against a bluffer. PPO is
        # simply a poor way to learn this function when the reward is several decisions away, and
        # the label is free — every `Call BS` opportunity resolves a few turns later when the cards
        # go face up, so the trainer can read it off ground truth at collection time.
        #
        # Built only on request, so a network without it is tensor-for-tensor the one the earlier
        # runs were trained with and their checkpoints still load. Using ground truth to *train* a
        # head is not cheating in the way an observation feature would be: at play time the head
        # reads the observation like everything else, exactly as the value head does with returns.
        self.lie_head = mlp((hidden, head_dim, 1)) if lie_head else None
        # A second auxiliary head on the same principle, predicting **"will the play I am about to
        # make be challenged"**. It is the dual of the one above: the honesty head represents *is the
        # opponent lying*, this one represents *how suspicious does this table find me*, and a bluff
        # decision turns on exactly that. The label is as free as the honesty one and arrives the same
        # way — a play is challenged or it is not, and the round says so a few turns later — so the
        # trainer reads it off the rollout at no cost.
        #
        # **It is conditioned on the state and not on the action**, because the trunk it reads is
        # computed from the observation alone. So what it estimates is `P(challenged | this position,
        # this policy)` rather than the challenge probability of one specific play. That is the
        # quantity a risk model wants and it is well-posed; it is not a per-action estimate, and a
        # future action-conditioned version would need a head over the action space rather than a
        # scalar.
        #
        # Like `lie_head` with `lie_to_policy` off, it feeds **nothing**: it is a training-time loss
        # that shapes the shared trunk, which is where `rl/ANTE.md` measures the honesty head's whole
        # value coming from. So a network carrying it is bit-identical in policy and value to one
        # without at every step, `export_ante_round.py` drops its tensors, and nothing in the browser
        # port changes. `challenge head` in `ante_match_check.py` holds that.
        self.challenge_head = mlp((hidden, head_dim, 1)) if challenge_head else None
        # `lie_to_policy` hands the head's *output* to the action heads rather than leaving it a pure
        # auxiliary loss. As an auxiliary loss it only shapes the shared trunk and the policy has to
        # rediscover how to read it back out — which is precisely the extraction step `rl/ANTE.md`
        # measures the policy failing at (0.675 call-probability AUC where a supervised probe on the
        # identical features reaches 0.851, and 0.401 against a bluffer).
        #
        # Two decisions, and both are the point rather than details.
        #
        # **The prediction is detached.** The head is then trained by its BCE label alone and the
        # policy consumes it as a fixed feature. Letting the policy gradient into the head would put
        # PPO back in charge of the one function this file's whole diagnosis says PPO learns badly,
        # which would defeat the reason for handing it over at all. The trunk still gets policy
        # gradient directly through `hidden`.
        #
        # **The new columns are zeroed at construction.** So at step zero a `lie_to_policy` network is
        # *exactly* the network without it, the way `load_round_weights` makes a warm-started match
        # network exactly its one-round source. Whatever the arm gains is then attributable to the
        # feed rather than to a differently-initialised head, which is what makes the comparison
        # against its own ablation readable. `lie feed` in `ante_match_check.py` holds it.
        if lie_to_policy:
            with torch.no_grad():
                self.simple_head.weight[:, hidden:].zero_()
                self.context.weight[:, hidden:].zero_()

        pair_left: list[int] = []
        pair_right: list[int] = []
        for left in range(self.num_types):
            for right in range(left, self.num_types):
                pair_left.append(left)
                pair_right.append(right)
        self.register_buffer("pair_left", torch.tensor(pair_left, dtype=torch.long))
        self.register_buffer("pair_right", torch.tensor(pair_right, dtype=torch.long))
        self.register_buffer("static", torch.from_numpy(build_static_table(config, self.space)))

    # ----------------------------------------------------------------- forward

    def forward(self, observation: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        logits, value, _, _, _ = self._compute(observation)
        return logits, value

    def _compute(
        self, observation: torch.Tensor
    ) -> Tuple[
        torch.Tensor, torch.Tensor, torch.Tensor, Optional[torch.Tensor], Optional[torch.Tensor]
    ]:
        """The whole network, returning the trunk's output and both auxiliary logits as well.

        The honesty logit is computed here rather than by the caller because `lie_to_policy` feeds it
        back into the action heads, so it has to exist before they run. The challenge logit feeds
        nothing and is returned for its loss alone.
        """
        batch = observation.shape[0]
        cursor = 0
        globals_ = observation[:, cursor : cursor + self.global_width]
        cursor += self.global_width
        type_rows = observation[:, cursor : cursor + self.num_types * self.type_width].reshape(
            batch, self.num_types, self.type_width
        )
        cursor += self.num_types * self.type_width
        rest = observation[:, cursor:]

        embeddings = self.type_encoder(type_rows)  # (B, T, D)
        pooled = torch.cat([embeddings.mean(dim=1), embeddings.amax(dim=1)], dim=-1)
        hidden = self.trunk(torch.cat([globals_, pooled, rest], dim=-1))
        lie = None if self.lie_head is None else self.lie_head(hidden).squeeze(-1)
        challenge = (
            None if self.challenge_head is None else self.challenge_head(hidden).squeeze(-1)
        )
        # Detached, and as a probability rather than a logit: the heads read a calibrated number in
        # [0, 1] whose scale does not drift as the head sharpens.
        head_input = (
            torch.cat([hidden, torch.sigmoid(lie).detach().unsqueeze(-1)], dim=-1)
            if self.lie_to_policy and lie is not None
            else hidden
        )
        context = self.context(head_input)

        simple = self.simple_head(head_input)  # (B, 2)

        expanded = context.unsqueeze(1).expand(batch, self.num_types, context.shape[-1])
        singles = self.single_head(torch.cat([expanded, embeddings], dim=-1))  # (B, T, 2)

        left = embeddings[:, self.pair_left]
        right = embeddings[:, self.pair_right]
        pair_context = context.unsqueeze(1).expand(batch, left.shape[1], context.shape[-1])
        # Symmetric in the two cards, because a choice is an unordered multiset.
        pairs = self.pair_head(torch.cat([pair_context, left + right, left * right], dim=-1))

        choices = torch.cat([singles, pairs], dim=1)  # (B, C, 2)
        play_logits = choices[:, :, 0]
        trump_choice_logits = choices[:, :, 1]

        slot_embeddings = embeddings[:, : self.config.num_ranks]
        if self.num_slots > self.config.num_ranks:
            off_deck = self.off_deck_slot.unsqueeze(0).unsqueeze(0).expand(batch, 1, -1)
            slot_embeddings = torch.cat([slot_embeddings, off_deck], dim=1)
        slot_context = context.unsqueeze(1).expand(batch, self.num_slots, context.shape[-1])
        slot_logits = self.slot_head(torch.cat([slot_context, slot_embeddings], dim=-1)).squeeze(-1)

        gate = self.static_gate(hidden)  # (B, K)
        interaction = torch.einsum("bk,sck->bsc", gate, self.static)
        trump_logits = (
            slot_logits.unsqueeze(-1) + trump_choice_logits.unsqueeze(1) + interaction
        ).reshape(batch, self.num_slots * self.num_choices)

        logits = torch.cat([simple, play_logits, trump_logits], dim=-1)
        # The critic reads the trunk alone. Whether it too should be handed the honesty prediction is
        # a separate question from the one this feed was built to answer, and mixing them in would
        # make the arm's gain unattributable.
        value = self.value_scale * torch.tanh(self.value_head(hidden)).squeeze(-1)
        return logits, value, hidden, lie, challenge

    # ----------------------------------------------------------------- sampling

    @staticmethod
    def masked_logits(logits: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
        return logits.masked_fill(~mask, float("-inf"))

    def policy(self, observation: torch.Tensor, mask: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        logits, value = self.forward(observation)
        return self.masked_logits(logits, mask), value

    def policy_and_lie(
        self, observation: torch.Tensor, mask: torch.Tensor
    ) -> Tuple[torch.Tensor, torch.Tensor, Optional[torch.Tensor]]:
        """Policy, value, and the auxiliary lie logit, from one pass through the trunk."""
        logits, value, _, lie, _ = self._compute(observation)
        return self.masked_logits(logits, mask), value, lie

    def policy_and_aux(
        self, observation: torch.Tensor, mask: torch.Tensor
    ) -> Tuple[torch.Tensor, torch.Tensor, Optional[torch.Tensor], Optional[torch.Tensor]]:
        """Policy, value, and **both** auxiliary logits, from one pass through the trunk.

        `policy_and_lie` is kept beside it rather than replaced: it is what every caller written
        before the second head uses, and widening its tuple would change them all for nothing.
        """
        logits, value, _, lie, challenge = self._compute(observation)
        return self.masked_logits(logits, mask), value, lie, challenge


def load_round_weights(net: "AnteNet", state: dict, reset_value_head: bool = True) -> None:
    """Load a **one-round** checkpoint into a match network, zeroing the match block's influence.

    Appending the match features to the observation made the first trunk layer wider, which is the
    one tensor whose shape differs between the two networks. Everything else — the type encoder, the
    second trunk layer, every head, every buffer — is decided by the config alone and matches exactly.

    So the round weights are copied into the first `round_width` columns and the remaining columns are
    **zeroed**. At step zero the resulting network is therefore not merely initialised from the
    one-round agent, it *is* the one-round agent: the match features multiply by zero and cannot
    change a single logit. Whatever it goes on to gain is attributable to the match layer rather than
    to having trained longer, which is what makes "does the match block add anything" answerable at
    all. Without this the only available comparison is a from-scratch match agent against a
    longer-trained round agent, which confounds the two.

    The auxiliary honesty head, if present, is left at its random initialisation — there is nothing in
    a one-round checkpoint to load into it.

    **The same padding covers `lie_to_policy`**, which appends one more input column to `simple_head`
    and `context`. Three tensors can therefore be narrower in the incoming state than in the network,
    and all three are widened the same way: copy what came in, zero the rest. The property that buys
    is the same one — a checkpoint trained without the honesty feed loads into a network that has it
    and *is* that checkpoint at step zero, so an arm can be warm-started from the shipped agent and
    its gain attributed to the feed rather than to a re-rolled head. `COLUMN_PADDED` names them, and
    a tensor not on that list still has to match exactly.

    **The value head is reset, and that is not optional.** It is the one part of a one-round network
    that predicts a quantity the match does not have: a round's return lives in `{-1, 0, +1}` and was
    read through `1.0 * tanh(...)`, while a match return spans the number of rounds and is read
    through `value_scale * tanh(...)`. Carrying the old weights across multiplies every prediction by
    the new scale, which is not a miscalibration that training quickly repairs — it is a value
    function answering a different question, and it poisons every advantage until it is unlearned.
    Measured: warm-starting with the head loaded put `explained_variance` at **-2.9 to -4.5**, i.e.
    worse than predicting the mean. Resetting it costs one thing only, a few thousand decisions of
    high-variance advantages, and `pass reset_value_head=False` recovers the exact-identity behaviour
    when that is what is being tested.
    """
    own = net.state_dict()
    incoming = dict(state)
    if reset_value_head:
        for key in list(incoming):
            if key.startswith("value_head."):
                incoming.pop(key)

    for key in COLUMN_PADDED:
        saved = incoming.get(key)
        if saved is None or key not in own or saved.shape == own[key].shape:
            continue
        if saved.shape[0] != own[key].shape[0] or saved.shape[1] > own[key].shape[1]:
            raise ValueError(
                f"{key} is {tuple(saved.shape)}, which does not fit {tuple(own[key].shape)}"
            )
        padded = torch.zeros_like(own[key])
        padded[:, : saved.shape[1]] = saved
        incoming[key] = padded

    missing = [key for key in own if key not in incoming]
    for key in missing:
        incoming[key] = own[key]
    net.load_state_dict(incoming, strict=True)


def infer_head_options(state: dict, hidden: int) -> Tuple[bool, bool, bool]:
    """Read `lie_head`, `lie_to_policy` and `challenge_head` back off a saved state dict.

    The tensors are the authority rather than the manifest keys beside them, for the reason
    `_restore_pool` already reads `extra_width` off `trunk.0.weight`: a shape cannot drift from itself,
    and a checkpoint written before a key existed has no key to read. `simple_head.weight` is one
    column wider than the trunk's output exactly when the honesty prediction is fed to the heads.
    """
    lie_head = any(key.startswith("lie_head.") for key in state)
    challenge_head = any(key.startswith("challenge_head.") for key in state)
    weight = state.get("simple_head.weight")
    lie_to_policy = weight is not None and int(weight.shape[1]) > hidden
    return lie_head, lie_to_policy, challenge_head


class CheckpointAgent:
    """Plays a saved policy. Greedy or sampled, and never on the training path."""

    def __init__(
        self,
        path: str,
        config: AnteConfig = DEFAULT_CONFIG,
        seed: Optional[int] = None,
        temperature: float = 1.0,
        device: str = "cpu",
    ) -> None:
        self.name = f"ckpt:{Path(path).name}"
        self.device = torch.device(device)
        checkpoint = torch.load(path, map_location=self.device, weights_only=False)
        saved = checkpoint.get("config")
        if saved is not None and (saved["num_players"], saved["num_ranks"]) != (
            config.num_players,
            config.num_ranks,
        ):
            raise ValueError(
                f"{path} was trained for {saved['num_players']}p/{saved['num_ranks']}r, "
                f"not {config.num_players}p/{config.num_ranks}r"
            )
        self.net = AnteNet(
            config,
            hidden=checkpoint.get("hidden", 256),
            type_dim=checkpoint.get("type_dim", 32),
        ).to(self.device)
        self.net.load_state_dict(checkpoint["model"])
        self.net.eval()
        self.temperature = temperature
        self._generator = torch.Generator(device="cpu")
        if seed is not None:
            self._generator.manual_seed(seed)

    @torch.no_grad()
    def act(self, decision: Decision) -> int:
        observation = torch.from_numpy(decision.observation).unsqueeze(0).to(self.device)
        mask = torch.from_numpy(decision.action_mask).unsqueeze(0).to(self.device)
        logits, _ = self.net.policy(observation, mask)
        if self.temperature <= 0.0:
            return int(logits.argmax(dim=-1).item())
        probabilities = F.softmax(logits / self.temperature, dim=-1).cpu()
        return int(torch.multinomial(probabilities, 1, generator=self._generator).item())

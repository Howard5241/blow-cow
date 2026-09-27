"""Agents that play a whole match, and the wrapper that puts a one-round agent in one.

Three kinds sit here:

* The **scripted baselines** from `ante/agents.py`, unchanged. They read `decision.game` and nothing
  else, and `MatchDecision.game` is the live round, so the five bots that set the bar in the subgame
  set it here too.
* :class:`MatchCheckpointAgent`, a saved match policy.
* :class:`RoundOnlyAgent`, which is the measurement this whole layer has to beat. It runs a
  **one-round** checkpoint over a match by handing it the first 200 features and dropping the rest —
  which is exactly "play every round as if it were the only one". If the multi-round agent cannot
  beat that, the match context bought nothing and the extra 98 features are decoration.

**Blinding is per agent, and that is not a refinement.** `BLOWCOW_ANTE_NO_RECORD` is a process
global, so a table holding an ablation arm and a record-reading arm at once has no setting that is
right for both — and the ablation arm scored against live record columns is being asked a question it
was never trained on. Measured on `m-ante-norecord`, 200 matches against four copies of
`round:ante-s2-long`: **+1.640 gold** read out of distribution against **+1.135** read as trained,
with elimination at 1.0% against 3.5%. So the flag now rides in the checkpoint and the columns are
zeroed for that seat alone, exactly as `rl/blowcow/agents.py` does for the classic lie feature.
"""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path
from typing import List, Optional

import torch
import torch.nn.functional as F

from .agents import BASELINES
from .config import AnteConfig, DEFAULT_RECENT_EVENTS
from .match import MatchConfig
from .match_observation import MatchObservationEncoder
from .nets import AnteNet, infer_head_options
from .spaces import CALL_BS_INDEX, PASS_INDEX

#: The browser's gold guard, transcribed from `src/bots/ante/anteBotPolicy.ts` so the two cannot
#: drift while the question of whether it belongs in front of a match policy is open. Nothing on the
#: training path reads these; only the `guard:` spec does.
GOLD_CAUTION_THRESHOLD = 2
CAUTIOUS_CALL_CONFIDENCE = 0.6


class MatchCheckpointAgent:
    """Plays a saved match policy. Greedy or sampled, and never on the training path."""

    def __init__(
        self,
        path: str,
        config: MatchConfig,
        seed: Optional[int] = None,
        temperature: float = 1.0,
        device: str = "cpu",
        record_features: Optional[bool] = None,
        gold_guard: bool = False,
    ) -> None:
        self.name = f"ckpt:{Path(path).name}"
        self.device = torch.device(device)
        checkpoint = torch.load(path, map_location=self.device, weights_only=False)
        saved = checkpoint.get("config")
        table_shape = config.shape
        if saved is not None and (saved["num_players"], saved["num_ranks"]) != (
            table_shape.num_players,
            table_shape.num_ranks,
        ):
            raise ValueError(
                f"{path} was trained for {saved['num_players']}p/{saved['num_ranks']}r, "
                f"not {table_shape.num_players}p/{table_shape.num_ranks}r"
            )
        # The event window is the agent's, not the table's. A checkpoint written before the field
        # existed was trained at the default, which is what makes the fallback right rather than a
        # guess: 8 is the width every run in `rl/runs/` used.
        window = int((saved or {}).get("recent_events", DEFAULT_RECENT_EVENTS))
        shape = replace(table_shape, recent_events=window)
        own_config = replace(config, shape=shape)
        own_encoder = MatchObservationEncoder(own_config)
        # The match block normalises `round_progress` and `rounds_left` by `round_limit` and every
        # gold column by `starting_gold`, so scoring a 20-round agent over 30 rounds silently feeds it
        # a scale it never saw. `disclosure` is deliberately not checked: both modes read the same
        # table since every ending turns it face up, which is what `ante_match_check.py` asserts.
        match = checkpoint.get("match")
        if match is not None and (match["round_limit"], match["starting_gold"]) != (
            config.round_limit,
            config.starting_gold,
        ):
            raise ValueError(
                f"{path} was trained over {match['round_limit']} rounds at {match['starting_gold']} "
                f"gold, not {config.round_limit} rounds at {config.starting_gold}"
            )
        hidden = checkpoint.get("hidden", 256)
        # Read off the tensors rather than the keys beside them, so a checkpoint written before
        # `lie_to_policy` existed needs no key and cannot disagree with its own weights.
        lie_head, lie_to_policy, challenge_head = infer_head_options(checkpoint["model"], hidden)
        self.net = AnteNet(
            shape,
            hidden=hidden,
            type_dim=checkpoint.get("type_dim", 32),
            extra_width=checkpoint.get("extra_width", 0),
            value_scale=checkpoint.get("value_scale", 1.0),
            lie_head=lie_head,
            lie_to_policy=lie_to_policy,
            challenge_head=challenge_head,
        ).to(self.device)
        self.net.load_state_dict(checkpoint["model"])
        self.net.eval()
        self.width = self.net.observation_size
        self.temperature = temperature

        # A table encoding at a different window produces a vector this network cannot read by
        # slicing. Widening the window lengthens the *round* block, so the match block stops starting
        # where this policy expects it — the round block alone would still slice correctly, since the
        # event rows are newest-first and last in it, but nothing above depends on that holding. So a
        # mismatched seat re-encodes from the live match with its own encoder. This is the same shape
        # of fix as `_blind`: one shared vector, corrected for the one seat that needs it, rather than
        # a process-wide setting that cannot be right for two agents at once.
        self._encoder = None if window == table_shape.recent_events else own_encoder

        # An explicit argument wins; otherwise the checkpoint says so itself. A checkpoint written
        # before the key existed cannot be told apart by its width — the ablation zeroes columns
        # rather than dropping them — so the default is "the record was live", and the two legacy
        # ablation runs must be seated with the `norecord:` spec. See `make_match_agent`.
        if record_features is None:
            record_features = bool(checkpoint.get("record_features", True))
        self.record_features = record_features
        # Its own encoder's columns, since a different event window moves where the match block —
        # and so the record — begins.
        self._blind: List[int] = (
            []
            if record_features
            else [column for column in own_encoder.record_columns if column < self.width]
        )
        if not record_features:
            self.name = f"norecord:{Path(path).name}"

        self.gold_guard = gold_guard
        if gold_guard:
            self.name = f"guard:{Path(path).name}"

        self._generator = torch.Generator(device="cpu")
        if seed is not None:
            self._generator.manual_seed(seed)

    @torch.no_grad()
    def act(self, decision) -> int:
        if self._encoder is not None and decision.match is not None:
            raw = self._encoder.encode(decision.match, decision.seat)[: self.width]
        else:
            raw = decision.observation[: self.width]
        if self._blind:
            # Copied first: slicing gives a view and `torch.from_numpy` shares its memory, so zeroing
            # in place would edit the decision every other reader of it still holds.
            raw = raw.copy()
        observation = torch.from_numpy(raw).unsqueeze(0).to(self.device)
        if self._blind:
            # This seat alone. The encoder is global and may well be producing the record; this
            # policy was never trained to read it, so it is blinded here rather than by turning the
            # feature off for every chair at the table.
            observation[:, self._blind] = 0.0
        mask = torch.from_numpy(decision.action_mask).unsqueeze(0).to(self.device)
        logits, _ = self.net.policy(observation, mask)
        if self.temperature <= 0.0:
            chosen = int(logits.argmax(dim=-1).item())
        else:
            probabilities = F.softmax(logits / self.temperature, dim=-1).cpu()
            chosen = int(torch.multinomial(probabilities, 1, generator=self._generator).item())
        if self.gold_guard:
            chosen = self._apply_gold_guard(chosen, logits, decision)
        return chosen

    def _apply_gold_guard(self, chosen: int, logits, decision) -> int:
        """`applyGoldGuard` in `src/bots/ante/anteBotPolicy.ts`, transcribed.

        The browser clamps the one decision that can end a match outright, and it clamps it in front
        of *both* policies. This exists so that "should it still sit in front of a match policy that
        was trained to price its last coin" is a measured question rather than an argued one: seat
        `guard:<path>` against `ckpt:<path>` and read the gap. Nothing on the training path calls it.
        """
        if chosen != CALL_BS_INDEX:
            return chosen
        if decision.match.gold[decision.seat] > GOLD_CAUTION_THRESHOLD:
            return chosen
        # Softmax over the legal set — the mask is already applied to `logits` by `net.policy`.
        confidence = float(F.softmax(logits, dim=-1)[0, CALL_BS_INDEX].item())
        return chosen if confidence >= CAUTIOUS_CALL_CONFIDENCE else PASS_INDEX


class RoundOnlyAgent(MatchCheckpointAgent):
    """A one-round checkpoint playing a match, one round at a time and forgetting between them.

    The slice in :meth:`MatchCheckpointAgent.act` does all the work: a one-round network's
    `observation_size` is the round block's 200, so it reads the round and never sees the match block.
    That is not a handicap invented for the comparison — it is precisely the agent that exists today,
    and the honest control for "is the cross-round record worth anything".
    """

    def __init__(self, path: str, config: MatchConfig, **kwargs) -> None:
        super().__init__(path, config, **kwargs)
        prefix = "guard-round-only" if self.gold_guard else "round-only"
        self.name = f"{prefix}:{Path(path).name}"
        if self.net.extra_width != 0:
            raise ValueError(f"{path} is a match policy; seat it with ckpt: rather than round:")


def make_match_agent(spec: str, config: MatchConfig, seed: Optional[int] = None):
    """``random`` | ``honest`` | ``liar`` | ``caller`` | ``heuristic``, or a checkpoint.

    ``ckpt:<path>``      a match policy, blinded or not according to what the checkpoint says.
    ``norecord:<path>``  the same, forced to the ablation's view. Needed only for a checkpoint
                         written before `record_features` existed — `runs/m-ante-norecord` and
                         `runs/m-warm-norecord` are the two — since the ablation zeroes columns
                         rather than dropping them and nothing about the file gives it away.
    ``round:<path>``     a one-round policy, reading the round block and nothing else.
    ``guard:<path>``     a match policy with the browser's gold guard in front of it, which is what
                         actually ships. Seat it against the bare ``ckpt:`` to price the guard.
    ``guard-round:<path>``  the same for a one-round policy, which is the pairing the guard was
                         written for.
    """
    if spec.startswith("guard-round:"):
        return RoundOnlyAgent(
            spec[len("guard-round:") :], config, seed=seed, gold_guard=True
        )
    if spec.startswith("guard:"):
        return MatchCheckpointAgent(spec[len("guard:") :], config, seed=seed, gold_guard=True)
    if spec.startswith("ckpt:"):
        return MatchCheckpointAgent(spec[len("ckpt:") :], config, seed=seed)
    if spec.startswith("norecord:"):
        return MatchCheckpointAgent(
            spec[len("norecord:") :], config, seed=seed, record_features=False
        )
    if spec.startswith("round:"):
        return RoundOnlyAgent(spec[len("round:") :], config, seed=seed)
    if spec not in BASELINES:
        raise ValueError(
            f"Unknown agent {spec!r}; expected one of {sorted(BASELINES)}, "
            "ckpt:<path>, norecord:<path> or round:<path>"
        )
    return BASELINES[spec](config.shape, seed=seed)

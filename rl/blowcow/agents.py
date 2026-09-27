"""Agents: the baselines a learned policy has to beat, and the wrapper that turns a checkpoint into
one of them.

The baselines read the engine directly rather than the observation vector. That is deliberate — they
are yardsticks and opponents, not learners, so there is no reason to make them squint through an
encoding. It also means a baseline's strength is a fact about the *game*, not about the features.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Protocol, Sequence, Set, Tuple

import numpy as np

from .canonical import JOKER_TYPE, RankMapping
from .engine import BlowCowEngine
from .env import BlowCowEnv
from .observation import LIE_FEATURE_COLUMNS, lie_probability_from_counts
from .spaces import (
    ACTION_CALL_BS,
    ACTION_CALL_RESET,
    ACTION_PASS,
    decompose,
)


@dataclass
class Decision:
    """Everything an agent is allowed to look at, which for a bot is the whole public state."""

    env: BlowCowEnv
    player_id: str
    observation: np.ndarray
    mask: np.ndarray

    @property
    def engine(self) -> BlowCowEngine:
        assert self.env.engine is not None
        return self.env.engine

    @property
    def mapping(self) -> RankMapping:
        assert self.env.mapping is not None
        return self.env.mapping


class Agent(Protocol):
    name: str

    def act(self, decision: Decision) -> int: ...


@dataclass
class LegalGroups:
    simple: Set[int] = field(default_factory=set)
    plays: Dict[int, int] = field(default_factory=dict)  # choice index -> action index
    trump_plays: Dict[Tuple[int, int], int] = field(default_factory=dict)  # (slot, choice) -> index

    @property
    def trump_slots(self) -> Set[int]:
        return {slot for slot, _choice in self.trump_plays}


def group_legal(mask: np.ndarray) -> LegalGroups:
    groups = LegalGroups()
    for raw in np.flatnonzero(mask):
        index = int(raw)
        kind, slot, choice = decompose(index)
        if kind in ("pass", "callBS", "callReset"):
            groups.simple.add(index)
        elif kind == "play":
            groups.plays[choice] = index  # type: ignore[index]
        else:
            groups.trump_plays[(slot, choice)] = index  # type: ignore[index]
    return groups


def choice_types(choice_index: int) -> Tuple[int, ...]:
    from .spaces import CARD_CHOICES

    return CARD_CHOICES[choice_index]


# --------------------------------------------------------------------------- counting


def unaccounted_by_type(engine: BlowCowEngine, mapping: RankMapping, viewer_id: str) -> List[int]:
    """Copies of each card type the viewer cannot see: opponents' hands and face-down piles.

    The same statistic the observation hands the network. A bot that reasons about whether a claim is
    plausible needs exactly this, and nothing else in the game is hidden.
    """
    card_types = mapping.card_types
    counts = list(mapping.type_copies)

    for card in engine.players[viewer_id].hand:
        counts[card_types[card]] -= 1

    for play in engine.plays:
        for card in play.cards:
            if engine._is_card_face_up(play, card) or play.player_id == viewer_id:
                counts[card_types[card]] -= 1

    for player in engine.players.values():
        for scored_set in player.scored_sets:
            counts[mapping.slot(scored_set.rank)] -= 4

    return [max(0, value) for value in counts]


def face_up_trump_count(engine: BlowCowEngine) -> int:
    trump = engine.round.trump_rank
    if trump is None:
        return 0
    return sum(
        1
        for play in engine.plays
        for card in play.cards
        if engine._is_card_face_up(play, card) and engine.deck.rank[card] == trump
    )


def probability_claim_is_a_lie(
    engine: BlowCowEngine, mapping: RankMapping, viewer_id: str, target_id: str
) -> float:
    """A rough read on whether the target's hidden play was really all trump.

    Treats their cards as if drawn at random from what the viewer cannot see, then scales the honest
    branch up, because a player with trump in hand plays it far more often than chance. Crude, and
    still enough to beat calling at random by a wide margin.
    """
    play = engine._get_pending_play(target_id)
    trump = engine.round.trump_rank
    if play is None or trump is None:
        return 0.0

    claimed = len(engine._hidden_cards(play))
    if claimed == 0:
        return 0.0

    unaccounted = unaccounted_by_type(engine, mapping, viewer_id)
    trump_left = unaccounted[mapping.slot(trump)] + unaccounted[JOKER_TYPE]

    # The arithmetic lives in `observation` because the per-seat observation feature computes the
    # same number off its own already-walked tally, and two transcriptions would drift silently.
    return lie_probability_from_counts(claimed, trump_left, sum(unaccounted))


# --------------------------------------------------------------------------- baselines


class RandomAgent:
    """Uniform over legal actions. The floor everything else has to clear."""

    name = "random"

    def __init__(self, seed: Optional[int] = None) -> None:
        self._rng = random.Random(seed)

    def act(self, decision: Decision) -> int:
        legal = np.flatnonzero(decision.mask)
        return int(legal[self._rng.randrange(legal.size)])


class _ScriptedAgent:
    """Shared plumbing: pick a play by score, and fall back through the simple actions."""

    name = "scripted"

    def __init__(self, seed: Optional[int] = None) -> None:
        self._rng = random.Random(seed)

    def _fallback(self, groups: LegalGroups, mask: np.ndarray) -> int:
        for candidate in (ACTION_PASS, ACTION_CALL_RESET, ACTION_CALL_BS):
            if candidate in groups.simple:
                return candidate
        legal = np.flatnonzero(mask)
        return int(legal[self._rng.randrange(legal.size)])

    @staticmethod
    def _honest_types(trump_slot: Optional[int]) -> Set[int]:
        return {JOKER_TYPE} if trump_slot is None else {trump_slot, JOKER_TYPE}

    def _score_choice(
        self, choice_index: int, counts: Sequence[int], honest: Set[int]
    ) -> Tuple[int, int, int]:
        types = choice_types(choice_index)
        is_honest = all(card_type in honest for card_type in types)
        # Dumping from a rank you already hold three of is worth points: a fourth completes the set,
        # and a completed set is a point, and points are what lose this game.
        avoids_set = sum(1 for card_type in types if counts[card_type] == 3)
        return (int(is_honest), avoids_set, len(types))


class HonestBot(_ScriptedAgent):
    """Never lies. Plays trump when it holds trump, passes otherwise, never challenges."""

    name = "honest"

    def act(self, decision: Decision) -> int:
        engine, mapping = decision.engine, decision.mapping
        groups = group_legal(decision.mask)
        counts = mapping.hand_counts(engine.players[decision.player_id].hand)

        if groups.trump_plays:
            slot = max(
                groups.trump_slots,
                key=lambda candidate: (counts[candidate], -candidate),
            )
            honest = self._honest_types(slot)
            options = [choice for (s, choice) in groups.trump_plays if s == slot]
            honest_options = [
                choice for choice in options if all(t in honest for t in choice_types(choice))
            ]
            pool = honest_options or options
            best = max(pool, key=lambda choice: self._score_choice(choice, counts, honest))
            return groups.trump_plays[(slot, best)]

        if groups.plays:
            trump_slot = (
                mapping.slot(engine.round.trump_rank) if engine.round.trump_rank else None
            )
            honest = self._honest_types(trump_slot)
            honest_options = [
                choice
                for choice in groups.plays
                if all(t in honest for t in choice_types(choice))
            ]
            if honest_options:
                best = max(
                    honest_options, key=lambda choice: self._score_choice(choice, counts, honest)
                )
                return groups.plays[best]

        return self._fallback(groups, decision.mask)


class LiarBot(_ScriptedAgent):
    """Always puts cards down, truth be damned. Dumps the hand as fast as the table allows."""

    name = "liar"

    def act(self, decision: Decision) -> int:
        engine, mapping = decision.engine, decision.mapping
        groups = group_legal(decision.mask)
        counts = mapping.hand_counts(engine.players[decision.player_id].hand)

        if groups.trump_plays:
            slot = max(groups.trump_slots, key=lambda candidate: (counts[candidate], -candidate))
            options = [choice for (s, choice) in groups.trump_plays if s == slot]
            best = max(options, key=lambda choice: (len(choice_types(choice)),))
            return groups.trump_plays[(slot, best)]

        if groups.plays:
            best = max(groups.plays, key=lambda choice: (len(choice_types(choice)),))
            return groups.plays[best]

        return self._fallback(groups, decision.mask)


class CallerBot(_ScriptedAgent):
    """Challenges at every opportunity. A useful punching bag: it punishes bluffing hard and
    collapses against anyone honest."""

    name = "caller"

    def act(self, decision: Decision) -> int:
        groups = group_legal(decision.mask)
        if ACTION_CALL_BS in groups.simple:
            return ACTION_CALL_BS
        if groups.plays:
            return groups.plays[next(iter(groups.plays))]
        if groups.trump_plays:
            return next(iter(groups.trump_plays.values()))
        return self._fallback(groups, decision.mask)


class HeuristicBot(_ScriptedAgent):
    """The real yardstick: counts cards, bluffs when the table is cheap, and knows the Reverse Rule.

    The Reverse Rule is the interesting part. Four or more face-up trump cards flip the punishment, so
    once it is armed the profitable challenge is against a player you believe is *honest*. Nothing
    else in the game inverts like that, and a bot that ignores it hands away free rounds.
    """

    name = "heuristic"

    def __init__(self, seed: Optional[int] = None, bluff_ceiling: float = 0.6) -> None:
        super().__init__(seed)
        self.bluff_ceiling = bluff_ceiling

    def act(self, decision: Decision) -> int:
        engine, mapping = decision.engine, decision.mapping
        player_id = decision.player_id
        groups = group_legal(decision.mask)
        hand = engine.players[player_id].hand
        counts = mapping.hand_counts(hand)

        if ACTION_CALL_BS in groups.simple:
            target = engine._get_default_bs_target(player_id)
            if target is not None:
                lie = probability_claim_is_a_lie(engine, mapping, player_id, target)
                reversed_punishment = face_up_trump_count(engine) >= 4
                if (lie < 0.35) if reversed_punishment else (lie > 0.55):
                    return ACTION_CALL_BS

        if groups.trump_plays:
            slot = max(groups.trump_slots, key=lambda candidate: (counts[candidate], -candidate))
            honest = self._honest_types(slot)
            options = [choice for (s, choice) in groups.trump_plays if s == slot]
            best = max(options, key=lambda choice: self._score_choice(choice, counts, honest))
            return groups.trump_plays[(slot, best)]

        if groups.plays:
            trump_slot = (
                mapping.slot(engine.round.trump_rank) if engine.round.trump_rank else None
            )
            honest = self._honest_types(trump_slot)
            honest_options = [
                choice for choice in groups.plays if all(t in honest for t in choice_types(choice))
            ]

            if honest_options:
                best = max(
                    honest_options, key=lambda choice: self._score_choice(choice, counts, honest)
                )
                return groups.plays[best]

            fill = engine.table_card_count() / max(1, engine.round.max_cards_on_table)
            # An almost-empty hand is worth a risk: running out is how a player leaves, and a player
            # who has left can never be given another point.
            if fill < self.bluff_ceiling or len(hand) <= 2:
                best = max(
                    groups.plays, key=lambda choice: self._score_choice(choice, counts, honest)
                )
                return groups.plays[best]

        if ACTION_PASS in groups.simple:
            return ACTION_PASS
        return self._fallback(groups, decision.mask)


BASELINES = {
    "random": RandomAgent,
    "honest": HonestBot,
    "liar": LiarBot,
    "caller": CallerBot,
    "heuristic": HeuristicBot,
}


# --------------------------------------------------------------------------- learned


class PolicyAgent:
    """A trained checkpoint, wrapped so it can sit in the same round-robin as the bots."""

    def __init__(self, network, device, name: str = "policy", deterministic: bool = False,
                 lie_feature: bool = True) -> None:
        import torch

        self._torch = torch
        self.network = network
        self.device = device
        self.name = name
        self.deterministic = deterministic
        #: False for a checkpoint trained under `BLOWCOW_NO_LIE_FEATURE`. The encoder is global and
        #: may well be producing the feature; this seat was never trained to read it, so it is
        #: blinded here rather than by turning the encoder off for everybody.
        self.lie_feature = lie_feature

    def act(self, decision: Decision) -> int:
        torch = self._torch
        with torch.no_grad():
            observation = torch.as_tensor(
                decision.observation, dtype=torch.float32, device=self.device
            ).unsqueeze(0)
            if not self.lie_feature:
                observation[:, list(LIE_FEATURE_COLUMNS)] = 0.0
            mask = torch.as_tensor(decision.mask, device=self.device).unsqueeze(0)
            action, _log_prob, _entropy, _value = self.network.act(
                observation, mask, deterministic=self.deterministic
            )
        return int(action.item())


def load_policy_agent(path: str, device: Optional[str] = None, name: Optional[str] = None,
                      deterministic: bool = False,
                      lie_feature: Optional[bool] = None) -> PolicyAgent:
    import torch

    from .nets import BlowCowNet

    resolved = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
    checkpoint = torch.load(path, map_location=resolved, weights_only=False)
    network = BlowCowNet(**checkpoint.get("net_kwargs", {}))
    network.load_state_dict(checkpoint["model"])
    network.to(resolved).eval()

    # Explicit spec option wins; otherwise the checkpoint says so itself. A checkpoint written before
    # the field existed predates the feature entirely, but it also has the *old* observation width and
    # will have failed to load above, so defaulting to True here cannot silently mislabel anything.
    if lie_feature is None:
        lie_feature = bool(checkpoint.get("lie_feature", True))
    return PolicyAgent(network, resolved, name=name or f"ckpt:{path}",
                       deterministic=deterministic, lie_feature=lie_feature)


def make_agent(spec: str, seed: Optional[int] = None, device: Optional[str] = None) -> Agent:
    """``random`` / ``honest`` / ``liar`` / ``caller`` / ``heuristic`` / ``ckpt:<path>`` /
    ``ismcts:<path>[:sims=N][:cpuct=F][:batch=N][:opponent=paranoid|prior][:value=<path>][:belief=F][:temperature=F]`` /
    ``lookahead:<path>[:top=N][:worlds=N]``."""
    if spec.startswith("ismcts:"):
        from .ismcts import load_ismcts_agent, parse_spec

        path, options = parse_spec(spec)
        return load_ismcts_agent(
            path,
            device=device,
            simulations=int(options.get("sims", 64)),  # type: ignore[arg-type]
            c_puct=float(options.get("cpuct", 1.5)),  # type: ignore[arg-type]
            name=spec,
            seed=seed,
            batch=int(options.get("batch", 32)),  # type: ignore[arg-type]
            opponent=str(options.get("opponent", "paranoid")),
            value=str(options["value"]) if "value" in options else None,
            belief=float(options.get("belief", 0.0)),
            temperature=float(options.get("temperature", 0.0)),
        )
    if spec.startswith("lookahead:"):
        from .ismcts import parse_spec
        from .lookahead import load_lookahead_agent

        path, options = parse_spec(spec)
        return load_lookahead_agent(
            path,
            device=device,
            top=int(options.get("top", 12)),  # type: ignore[arg-type]
            worlds=int(options.get("worlds", 12)),  # type: ignore[arg-type]
            name=spec,
            seed=seed,
            batch=int(options.get("batch", 256)),  # type: ignore[arg-type]
        )
    if spec.startswith("ckpt:"):
        from .ismcts import parse_spec

        path, options = parse_spec(spec)
        return load_policy_agent(
            path, device=device, name=spec,
            # `:lie=0` blinds this seat to the analytic lie columns. Needed for a checkpoint trained
            # before `lie_feature` was recorded, and as an override for a deliberate ablation.
            lie_feature=None if "lie" not in options else bool(float(options["lie"])),  # type: ignore[arg-type]
        )
    if spec in BASELINES:
        return BASELINES[spec](seed=seed)  # type: ignore[call-arg]
    raise ValueError(f"Unknown agent: {spec}")

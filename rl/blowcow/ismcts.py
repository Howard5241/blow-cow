"""Single-observer ISMCTS with a learned prior and a learned value.

Every lever tried before this one tunes a *reactive* policy — a function from observation to action,
fixed at the end of training. Both of the levers that made the agent better at reading a lie also
made it easier to best-respond to, because a sharper fixed function is a sharper thing to model. This
recomputes the decision at the table instead: sample the hidden cards, search the resulting game, and
answer from the position rather than from a memorised tendency.

The shape is Cowling, Powley and Whitehouse's SO-ISMCTS with two substitutions that make it affordable
here. A rollout to the end of a match would be hundreds of plies, so leaves are evaluated by a trained
value head instead; and with up to 1,669 actions, uniform exploration is hopeless, so selection is
PUCT against a trained policy prior rather than plain UCB.

Three details are specific to this game and worth stating:

* **Determinizations can be belief-weighted, and by default are not.** Every arrangement of the cards
  the viewer cannot see is consistent with the public state, because the rules constrain counts and
  never identities, so uniform sampling is *correct*. It is also biased in a measurable direction: it
  throws away the fact that a player who plays trump probably had trump, which makes most sampled
  worlds turn a claim into a lie and leads the search to call BS far too often. ``belief`` mixes in
  the analytic estimate instead — see `determinize`. Consistency is preserved either way; only which
  consistent world gets drawn changes.
* **The backup is paranoid.** Placement is constant-sum across seats but not two-player zero-sum, so
  there is no single scalar both sides agree on. Values are kept from the searching seat's point of
  view throughout, and every other seat is assumed to pick the move that minimises it. Pessimistic
  with three or more seats, and cheap, which is the trade.
* **A clone must be given its own randomness.** `BlowCowEngine.clone()` shares the shuffle callback
  by design, so a search that reached a `Call Reset` would draw from the live match's stream and
  desynchronise it. `determinize` replaces it.
"""

from __future__ import annotations

import math
import os
import random
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

from .bridge import CanonicalTable
from .canonical import RankMapping
from .engine import BlowCowEngine
from .rng import make_seeded_shuffle

#: Plies of real search below the root before a node is evaluated regardless. The tree rarely gets
#: this deep at the simulation counts used here; it is a guard against a pathological line.
MAX_DEPTH = 24

#: Bound to a local name because it is called once per legal action per node in `_descend`.
_sqrt = math.sqrt

#: Platt scaling for `probability_claim_is_a_lie`, as ``(slope, intercept)`` on its logit.
#:
#: The raw estimate ranks claims well but is wildly overconfident: on 1,757 real claims from mixed
#: three-seat play it scores a log loss of **0.849 against a base rate of 0.691**, meaning it is worse
#: than ignoring the position and quoting the average. A slope of 0.233 shrinks its logit roughly
#: fourfold and takes it to **0.576**, comfortably better than base rate — the signal was always
#: there, only the scale was wrong. `rl/belief.py` is why the *ranking* is trusted across opponents
#: where a learned model is not.
#:
#: Fitted against a `ckpt` + `heuristic` mix. The true lie rate is strongly opponent-dependent (7.6%
#: for `heuristic`, 92.3% for `liar`), so this is a compromise rather than a universal constant —
#: but any calibration beats the uniform sampler, which effectively asserts ~88% regardless.
BELIEF_CALIBRATION = (0.233, -0.077)


def calibrated_lie_probability(raw: float) -> float:
    """`probability_claim_is_a_lie` put through :data:`BELIEF_CALIBRATION`."""
    slope, intercept = BELIEF_CALIBRATION
    clipped = min(1.0 - 1e-4, max(1e-4, raw))
    logit = math.log(clipped / (1.0 - clipped))
    return 1.0 / (1.0 + math.exp(-(slope * logit + intercept)))


def determinize(
    engine: BlowCowEngine,
    viewer_id: str,
    rng: random.Random,
    mapping: Optional[RankMapping] = None,
    belief: float = 0.0,
) -> BlowCowEngine:
    """A clone with every card the viewer cannot see reshuffled among the places it could be.

    The viewer knows the deck, its own hand, every face-up card and every scored set, so it knows the
    *multiset* of what is hidden and nothing about where each card sits. Any permutation of that
    multiset over the hidden slots is therefore a consistent world, which is exactly what a
    determinization has to be.

    **Uniform is consistent but biased, and the bias has a direction.** Dealing the hidden cards at
    random ignores that a player who claimed trump probably *held* trump, so an opponent claiming two
    trumps rarely holds two in a sampled world, most worlds make the claim a lie, and a search over
    those worlds calls BS far too often. Measured at three seats: the search called on 24.5% of its
    chances against the raw policy's 11.7%, and hit 30.2% against the 33.8% that were actually good —
    worse than choosing at random. The error grows with the seat count, because more seats mean a
    larger and less constrained hidden pool, which is why two seats were unaffected.

    ``belief`` mixes in the analytic estimate that `rl/belief.py` found *does* transfer across
    opponents, unlike a learned one. At 0 the sampler is exactly the uniform one above. Above 0, that
    fraction of pending claims are first decided honest-or-lying by
    :func:`~blowcow.agents.probability_claim_is_a_lie` and dealt to match, and everything else is
    shuffled uniformly into what remains. Worlds stay consistent either way: it only re-weights which
    consistent world gets drawn, which is the whole job of a determinization's prior.
    """
    clone = engine.clone()
    clone.shuffle = make_seeded_shuffle(rng.randrange(1, 2**31))

    slots: List[Tuple[bool, object, int]] = []
    cards: List[int] = []

    for player_id in clone.seat_order:
        if player_id == viewer_id:
            continue
        for index in range(len(clone.players[player_id].hand)):
            slots.append((True, player_id, index))
            cards.append(clone.players[player_id].hand[index])

    for play_index, play in enumerate(clone.plays):
        if play.player_id == viewer_id:
            continue
        for card_index, card in enumerate(play.cards):
            if not clone._is_card_face_up(play, card):
                slots.append((False, play_index, card_index))
                cards.append(card)

    if belief > 0.0 and mapping is not None:
        _deal_with_belief(clone, engine, viewer_id, rng, mapping, belief, slots, cards)
    else:
        rng.shuffle(cards)
        for (is_hand, owner, index), card in zip(slots, cards):
            if is_hand:
                clone.players[str(owner)].hand[index] = card
            else:
                clone.plays[int(owner)].cards[index] = card

    return clone


def _deal_with_belief(
    clone: BlowCowEngine,
    engine: BlowCowEngine,
    viewer_id: str,
    rng: random.Random,
    mapping: RankMapping,
    belief: float,
    slots: List[Tuple[bool, object, int]],
    cards: List[int],
) -> None:
    """Deal the hidden multiset, honouring a sampled honest/lying verdict on pending claims."""
    from .agents import probability_claim_is_a_lie

    trump = engine.round.trump_rank
    by_slot = {slot: card for slot, card in zip(slots, cards)}
    pool = list(cards)

    # Which pending plays get their claim decided up front. Only pending ones matter: they are what a
    # BS call can target, and they are where the uniform prior does its damage.
    constrained: List[Tuple[List[Tuple[bool, object, int]], bool]] = []
    if trump is not None:
        for player_id in clone.seat_order:
            if player_id == viewer_id or rng.random() >= belief:
                continue
            play = engine._get_pending_play(player_id)
            if play is None or play.claimed_rank is None:
                continue
            try:
                play_index = engine.plays.index(play)
            except ValueError:
                continue
            hidden = [
                slot
                for slot in slots
                if not slot[0] and int(slot[1]) == play_index  # type: ignore[arg-type]
            ]
            if not hidden:
                continue
            lying = rng.random() < calibrated_lie_probability(
                probability_claim_is_a_lie(engine, mapping, viewer_id, player_id)
            )
            constrained.append((hidden, not lying))

    # Honest claims first: they are the demanding case, and a lie can be satisfied by anything left.
    decided: set = set()
    for hidden, honest in sorted(constrained, key=lambda entry: not entry[1]):
        wanted = [card for card in pool if clone._is_trump(card, trump) == honest]
        if len(wanted) < len(hidden):
            continue  # Not enough cards of that kind left; leave these slots to the shuffle.
        rng.shuffle(wanted)
        for slot, card in zip(hidden, wanted[: len(hidden)]):
            by_slot[slot] = card
            pool.remove(card)
        # Only once it is actually satisfied. Marking a skipped group decided would leave more slots
        # than cards for the shuffle below, and silently drop cards out of the world.
        decided.update(hidden)

    remaining = [slot for slot in slots if slot not in decided]
    rng.shuffle(pool)
    for slot, card in zip(remaining, pool):
        by_slot[slot] = card

    for (is_hand, owner, index), card in by_slot.items():
        if is_hand:
            clone.players[str(owner)].hand[index] = card
        else:
            clone.plays[int(owner)].cards[index] = card


class Node:
    """One edge-labelled node of the shared tree. Statistics are pooled across determinizations."""

    __slots__ = ("children", "visits", "value", "availability", "priors", "player")

    def __init__(self) -> None:
        self.children: Dict[int, "Node"] = {}
        self.visits: Dict[int, int] = {}
        self.value: Dict[int, float] = {}
        # How often each action was *offered*, which is the ISMCTS correction: an action legal in one
        # determinization out of ten must not be judged against the root's whole visit count.
        self.availability: Dict[int, int] = {}
        self.priors: Optional[Dict[int, float]] = None
        self.player: Optional[str] = None

    def expanded(self) -> bool:
        return self.priors is not None


def _placement_value(engine: BlowCowEngine, viewer_id: str) -> float:
    """The environment's own payoff: +1 first, -1 last, linear between."""
    placements = engine.gameover.placements
    count = len(placements)
    if count < 2:
        return 0.0
    return 1.0 - 2.0 * placements.index(viewer_id) / (count - 1)


def _drive_forced(engine: BlowCowEngine, budget: int = 4096) -> None:
    for _ in range(budget):
        if engine.gameover is not None:
            return
        forced = engine.forced_move()
        if forced is None:
            return
        engine.apply_move(*forced)


class ISMCTSAgent:
    """A search agent that satisfies the same protocol as the scripted bots and `PolicyAgent`."""

    def __init__(
        self,
        network,
        device,
        simulations: int = 64,
        c_puct: float = 1.5,
        name: str = "ismcts",
        seed: Optional[int] = None,
        temperature: float = 0.0,
        batch: int = 32,
        opponent: str = "paranoid",
        value_network=None,
        belief: float = 0.0,
    ) -> None:
        import torch

        self._torch = torch
        self.network = network
        #: Where leaf values come from. Separate from the prior network on purpose: the PPO critic
        #: is a by-product of advantage estimation and has no skill in the opening third of a match,
        #: while a head trained directly on final placement has 2.3x that. Swapping the value while
        #: keeping `network`'s policy *exactly* is what isolates the critic as the variable — and a
        #: value network's own policy head is untrained, so it must never supply the prior.
        self.value_network = value_network if value_network is not None else network
        self.device = device
        self.simulations = simulations
        self.c_puct = c_puct
        self.name = name
        self.temperature = temperature
        #: How the other seats are searched. ``paranoid`` minimises the viewer's value at every
        #: opponent node; ``prior`` samples the opponent's own policy instead. See `_descend`.
        if opponent not in ("paranoid", "prior"):
            raise ValueError(f"Unknown opponent model {opponent!r}; use 'paranoid' or 'prior'.")
        self.opponent = opponent
        #: How often a pending claim is decided honest-or-lying by the analytic estimate before the
        #: hidden cards are dealt. 0 is the uniform sampler. See `determinize`.
        self.belief = min(1.0, max(0.0, belief))
        #: Leaves evaluated per forward pass. Larger costs nothing until the GPU saturates and buys
        #: proportionally less tree, since every simulation in a batch descends the same statistics.
        self.batch = max(1, batch)
        self.rng = random.Random(seed)

    # ------------------------------------------------------------------ network

    def _evaluate_many(
        self, items: Sequence[Tuple[CanonicalTable, str, str, np.ndarray]]
    ) -> List[Tuple[Dict[int, float], float]]:
        """Priors and viewer-values for a whole batch of leaves, in one forward pass.

        This is why the search is batched at all. At these sizes the network is entirely
        latency-bound — measured on this machine, a batch of 64 costs the same 4.3ms as a batch of 2
        — so evaluating leaves one at a time throws away roughly thirty-fold. Each leaf contributes
        the actor's observation, for the prior, and the viewer's, for the value; they are the same row
        whenever the searching seat is the one to move.
        """
        torch = self._torch
        if not items:
            return []

        rows: List[np.ndarray] = []
        actor_rows: List[int] = []
        viewer_rows: List[int] = []
        masks: List[np.ndarray] = []

        for table, actor_id, viewer_id, mask in items:
            actor_rows.append(len(rows))
            rows.append(table.observation(actor_id))
            if actor_id == viewer_id:
                viewer_rows.append(actor_rows[-1])
            else:
                viewer_rows.append(len(rows))
                rows.append(table.observation(viewer_id))
            masks.append(mask)

        with torch.no_grad():
            batch = torch.as_tensor(np.stack(rows), dtype=torch.float32, device=self.device)
            if self.value_network is self.network:
                logits, values = self.network(batch)
            else:
                # Two forwards over the same rows rather than two sliced batches. At these sizes a
                # forward is latency-bound, so slicing would save nothing measurable and the row
                # bookkeeping below stays identical either way.
                logits, _ = self.network(batch)
                _logits, values = self.value_network(batch)
            actor_logits = logits[torch.as_tensor(actor_rows, device=self.device)]
            mask_batch = torch.as_tensor(np.stack(masks), device=self.device)
            probabilities = torch.softmax(
                self.network.masked_logits(actor_logits, mask_batch), dim=1
            ).cpu().numpy()
            viewer_values = values[torch.as_tensor(viewer_rows, device=self.device)].cpu().numpy()

        results: List[Tuple[Dict[int, float], float]] = []
        for position, (_table, _actor, _viewer, mask) in enumerate(items):
            legal = np.flatnonzero(mask)
            row = probabilities[position]
            results.append(
                ({int(index): float(row[index]) for index in legal}, float(viewer_values[position]))
            )
        return results

    def _evaluate(
        self, table: CanonicalTable, actor_id: str, viewer_id: str, mask: np.ndarray
    ) -> Tuple[Dict[int, float], float]:
        return self._evaluate_many([(table, actor_id, viewer_id, mask)])[0]

    # ------------------------------------------------------------------ search

    def _sample_prior(
        self, legal: Sequence[int], priors: Dict[int, float], default_prior: float
    ) -> int:
        """One action drawn from the prior, renormalised over what this determinization allows."""
        weights = [priors.get(action, default_prior) for action in legal]
        total = sum(weights)
        if total <= 0.0:
            return self.rng.choice(list(legal))
        threshold = self.rng.random() * total
        running = 0.0
        for action, weight in zip(legal, weights):
            running += weight
            if running >= threshold:
                return action
        return legal[-1]

    def _descend(
        self, root: Node, engine: BlowCowEngine, mapping: RankMapping, viewer_id: str
    ) -> Tuple[List[Tuple[Node, int]], Optional[float], Optional[Tuple]]:
        """One simulation, down to a leaf. Returns its path and either a value or a leaf to evaluate.

        Visits are incremented *on the way down* rather than on backup. That is the virtual loss: an
        edge already taken by an earlier simulation in this batch has its denominator raised and its
        mean temporarily diluted, so the rest of the batch spreads out instead of piling onto one
        line. The backup then only has to add the value, since the visit is already counted.
        """
        state = determinize(engine, viewer_id, self.rng, mapping, self.belief)
        table = CanonicalTable(state, mapping)
        node = root
        path: List[Tuple[Node, int]] = []

        for _depth in range(MAX_DEPTH):
            _drive_forced(state)
            if state.gameover is not None:
                return path, _placement_value(state, viewer_id), None

            actor = state.decision_player()
            if actor is None:
                return path, 0.0, None

            mask, actions = table.build_actions()
            legal = [int(index) for index in np.flatnonzero(mask)]
            if not legal:
                return path, 0.0, None

            node.player = actor
            for action in legal:
                node.availability[action] = node.availability.get(action, 0) + 1

            if not node.expanded():
                return path, None, (node, table, actor, mask)

            default_prior = 1.0 / len(legal)
            # The searching seat maximises its own value; every other seat is assumed to minimise
            # it. One sign flip, on the exploitation term only — exploration should widen the search
            # for whoever is choosing, whichever way they are choosing.
            sign = 1.0 if actor == viewer_id else -1.0
            priors = node.priors or {}

            if sign < 0 and self.opponent == "prior":
                # Opponents sample their own prior instead of being searched against. Paranoia is
                # the right pessimism when the goal is to be unexploitable, but it is the wrong
                # model of a real table: it assumes every bluff is called by someone who cannot in
                # fact see the cards, so it prices bluffing out of the tree. Sampling makes an
                # opponent node a chance node, and the value that backs up is the value against an
                # opponent who plays like the prior — which is what beating a given field means.
                chosen = self._sample_prior(legal, priors, default_prior)
                node.visits[chosen] = node.visits.get(chosen, 0) + 1
                path.append((node, chosen))

                if state.apply_move(actor, *actions[chosen].to_move()):
                    return path, 0.0, None

                child = node.children.get(chosen)
                if child is None:
                    child = Node()
                    node.children[chosen] = child
                node = child
                continue

            # Written out rather than as `max(legal, key=lambda ...)`. This is the innermost loop of
            # the search — once per legal action per node, and the root alone offers a few hundred —
            # so the per-call cost of the lambda was a sixth of the whole search. Ties still go to
            # the earliest action, as `max` does, which keeps the search reproducible.
            visits_by_action = node.visits
            value_by_action = node.value
            availability = node.availability
            exploration = self.c_puct
            chosen = legal[0]
            best = -math.inf
            for action in legal:
                visits = visits_by_action.get(action, 0)
                # `availability` was just incremented for every legal action, so it is at least 1.
                score = (
                    exploration
                    * priors.get(action, default_prior)
                    * _sqrt(availability[action])
                    / (1 + visits)
                )
                if visits:
                    score += sign * value_by_action.get(action, 0.0) / visits
                if score > best:
                    best = score
                    chosen = action

            node.visits[chosen] = node.visits.get(chosen, 0) + 1
            path.append((node, chosen))

            if state.apply_move(actor, *actions[chosen].to_move()):
                # The engine refused a move the mask offered. Abandon the line rather than search a
                # state that cannot happen; `check_ismcts.py` asserts this never fires in practice.
                return path, 0.0, None

            child = node.children.get(chosen)
            if child is None:
                child = Node()
                node.children[chosen] = child
            node = child

        _drive_forced(state)
        if state.gameover is not None:
            return path, _placement_value(state, viewer_id), None
        mask, _actions = table.build_actions()
        actor = state.decision_player() or viewer_id
        return path, None, (node, table, actor, mask)

    def search(
        self, engine: BlowCowEngine, mapping: RankMapping, viewer_id: str
    ) -> Dict[int, int]:
        """Returns root visit counts by canonical action index."""
        root = Node()

        # Prime the root before batching. Without this a whole batch descends into an unexpanded
        # root, every simulation returns an empty path, and the search records no visits at all —
        # silently returning the prior. The root can be expanded from the *real* state rather than a
        # determinization, because the seat to move is the viewer and its legal moves follow from its
        # own hand and the public table, neither of which a determinization touches.
        root_table = CanonicalTable(engine, mapping)
        root_mask, _root_actions = root_table.build_actions()
        root.player = viewer_id
        root.priors, _root_value = self._evaluate(root_table, viewer_id, viewer_id, root_mask)

        remaining = self.simulations

        while remaining > 0:
            size = min(self.batch, remaining)
            remaining -= size

            paths: List[List[Tuple[Node, int]]] = []
            values: List[Optional[float]] = []
            leaves: List[Tuple] = []
            leaf_positions: List[int] = []

            for _ in range(size):
                path, value, leaf = self._descend(root, engine, mapping, viewer_id)
                paths.append(path)
                values.append(value)
                if leaf is not None:
                    leaf_positions.append(len(paths) - 1)
                    leaves.append(leaf)

            evaluations = self._evaluate_many(
                [(table, actor, viewer_id, mask) for _node, table, actor, mask in leaves]
            )
            for (node, _table, _actor, _mask), position, (priors, value) in zip(
                leaves, leaf_positions, evaluations
            ):
                node.priors = priors
                values[position] = value

            for path, value in zip(paths, values):
                if value is None:
                    value = 0.0
                for visited, action in path:
                    # The visit was counted on the way down; only the value is outstanding.
                    visited.value[action] = visited.value.get(action, 0.0) + value

        return dict(root.visits)

    # ------------------------------------------------------------------ agent

    def act(self, decision) -> int:
        env = decision.env
        engine = env.engine
        mapping = env.mapping
        legal = [int(index) for index in np.flatnonzero(decision.mask)]
        if len(legal) == 1:
            return legal[0]

        visits = self.search(engine, mapping, decision.player_id)
        visits = {action: count for action, count in visits.items() if action in set(legal)}
        if not visits:
            # Every simulation bottomed out before choosing — fall back on the raw prior rather than
            # on chance, so a search that found nothing is no worse than the network alone.
            table = CanonicalTable(engine, mapping)
            priors, _value = self._evaluate(
                table, decision.player_id, decision.player_id, decision.mask
            )
            return max(priors, key=priors.get)

        if self.temperature <= 0:
            return max(visits, key=visits.get)

        counts = np.array([visits[action] for action in visits], dtype=np.float64)
        weights = counts ** (1.0 / self.temperature)
        return int(
            self.rng.choices(list(visits), weights=(weights / weights.sum()).tolist(), k=1)[0]
        )


def load_ismcts_agent(
    path: str,
    device: Optional[str] = None,
    simulations: int = 64,
    c_puct: float = 1.5,
    name: Optional[str] = None,
    seed: Optional[int] = None,
    batch: int = 32,
    opponent: str = "paranoid",
    value: Optional[str] = None,
    belief: float = 0.0,
    temperature: float = 0.0,
) -> ISMCTSAgent:
    import torch

    from .nets import BlowCowNet

    resolved = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
    checkpoint = torch.load(path, map_location=resolved, weights_only=False)
    network = BlowCowNet(**checkpoint.get("net_kwargs", {}))
    network.load_state_dict(checkpoint["model"])
    network.to(resolved).eval()

    value_network = None
    if value:
        if not os.path.exists(value):
            # Almost always the colon: `parse_spec` splits options on it, so `value=C:/x/y.pt`
            # arrives here as `C`. Relative paths have no colon and are what the repo uses.
            raise FileNotFoundError(
                f"value network {value!r} does not exist. Option values cannot contain ':' — "
                f"use a path relative to the working directory."
            )
        value_checkpoint = torch.load(value, map_location=resolved, weights_only=False)
        value_network = BlowCowNet(**value_checkpoint.get("net_kwargs", {}))
        value_network.load_state_dict(value_checkpoint["model"])
        value_network.to(resolved).eval()

    return ISMCTSAgent(
        network,
        resolved,
        simulations=simulations,
        c_puct=c_puct,
        name=name or f"ismcts:{path}",
        seed=seed,
        batch=batch,
        opponent=opponent,
        value_network=value_network,
        belief=belief,
        temperature=temperature,
    )


def parse_spec(spec: str) -> Tuple[str, Dict[str, object]]:
    """``ismcts:<path>[:sims=N][:cpuct=F][:opponent=prior][:value=<path>]`` — the policy path may
    contain a drive letter, so options are matched by their ``key=value`` shape rather than by
    position. A value that is not a number is kept as text, which is what carries ``opponent`` and
    ``value``. Option *values* must not contain a colon; `load_ismcts_agent` says so if one does."""
    parts = spec.split(":")
    options: Dict[str, object] = {}
    path_parts: List[str] = []
    for part in parts[1:]:
        if "=" in part:
            key, _, value = part.partition("=")
            try:
                options[key.strip()] = float(value)
            except ValueError:
                options[key.strip()] = value.strip()
        else:
            path_parts.append(part)
    return ":".join(path_parts), options

"""One-ply lookahead over shared determinizations.

This exists because of a measurement rather than a hunch. Instrumenting `ISMCTSAgent` on real
four-seat positions showed that at 16 simulations — the budget that plays as well as any larger one —
the tree is **exactly one ply deep** and touches about 5 of the 64 actions legal at the root. There
is no tree. Every point the search was winning came from trying a few candidate moves, sampling the
hidden cards, and asking the value head how the resulting position looked.

    sims   legal@root   visited   mean depth   max depth
      16           64       5.4         1.00           1
     256           64      15.7         2.36           8

Against that, spending the budget as a tree is a poor allocation. Sixteen simulations spread over
five actions evaluate each in about three sampled worlds, and three samples of a high-variance
quantity is nearly noise. This spends the same budget the other way round: fewer candidate actions,
many more worlds each, and — the part that matters most — **the same worlds for every candidate**.

Common random numbers are the whole trick. What has to be compared is the *difference* between two
actions, and both are being estimated by sampling the same unknown hand. Drawing separate worlds per
action leaves that shared uncertainty in the comparison; drawing one set and playing every candidate
through all of it cancels it, exactly as a paired test beats an unpaired one. That is unavailable to
tree search by construction, because each simulation gets its own determinization.

The candidate set is still the prior's top `top` actions. That is a real restriction — an action the
prior ranks 20th is never examined — but the prior is a trained policy, and widening the set costs
clones linearly while the value of the extra candidates falls off fast.
"""

from __future__ import annotations

import random
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

from .bridge import CanonicalTable
from .canonical import RankMapping
from .engine import BlowCowEngine
from .ismcts import _drive_forced, _placement_value, determinize
from .rng import make_seeded_shuffle


class LookaheadAgent:
    """Satisfies the same protocol as the scripted bots, `PolicyAgent` and `ISMCTSAgent`."""

    def __init__(
        self,
        network,
        device,
        top: int = 12,
        worlds: int = 12,
        name: str = "lookahead",
        seed: Optional[int] = None,
        batch: int = 256,
    ) -> None:
        import torch

        self._torch = torch
        self.network = network
        self.device = device
        #: Candidate actions taken from the prior, best first.
        self.top = max(2, top)
        #: Determinizations, shared across every candidate.
        self.worlds = max(1, worlds)
        self.batch = max(1, batch)
        self.name = name
        self.rng = random.Random(seed)

    # ------------------------------------------------------------------ network

    def _priors(self, table: CanonicalTable, viewer_id: str, mask: np.ndarray) -> Dict[int, float]:
        torch = self._torch
        with torch.no_grad():
            row = torch.as_tensor(
                table.observation(viewer_id)[None, :], dtype=torch.float32, device=self.device
            )
            logits, _value = self.network(row)
            masked = self.network.masked_logits(
                logits, torch.as_tensor(mask[None, :], device=self.device)
            )
            probabilities = torch.softmax(masked, dim=1)[0].cpu().numpy()
        return {int(index): float(probabilities[index]) for index in np.flatnonzero(mask)}

    def _values(self, rows: Sequence[np.ndarray]) -> np.ndarray:
        """Value-head output for a stack of observations, in batches."""
        torch = self._torch
        if not rows:
            return np.zeros(0, dtype=np.float32)
        out: List[np.ndarray] = []
        with torch.no_grad():
            for start in range(0, len(rows), self.batch):
                chunk = np.stack(rows[start : start + self.batch])
                tensor = torch.as_tensor(chunk, dtype=torch.float32, device=self.device)
                _logits, values = self.network(tensor)
                out.append(values.cpu().numpy())
        return np.concatenate(out)

    # ---------------------------------------------------------------- lookahead

    def evaluate_actions(
        self,
        engine: BlowCowEngine,
        mapping: RankMapping,
        viewer_id: str,
        mask: np.ndarray,
    ) -> Dict[int, float]:
        """Mean value of each candidate action, averaged over the shared worlds."""
        table = CanonicalTable(engine, mapping)
        priors = self._priors(table, viewer_id, mask)
        candidates = sorted(priors, key=lambda action: -priors[action])[: self.top]
        if len(candidates) < 2:
            return {action: 0.0 for action in candidates}

        worlds = [determinize(engine, viewer_id, self.rng) for _ in range(self.worlds)]

        totals = {action: 0.0 for action in candidates}
        counts = {action: 0 for action in candidates}
        pending: List[Tuple[int, np.ndarray]] = []

        for world in worlds:
            _mask, actions = CanonicalTable(world, mapping).build_actions()
            for action in candidates:
                # `.get`, not subscripting: the viewer's legal set is determinization-invariant, so
                # this should always resolve, but a missing entry is a reason to skip a candidate
                # rather than to abort the decision.
                concrete = actions.get(action)
                if concrete is None:
                    continue
                child = world.clone()
                # Each child needs its own stream: they all descend from one world, and a shared
                # callback would have them draw each other's shuffles.
                child.shuffle = make_seeded_shuffle(self.rng.randrange(1, 2**31))
                if child.apply_move(viewer_id, *concrete.to_move()):
                    continue  # the world refused a move the root offered; skip rather than guess
                _drive_forced(child)

                if child.gameover is not None:
                    totals[action] += _placement_value(child, viewer_id)
                    counts[action] += 1
                    continue
                pending.append((action, CanonicalTable(child, mapping).observation(viewer_id)))

        values = self._values([row for _action, row in pending])
        for (action, _row), value in zip(pending, values):
            totals[action] += float(value)
            counts[action] += 1

        return {
            action: totals[action] / counts[action]
            for action in candidates
            if counts[action] > 0
        }

    def act(self, decision) -> int:
        legal = [int(index) for index in np.flatnonzero(decision.mask)]
        if len(legal) == 1:
            return legal[0]

        scores = self.evaluate_actions(
            decision.env.engine, decision.env.mapping, decision.player_id, decision.mask
        )
        if not scores:
            table = CanonicalTable(decision.env.engine, decision.env.mapping)
            priors = self._priors(table, decision.player_id, decision.mask)
            return max(priors, key=priors.get)
        return max(scores, key=scores.get)


def load_lookahead_agent(
    path: str,
    device: Optional[str] = None,
    top: int = 12,
    worlds: int = 12,
    name: Optional[str] = None,
    seed: Optional[int] = None,
    batch: int = 256,
) -> LookaheadAgent:
    import torch

    from .nets import BlowCowNet

    resolved = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
    checkpoint = torch.load(path, map_location=resolved, weights_only=False)
    network = BlowCowNet(**checkpoint.get("net_kwargs", {}))
    network.load_state_dict(checkpoint["model"])
    network.to(resolved).eval()
    return LookaheadAgent(
        network,
        resolved,
        top=top,
        worlds=worlds,
        name=name or f"lookahead:{path}",
        seed=seed,
        batch=batch,
    )

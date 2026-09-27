"""Scripted baselines, and the wrapper that seats a trained checkpoint beside them.

Four of the five are deliberately simple — they exist to fill a table and to give a learned policy
something that is not itself to beat. The fifth, `heuristic`, is the yardstick: it counts what is
unaccounted for, it knows that the Reverse Rule inverts *who* is worth challenging, and it knows the
one thing this mode adds that vanilla does not — that with `n - 1` passes standing, `Pass` wins the
round outright.

Every baseline reads the position through the same queries a real player could answer: their own
hand, the face-up table, the public tallies, and `unaccounted`. `scripted agents are honest` in
`rl/ante_check.py` is what holds them to that, by reshuffling the cards they cannot see and requiring
the same decision.
"""

from __future__ import annotations

import random
from typing import Dict, List, Optional, Sequence, Tuple

from .config import AnteConfig, DEFAULT_CONFIG
from .env import Decision
from .game import ACTION_CALL_BS, ACTION_PASS, ACTION_PLAY, AnteRound, lie_probability_from_counts
from .spaces import ActionSpace

PASS: Tuple = (ACTION_PASS,)
CALL_BS: Tuple = (ACTION_CALL_BS,)


def reverse_probability(game: AnteRound, viewer: int) -> float:
    """The chance the Reverse Rule fires if `Call BS` were called right now, from ``viewer``'s seat.

    The rule counts cards of the **trump rank** once the whole table is face up, Jokers excluded. The
    viewer knows the face-up half and their own pile exactly; the rest is a draw from what they
    cannot place. A caller therefore knows the floor and has to estimate the top, which is the whole
    of the uncertainty the rule adds.
    """
    trump = game.trump
    if trump is None or trump == game.config.off_deck_trump:
        return 0.0

    known = 0
    hidden = 0
    for play in game.table:
        if play.revealed or play.seat == viewer:
            known += sum(1 for card_type in play.types if card_type == trump)
        else:
            hidden += play.size
    if known >= 4:
        return 1.0
    if hidden == 0:
        return 0.0

    unaccounted = game.unaccounted(viewer)
    unseen = sum(unaccounted)
    if unseen <= 0:
        return 0.0
    share = unaccounted[trump] / unseen

    # Binomial over the face-down cards. Crude — the draws are not independent — but the question is
    # only "is this close to four", and an exact hypergeometric here would be precision nobody reads.
    needed = 4 - known
    if needed > hidden:
        return 0.0
    probability = 0.0
    for hits in range(needed, hidden + 1):
        term = 1.0
        for index in range(hits):
            term *= (hidden - index) / (index + 1)
        probability += term * (share**hits) * ((1.0 - share) ** (hidden - hits))
    return min(1.0, probability)


class _Agent:
    """Shared plumbing: turn a semantic action into the flat index the environment wants."""

    name = "scripted"

    def __init__(self, config: AnteConfig = DEFAULT_CONFIG, seed: Optional[int] = None) -> None:
        self.config = config
        self.space = ActionSpace(config)
        self._rng = random.Random(seed)

    def act(self, decision: Decision) -> int:
        game = decision.game
        assert game is not None, "The scripted baselines read the position, not the vector."
        return self.space.index(self.choose(game))

    def choose(self, game: AnteRound) -> Tuple:  # pragma: no cover - overridden
        raise NotImplementedError

    # -- shared reading ----------------------------------------------------------

    def _plays(self, game: AnteRound) -> List[Tuple]:
        return [action for action in game.legal_actions() if action[0] == ACTION_PLAY]

    def _honest(self, game: AnteRound, action: Tuple) -> bool:
        """Would this play be truthful? A trump-selecting play sets the rank it is judged against."""
        trump = action[1] if action[1] is not None else game.trump
        joker = game.config.joker_type
        return all(card_type == joker or card_type == trump for card_type in action[2])

    def _random(self, actions: Sequence[Tuple]) -> Tuple:
        return actions[self._rng.randrange(len(actions))]


class RandomAgent(_Agent):
    """Uniform over legal actions. The floor everything else has to clear."""

    name = "random"

    def choose(self, game: AnteRound) -> Tuple:
        return self._random(game.legal_actions())


class HonestAgent(_Agent):
    """Never lies and never challenges. Plays trump when it holds some, and passes when it does not."""

    name = "honest"

    def choose(self, game: AnteRound) -> Tuple:
        honest = [action for action in self._plays(game) if self._honest(game, action)]
        if not honest:
            return PASS
        # Longest honest play first, which is also the fastest route to an empty hand.
        honest.sort(key=lambda action: -len(action[2]))
        best = len(honest[0][2])
        return self._random([action for action in honest if len(action[2]) == best])


class LiarAgent(_Agent):
    """Always plays, truth be damned, and never challenges."""

    name = "liar"

    def choose(self, game: AnteRound) -> Tuple:
        plays = self._plays(game)
        return self._random(plays) if plays else PASS


class CallerAgent(_Agent):
    """Challenges at every opportunity. The opposite failure mode to `liar`."""

    name = "caller"

    def choose(self, game: AnteRound) -> Tuple:
        if game.bs_target() is not None:
            return CALL_BS
        plays = self._plays(game)
        return self._random(plays) if plays else PASS


class HeuristicAgent(_Agent):
    """Counts cards, reads the Reverse Rule, and knows when passing wins.

    Three decisions, in the order the position forces them.
    """

    name = "heuristic"

    #: How sure of winning a challenge it wants to be. A call is `+1` or `-1`, so the break-even is
    #: 0.5; the margin is for the round it gives up by ending it early.
    CALL_THRESHOLD = 0.62
    #: What it wants when the target is about to win anyway — an empty hand means they take the round
    #: at the start of their next turn, so declining is worth 0 and the break-even is the real one.
    CALL_THRESHOLD_UNDER_THREAT = 0.45

    def choose(self, game: AnteRound) -> Tuple:
        seat = game.current

        # 1. Passing at `n - 1` ends the round and wins it. Nothing beats a certainty.
        if game.pass_streak == game.n - 1:
            return PASS

        # 2. The challenge, which is the only action in the mode that costs anybody anything.
        target = game.bs_target()
        if target is not None:
            lie = game.claim_lie_probability(seat, target)
            reverse = reverse_probability(game, seat)
            # The Reverse Rule swaps the result, so the caller wins on exactly one of the two: the
            # target lied, or the table reversed. With four trump showing the profitable challenge is
            # against somebody you believe is **honest**, which is the one thing in the game that
            # inverts like this.
            win = lie * (1.0 - reverse) + (1.0 - lie) * reverse
            under_threat = sum(game.hands[target]) == 0
            threshold = self.CALL_THRESHOLD_UNDER_THREAT if under_threat else self.CALL_THRESHOLD
            if win > threshold:
                return CALL_BS

        # 3. The play.
        plays = self._plays(game)
        if not plays:
            return PASS

        scored = sorted(((self._score(game, action), action) for action in plays), key=lambda pair: -pair[0])
        best_score, best = scored[0]
        if best_score <= 0.0:
            return PASS
        return best

    def _score(self, game: AnteRound, action: Tuple) -> float:
        """How much this play is worth. Positive means better than passing."""
        seat = game.current
        joker = game.config.joker_type
        trump = action[1] if action[1] is not None else game.trump
        cards = action[2]
        honest = all(card_type == joker or card_type == trump for card_type in cards)
        hand_size = sum(game.hands[seat])
        empties = hand_size == len(cards)

        # An honest play is safe *and* threatening: nobody can profitably challenge it, and if the
        # table declines to answer it the round comes back with `n - 1` passes standing.
        score = 3.0 if honest else -1.5 * sum(
            1 for card_type in cards if not (card_type == joker or card_type == trump)
        )
        score += 0.8 * len(cards)

        if empties:
            # An empty hand wins at the start of the next turn unless somebody challenges, so it is
            # worth reaching even on a lie — a challenge is only one of several things they may do.
            score += 6.0 if honest else 2.5

        if action[1] is not None:
            # Choosing the trump rank. Take the rank held most, which is what buys honest plays for
            # the rest of the round; an off-deck rank makes every later play of your own a lie too.
            if trump == game.config.off_deck_trump:
                score -= 2.0
            else:
                score += 1.2 * (game.hands[seat][trump] - len(
                    [card_type for card_type in cards if card_type == trump]
                ))

        if not honest:
            # A claim nobody can believe is a claim nobody has to think about. This is the same
            # counting an opponent will do, read from this seat's own tally.
            unaccounted = game.unaccounted(seat)
            trump_left = unaccounted[joker] + (
                unaccounted[trump] if trump is not None and trump != game.config.off_deck_trump else 0
            )
            credibility = 1.0 - lie_probability_from_counts(len(cards), trump_left, sum(unaccounted))
            score += 3.0 * credibility

        # Jokers are trump whatever the rank is, so a Joker still in hand is a guaranteed honest play
        # later. Spending one to pad a play the seat did not need is a small loss.
        if not empties:
            score -= 0.6 * sum(1 for card_type in cards if card_type == joker)

        return score


BASELINES: Dict[str, type] = {
    "random": RandomAgent,
    "honest": HonestAgent,
    "liar": LiarAgent,
    "caller": CallerAgent,
    "heuristic": HeuristicAgent,
}


def make_agent(spec: str, config: AnteConfig = DEFAULT_CONFIG, seed: Optional[int] = None):
    """``random`` … ``heuristic``, or ``ckpt:<path>`` for a trained policy."""
    if spec.startswith("ckpt:"):
        from .nets import CheckpointAgent  # imported lazily: it needs torch

        return CheckpointAgent(spec[len("ckpt:") :], config, seed=seed)
    if spec not in BASELINES:
        raise ValueError(f"Unknown agent {spec!r}; expected one of {sorted(BASELINES)} or ckpt:<path>")
    return BASELINES[spec](config, seed=seed)

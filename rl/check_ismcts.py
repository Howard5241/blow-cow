"""Search validation: determinizations are legal worlds, and the search never touches the real match.

A search bug is uniquely nasty because it does not crash — it quietly plays a slightly different game
than the one on the table, and every number downstream is then measuring a fiction. The three things
that could go wrong here are all cheap to rule out.

    python rl/check_ismcts.py
"""

from __future__ import annotations

import argparse
import os
import random
import sys
import time
from typing import Optional, Sequence

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import numpy as np
    import torch
except ModuleNotFoundError as missing:  # pragma: no cover - environment guidance
    raise SystemExit(
        f"This needs {missing.name}. Activate the project virtualenv and retry."
    ) from missing

from blowcow.agents import Decision  # noqa: E402
from blowcow.env import BlowCowEnv, RewardConfig  # noqa: E402
from blowcow.ismcts import ISMCTSAgent, determinize  # noqa: E402
from blowcow.nets import BlowCowNet  # noqa: E402
from blowcow.observation import encode  # noqa: E402
from blowcow.projection import project  # noqa: E402


class CheckFailed(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise CheckFailed(message)


def _env(seed: int = 3, players: int = 4) -> BlowCowEnv:
    env = BlowCowEnv(seed=seed, reward=RewardConfig(terminal=1.0, dense_points=0.0))
    env.reset(num_players=players)
    return env


def _agent(simulations: int = 24) -> ISMCTSAgent:
    torch.manual_seed(0)
    network = BlowCowNet().eval()
    return ISMCTSAgent(network, torch.device("cpu"), simulations=simulations, seed=1)


# --------------------------------------------------------------------------- 1

def check_determinization_is_a_legal_world(rng: random.Random) -> str:
    """A determinization must be indistinguishable from the real state *to the viewer*.

    That is the defining property: the viewer's own observation cannot move, because everything it
    encodes is either public or the viewer's own. If it does move, the search is reasoning from a
    world the viewer could rule out, and its answer is worth nothing.
    """
    checked = 0
    for game in range(6):
        env = _env(seed=17 + game, players=2 + game % 5)
        engine = env.engine

        for _ in range(400):
            if engine.gameover is not None:
                break
            forced = engine.forced_move()
            if forced is not None:
                engine.apply_move(*forced)
                continue

            viewer = engine.decision_player()
            original = encode(engine, env.mapping, viewer)
            # Hidden cards move freely between hands and face-down piles: the *counts* at each are
            # public, the identities are not, so only the total is conserved.
            multiset = sorted(
                [card for player in engine.players.values() for card in player.hand]
                + [card for play in engine.plays for card in play.cards]
            )
            hand_sizes = {
                player_id: len(player.hand) for player_id, player in engine.players.items()
            }
            face_up = [
                sorted(card for card in play.cards if engine._is_card_face_up(play, card))
                for play in engine.plays
            ]

            # Every belief setting has to produce a *legal* world. A belief-weighted sampler only
            # re-weights which consistent world is drawn; if it can create, destroy or relocate a
            # card the viewer can see, it is not a determinization at all and every value the search
            # reads off it is measured in a game that cannot happen.
            for belief in (0.0, 0.5, 1.0):
                world = determinize(engine, viewer, rng, env.mapping, belief)
                require(
                    np.array_equal(encode(world, env.mapping, viewer), original),
                    "a determinization changed what the viewer can see",
                )
                require(
                    world.players[viewer].hand == engine.players[viewer].hand,
                    "a determinization disturbed the viewer's own hand",
                )
                require(
                    sorted(
                        [card for player in world.players.values() for card in player.hand]
                        + [card for play in world.plays for card in play.cards]
                    )
                    == multiset,
                    "a determinization created or destroyed cards",
                )
                require(
                    {
                        player_id: len(player.hand)
                        for player_id, player in world.players.items()
                    }
                    == hand_sizes,
                    "a determinization changed a public hand size",
                )
                require(
                    [
                        sorted(card for card in play.cards if world._is_card_face_up(play, card))
                        for play in world.plays
                    ]
                    == face_up,
                    "a determinization moved a card that is already face up",
                )
                require(
                    world.shuffle is not engine.shuffle,
                    "a determinization shares the live match's shuffle stream",
                )
                checked += 1

            mask, actions = env.table.build_actions()
            engine.apply_move(viewer, *actions[int(rng.choice(np.flatnonzero(mask)))].to_move())

    return f"{checked} determinizations were worlds the viewer cannot rule out"


# --------------------------------------------------------------------------- 2

def check_search_is_read_only() -> str:
    """Searching must leave the real match byte-identical. It runs on clones; prove it."""
    env = _env()
    engine = env.engine
    agent = _agent()

    for _ in range(40):
        if engine.gameover is not None:
            break
        forced = engine.forced_move()
        if forced is not None:
            engine.apply_move(*forced)
            continue

        seat = engine.decision_player()
        mask, actions = env.table.build_actions()
        before = project(engine)

        chosen = agent.act(Decision(env, seat, env.table.observation(seat), mask))

        require(
            project(engine) == before,
            "the search mutated the live match",
        )
        require(bool(mask[chosen]), f"the search returned illegal action {chosen}")
        engine.apply_move(seat, *actions[chosen].to_move())

    return "40 searched decisions left the match untouched"


# --------------------------------------------------------------------------- 3

def check_search_uses_its_budget() -> str:
    """Visits have to reach the root's legal actions and grow with the simulation count.

    A search that silently bottoms out every iteration returns the prior with extra steps, and would
    otherwise look exactly like a working one from the outside.
    """
    env = _env()
    engine = env.engine
    for _ in range(12):
        forced = engine.forced_move()
        if forced is None:
            break
        engine.apply_move(*forced)

    seat = engine.decision_player()
    mask, _actions = env.table.build_actions()
    legal = set(int(index) for index in np.flatnonzero(mask))

    small = _agent(simulations=16).search(engine, env.mapping, seat)
    large = _agent(simulations=96).search(engine, env.mapping, seat)

    require(sum(small.values()) > 0, "a 16-simulation search recorded no visits at all")
    require(
        set(small) <= legal and set(large) <= legal,
        "the search visited an action that is not legal at the root",
    )
    require(
        sum(large.values()) > sum(small.values()),
        f"96 simulations recorded {sum(large.values())} visits, not more than 16's "
        f"{sum(small.values())} — the budget is not reaching the tree",
    )
    require(len(large) > 1, "the search only ever considered one action")

    return (
        f"{len(legal)} legal at root, {sum(small.values())} visits at 16 sims and "
        f"{sum(large.values())} at 96"
    )


# --------------------------------------------------------------------------- 4

def check_finishes_matches() -> str:
    """A full match with search in one seat has to terminate and produce a legal result."""
    env = _env(seed=91)
    agent = _agent(simulations=16)
    from blowcow.agents import HeuristicBot

    others = HeuristicBot(seed=2)
    seats = env.agents
    searcher = seats[0]

    step = env.reset(num_players=4)
    searcher = env.agents[0]
    moves = 0
    while not step.done:
        actor = agent if step.agent == searcher else others
        step = env.step(actor.act(Decision(env, step.agent, step.observation, step.action_mask)))
        moves += 1

    require(len(step.info["placements"]) == 4, "the match produced a malformed result")
    return f"finished in {moves} decisions, placements {step.info['placements']}"


# --------------------------------------------------------------------------- 5

#: Exactly the fields `BlowCowEngine.clone` copies. The rest — the deck, the shuffle, the scalars —
#: are shared with the original on purpose, so scrambling them would prove the opposite of the point.
_COPIED_FIELDS = (
    "seat_order",
    "placements",
    "public_events",
    "_pending_end_turns",
    "players",
    "round",
    "plays",
    "bs_resolution",
    "reset_resolution",
    "turn_opening",
    "gameover",
)

#: Fields no clone can ever catch holding anything. ``_pending_end_turns`` is a queue drained inside
#: ``apply_move``, so between moves it is always empty — the check asserts that instead of pretending
#: to exercise it, and starts demanding real coverage the moment it stops being true.
_TRANSIENT_FIELDS = ("_pending_end_turns",)


def _is_substantive(value: object) -> bool:
    """Whether observing this field actually put the copier at risk. An empty list shared is an
    empty list either way, and counting it as covered is how a check goes quietly vacuous."""
    if value is None:
        return False
    if isinstance(value, (list, dict, set)):
        return bool(value)
    return True


def _fingerprint(value: object):
    """A hashable deep summary of a record, walked the same way ``_copy_record`` walks it.

    ``project`` is not enough on its own here: it is the *rules-visible* state, so it says nothing
    about the public trace, and a mid-match ``placements`` is empty in both a working copy and a
    broken one. Comparing fingerprints instead means every field the clone touches is covered, and
    covered automatically as ``state.py`` grows.
    """
    kind = type(value)
    if kind is list:
        return ("list", tuple(_fingerprint(item) for item in value))
    if kind is dict:
        return ("dict", tuple((key, _fingerprint(item)) for key, item in sorted(value.items())))
    if kind is set:
        return ("set", tuple(sorted(value)))
    if getattr(kind, "__dataclass_params__", None) is None:
        return ("leaf", value)
    return (kind.__name__, tuple(_fingerprint(getattr(value, name)) for name in kind.__slots__))


def _poison(current: object) -> object:
    """A different value of the same shape, so overwriting a slot is visible in a fingerprint."""
    if isinstance(current, bool):
        return not current
    if isinstance(current, int):
        return -987_654_321
    if isinstance(current, float):
        return -1.5e9
    if isinstance(current, str):
        return "<scrambled>"
    return current  # None, and containers that were just emptied


def _scramble(value: object) -> None:
    """Wreck a record as thoroughly as its shape allows, depth first.

    Containers are emptied and scalars are overwritten. Both halves are needed: emptying alone
    misses a record like ``RoundState`` that is nothing but scalars, and overwriting alone misses a
    list that is shared but happens to be empty at the moment of the check.

    Driven off ``__slots__`` for the same reason ``_copy_record`` is: a field added to ``state.py``
    is scrambled here without anyone remembering this function exists. A frozen record is skipped —
    it is shared by design, and ``setattr`` would refuse anyway.
    """
    kind = type(value)
    if kind is list:
        for item in value:
            _scramble(item)
        value.clear()  # type: ignore[attr-defined]
        return
    if kind is dict:
        for item in value.values():  # type: ignore[attr-defined]
            _scramble(item)
        value.clear()  # type: ignore[attr-defined]
        return
    if kind is set:
        value.clear()  # type: ignore[attr-defined]
        return
    params = getattr(kind, "__dataclass_params__", None)
    if params is None or params.frozen:
        return
    for name in kind.__slots__:  # type: ignore[attr-defined]
        current = getattr(value, name)
        _scramble(current)
        setattr(value, name, _poison(current))


def check_clone_is_independent() -> str:
    """``clone`` is hand-rolled for speed, so prove it still copies everything ``deepcopy`` did.

    The failure this guards is silent and delayed: a field left shared would let a search write
    through into the live match, and the damage would surface as a match that drifted rather than as
    an exception. Scrambling the clone to destruction and requiring the original to be byte-identical
    catches a missed field wherever in the tree it sits.
    """
    cloned = 0
    live_records = set()
    for game in range(4):
        env = _env(seed=41 + game, players=2 + game % 4)
        engine = env.engine
        rng = random.Random(7 + game)

        for _ in range(220):
            if engine.gameover is not None:
                break

            # Cloned before *every* step, forced ones included. Cloning only at decisions would
            # leave `bs_resolution`, `reset_resolution` and `turn_opening` null throughout, and a
            # field that is null in every sample is a field this check is not really testing.
            before = tuple(_fingerprint(getattr(engine, name)) for name in _COPIED_FIELDS)
            projected = project(engine)
            clone = engine.clone()

            require(
                tuple(_fingerprint(getattr(clone, name)) for name in _COPIED_FIELDS) == before,
                "a clone did not start out equal to its original",
            )
            require(project(clone) == projected, "a clone projected differently to its original")

            require(
                not engine._pending_end_turns,
                "_pending_end_turns was non-empty between moves — it is no longer transient, so "
                "the clone check must exercise it rather than assume it away",
            )
            for field_name in _COPIED_FIELDS:
                if _is_substantive(getattr(engine, field_name)):
                    live_records.add(field_name)
                _scramble(getattr(clone, field_name))
            require(
                tuple(_fingerprint(getattr(engine, name)) for name in _COPIED_FIELDS) == before,
                "scrambling a clone reached back into the original — a field is still shared",
            )
            cloned += 1

            forced = engine.forced_move()
            if forced is not None:
                engine.apply_move(*forced)
                continue
            seat = engine.decision_player()
            mask, actions = env.table.build_actions()
            engine.apply_move(seat, *actions[int(rng.choice(np.flatnonzero(mask)))].to_move())


    # The one place `deepcopy`'s identity memo mattered: `gameover.placements` and `placements` are
    # the same list there and two equal lists here. Nothing mutates either, so equality is the whole
    # requirement — but it is worth failing loudly if that ever stops being true.
    finished = _env(seed=91, players=2)
    engine = finished.engine
    rng = random.Random(3)
    for _ in range(4000):
        if engine.gameover is not None:
            break
        forced = engine.forced_move()
        if forced is not None:
            engine.apply_move(*forced)
            continue
        mask, actions = finished.table.build_actions()
        engine.apply_move(
            engine.decision_player(),
            *actions[int(rng.choice(np.flatnonzero(mask)))].to_move(),
        )
    require(engine.gameover is not None, "the sample match never finished, so nothing was checked")
    standings = tuple(_fingerprint(getattr(engine, name)) for name in _COPIED_FIELDS)
    end_clone = engine.clone()
    require(
        end_clone.gameover.placements == engine.gameover.placements
        and end_clone.placements == engine.placements,
        "a clone of a finished match disagreed about the standings",
    )
    for field_name in _COPIED_FIELDS:
        if _is_substantive(getattr(engine, field_name)):
            live_records.add(field_name)
        _scramble(getattr(end_clone, field_name))
    require(
        tuple(_fingerprint(getattr(engine, name)) for name in _COPIED_FIELDS) == standings,
        "scrambling a finished match's clone reached back into the original",
    )

    # A field that was null in every single sample was never actually put at risk, so say so rather
    # than let the check report a pass it did not earn. `gameover` is why the finished match above
    # exists at all: mid-match it is null by definition.
    missed = [
        name
        for name in _COPIED_FIELDS
        if name not in live_records and name not in _TRANSIENT_FIELDS
    ]
    require(not missed, f"never observed a non-null {', '.join(missed)} — the check proved nothing")

    return f"{cloned} clones survived being scrambled without touching their original"


# --------------------------------------------------------------------------- 6

def check_opponent_models() -> str:
    """Both backups have to search legally; they are allowed to disagree about what is best.

    ``prior`` is the one that matters for playing a field rather than a worst case, and its opponent
    nodes take a different path through `_descend` entirely, so "it still returns a legal action with
    visits behind it" is worth asserting separately.
    """
    summary = []
    for model in ("paranoid", "prior"):
        env = _env(seed=23)
        engine = env.engine
        for _ in range(12):
            forced = engine.forced_move()
            if forced is None:
                break
            engine.apply_move(*forced)

        seat = engine.decision_player()
        mask, _actions = env.table.build_actions()
        legal = set(int(index) for index in np.flatnonzero(mask))

        torch.manual_seed(0)
        agent = ISMCTSAgent(
            BlowCowNet().eval(),
            torch.device("cpu"),
            simulations=48,
            seed=1,
            opponent=model,
        )
        visits = agent.search(engine, env.mapping, seat)

        require(set(visits) <= legal, f"{model} visited an action that is not legal at the root")
        require(sum(visits.values()) > 0, f"{model} recorded no visits at all")
        require(len(visits) > 1, f"{model} only ever considered one action")
        summary.append(f"{model}={sum(visits.values())}")

    try:
        ISMCTSAgent(BlowCowNet().eval(), torch.device("cpu"), opponent="nonsense")
    except ValueError:
        pass
    else:
        raise CheckFailed("an unknown opponent model was accepted")

    return f"both backups searched legally ({', '.join(summary)} visits)"


# --------------------------------------------------------------------------- 7

def check_lookahead_is_legal_and_read_only() -> str:
    """`lookahead` plays badly, but it still has to play *legally*.

    It is kept as a recorded negative result — one-ply argmax over a noisy value head loses to the
    raw policy by a mile — and a negative result is only worth keeping if the thing that produced it
    was correct. Same two properties the search has to hold: it never touches the live match, and it
    never returns a move the mask did not offer.
    """
    from blowcow.lookahead import LookaheadAgent

    env = _env(seed=57)
    engine = env.engine
    torch.manual_seed(0)
    agent = LookaheadAgent(
        BlowCowNet().eval(), torch.device("cpu"), top=6, worlds=4, seed=2
    )

    decided = 0
    for _ in range(30):
        if engine.gameover is not None:
            break
        forced = engine.forced_move()
        if forced is not None:
            engine.apply_move(*forced)
            continue

        seat = engine.decision_player()
        mask, actions = env.table.build_actions()
        before = project(engine)

        chosen = agent.act(Decision(env, seat, env.table.observation(seat), mask))

        require(project(engine) == before, "lookahead mutated the live match")
        require(bool(mask[chosen]), f"lookahead returned illegal action {chosen}")
        engine.apply_move(seat, *actions[chosen].to_move())
        decided += 1

    require(decided > 0, "no lookahead decision was actually exercised")
    return f"{decided} lookahead decisions were legal and left the match untouched"


# --------------------------------------------------------------------------- 8

def check_separate_value_network() -> str:
    """With `value=`, priors must still come from the policy net and values from the value net.

    Getting this backwards would be silent and ruinous: a value network's policy head is never
    trained, so drawing the prior from it would hand the search a uniform-ish suggestion over 1,669
    actions and quietly undo everything the prior is for. The two halves are checked separately by
    holding one network fixed and swapping the other.
    """
    env = _env(seed=13)
    engine = env.engine
    for _ in range(12):
        forced = engine.forced_move()
        if forced is None:
            break
        engine.apply_move(*forced)

    seat = engine.decision_player()
    table = env.table
    mask, _actions = table.build_actions()

    torch.manual_seed(0)
    policy = BlowCowNet().eval()
    torch.manual_seed(99)
    other = BlowCowNet().eval()

    shared = ISMCTSAgent(policy, torch.device("cpu"), simulations=8, seed=1)
    split = ISMCTSAgent(policy, torch.device("cpu"), simulations=8, seed=1, value_network=other)

    shared_priors, shared_value = shared._evaluate(table, seat, seat, mask)
    split_priors, split_value = split._evaluate(table, seat, seat, mask)

    require(
        shared_priors.keys() == split_priors.keys()
        and all(
            abs(shared_priors[action] - split_priors[action]) < 1e-6 for action in shared_priors
        ),
        "a separate value network changed the priors — the prior is being read off the wrong net",
    )
    require(
        abs(shared_value - split_value) > 1e-6,
        "a separate value network produced the same value — the value net is being ignored",
    )

    # And the value really is the other network's opinion, not something derived.
    with torch.no_grad():
        _logits, expected = other(
            torch.as_tensor(table.observation(seat)[None, :], dtype=torch.float32)
        )
    require(
        abs(float(expected[0]) - split_value) < 1e-5,
        "the leaf value did not match the value network's own output",
    )

    # It still has to search legally with the two split apart.
    before = project(engine)
    chosen = split.act(Decision(env, seat, table.observation(seat), mask))
    require(project(engine) == before, "a split-network search mutated the live match")
    require(bool(mask[chosen]), f"a split-network search returned illegal action {chosen}")

    return "priors came from the policy net, values from the value net"


def measure_throughput() -> str:
    env = _env(seed=5)
    engine = env.engine
    for _ in range(12):
        forced = engine.forced_move()
        if forced is None:
            break
        engine.apply_move(*forced)

    seat = engine.decision_player()
    agent = _agent(simulations=64)
    started = time.perf_counter()
    for _ in range(10):
        agent.search(engine, env.mapping, seat)
    elapsed = (time.perf_counter() - started) / 10
    return f"{1000 * elapsed:.0f}ms per 64-simulation search on cpu"


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--skip-throughput", action="store_true")
    args = parser.parse_args(argv)

    checks = [
        ("determinization legality", lambda: check_determinization_is_a_legal_world(
            random.Random(args.seed)
        )),
        ("search is read-only", check_search_is_read_only),
        ("search uses its budget", check_search_uses_its_budget),
        ("search finishes matches", check_finishes_matches),
        ("clone independence", check_clone_is_independent),
        ("opponent models", check_opponent_models),
        ("lookahead legality", check_lookahead_is_legal_and_read_only),
        ("separate value network", check_separate_value_network),
    ]

    failures = 0
    for name, run in checks:
        started = time.perf_counter()
        try:
            detail = run()
        except CheckFailed as failure:
            print(f"FAIL {name}\n     {failure}")
            failures += 1
            continue
        print(f"PASS {name:30s} {detail}  ({time.perf_counter() - started:.1f}s)")

    if not args.skip_throughput and not failures:
        print(f"     {'throughput':30s} {measure_throughput()}")

    if failures:
        print(f"\n{failures} check(s) failed.")
        return 1

    print("\nAll ISMCTS checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

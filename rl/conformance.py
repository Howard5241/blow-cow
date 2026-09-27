"""Lockstep conformance: the Python vanilla simulator against the real engine, move for move.

Both sides are started from the same seed and stepped through the same moves. After every single
move — the forced ones included — their projected states are compared leaf by leaf, and at every
decision point the simulator's legal-action mask is compared against the engine itself by probing
each candidate move on a throwaway clone.

That second half is the part worth having. A simulator that transitions correctly but offers a
policy one action the server would refuse, or hides one it would accept, trains an agent against a
game nobody else is playing.

    python rl/conformance.py                       # the default sweep
    python rl/conformance.py --games 200 --probe full
    python rl/conformance.py --suit-invariance     # check that suits really are irrelevant
    python rl/conformance.py --players 4 --seed 7 --verbose
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from collections import Counter
from itertools import combinations
from typing import Any, Dict, List, Optional, Sequence, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from blowcow.actions import Action  # noqa: E402
from blowcow.cards import RANKS, get_default_standard_rank_count  # noqa: E402
from blowcow.engine import BlowCowEngine  # noqa: E402
from blowcow.oracle_client import OracleClient  # noqa: E402
from blowcow.projection import diff, project  # noqa: E402

ACTION_ORDER = ("play", "trumpPlay", "callBS", "callReset", "pass")


class Mismatch(Exception):
    """A disagreement between the simulator and the engine, with enough context to reproduce it."""

    def __init__(self, headline: str, context: Dict[str, Any], details: Sequence[str] = ()) -> None:
        super().__init__(headline)
        self.headline = headline
        self.context = context
        self.details = list(details)

    def report(self) -> str:
        lines = [f"MISMATCH: {self.headline}", ""]
        for key, value in self.context.items():
            lines.append(f"  {key}: {value}")
        if self.details:
            lines.append("")
            lines.extend(f"  - {detail}" for detail in self.details[:40])
            if len(self.details) > 40:
                lines.append(f"  ... and {len(self.details) - 40} more")
        return "\n".join(lines)


def describe_cards(engine: BlowCowEngine, args: Dict[str, Any]) -> str:
    """Card ids are deck orders, which are unreadable in a failure report. Name them."""
    cards = args.get("cardIDs") or ([args["cardID"]] if "cardID" in args else [])
    if not cards:
        return ""
    return "  (" + ", ".join(engine.deck.label(card) for card in cards) + ")"


def _dedupe(actions: Sequence[Action]) -> List[Action]:
    seen: set[Action] = set()
    unique: List[Action] = []
    for action in actions:
        if action not in seen:
            seen.add(action)
            unique.append(action)
    return unique


def candidate_actions(engine: BlowCowEngine, player_id: str, mode: str) -> List[Action]:
    """The universe the mask is checked against: a superset of what the simulator calls legal.

    ``full`` is the whole cross product of trump ranks and card choices. ``fast`` walks the two axes
    separately, which is enough because legality factorises — ``validateCommonPlay`` judges the rank
    and the cards with independent tests — and the cross product is otherwise ~13x the probes.
    """
    # Deliberately asks for the 2-card enumeration whatever the table has room for, so a play the
    # table is too full to accept is still probed and still has to come back refused.
    choices = engine._enumerate_play_card_choices(player_id, 2)
    candidates: List[Action] = [Action("pass"), Action("callBS"), Action("callReset")]

    if engine.round.trump_rank is None:
        if mode == "full":
            for rank in RANKS:
                for cards in choices:
                    candidates.append(Action("trumpPlay", rank, cards))
        else:
            if choices:
                for rank in RANKS:
                    candidates.append(Action("trumpPlay", rank, choices[0]))
            fixed_rank = next(
                (rank for rank in RANKS if rank != engine.round.previous_trump_rank), RANKS[0]
            )
            for cards in choices:
                candidates.append(Action("trumpPlay", fixed_rank, cards))
    else:
        for cards in choices:
            candidates.append(Action("play", None, cards))

    return _dedupe(candidates)


def check_action_mask(
    engine: BlowCowEngine,
    oracle: OracleClient,
    player_id: str,
    mode: str,
    context: Dict[str, Any],
) -> int:
    """Compare the simulator's mask against the engine, both directions."""
    legal = set(engine.legal_actions())
    disagreements: List[str] = []

    candidates = candidate_actions(engine, player_id, mode)
    answers = oracle.probe_batch(
        [(player_id, *candidate.to_move()) for candidate in candidates]
    )
    probes = len(candidates)

    for candidate, engine_says in zip(candidates, answers):
        simulator_says = candidate in legal
        if engine_says != simulator_says:
            disagreements.append(
                f"{candidate}: engine={'legal' if engine_says else 'refused'}, "
                f"simulator={'legal' if simulator_says else 'refused'}"
            )

    # A handful of moves that must always be refused, which the canonical space never generates.
    hand = engine.players[player_id].hand
    always_illegal: List[Tuple[str, str, Dict[str, Any]]] = []

    if len(hand) >= 3:
        over_sized = {"cardIDs": list(hand[:3])}
        if engine.round.trump_rank is None:
            always_illegal.append(
                ("selectTrumpAndPlay", "3 cards", {"trumpRank": RANKS[0], **over_sized})
            )
        else:
            always_illegal.append(("play", "3 cards", over_sized))

    unheld = next((card for card in range(engine.deck.size) if card not in set(hand)), None)
    if unheld is not None and engine.round.trump_rank is not None:
        always_illegal.append(("play", "card not in hand", {"cardIDs": [unheld]}))

    # Turn enforcement: nobody else may take this seat's actions.
    other_player_id = next(
        (entry for entry in engine.active_player_ids() if entry != player_id), None
    )
    negative_probes: List[Tuple[str, str, Dict[str, Any]]] = [
        (player_id, move_name, args) for move_name, _label, args in always_illegal
    ]
    if other_player_id is not None:
        negative_probes.append((other_player_id, "pass", {}))

    negative_answers = oracle.probe_batch(negative_probes)
    probes += len(negative_probes)

    for (probe_player_id, move_name, _args), accepted in zip(negative_probes, negative_answers):
        if accepted:
            disagreements.append(
                f"{probe_player_id} {move_name} was accepted by the engine but must not be"
            )

    if disagreements:
        raise Mismatch("legal action mask disagrees with the engine", context, disagreements)

    return probes


def check_suit_invariance(
    engine: BlowCowEngine,
    oracle: OracleClient,
    player_id: str,
    context: Dict[str, Any],
) -> int:
    """Every concrete card subset, grouped by rank multiset — the claim the abstraction rests on.

    Nothing in the vanilla rules reads a suit, so two plays that differ only in which suit was sent
    must be equally legal. If that ever stops being true, the observation encoder in Stage B is
    lossy and this is where it shows up.
    """
    hand = engine.players[player_id].hand
    trump = engine.round.trump_rank
    by_rank_key: Dict[Tuple[str, ...], List[Tuple[Tuple[int, ...], bool]]] = {}

    subsets: List[Tuple[int, ...]] = [(card,) for card in hand]
    subsets.extend(combinations(hand, 2))

    if trump is None:
        fixed_rank = next(
            (rank for rank in RANKS if rank != engine.round.previous_trump_rank), RANKS[0]
        )
        probe_specs = [
            (player_id, "selectTrumpAndPlay", {"trumpRank": fixed_rank, "cardIDs": list(cards)})
            for cards in subsets
        ]
    else:
        probe_specs = [(player_id, "play", {"cardIDs": list(cards)}) for cards in subsets]

    answers = oracle.probe_batch(probe_specs)
    probes = len(probe_specs)

    for cards, legal in zip(subsets, answers):
        rank_key = tuple(sorted(engine.deck.rank[card] for card in cards))
        by_rank_key.setdefault(rank_key, []).append((cards, legal))

    disagreements = [
        f"{list(rank_key)}: " + ", ".join(f"{list(cards)}={legal}" for cards, legal in entries)
        for rank_key, entries in by_rank_key.items()
        if len({legal for _cards, legal in entries}) > 1
    ]

    if disagreements:
        raise Mismatch("legality depends on suit, so the rank abstraction is lossy", context, disagreements)

    return probes


def choose_action(actions: Sequence[Action], rng: random.Random, flat: bool) -> Action:
    """Pick by kind first unless asked otherwise.

    Flat uniform would be dominated by plays — there are dozens of card choices and exactly one
    `Call BS` — and the BS and Reset resolutions are the most intricate machinery in the game. Two
    levels of uniform gives them proportionate coverage.
    """
    if flat:
        return rng.choice(list(actions))

    by_kind: Dict[str, List[Action]] = {}
    for action in actions:
        by_kind.setdefault(action.kind, []).append(action)

    kind = rng.choice(sorted(by_kind))
    return rng.choice(by_kind[kind])


def run_game(
    oracle: OracleClient,
    num_players: int,
    selected_ranks: Sequence[str],
    seed: int,
    rng: random.Random,
    probe_mode: str,
    suit_invariance_rate: float,
    max_steps: int,
    flat_actions: bool,
    verbose: bool,
) -> Dict[str, Any]:
    base_context = {
        "players": num_players,
        "ranks": ",".join(selected_ranks),
        "seed": seed,
        "repro": (
            f"python rl/conformance.py --games 1 --players {num_players}"
            f" --game-seed {seed} --sampling {'flat' if flat_actions else 'kinds'}"
        ),
    }

    oracle_projection = oracle.new_match(num_players, selected_ranks, seed)
    engine = BlowCowEngine(num_players, selected_ranks, seed=seed)

    differences = diff(project(engine), oracle_projection, "state")
    if differences:
        raise Mismatch("initial deal differs", {**base_context, "step": 0}, differences)

    stats = Counter()
    history: List[str] = []

    for step in range(1, max_steps + 1):
        if engine.gameover is not None:
            break

        forced = engine.forced_move()
        context = {**base_context, "step": step, "turn": engine.ctx_turn, "round": engine.round.round_number}

        if forced is not None:
            player_id, move_name, args = forced
            stats["forced_moves"] += 1
            stats[f"forced:{move_name}"] += 1
        else:
            player_id = engine.decision_player()
            if player_id is None:
                raise Mismatch("no forced move and no decision player", context)

            context["decisionPlayer"] = player_id
            if probe_mode != "none":
                stats["probes"] += check_action_mask(engine, oracle, player_id, probe_mode, context)
            if suit_invariance_rate > 0 and rng.random() < suit_invariance_rate:
                stats["probes"] += check_suit_invariance(engine, oracle, player_id, context)
                stats["suit_invariance_checks"] += 1

            actions = engine.legal_actions()
            if not actions:
                raise Mismatch("decision point with no legal action", context)

            action = choose_action(actions, rng, flat_actions)
            move_name, args = action.to_move()
            stats["decisions"] += 1
            stats[f"action:{action.kind}"] += 1

        history.append(
            f"{step}: {player_id} {move_name} {json.dumps(args, default=list)}"
            f"{describe_cards(engine, args)}"
        )
        if verbose:
            print(f"  {history[-1]}")

        oracle_invalid, oracle_projection = oracle.apply(player_id, move_name, args)
        simulator_invalid = engine.apply_move(player_id, move_name, args)

        context["move"] = f"{player_id} {move_name} {args}"
        context["recentMoves"] = " | ".join(history[-6:])

        if oracle_invalid != simulator_invalid:
            raise Mismatch(
                "engine and simulator disagree on whether the move was legal",
                {
                    **context,
                    "engine": "refused" if oracle_invalid else "accepted",
                    "simulator": "refused" if simulator_invalid else "accepted",
                },
            )

        if oracle_invalid:
            raise Mismatch("a move the harness chose was refused by both sides", context)

        differences = diff(project(engine), oracle_projection, "state")
        if differences:
            raise Mismatch("state diverged after the move", context, differences)

        stats["steps"] += 1
    else:
        raise Mismatch(
            "match did not finish within the step limit",
            {**base_context, "step": max_steps, "recentMoves": " | ".join(history[-8:])},
        )

    if engine.gameover is None:
        raise Mismatch("match ended without a result", base_context)

    stats["rounds"] = engine.round.round_number
    stats["games"] = 1
    return dict(stats)


def parse_players(value: str) -> List[int]:
    counts = [int(part) for part in value.split(",") if part.strip()]
    for count in counts:
        if not 2 <= count <= 8:
            raise argparse.ArgumentTypeError("Player counts must be between 2 and 8.")
    return counts


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--games", type=int, default=30, help="matches to play (default: 30)")
    parser.add_argument(
        "--players",
        type=parse_players,
        default=[2, 3, 4, 5, 6, 8],
        help="comma-separated player counts to sweep (default: 2,3,4,5,6,8)",
    )
    parser.add_argument("--seed", type=int, default=1, help="base seed (default: 1)")
    parser.add_argument(
        "--game-seed",
        type=int,
        default=None,
        help="use this exact seed for every match, for reproducing one reported failure",
    )
    parser.add_argument(
        "--probe",
        choices=("none", "fast", "full"),
        default="fast",
        help="how thoroughly to check the legal-action mask (default: fast)",
    )
    parser.add_argument(
        "--suit-invariance",
        action="store_true",
        help="also check that legality never depends on suit",
    )
    parser.add_argument(
        "--suit-invariance-rate",
        type=float,
        default=0.05,
        help="fraction of decision points to run the suit check at (default: 0.05)",
    )
    parser.add_argument("--max-steps", type=int, default=20000, help="step limit per match")
    parser.add_argument(
        "--sampling",
        choices=("mixed", "kinds", "flat"),
        default="mixed",
        help=(
            "how random play picks actions. 'kinds' spreads evenly over Play/Call BS/Call Reset/Pass"
            " and exercises the resolutions; 'flat' is uniform over every action, so plays dominate"
            " and tables fill up, which is what reaches Call Reset. 'mixed' alternates (default)."
        ),
    )
    parser.add_argument("--node", default="node", help="node executable")
    parser.add_argument("--verbose", action="store_true", help="print every move")
    args = parser.parse_args(argv)

    totals = Counter()
    started = time.perf_counter()

    with OracleClient(node_executable=args.node) as oracle:
        for game_index in range(args.games):
            num_players = args.players[game_index % len(args.players)]
            selected_ranks = list(RANKS[: get_default_standard_rank_count(num_players)])
            seed = args.game_seed if args.game_seed is not None else args.seed * 1_000_003 + game_index
            # Seeded per match rather than once, so a single reported failure replays exactly from
            # its own `--game-seed` without having to replay every match before it.
            rng = random.Random(seed)

            if args.verbose:
                print(f"game {game_index + 1}/{args.games}: {num_players} players, seed {seed}")

            try:
                totals.update(
                    run_game(
                        oracle=oracle,
                        num_players=num_players,
                        selected_ranks=selected_ranks,
                        seed=seed,
                        rng=rng,
                        probe_mode=args.probe,
                        suit_invariance_rate=(
                            args.suit_invariance_rate if args.suit_invariance else 0.0
                        ),
                        max_steps=args.max_steps,
                        flat_actions=(
                            args.sampling == "flat"
                            or (args.sampling == "mixed" and game_index % 2 == 1)
                        ),
                        verbose=args.verbose,
                    )
                )
            except Mismatch as mismatch:
                print()
                print(mismatch.report())
                print()
                stderr = oracle.stderr_tail()
                if stderr.strip():
                    print("oracle stderr:")
                    print(stderr)
                return 1

            # Only worth redrawing on a terminal; piped into a log it would be one line per match.
            if not args.verbose and sys.stdout.isatty():
                print(
                    f"  game {game_index + 1}/{args.games}"
                    f"  players={num_players}  steps={totals['steps']}  probes={totals['probes']}",
                    end="\r",
                    flush=True,
                )

    elapsed = time.perf_counter() - started
    if sys.stdout.isatty():
        print(" " * 78, end="\r")
    print(f"OK  {totals['games']} matches agreed with the engine in {elapsed:.1f}s")
    print(f"    steps            {totals['steps']}")
    print(f"    decisions        {totals['decisions']}")
    print(f"    forced moves     {totals['forced_moves']}")
    print(f"    mask probes      {totals['probes']}")
    if totals["suit_invariance_checks"]:
        print(f"    suit checks      {totals['suit_invariance_checks']}")
    print("    actions taken    " + ", ".join(
        f"{kind}={totals[f'action:{kind}']}" for kind in ACTION_ORDER if totals[f"action:{kind}"]
    ))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

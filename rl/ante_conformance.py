"""Lockstep conformance: the Ante simulator against the real engine, move for move.

Both sides start from the same deal and take the same actions. After **every** decision — and after
the forced procedures in between — their states are compared leaf by leaf in the simulator's own
vocabulary: seats in turn order, cards as types. At every decision point the simulator's legal-action
mask is checked against the engine by probing each candidate on a throwaway clone, so both directions
are covered: nothing the engine would accept is hidden from a policy, and nothing it would refuse is
offered.

The deal is not synchronised after the fact and it is not re-derived either. The engine is asked what
it dealt, and the simulator is dealt exactly that — which is stricter than a shared PRNG would be,
because it means a bug in `dealAnteHands` shows up as a hand mismatch rather than as two
implementations of the same mistake.

**Compared:** current seat, trump slot, pass streak, the previous non-passing player, every hand as a
multiset of card types, every table play (owner, contents, size, whether it is face up), every
pending reveal pointer, whether the round is over, and the gold every seat finished with.

**Not compared:** history, telemetry, the archive, and every rendered string — prose about the state
rather than the state.

Usage::

    python rl/ante_conformance.py --games 40 --probe fast
    python rl/ante_conformance.py --games 6 --probe full
"""

from __future__ import annotations

import argparse
import json
import random
import subprocess
import sys
import threading
import collections
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ante.config import AnteConfig, TOTAL_STANDARD_RANKS  # noqa: E402
from ante.game import ACTION_CALL_BS, ACTION_PASS, ACTION_PLAY, AnteRound  # noqa: E402
from ante.match import AnteMatch, MatchConfig  # noqa: E402
from ante.spaces import ActionSpace  # noqa: E402

ORACLE_SCRIPT = Path(__file__).resolve().parent / "oracle" / "blowcow-oracle.ts"

#: The engine's thirteen rank labels in `BLOW_COW_RANKS` order, which is also `RANK_SORT_INDEX`
#: order — Ace first, not last. That matters: `normalizeSelectedRanks` sorts whatever the lobby sends
#: and `createDeck` walks the result rank-minor, so `deckOrder % R` only names a rank if this tuple
#: is in the engine's own order. Getting it wrong is invisible in a state comparison (both sides use
#: the same wrong map) and shows up only in a `Call BS` verdict.
ALL_RANKS: Tuple[str, ...] = (
    "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K",
)

STARTING_GOLD = 5


class Mismatch(RuntimeError):
    def __init__(self, label: str, details: Sequence[str]) -> None:
        super().__init__(label)
        self.label = label
        self.details = list(details)

    def report(self) -> str:
        lines = [f"  {detail}" for detail in self.details[:24]]
        if len(self.details) > 24:
            lines.append(f"  ... and {len(self.details) - 24} more")
        return "\n".join([self.label, *lines])


# --------------------------------------------------------------------------- the oracle


class Oracle:
    """One long-lived Node process holding one Ante match. It decides nothing; it only relays."""

    def __init__(self, node_executable: str = "node") -> None:
        if not ORACLE_SCRIPT.exists():
            raise RuntimeError(f"Oracle script not found: {ORACLE_SCRIPT}")
        self.process = subprocess.Popen(
            [node_executable, "--experimental-strip-types", str(ORACLE_SCRIPT)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )
        self._stderr: collections.deque = collections.deque(maxlen=200)
        threading.Thread(target=self._drain, daemon=True).start()

    def _drain(self) -> None:
        if self.process.stderr is None:
            return
        for line in self.process.stderr:
            self._stderr.append(line.rstrip("\n"))

    def _rpc(self, command: Dict[str, Any]) -> Dict[str, Any]:
        assert self.process.stdin is not None and self.process.stdout is not None
        self.process.stdin.write(json.dumps(command) + "\n")
        self.process.stdin.flush()
        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError("Oracle exited unexpectedly.\n" + "\n".join(self._stderr))
        response = json.loads(line)
        if not response.get("ok"):
            raise RuntimeError(str(response.get("error", "Oracle refused the command.")))
        return response

    def new_match(
        self,
        num_players: int,
        ranks: Sequence[str],
        seed: int,
        round_limit: int = 1,
        starting_gold: int = STARTING_GOLD,
    ) -> Dict[str, Any]:
        return self._rpc(
            {
                "cmd": "new",
                "numPlayers": num_players,
                "selectedRanks": list(ranks),
                "seed": seed,
                "gameMode": "ante",
                "roundLimit": round_limit,
                "startingGold": starting_gold,
            }
        )["proj"]

    def apply(self, player_id: str, move: str, args: Dict[str, Any]) -> Tuple[bool, Dict[str, Any]]:
        response = self._rpc({"cmd": "apply", "playerID": player_id, "move": move, "args": args})
        return bool(response["invalid"]), response["proj"]

    def probe_batch(self, probes: Sequence[Tuple[str, str, Dict[str, Any]]]) -> List[bool]:
        if not probes:
            return []
        response = self._rpc(
            {
                "cmd": "probeBatch",
                "probes": [
                    {"playerID": player, "move": move, "args": args} for player, move, args in probes
                ],
            }
        )
        return [bool(entry) for entry in response["legal"]]

    def close(self) -> None:
        if self.process.poll() is not None:
            return
        try:
            self._rpc({"cmd": "quit"})
        except Exception:  # noqa: BLE001 - shutting down either way
            pass
        finally:
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()


# --------------------------------------------------------------------------- translation


class Seating:
    """Match seats, fixed for the whole match. The one thing that does **not** move between rounds.

    Match seat `i` is the `i`-th player counterclockwise from `seatOrder[0]`, which makes walking
    `+1` through ascending match seats the same walk as the engine's ring — see
    `getNextActivePlayerID`, which steps `-1` through `seatOrder` and skips whoever has left. Numbering
    them in `seatOrder` order instead would have the two rings running opposite ways, and every round
    after an elimination would have to undo that.
    """

    def __init__(self, projection: Dict[str, Any]) -> None:
        seat_order: List[str] = projection["seatOrder"]
        self.players = [seat_order[(0 - step) % len(seat_order)] for step in range(len(seat_order))]
        self.match_seat = {player_id: seat for seat, player_id in enumerate(self.players)}


class Table:
    """The map between the engine's vocabulary and the simulator's, for **one round**.

    Rebuilt every round, because both halves of it move. **Seats:** who is still in the game and who
    starts. **Cards:** an elimination re-derives the deck for the new player count, so both the rank
    list and the Joker's `deckOrder` threshold shrink with it.
    """

    def __init__(
        self,
        projection: Dict[str, Any],
        seating: Seating,
        config: AnteConfig,
    ) -> None:
        # Read back from the engine rather than assumed. `normalizeSelectedRanks` sorts what the
        # lobby sends, and a harness that kept its own order would map every `deckOrder` onto the
        # wrong rank *consistently* — which no state comparison can catch, because both sides would
        # be reading the same wrong map. Only a `Call BS` verdict would ever disagree. After an
        # elimination it is also the only way to know *which* ranks the engine kept: `resizeAnteDeck`
        # drops them at random.
        self.ranks = list(projection["selectedRanks"])
        self.config = config
        self.active_ranks = len(self.ranks)
        self.seating = seating

        players = projection["players"]
        active = [player_id for player_id in seating.players if not players[player_id]["hasLeft"]]
        start = projection["round"]["startingPlayerID"]
        if start not in active:
            raise Mismatch("The engine started a round on a seat that has left", [str(start)])
        index = active.index(start)
        self.turn_order = [active[(index + step) % len(active)] for step in range(len(active))]
        self.position = {player_id: position for position, player_id in enumerate(self.turn_order)}

    def seat(self, player_id: Optional[str]) -> Optional[int]:
        return None if player_id is None else self.position[player_id]

    def player(self, seat: int) -> str:
        return self.turn_order[seat]

    def card_type(self, deck_order: int) -> int:
        # `4 * active_ranks` is where the Jokers start in the *current* deck, but the type they map to
        # is the config's fixed Joker slot — the simulator keeps the Joker's row still while ranks are
        # trimmed away beneath it. See `AnteRound`.
        if deck_order >= 4 * self.active_ranks:
            return self.config.joker_type
        return deck_order % self.active_ranks

    def trump_slot(self, rank: Optional[str]) -> Optional[int]:
        if rank is None:
            return None
        if rank in self.ranks:
            return self.ranks.index(rank)
        return self.config.off_deck_trump

    def trump_rank(self, slot: int) -> str:
        if slot < len(self.ranks):
            return self.ranks[slot]
        off_deck = [rank for rank in ALL_RANKS if rank not in self.ranks]
        return off_deck[0]

    def counts(self, deck_orders: Sequence[int]) -> List[int]:
        counts = [0] * self.config.num_types
        for deck_order in deck_orders:
            counts[self.card_type(deck_order)] += 1
        return counts


def project_engine(projection: Dict[str, Any], table: Table) -> Dict[str, Any]:
    plays = []
    for play in projection["table"]:
        revealed = len(play["revealedCardIDs"])
        if revealed not in (0, len(play["cards"])):
            raise Mismatch(
                "A play was half revealed at a decision point",
                [f"play {play['id']}: {revealed} of {len(play['cards'])} face up"],
            )
        plays.append(
            {
                "seat": table.seat(play["playerID"]),
                "types": sorted(table.card_type(card) for card in play["cards"]),
                "size": len(play["cards"]),
                "revealed": revealed > 0,
            }
        )

    play_index_by_id = {play["id"]: index for index, play in enumerate(projection["table"])}
    pending: List[Optional[int]] = [None] * len(table.turn_order)
    for player_id, player in projection["players"].items():
        if player_id not in table.position:
            continue  # Eliminated, so not dealt into this round and holding no pending reveal.
        pending[table.position[player_id]] = play_index_by_id.get(player["pendingRevealPlayID"])

    return {
        "current": table.seat(projection["currentPlayer"]),
        "trump": table.trump_slot(projection["round"]["trumpRank"]),
        "pass_streak": projection["round"]["passStreak"],
        "last_non_passing": table.seat(projection["round"]["lastNonPassingPlayerID"]),
        "hands": [table.counts(projection["players"][table.player(seat)]["hand"]) for seat in range(len(table.turn_order))],
        "table": plays,
        "pending_reveal": pending,
    }


def project_sim(game: AnteRound) -> Dict[str, Any]:
    return {
        "current": game.current,
        "trump": game.trump,
        "pass_streak": game.pass_streak,
        "last_non_passing": game.last_non_passing,
        "hands": [list(hand) for hand in game.hands],
        "table": [
            {"seat": play.seat, "types": sorted(play.types), "size": play.size, "revealed": play.revealed}
            for play in game.table
        ],
        "pending_reveal": list(game.pending_reveal),
    }


def diff(left: Any, right: Any, path: str = "") -> List[str]:
    if isinstance(left, dict) and isinstance(right, dict):
        out: List[str] = []
        for key in sorted(set(left) | set(right)):
            if key not in left:
                out.append(f"{path}.{key}: missing on the simulator side")
            elif key not in right:
                out.append(f"{path}.{key}: missing on the oracle side")
            else:
                out.extend(diff(left[key], right[key], f"{path}.{key}"))
        return out
    if isinstance(left, list) and isinstance(right, list):
        if len(left) != len(right):
            return [f"{path}: length {len(left)} vs {len(right)}"]
        out = []
        for index, (one, other) in enumerate(zip(left, right)):
            out.extend(diff(one, other, f"{path}[{index}]"))
        return out
    return [] if left == right else [f"{path}: {left!r} vs {right!r}"]


# --------------------------------------------------------------------------- driving


def forced_move(projection: Dict[str, Any]) -> Optional[Tuple[str, str, Dict[str, Any]]]:
    """The next move nobody chooses: `(playerID, move, args)`, or ``None`` at a decision point.

    `Take Turn`, the Reveal Rule's flips and the `Call BS` walk are all pressed by hand in the real
    client, but none of them is a choice — which card of a pile goes over first changes nothing, and
    the walk cannot be declined or reordered. An environment that exposed them as actions would hand
    a policy a long stretch of moves with one outcome each. The simulator therefore folds them into
    the turn, and this is what drives the engine through them so the two meet at the same places.
    """
    # The framework stops accepting moves once the match is over, and the engine leans on that: an
    # Ante `finalizeBSResolution` ends the match through `finalizeGame` without clearing
    # `G.bsResolution`, so a driver that kept going would award the same gold twice.
    if projection["gameStatus"] != "active" or projection["gameover"] is not None:
        return None

    # Card ids are positional and prefixed per round: `dealAnteRound` builds each round's deck with
    # `r${roundNumber}`, because two rounds sharing a prefix would hand the client the same id for
    # different cards. Every id assembled below has to carry the round it was dealt in.
    prefix = f"r{projection['round']['roundNumber']}-"

    resolution = projection["bs"]
    if resolution is not None:
        caller = resolution["callerPlayerID"]
        args = {"resolutionID": resolution["id"]}
        order = resolution["revealOrder"]
        step = resolution["revealStepIndex"]
        complete = step >= len(order)
        if not complete and not resolution["isPunishing"]:
            focused = order[step]
            for play in projection["table"]:
                if play["playerID"] != focused:
                    continue
                face_down = [card for card in play["cards"] if card not in play["revealedCardIDs"]]
                if face_down:
                    return caller, "revealBSCard", {**args, "cardID": f"{prefix}{face_down[0]}"}
            return caller, "advanceBSReveal", args
        if not resolution["isPunishing"]:
            return caller, "beginBSPunishment", args
        return caller, "finalizeBSResolution", args

    # `Ending 2` and `Ending 3` borrow the engine's Reset walk to turn the table over before the round
    # settles. Neither is a decision — the winner was named before the first card went over — so it is
    # driven here rather than exposed, exactly as the `Call BS` walk above is. The simulator folds both
    # into `_finish`, which flips the whole table at once.
    reset = projection["reset"]
    if reset is not None:
        caller = reset["callerPlayerID"]
        args = {"resolutionID": reset["id"]}
        order = reset["revealOrder"]
        step = reset["revealStepIndex"]
        if step < len(order):
            focused = order[step]
            for play in projection["table"]:
                if play["playerID"] != focused:
                    continue
                face_down = [card for card in play["cards"] if card not in play["revealedCardIDs"]]
                if face_down:
                    return caller, "revealResetCard", {**args, "cardID": f"{prefix}{face_down[0]}"}
            return caller, "advanceResetReveal", args
        return caller, "finalizeResetResolution", args

    opening = projection["turnOpening"]
    if opening is not None:
        if not opening["isTaken"]:
            return opening["playerID"], "takeTurn", {"openingID": opening["id"]}
        reveal = opening["reveal"]
        if reveal is not None:
            for play in projection["table"]:
                if play["id"] != reveal["playID"]:
                    continue
                for card in reveal["cardIDs"]:
                    if card not in play["revealedCardIDs"]:
                        return (
                            opening["playerID"],
                            "revealTurnCard",
                            {"openingID": opening["id"], "cardID": f"{prefix}{card}"},
                        )
            return opening["playerID"], "finalizeTurnReveal", {"openingID": opening["id"]}

    return None


def drive_forced(oracle: Oracle, projection: Dict[str, Any]) -> Dict[str, Any]:
    """Run the engine's forced procedures until it is standing at a decision, as the simulator is."""
    for _ in range(512):
        pending = forced_move(projection)
        if pending is None:
            return projection
        player_id, move, args = pending
        invalid, projection = oracle.apply(player_id, move, args)
        if invalid:
            raise Mismatch(
                "The engine refused a forced move",
                [f"{player_id} {move} {args}"],
            )
    raise Mismatch("Forced procedures did not settle", [])


def engine_move(
    action: Tuple,
    table: Table,
    projection: Dict[str, Any],
    seat: int,
) -> Tuple[str, str, Dict[str, Any]]:
    """Translate one simulator action into the engine move that performs it.

    A play names *types*, and the engine needs concrete card ids. Any card of the right type will do
    — Ante reads nothing but the rank — so the lowest-sorting held one is taken, which keeps the
    choice reproducible on both sides.
    """
    player_id = table.player(seat)
    if action[0] == ACTION_PASS:
        return player_id, "pass", {}
    if action[0] == ACTION_CALL_BS:
        return player_id, "callBS", {}

    trump_slot, types = action[1], action[2]
    # Cards held first, then the rest of the deck. A probe of an *illegal* play has to name real
    # cards of the right type that the player does not hold, so the engine refuses it for the reason
    # being tested rather than for an unparseable id.
    hand = set(projection["players"][player_id]["hand"])
    deck_size = 4 * table.active_ranks + 2
    by_type: Dict[int, List[int]] = {}
    for deck_order in range(deck_size):
        by_type.setdefault(table.card_type(deck_order), []).append(deck_order)
    for candidates in by_type.values():
        candidates.sort(key=lambda deck_order: (deck_order not in hand, deck_order))

    prefix = f"r{projection['round']['roundNumber']}-"
    card_ids: List[str] = []
    taken: Dict[int, int] = {}
    for card_type in types:
        offset = taken.get(card_type, 0)
        card_ids.append(f"{prefix}{by_type[card_type][offset]}")
        taken[card_type] = offset + 1

    if trump_slot is None:
        return player_id, "play", {"cardIDs": card_ids}
    return player_id, "selectTrumpAndPlay", {"cardIDs": card_ids, "trumpRank": table.trump_rank(trump_slot)}


# --------------------------------------------------------------------------- the run


def choose_action(game: AnteRound, rng: random.Random, mode: str) -> Tuple:
    """Pick the next action under one of three schedules.

    ``flat`` is uniform and is dominated by plays — dozens of card choices against one `Call BS` — so
    it reaches the deep positions a long round gets to. ``kind`` picks a kind first, which is what
    exercises the resolutions. ``pass_heavy`` is the only way five passes in a row happen often
    enough to test `Ending 2`, and ``play_heavy`` refuses to challenge, which is what empties a hand
    and reaches `Ending 3`. ``reverse`` exists because random play essentially never arms the
    **Reverse Rule**: it needs four cards of the trump rank face up at once, and the one branch in the
    game that inverts a verdict would otherwise go untested across a whole run. It piles trump onto
    the table and only challenges once four are there.
    """
    actions = game.legal_actions()
    if mode == "flat":
        return actions[rng.randrange(len(actions))]

    by_kind: Dict[str, List[Tuple]] = {}
    for action in actions:
        by_kind.setdefault(action[0], []).append(action)

    if mode == "pass_heavy" and rng.random() < 0.6:
        return (ACTION_PASS,)

    if mode == "play_heavy" and ACTION_PLAY in by_kind:
        bucket = by_kind[ACTION_PLAY]
        return bucket[rng.randrange(len(bucket))]

    if mode == "reverse":
        trump = game.trump
        # Jokers deliberately excluded: the Joker Rule keeps them out of the Reverse Rule count, so a
        # play of two Jokers is honest and does nothing toward arming it.
        loaded = [
            action
            for action in by_kind.get(ACTION_PLAY, [])
            if all(
                card_type == (action[1] if action[1] is not None else trump)
                for card_type in action[2]
            )
            and (action[1] is None or action[1] != game.config.off_deck_trump)
        ]
        if loaded and (game.reverse_rule_count() < 4 or rng.random() < 0.5):
            loaded.sort(key=lambda action: -len(action[2]))
            return loaded[0]
        if game.reverse_rule_count() >= 4 and (ACTION_CALL_BS,) in actions:
            return (ACTION_CALL_BS,)

    kind = rng.choice(sorted(by_kind))
    bucket = by_kind[kind]
    return bucket[rng.randrange(len(bucket))]


def probe_mask(
    oracle: Oracle,
    game: AnteRound,
    space: ActionSpace,
    table: Table,
    projection: Dict[str, Any],
    rng: random.Random,
    mode: str,
) -> int:
    """Check the simulator's mask against the engine in both directions.

    Every action the simulator calls legal is applied to a throwaway clone and must be accepted; a
    sample (or, at ``full``, every one) of the actions it calls illegal must be refused. A mask that
    is too narrow hides real options from a policy; one that is too wide makes it choose moves the
    server will silently drop, which on a real table is a frozen game.
    """
    mask = space.legal_mask(game)

    def is_probeable(index: int) -> bool:
        """Whether this index names a move the engine can even be asked about.

        The flat action space is built for the *starting* deck, so after an elimination trims it two
        families of index describe nothing the engine holds, and both must be skipped rather than
        probed — the second would otherwise report a failure that is not one.

        * A choice needing a card type the deck no longer contains. There is no card to name, so
          there is no move; the simulator calling it illegal is trivially right.
        * A trump-selecting play naming a rank slot that has been trimmed away. `trump_rank` would
          resolve it to some off-deck rank, which the engine accepts — but as a *different* move from
          the one the index means. The simulator masks these deliberately, because they duplicate the
          off-deck slot rather than because the engine refuses them, and probing them would compare
          the two sides on two different questions.
        """
        action = space.decompose(index)
        if action[0] != ACTION_PLAY:
            return True
        if action[1] is not None and action[1] not in game.trump_slots:
            return False
        return all(game.copies[card_type] > 0 for card_type in action[2])

    candidates = [index for index, legal in enumerate(mask) if legal]
    illegal = [index for index, legal in enumerate(mask) if not legal and is_probeable(index)]

    if mode == "fast":
        # A play whose cards are not in hand is the interesting refusal, and there are hundreds of
        # them; a sample is enough to catch a mask that has gone systematically wide.
        rng.shuffle(illegal)
        illegal = illegal[:24]

    probes: List[Tuple[str, str, Dict[str, Any]]] = []
    for index in candidates + illegal:
        probes.append(engine_move(space.decompose(index), table, projection, game.current))

    answers = oracle.probe_batch(probes)
    details: List[str] = []
    for offset, index in enumerate(candidates + illegal):
        expected = offset < len(candidates)
        if answers[offset] != expected:
            verdict = "accepted" if answers[offset] else "refused"
            details.append(
                f"index {index} {space.decompose(index)!r}: simulator says "
                f"{'legal' if expected else 'illegal'}, engine {verdict} it"
            )
    if details:
        raise Mismatch("Legal-action mask disagreed with the engine", details)
    return len(probes)


@dataclass
class RunStats:
    decisions: int = 0
    probes: int = 0
    rounds: int = 0
    reversals: int = 0
    eliminations: int = 0
    endings: Dict[str, int] = field(default_factory=dict)
    deck_shrinks: int = 0


class MatchRun:
    """One match played in lockstep. Holds the two sides and the map between them.

    A class rather than a function because a round boundary needs three things to happen in one
    order, and that order is the only subtle thing in this file. The engine deals the next round
    *inside* the move that ends the current one — `endAnteRound` settles the gold, sweeps the
    eliminations, resizes the deck and redeals, all before it returns — so the engine is asked to move
    first and the simulator second. By the time `AnteMatch` settles its own round and calls back for
    the next deal, the engine's cards for it are already on the table to be read.
    """

    def __init__(
        self,
        oracle: Oracle,
        config: AnteConfig,
        space: ActionSpace,
        rng: random.Random,
        probe: str,
        mode: str,
        round_limit: int,
        starting_gold: int = STARTING_GOLD,
    ) -> None:
        self.oracle = oracle
        self.config = config
        self.space = space
        self.rng = rng
        self.probe = probe
        self.mode = mode
        self.round_limit = round_limit
        self.starting_gold = starting_gold
        self.stats = RunStats()

    # ------------------------------------------------------------------ dealing

    def _deal(self, seats: List[int], active_ranks: int) -> List[List[int]]:
        """`AnteMatch`'s dealer: hand the simulator exactly what the engine just dealt.

        Called once per round, after the engine has already begun it. Everything that moves at a
        round boundary is re-read here rather than derived — which ranks survived the resize (they are
        dropped at random), who is still in, and who starts.
        """
        self.table = Table(self.projection, self.seating, self.config)

        if self.table.active_ranks != active_ranks:
            raise Mismatch(
                "The deck resized differently",
                [f"simulator kept {active_ranks} rank(s), engine kept {self.table.active_ranks}"],
            )
        engine_seats = [self.seating.match_seat[player_id] for player_id in self.table.turn_order]
        if engine_seats != seats:
            raise Mismatch(
                "The round's turn order disagreed",
                [f"simulator {seats} vs engine {engine_seats}"],
            )
        return [
            self.table.counts(self.projection["players"][self.table.player(seat)]["hand"])
            for seat in range(len(seats))
        ]

    # ------------------------------------------------------------------ checks

    def _check_standings(self, final: bool = False) -> None:
        """Gold and elimination, which are the only things a round hands to the next one."""
        match = self.match
        players = self.projection["players"]
        engine_gold = [players[self.seating.players[seat]]["gold"] for seat in range(self.config.num_players)]
        if engine_gold != list(match.gold):
            raise Mismatch(
                f"Gold disagreed after round {match.round_number}",
                [f"simulator {list(match.gold)} vs engine {engine_gold}"],
            )

        engine_left = [bool(players[self.seating.players[seat]]["hasLeft"]) for seat in range(self.config.num_players)]
        eliminated = list(match.eliminated)
        if not final:
            if engine_left != eliminated:
                raise Mismatch(
                    f"Elimination disagreed after round {match.round_number}",
                    [f"simulator {eliminated} vs engine {engine_left}"],
                )
            return

        # At the end the two words stop meaning the same thing. The simulator's `eliminated` is
        # bankruptcy and nothing else; the engine's `hasLeft` also gets set on the **last remaining**
        # player by `finalizeGameForLastRemainingPlayer`, because a finished match has nobody in it.
        # So the requirement here is containment plus that one permitted extra, and gold above is what
        # actually pins the bankruptcies down — a seat is eliminated exactly when its gold reaches 0.
        extra = [seat for seat in range(self.config.num_players) if engine_left[seat] and not eliminated[seat]]
        missing = [seat for seat in range(self.config.num_players) if eliminated[seat] and not engine_left[seat]]
        survivors = [seat for seat in range(self.config.num_players) if not eliminated[seat]]
        if missing or len(extra) > 1 or (extra and len(survivors) != 1):
            raise Mismatch(
                "Elimination disagreed at the end of the match",
                [
                    f"simulator {eliminated} vs engine {engine_left}",
                    f"unexplained extras {extra}, missing {missing}, survivors {survivors}",
                ],
            )

    # ------------------------------------------------------------------ the run

    def run(self, seed: int) -> RunStats:
        config = self.config
        # Sorted, because `normalizeSelectedRanks` sorts whatever a host sends and the deck is built
        # in that order — so `deckOrder % R` names a rank only if this list is in the engine's order.
        ranks = sorted(self.rng.sample(list(ALL_RANKS), config.num_ranks), key=ALL_RANKS.index)
        self.projection = self.oracle.new_match(
            config.num_players, ranks, seed, self.round_limit, self.starting_gold
        )
        if sorted(self.projection["selectedRanks"]) != sorted(ranks):
            raise Mismatch(
                "The engine chose a different deck",
                [f"asked for {sorted(ranks)}, got {sorted(self.projection['selectedRanks'])}"],
            )
        self.seating = Seating(self.projection)
        self.projection = drive_forced(self.oracle, self.projection)

        start = self.seating.match_seat[self.projection["round"]["startingPlayerID"]]
        self.match = AnteMatch(
            MatchConfig(
                shape=config, round_limit=self.round_limit, starting_gold=self.starting_gold
            ),
            starting_seat=start,
            dealer=self._deal,
        )

        active_ranks = self.match.active_ranks
        while not self.match.finished:
            game = self.match.round
            assert game is not None
            differences = diff(project_sim(game), project_engine(self.projection, self.table))
            if differences:
                raise Mismatch(
                    f"State diverged in round {self.match.round_number} after "
                    f"{self.stats.decisions} decision(s)",
                    differences,
                )

            if self.probe != "none":
                self.stats.probes += probe_mask(
                    self.oracle, game, self.space, self.table, self.projection, self.rng, self.probe
                )

            action = choose_action(game, self.rng, self.mode)
            self.stats.decisions += 1
            if action[0] == ACTION_CALL_BS and game.reverse_rule_count() >= 4:
                self.stats.reversals += 1

            player_id, move, args = engine_move(action, self.table, self.projection, game.current)
            invalid, self.projection = self.oracle.apply(player_id, move, args)
            if invalid:
                raise Mismatch(
                    "The engine refused an action the simulator called legal",
                    [f"{player_id} {move} {args} for {action!r}"],
                )
            self.projection = drive_forced(self.oracle, self.projection)

            # Second, and only now: settling this may deal the next round out of `self.projection`.
            before = len(self.match.outcomes)
            self.match.apply(action)
            if len(self.match.outcomes) > before:
                outcome = self.match.outcomes[-1]
                self.stats.rounds += 1
                self.stats.endings[outcome.ending] = self.stats.endings.get(outcome.ending, 0) + 1
                self.stats.eliminations += len(outcome.eliminated)
                self._check_standings(final=self.match.finished)
                if self.match.active_ranks < active_ranks:
                    self.stats.deck_shrinks += 1
                    active_ranks = self.match.active_ranks

        engine_over = self.projection["gameStatus"] != "active" or self.projection["gameover"] is not None
        if not engine_over:
            raise Mismatch(
                "The simulator ended the match and the engine did not",
                [f"after {self.stats.rounds} round(s), engine status {self.projection['gameStatus']}"],
            )
        self._check_standings(final=True)
        return self.stats


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--games", type=int, default=40, help="matches to play")
    parser.add_argument("--rounds", type=int, default=1, help="`RoundLimit` for each match")
    # `StartingGold`. The default is the game's, but the elimination sweep and the deck resize behind
    # it are only reached when somebody actually goes bankrupt, and at 5 gold that is rare enough to
    # leave both branches untested in a run of any affordable length. Lowering it does not weaken the
    # test — it is the same code path, reached sooner.
    parser.add_argument("--gold", type=int, default=STARTING_GOLD, help="`StartingGold` per seat")
    parser.add_argument("--players", type=int, default=5)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--probe", choices=("none", "fast", "full"), default="fast")
    parser.add_argument("--node", default="node")
    args = parser.parse_args()

    config = AnteConfig.for_players(args.players)
    space = ActionSpace(config)
    rng = random.Random(args.seed)
    oracle = Oracle(args.node)

    print(
        f"Ante conformance: {args.games} match(es) of up to {args.rounds} round(s), "
        f"{config.num_players} players, {config.num_ranks} ranks ({config.deck_size} cards), "
        f"probe={args.probe}"
    )

    total = RunStats()
    modes = ("flat", "kind", "pass_heavy", "play_heavy", "reverse")

    try:
        for game_index in range(args.games):
            seed = rng.randrange(1, 2**31 - 1)
            mode = modes[game_index % len(modes)]
            run = MatchRun(oracle, config, space, rng, args.probe, mode, args.rounds, args.gold)
            try:
                stats = run.run(seed)
            except Mismatch as mismatch:
                print(f"\nFAIL match {game_index + 1} (seed {seed}, {mode})")
                print(mismatch.report())
                return 1
            total.decisions += stats.decisions
            total.probes += stats.probes
            total.rounds += stats.rounds
            total.reversals += stats.reversals
            total.eliminations += stats.eliminations
            total.deck_shrinks += stats.deck_shrinks
            for name, count in stats.endings.items():
                total.endings[name] = total.endings.get(name, 0) + count
            if (game_index + 1) % 10 == 0:
                print(f"  {game_index + 1} match(es), {total.decisions} decisions agreed")
    finally:
        oracle.close()

    share = ", ".join(f"{name}={count}" for name, count in sorted(total.endings.items()))
    print(
        f"\nOK  {args.games} match(es), {total.rounds} round(s), {total.decisions} decisions, "
        f"{total.probes} mask probes agreed"
    )
    print(f"    endings {share}; {total.reversals} verdict(s) reversed by the Reverse Rule")
    if args.rounds > 1:
        print(
            f"    {total.eliminations} elimination(s), {total.deck_shrinks} deck resize(s) agreed"
        )

    if TOTAL_STANDARD_RANKS != len(ALL_RANKS):
        raise AssertionError("Rank table drifted")
    # The Reverse Rule is the one branch that inverts a verdict, and random play essentially never
    # arms it. A run that never triggered it has not tested it, so say so rather than pass quietly.
    if total.rounds >= 12 and total.reversals == 0:
        print("    FAIL the Reverse Rule was never armed, so its branch went untested")
        return 1
    if len(total.endings) < 3 and total.rounds >= 24:
        print(f"    FAIL only {sorted(total.endings)} were reached; all three endings need covering")
        return 1
    # A multi-round run that never eliminated anybody has not tested the two things it exists for:
    # the elimination sweep and the deck resize that follows it. Both are branches nothing else in
    # this repo reaches, and a quiet pass here would be the same failure the Reverse Rule guard above
    # was written for.
    if args.rounds >= 10 and args.games >= 8 and total.eliminations == 0:
        print("    FAIL no seat was ever eliminated, so the resize and sweep went untested")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

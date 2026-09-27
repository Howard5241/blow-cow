"""The comparable shape of a match, produced identically here and in the oracle.

History, telemetry, the archive and every rendered status string are left out on purpose. They are
prose *about* the state rather than the state, and holding the simulator to them would be holding it
to the wording of a log line. Everything a rule can be read off is in.

Cards are their ``deckOrder`` integers, which is the number the real engine embeds in its ``card-N``
ids, so both sides name the same card without either one having to parse the other's format.
"""

from __future__ import annotations

from typing import Any, Dict, List

from .engine import BlowCowEngine
from .state import Play


def _project_play(play: Play) -> Dict[str, Any]:
    return {
        "id": play.id,
        "playerID": play.player_id,
        "cards": list(play.cards),
        "declaredCardCount": play.declared_card_count,
        "revealedCardIDs": sorted(play.revealed_card_ids),
        "claimedRank": play.claimed_rank,
        "playedAtRound": play.played_at_round,
        "playedAtTurn": play.played_at_turn,
        "revealedAtTurn": play.revealed_at_turn,
        "wasTrumpSelection": play.was_trump_selection,
    }


def project(engine: BlowCowEngine) -> Dict[str, Any]:
    resolution = engine.bs_resolution
    reset = engine.reset_resolution
    opening = engine.turn_opening

    return {
        "turn": engine.ctx_turn,
        "currentPlayer": engine.current_player,
        "gameStatus": engine.game_status,
        "gameover": (
            {
                "placements": list(engine.gameover.placements),
                "winnerID": engine.gameover.winner_id,
                "pointsByPlayer": dict(engine.gameover.points_by_player),
            }
            if engine.gameover
            else None
        ),
        "placements": list(engine.placements),
        "seatOrder": list(engine.seat_order),
        "round": {
            "roundNumber": engine.round.round_number,
            "status": engine.round.status,
            "direction": engine.round.direction,
            "startingPlayerID": engine.round.starting_player_id,
            "trumpRank": engine.round.trump_rank,
            "previousTrumpRank": engine.round.previous_trump_rank,
            "passStreak": engine.round.pass_streak,
            "lastNonPassingPlayerID": engine.round.last_non_passing_player_id,
            "maxCardsOnTable": engine.round.max_cards_on_table,
            "startedTurnNumber": engine.round.started_turn_number,
        },
        "table": [_project_play(play) for play in engine.plays],
        "players": {
            player_id: {
                "seatIndex": engine.players[player_id].seat_index,
                "hand": list(engine.players[player_id].hand),
                "points": engine.players[player_id].points,
                "scoredSets": [
                    {
                        "id": scored_set.id,
                        "rank": scored_set.rank,
                        "cards": list(scored_set.cards),
                    }
                    for scored_set in engine.players[player_id].scored_sets
                ],
                "pendingRevealPlayID": engine.players[player_id].pending_reveal_play_id,
                "hasLeft": engine.players[player_id].has_left,
                "leaveOrder": engine.players[player_id].leave_order,
            }
            for player_id in engine.seat_order
        },
        "bs": (
            {
                "id": resolution.id,
                "callerPlayerID": resolution.caller_player_id,
                "targetPlayerID": resolution.target_player_id,
                "targetPlayID": resolution.target_play_id,
                "targetDeclaredCardCount": resolution.target_declared_card_count,
                "trumpRank": resolution.trump_rank,
                "punishmentCardCount": resolution.punishment_card_count,
                "revealOrder": list(resolution.reveal_order),
                "revealStepIndex": resolution.reveal_step_index,
                "isPunishing": resolution.is_punishing,
                "targetWasHonest": resolution.target_was_honest,
                "reverseRuleTriggered": resolution.reverse_rule_triggered,
                "punishedPlayerID": resolution.punished_player_id,
                "unpunishedPlayerID": resolution.unpunished_player_id,
            }
            if resolution
            else None
        ),
        "reset": (
            {
                "id": reset.id,
                "callerPlayerID": reset.caller_player_id,
                "kind": reset.kind,
                "revealOrder": list(reset.reveal_order),
                "revealStepIndex": reset.reveal_step_index,
            }
            if reset
            else None
        ),
        "turnOpening": (
            {
                "id": opening.id,
                "playerID": opening.player_id,
                "turnNumber": opening.turn_number,
                "isTaken": opening.is_taken,
                "reveal": (
                    {
                        "playID": opening.reveal.play_id,
                        "cardIDs": sorted(opening.reveal.card_ids),
                        "isFullReveal": opening.reveal.is_full_reveal,
                    }
                    if opening.reveal
                    else None
                ),
            }
            if opening
            else None
        ),
    }


def diff(left: Any, right: Any, path: str = "") -> List[str]:
    """Every leaf where two projections disagree, named by path. Used for failure reports."""
    differences: List[str] = []

    if isinstance(left, dict) and isinstance(right, dict):
        for key in sorted(set(left) | set(right)):
            if key not in left:
                differences.append(f"{path}.{key}: missing on the simulator side")
            elif key not in right:
                differences.append(f"{path}.{key}: missing on the oracle side")
            else:
                differences.extend(diff(left[key], right[key], f"{path}.{key}"))
        return differences

    if isinstance(left, list) and isinstance(right, list):
        if len(left) != len(right):
            differences.append(f"{path}: length {len(left)} vs {len(right)}")
            return differences
        for index, (left_item, right_item) in enumerate(zip(left, right)):
            differences.extend(diff(left_item, right_item, f"{path}[{index}]"))
        return differences

    if left != right:
        differences.append(f"{path}: {left!r} vs {right!r}")

    return differences

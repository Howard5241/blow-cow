"""Fixtures for `scripts/check-ante-bot.ts`, which holds the browser port to this package.

Two independent things are dumped, because two independent things were ported and a single fixture
would let one hide a bug in the other.

**Network cases.** Random observations through the real `AnteNet`, with the logits and value it
produced. That covers the whole forward pass — the shared type encoder, the pooling, the factored
action head and its static gate — and it needs no game state at all, so a disagreement is
unambiguously an arithmetic bug rather than a state-translation one.

**Encoder cases.** Real positions from real rollouts, dumped as a neutral description of the round
(whose hand, what is on the table, what has happened) alongside the observation and legal mask the
Python encoder produced from it. The TypeScript side rebuilds its own view from that description and
must reach the same 200 numbers and the same mask.

What this deliberately does *not* cover is the step in front of the encoder: turning a boardgame.io
``G`` into that neutral description. That one is checked by `ante engine adapter` in the same script,
which drives the real engine through `rl/oracle/blowcow-oracle.ts`.

Usage::

    python rl/dump_ante_bot_cases.py --out rl/runs/_check/ante-bot-cases.json
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import numpy as np
import torch

from ante.config import AnteConfig
from ante.env import AnteEnv
from ante.nets import AnteNet
from ante.observation import ObservationEncoder
from ante.match import MatchConfig
from ante.match_env import AnteMatchEnv
from ante.match_observation import MatchObservationEncoder
from ante.spaces import ActionSpace


def dump_network_cases(net: AnteNet, count: int, rng: random.Random) -> list[dict]:
    """Random observations, and what the network says about them.

    Drawn from a mixture of uniform noise and sparse vectors rather than from real positions on
    purpose: a real observation is mostly zeros and would leave whole branches of the head untested,
    while noise exercises every weight. Correctness on both is what the port needs.
    """
    cases = []
    generator = np.random.default_rng(rng.getrandbits(32))
    for index in range(count):
        if index % 3 == 0:
            observation = generator.random(net.observation_size, dtype=np.float32)
        elif index % 3 == 1:
            observation = generator.normal(0, 1, net.observation_size).astype(np.float32)
        else:
            observation = (generator.random(net.observation_size) < 0.2).astype(np.float32)

        with torch.no_grad():
            logits, value = net.forward(torch.from_numpy(observation).unsqueeze(0))

        cases.append(
            {
                "observation": [round(float(x), 7) for x in observation],
                "logits": [round(float(x), 5) for x in logits[0].tolist()],
                "value": round(float(value[0].item()), 6),
            }
        )
    return cases


def describe_round(game, viewer: int) -> dict:
    """The round as a neutral structure, carrying only what a viewer may see.

    This is the contract the TypeScript `AnteRoundView` has to be able to reproduce from `G`. It
    deliberately holds no hand but the viewer's, and no face-down cards but the viewer's own — if a
    field here could not be filled in from a client's `playerView`, the port could not be written.
    """
    return {
        "numPlayers": game.n,
        "activeRanks": game.active_ranks,
        "copies": list(game.copies),
        "viewer": viewer,
        "current": game.current,
        "trump": game.trump,
        "passStreak": game.pass_streak,
        "lastNonPassing": game.last_non_passing,
        "turn": game.turn,
        "hand": list(game.hands[viewer]),
        "handSizes": [sum(hand) for hand in game.hands],
        "bsTarget": game.bs_target() if game.current == viewer else None,
        "table": [
            {
                "seat": play.seat,
                # Face down and not the viewer's own: the types are withheld, exactly as
                # `hideSecretState` withholds the cards.
                "types": list(play.types) if (play.revealed or play.seat == viewer) else None,
                "size": play.size,
                "revealed": play.revealed,
            }
            for play in game.table
        ],
        "events": [
            {"seat": event.seat, "kind": event.kind, "size": event.size} for event in game.events
        ],
    }


def dump_encoder_cases(config: AnteConfig, count: int, seed: int) -> list[dict]:
    """Positions from random rollouts, with the observation and mask the encoder produced."""
    encoder = ObservationEncoder(config)
    space = ActionSpace(config)
    env = AnteEnv(config=config, seed=seed)
    rng = random.Random(seed)

    cases: list[dict] = []
    while len(cases) < count:
        decision = env.reset()
        while decision is not None and not env.game.finished:
            game = env.game
            # Every seat's view of the same position, since the per-seat rows and the counting differ
            # by viewer and a bug in one seat's row is invisible from another's.
            for viewer in range(game.n):
                cases.append(
                    {
                        "round": describe_round(game, viewer),
                        "observation": [round(float(x), 7) for x in encoder.encode(game, viewer)],
                        # The mask is only defined for the seat on the clock.
                        "mask": space.legal_mask(game) if viewer == game.current else None,
                    }
                )
            legal = [index for index, allowed in enumerate(space.legal_mask(game)) if allowed]
            decision = env.step(rng.choice(legal))
    return cases[:count]


def dump_match_encoder_cases(config: AnteConfig, count: int, seed: int, rounds: int, gold: int) -> list[dict]:
    """Match-block features from real match rollouts, with the inputs a client would build them from.

    This holds `src/bots/ante/anteMatchObservation.ts` to `ante/match_observation.py`, and it dumps
    the encoder's *inputs* rather than a match object because the browser never has one: it builds an
    `AnteMatchView` out of `G` — gold, elimination, `player.anteRecord`, the round number — and this
    fixture is that view plus the 98 features the Python produced from the same state.

    Row order is the encoder's own: offset 0 is the viewer, offset k is whoever acts k turns later,
    and seats already eliminated fill the leftover rows. Dumped rather than recomputed on the other
    side, so a disagreement about *seating* shows up as a feature mismatch here instead of silently
    handing the network somebody else's honesty record.
    """
    match_config = MatchConfig(shape=config, round_limit=rounds, starting_gold=gold)
    encoder = MatchObservationEncoder(match_config)
    space = ActionSpace(config)
    env = AnteMatchEnv(match_config, seed=seed)
    rng = random.Random(seed)
    round_size = encoder.round_size

    cases: list[dict] = []
    while len(cases) < count:
        decision = env.reset()
        while not decision.terminated:
            match = decision.match
            for viewer in range(match.num_seats):
                observation = encoder.encode(match, viewer)
                # The same row walk `encode` uses, so the fixture carries the seating it assumed.
                order: list[int] = []
                if match.round is not None and not match.round.finished and viewer in match.round_seat:
                    base = match.round_seat[viewer]
                    order = [match.seats[(base + step) % match.round.n] for step in range(match.round.n)]
                else:
                    order = list(match.active_seats)
                rows = list(order) + [s for s in range(match.num_seats) if s not in order]
                records = match.live_records()

                def describe(seat: int) -> dict:
                    return {
                        "gold": int(match.gold[seat]),
                        "isEliminated": bool(match.eliminated[seat]),
                        "record": {
                            "lies": records[seat].lies,
                            "honest": records[seat].honest,
                            "callsMade": records[seat].calls_made,
                            "callsWon": records[seat].calls_won,
                            "roundsWon": records[seat].rounds_won,
                            "bsLosses": records[seat].bs_losses,
                        },
                    }

                cases.append(
                    {
                        "numSeats": match.num_seats,
                        "roundNumber": match.round_number,
                        "roundLimit": match_config.round_limit,
                        "startingGold": match_config.starting_gold,
                        "seats": [describe(seat) for seat in rows],
                        # Carried rather than left to be read off row 0. `encode` reads `gold[viewer]`
                        # and `records[viewer]` directly, and row 0 is the viewer only while they are
                        # seated in a live round — a bankrupt seat is in none of these rows at all.
                        # Dumping it is what lets the port be checked on those positions instead of
                        # agreeing with the Python only where the assumption happened to hold.
                        "viewer": describe(viewer),
                        "viewerRowIndex": rows.index(viewer),
                        "match": [round(float(x), 7) for x in observation[round_size:]],
                    }
                )
            legal = [i for i, allowed in enumerate(decision.action_mask) if allowed]
            decision = env.step(rng.choice(legal))
    return cases[:count]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", default="rl/runs/ante-s2-long/final.pt")
    parser.add_argument("--out", default="rl/runs/_check/ante-bot-cases.json")
    parser.add_argument("--network-cases", type=int, default=40)
    parser.add_argument("--encoder-cases", type=int, default=300)
    parser.add_argument("--match-cases", type=int, default=0,
                        help="match-block cases; only meaningful for a match checkpoint")
    parser.add_argument("--rounds", type=int, default=20)
    parser.add_argument("--gold", type=int, default=5)
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()

    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    saved = checkpoint.get("config") or {"num_players": 5, "num_ranks": 7}
    config = AnteConfig(num_players=saved["num_players"], num_ranks=saved["num_ranks"])
    # `extra_width` and `value_scale` are 0 and 1.0 for every one-round checkpoint and non-trivial for
    # a match one. Built from the checkpoint rather than defaulted, so the network cases a match
    # policy produces are the network the browser will actually run — see `rl/export_ante_round.py`.
    net = AnteNet(
        config,
        hidden=checkpoint.get("hidden", 256),
        type_dim=checkpoint.get("type_dim", 32),
        extra_width=int(checkpoint.get("extra_width", 0)),
        value_scale=float(checkpoint.get("value_scale", 1.0)),
        lie_head=bool(checkpoint.get("lie_head", False)),
        lie_to_policy=bool(checkpoint.get("lie_to_policy", False)),
        challenge_head=bool(checkpoint.get("challenge_head", False)),
    )
    net.load_state_dict(checkpoint["model"])
    net.eval()

    rng = random.Random(args.seed)
    payload = {
        "checkpoint": Path(args.checkpoint).as_posix(),
        "numPlayers": config.num_players,
        "numRanks": config.num_ranks,
        "observationSize": net.observation_size,
        "actionSize": net.action_size,
        "network": dump_network_cases(net, args.network_cases, rng),
        "encoder": dump_encoder_cases(config, args.encoder_cases, args.seed),
        "matchEncoder": (
            dump_match_encoder_cases(config, args.match_cases, args.seed, args.rounds, args.gold)
            if args.match_cases
            else []
        ),
    }

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload), encoding="utf-8")
    print(
        f"wrote {out} ({len(payload['network'])} network, "
        f"{len(payload['encoder'])} encoder, {len(payload['matchEncoder'])} match cases)"
    )


if __name__ == "__main__":
    main()

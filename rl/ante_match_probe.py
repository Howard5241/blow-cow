"""What does a trained Ante **match** policy actually encode — and is there anything to encode?

Every other script here scores agents against each other. This one asks two mechanical questions that
need no training and no opponent, and between them they explain most of `rl/ANTE.md`'s null results.

**1. Criticality.** In what fraction of decisions is gold live at all? Ante's economy is inflationary
— two of the three endings mint a gold from the bank and only `Call BS` removes one — so a seat's gold
drifts *upward* and elimination is a tail event that gets rarer with match length rather than
accumulating. Where no seat is near going out, total gold is the sum of independent per-round outcomes
and the policy maximising it is the one-round policy, so the match layer is a no-op by construction.

**2. Counterfactual sensitivity.** At every `Call BS` opportunity, re-encode the *same* position with
exactly one thing changed and read `P(Call BS)` back:

* the viewer's own gold, swept over every value up to `--gold`. A policy that has learned risk calls
  *less* on its last coin, because losing a challenge there ends its match — so `g1 − g2` should be
  **negative**.
* the target's honesty record, forced to `--reveals` straight honest reveals and then to that many
  straight lies. The ratio is what the 98 match features buy behaviourally, on identical positions.

**Read the negative controls first.** A one-round checkpoint (`round:`) and any arm trained under
`BLOWCOW_ANTE_NO_RECORD` cannot see the block being swept, so they must come back at exactly `+0.0000`
and a ratio of `1.00`. Nothing else in the output means anything if they do not.

This exists because `call_split` — the statistic `ante_match_train.py` logs for the same purpose — is
contaminated: ablation arms score well above zero on it while provably reading nothing, since a seat's
*within-round* revealed honesty correlates with its cross-round record. The counterfactual has no such
leak, because the position is held fixed.

Usage::

    python rl/ante_match_probe.py --games 200 --gold 5 --rounds 20 \\
        --agents ckpt:rl/runs/m-pop-rec-s1/final.pt ckpt:rl/runs/m-pop-abl-s1/final.pt \\
                 round:rl/runs/ante-s2-long/final.pt \\
        --field ckpt:rl/runs/m-pop-rec-s1/final.pt ckpt:rl/runs/m-pop-abl-s1/final.pt \\
                ckpt:rl/runs/m-pop-rec-s3/final.pt ckpt:rl/runs/m-pop-abl-s3/final.pt \\
                round:rl/runs/ante-s2-long/final.pt

``--field`` is the table that generates the positions and needs one spec per seat; ``--agents`` is who
gets probed on them, and the two lists are independent — every agent is asked about every position,
whether or not it is playing.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Dict, List, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np  # noqa: E402
import torch  # noqa: E402

from ante.config import AnteConfig  # noqa: E402
from ante.match import MatchConfig  # noqa: E402
from ante.match_agents import make_match_agent  # noqa: E402
from ante.match_env import AnteMatchEnv  # noqa: E402
from ante.spaces import CALL_BS_INDEX  # noqa: E402


def label(spec: str) -> str:
    path = spec.split(":", 1)[-1]
    name = os.path.basename(os.path.dirname(path)) if "/" in path else path
    kind = spec.split(":", 1)[0] if ":" in spec else "ckpt"
    return name if kind == "ckpt" else f"{name} [{kind}]"


@torch.no_grad()
def call_probabilities(agent, observations: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """`P(Call BS)` for one agent over a batch of variants of a single position."""
    raw = observations[:, : agent.width]
    if agent._blind:
        raw = raw.copy()
        raw[:, agent._blind] = 0.0
    masks = np.broadcast_to(mask, (raw.shape[0], mask.shape[0]))
    logits, _ = agent.net.policy(torch.from_numpy(raw), torch.from_numpy(np.ascontiguousarray(masks)))
    return torch.softmax(logits, dim=-1)[:, CALL_BS_INDEX].numpy()


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--agents", nargs="+", required=True, help="who gets probed")
    parser.add_argument("--field", nargs="+", required=True, help="who generates the positions")
    parser.add_argument("--games", type=int, default=200)
    parser.add_argument("--players", type=int, default=5)
    parser.add_argument("--rounds", type=int, default=20)
    parser.add_argument("--gold", type=int, default=5)
    parser.add_argument(
        "--reveals",
        type=int,
        default=12,
        help="how many reveals the forced honest/lying record is built from",
    )
    parser.add_argument("--seed", type=int, default=101)
    args = parser.parse_args(argv)

    if len(args.field) != args.players:
        raise SystemExit(f"--field needs {args.players} specs, got {len(args.field)}")

    config = MatchConfig(
        shape=AnteConfig.for_players(args.players), round_limit=args.rounds, starting_gold=args.gold
    )
    probes = {
        label(spec): make_match_agent(spec, config, seed=args.seed + 3) for spec in args.agents
    }
    field = [
        make_match_agent(spec, config, seed=args.seed + 17 + i) for i, spec in enumerate(args.field)
    ]
    env = AnteMatchEnv(config, seed=args.seed)
    encoder = env.encoder

    decisions = critical_self = critical_table = 0
    own_gold = np.zeros(args.gold + 2, dtype=np.int64)
    outs = with_out = rounds_played = 0

    gold_curve: Dict[str, np.ndarray] = {name: np.zeros(args.gold) for name in probes}
    record_pair: Dict[str, np.ndarray] = {name: np.zeros(2) for name in probes}
    gold_n = record_n = 0

    for game in range(args.games):
        shift = game % args.players
        decision = env.reset()
        while not decision.terminated:
            match = decision.match
            viewer = decision.seat
            decisions += 1
            gold = match.gold[viewer]
            own_gold[min(gold, args.gold + 1)] += 1
            critical_self += int(gold <= 1)
            critical_table += int(any(match.gold[s] <= 1 for s in match.active_seats))

            if decision.action_mask[CALL_BS_INDEX]:
                mask = decision.action_mask

                # Own gold, position held fixed. Every gold column the encoder writes — the rank, the
                # lead over the best other seat, the table total — recomputes from `match.gold`, so
                # setting it here is the whole counterfactual rather than an edit to one feature.
                keep_gold = match.gold[viewer]
                variants = []
                for forced in range(1, args.gold + 1):
                    match.gold[viewer] = forced
                    variants.append(encoder.encode(match, viewer))
                match.gold[viewer] = keep_gold
                stacked = np.stack(variants)
                for name, agent in probes.items():
                    gold_curve[name] += call_probabilities(agent, stacked, mask)
                gold_n += 1

                target_round = decision.game.bs_target()
                target = None if target_round is None else match.seats[target_round]
                if target is not None and target != viewer:
                    record = match.records[target]
                    keep = (record.lies, record.honest)
                    variants = []
                    for lies, honest in ((0, args.reveals), (args.reveals, 0)):
                        record.lies, record.honest = lies, honest
                        variants.append(encoder.encode(match, viewer))
                    record.lies, record.honest = keep
                    stacked = np.stack(variants)
                    for name, agent in probes.items():
                        record_pair[name] += call_probabilities(agent, stacked, mask)
                    record_n += 1

            decision = env.step(int(field[(decision.seat + shift) % args.players].act(decision)))

        info = decision.info
        rounds_played += int(info["rounds"])
        outs += len(info["eliminated"])
        with_out += int(len(info["eliminated"]) > 0)

    print(
        f"\n{args.games} matches at {args.gold} gold / {args.rounds} rounds — "
        f"{rounds_played} rounds, {decisions} decisions"
    )
    print(f"field: {' | '.join(label(s) for s in args.field)}\n")

    print("1. CRITICALITY — is gold live?")
    print(f"   matches with any elimination                 {100.0 * with_out / args.games:6.2f}%")
    print(f"   eliminations per match                       {outs / args.games:6.3f}")
    print(f"   decisions where the ACTOR is on 1 gold       {100.0 * critical_self / decisions:6.2f}%")
    print(f"   decisions where ANY live seat is on 1 gold   {100.0 * critical_table / decisions:6.2f}%")
    share = " ".join(f"{g}:{100.0 * own_gold[g] / decisions:.1f}%" for g in range(1, args.gold + 1))
    print(f"   actor's own gold   {share}  more:{100.0 * own_gold[args.gold + 1] / decisions:.1f}%")

    print(f"\n2. OWN-GOLD SENSITIVITY — P(Call BS), position held fixed ({gold_n} positions)")
    print("   negative g1-g2 is correct: a lost challenge on your last coin ends the match")
    columns = " ".join(f"g={g}".rjust(7) for g in range(1, args.gold + 1))
    print(f"   {'probe':<24} {columns}    g1-g2")
    for name in probes:
        curve = gold_curve[name] / max(1, gold_n)
        step = curve[0] - curve[1] if len(curve) > 1 else float("nan")
        print(f"   {name:<24} " + " ".join(f"{v:7.4f}" for v in curve) + f"  {step:+7.4f}")

    print(f"\n3. RECORD SENSITIVITY — target forced honest vs forced liar ({record_n} positions)")
    print(f"   {'probe':<24} {'honest':>8} {'liar':>8} {'liar-honest':>13} {'ratio':>8}")
    for name in probes:
        honest, liar = record_pair[name] / max(1, record_n)
        ratio = liar / honest if honest > 1e-9 else float("nan")
        print(f"   {name:<24} {honest:8.4f} {liar:8.4f} {liar - honest:+13.4f} {ratio:8.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

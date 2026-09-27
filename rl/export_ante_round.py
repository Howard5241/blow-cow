"""Export a one-round Ante checkpoint for the browser bot.

`src/bots/ante/` runs this network in TypeScript, because a bot has to be a *client* — see
`src/bots/useBotSeats.ts` for why. That means the weights have to leave PyTorch, and this is the one
place that happens.

**What is shipped and what is rebuilt.** Only learned parameters go into the blob. `pair_left`,
`pair_right` and `static` are registered buffers but they are pure functions of the config —
`build_choices` and `build_static_table` — so the TypeScript side rebuilds them and the export
refuses to carry them. That is not a size saving worth 8KB; it is that a buffer shipped as data can
silently disagree with the code that consumes it, while a buffer rebuilt from the same arithmetic on
both sides cannot.

**Layout.** One little-endian float32 blob plus a JSON manifest naming each tensor's offset and
shape, in a fixed order. The manifest carries the config the checkpoint was stamped with, so the
loader can refuse a network built for a different table size rather than reading garbage at the
right offsets.

Usage::

    python rl/export_ante_round.py --checkpoint rl/runs/ante-s2-long/final.pt \\
        --out model_weights/ante-round
"""

from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path

import torch

from ante.config import AnteConfig
from ante.nets import AnteNet

#: Every learned tensor, in the order the blob carries them. Buffers are deliberately absent.
TENSORS = (
    "off_deck_slot",
    "type_encoder.0.weight",
    "type_encoder.0.bias",
    "type_encoder.2.weight",
    "type_encoder.2.bias",
    "trunk.0.weight",
    "trunk.0.bias",
    "trunk.2.weight",
    "trunk.2.bias",
    "context.weight",
    "context.bias",
    "simple_head.weight",
    "simple_head.bias",
    "single_head.0.weight",
    "single_head.0.bias",
    "single_head.2.weight",
    "single_head.2.bias",
    "pair_head.0.weight",
    "pair_head.0.bias",
    "pair_head.2.weight",
    "pair_head.2.bias",
    "slot_head.0.weight",
    "slot_head.0.bias",
    "slot_head.2.weight",
    "slot_head.2.bias",
    "static_gate.weight",
    "static_gate.bias",
    "value_head.0.weight",
    "value_head.0.bias",
    "value_head.2.weight",
    "value_head.2.bias",
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--out", required=True, help="path prefix; writes <out>.bin and <out>.json")
    args = parser.parse_args()

    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    saved = checkpoint.get("config") or {"num_players": 5, "num_ranks": 7}
    config = AnteConfig(num_players=saved["num_players"], num_ranks=saved["num_ranks"])

    # Built rather than trusted: constructing the network proves the checkpoint actually fits the
    # architecture this exporter describes, so a shape drift fails here rather than in a browser.
    #
    # `extra_width` is the match block `ante/match_observation.py` appends after the round's 200
    # features. A one-round checkpoint saves 0 and a match checkpoint saves 98, and the only thing
    # that changes downstream is the width of `trunk.0` — the match block rides into the trunk beside
    # the seat and event rows rather than getting a path of its own. `anteNet.ts` reads that width out
    # of the manifest and copies the observation's tail wholesale, so both kinds export and run
    # through the identical code; what the browser must not do is feed a 200-wide observation to a
    # 298-wide trunk, which is why `observationSize` is in the manifest and checked on load.
    extra_width = int(checkpoint.get("extra_width", 0))
    net = AnteNet(
        config,
        hidden=checkpoint.get("hidden", 256),
        type_dim=checkpoint.get("type_dim", 32),
        extra_width=extra_width,
        value_scale=checkpoint.get("value_scale", 1.0),
        lie_head=bool(checkpoint.get("lie_head", False)),
        challenge_head=bool(checkpoint.get("challenge_head", False)),
    )
    if bool(checkpoint.get("lie_to_policy", False)):
        # `--lie-to-policy` is where the honesty head stops being auxiliary: its output is an input to
        # `simple_head` and `context`, both of which are then one column wider. Shipping such an arm
        # means porting the head and that extra column to `anteNet.ts` and widening its two head
        # matmuls, not merely dropping tensors here. Measured a negative result in `rl/ANTE.md`, so
        # this refusal has never had to be lifted.
        raise SystemExit(
            "that checkpoint sets lie_to_policy, so the honesty head is load-bearing at play time "
            "and `anteNet.ts` needs it before this can ship"
        )
    net.load_state_dict(checkpoint["model"])
    net.eval()

    state = net.state_dict()
    # `lie_head.*` is dropped on purpose rather than tolerated. With `lie_to_policy` off — refused
    # above when on — the head is a training-time loss whose output feeds nothing: `_compute` computes
    # the honesty logit and returns it for the trainer's auxiliary term alone. Verified at the bit
    # level on `lf-aux-s1`: deleting every `lie_head.*` tensor moves the policy logits and the value
    # by 0.0 over 534 positions. So this is not a lossy export, and `anteNet.ts` needs nothing.
    #
    # `challenge_head.*` is dropped for exactly the same reason and has no `lie_to_policy` equivalent
    # to refuse: it feeds nothing by construction, so there is no configuration of it that would be
    # load-bearing at play time. `challenge head` in `ante_match_check.py` is what holds that.
    skipped = ("pair_left", "pair_right", "static")
    auxiliary = ("lie_head.", "challenge_head.")
    unknown = [
        key
        for key in state
        if key not in TENSORS
        and key not in skipped
        and not any(key.startswith(prefix) for prefix in auxiliary)
    ]
    if unknown:
        raise SystemExit(f"checkpoint carries tensors this exporter does not know: {unknown}")
    for prefix, label in zip(auxiliary, ("honesty", "challenge")):
        if any(key.startswith(prefix) for key in state):
            print(f"dropping the auxiliary {label} head (training-time only; not read at play time)")

    blob = bytearray()
    manifest_tensors = []
    for name in TENSORS:
        tensor = state[name].detach().cpu().contiguous().to(torch.float32)
        manifest_tensors.append(
            {"name": name, "offset": len(blob) // 4, "shape": list(tensor.shape)}
        )
        blob.extend(struct.pack(f"<{tensor.numel()}f", *tensor.reshape(-1).tolist()))

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.with_suffix(".bin").write_bytes(bytes(blob))

    manifest = {
        "format": "ante-round-policy/1",
        "source": Path(args.checkpoint).as_posix(),
        "steps": int(checkpoint.get("steps", 0)),
        "numPlayers": config.num_players,
        "numRanks": config.num_ranks,
        "hidden": int(checkpoint.get("hidden", 256)),
        "typeDim": int(checkpoint.get("type_dim", 32)),
        "headDim": 64,
        # 0 for a one-round policy, 98 for a match policy. The browser needs it to decide whether to
        # build the match block at all, and `observationSize` already carries the sum.
        "extraWidth": extra_width,
        # `AnteNet.forward` reads the value as `value_scale * tanh(...)`, and the scale is a plain
        # attribute rather than a learned tensor, so it does not ride in the blob. A one-round policy
        # is trained at exactly 1.0 and never needed it carried; a match policy is trained at the
        # number of rounds (20, or 23 with a placement weight), so omitting it would hand the browser
        # a value 20x too small. The policy head does not depend on it — but `check:ante:bot` compares
        # values, and a silently-wrong critic is not something to ship on the grounds that nothing
        # currently reads it.
        "valueScale": float(checkpoint.get("value_scale", 1.0)),
        "roundLimit": (checkpoint.get("match") or {}).get("round_limit"),
        "startingGold": (checkpoint.get("match") or {}).get("starting_gold"),
        "observationSize": net.observation_size,
        "actionSize": net.action_size,
        "floats": len(blob) // 4,
        "tensors": manifest_tensors,
    }
    out.with_suffix(".json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"wrote {out.with_suffix('.bin')} ({len(blob)} bytes, {len(blob)//4} floats)")
    print(f"wrote {out.with_suffix('.json')}")
    print(f"  {config.num_players}p/{config.num_ranks}r, obs {net.observation_size}, actions {net.action_size}")


if __name__ == "__main__":
    main()

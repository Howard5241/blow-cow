"""Deterministic randomness, reimplemented byte for byte in ``rl/oracle/blowcow-oracle.ts``.

The engine takes its entire supply of randomness through one injected ``shuffle`` callback, so an
identical stream of shuffles is an identical match. That is what makes the lockstep conformance run
possible: both sides deal the same cards from the same seed without either one telling the other
what it drew.

xorshift32 is used rather than anything better because it has to be reproducible in JavaScript with
no effort: every operation here is a 32-bit shift or xor, which JS does natively on int32 and Python
does with an explicit mask.
"""

from __future__ import annotations

from typing import Callable, List, Sequence, TypeVar

Value = TypeVar("Value")

Shuffle = Callable[[Sequence[Value]], List[Value]]

_UINT32 = 0xFFFFFFFF


def make_random_source(seed: int) -> Callable[[], float]:
    """A 32-bit xorshift generator yielding floats in ``[0, 1)``."""
    state = seed & _UINT32
    if state == 0:
        state = 0x9E3779B9

    def next_random() -> float:
        nonlocal state
        state ^= (state << 13) & _UINT32
        state &= _UINT32
        state ^= state >> 17
        state ^= (state << 5) & _UINT32
        state &= _UINT32
        return state / 4294967296.0

    return next_random


def make_shuffle(next_random: Callable[[], float]) -> Shuffle:
    """Descending Fisher-Yates. The direction and the index formula both matter for lockstep."""

    def shuffle(values: Sequence[Value]) -> List[Value]:
        result = list(values)
        for index in range(len(result) - 1, 0, -1):
            swap_index = int(next_random() * (index + 1))
            result[index], result[swap_index] = result[swap_index], result[index]
        return result

    return shuffle


def make_seeded_shuffle(seed: int) -> Shuffle:
    return make_shuffle(make_random_source(seed))

"""A subprocess client for ``rl/oracle/blowcow-oracle.ts``.

The oracle runs the *real* engine, so every answer it gives is the game's own. Nothing in this file
decides a rule; it only moves JSON lines back and forth.
"""

from __future__ import annotations

import collections
import json
import subprocess
import threading
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional, Sequence

ORACLE_SCRIPT = Path(__file__).resolve().parents[1] / "oracle" / "blowcow-oracle.ts"


class OracleError(RuntimeError):
    pass


def to_card_id(card: int) -> str:
    """The real engine's card id for a deck order. See ``createDeck``."""
    return f"card-{card}"


def to_oracle_args(args: Dict[str, Any]) -> Dict[str, Any]:
    """Translate the simulator's integer card ids into the engine's string ones."""
    converted = dict(args)
    if "cardIDs" in converted:
        converted["cardIDs"] = [to_card_id(card) for card in converted["cardIDs"]]
    if "cardID" in converted:
        converted["cardID"] = to_card_id(converted["cardID"])
    return converted


class OracleClient:
    """One long-lived Node process holding one match at a time."""

    def __init__(self, node_executable: str = "node", script: Optional[Path] = None) -> None:
        self.script = Path(script) if script else ORACLE_SCRIPT
        if not self.script.exists():
            raise OracleError(f"Oracle script not found: {self.script}")

        self.process = subprocess.Popen(
            [node_executable, "--experimental-strip-types", str(self.script)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )

        # Drained on a thread rather than left in the pipe: Node writes at least an experimental
        # warning there, and a full stderr buffer would deadlock the process mid-match.
        self._stderr_lines: Deque[str] = collections.deque(maxlen=200)
        self._stderr_thread = threading.Thread(target=self._drain_stderr, daemon=True)
        self._stderr_thread.start()

    def _drain_stderr(self) -> None:
        if self.process.stderr is None:
            return
        for line in self.process.stderr:
            self._stderr_lines.append(line.rstrip("\n"))

    def _rpc(self, command: Dict[str, Any]) -> Dict[str, Any]:
        if self.process.stdin is None or self.process.stdout is None:
            raise OracleError("Oracle process is not running.")

        self.process.stdin.write(json.dumps(command) + "\n")
        self.process.stdin.flush()

        line = self.process.stdout.readline()
        if not line:
            raise OracleError(f"Oracle exited unexpectedly.\n{self.stderr_tail()}")

        response = json.loads(line)
        if not response.get("ok"):
            raise OracleError(str(response.get("error", "Oracle refused the command.")))
        return response

    def new_match(
        self, num_players: int, selected_ranks: Sequence[str], seed: int
    ) -> Dict[str, Any]:
        response = self._rpc(
            {
                "cmd": "new",
                "numPlayers": num_players,
                "selectedRanks": list(selected_ranks),
                "seed": seed,
            }
        )
        return response["proj"]

    def apply(self, player_id: str, move: str, args: Dict[str, Any]) -> tuple[bool, Dict[str, Any]]:
        response = self._rpc(
            {
                "cmd": "apply",
                "playerID": player_id,
                "move": move,
                "args": to_oracle_args(args),
            }
        )
        return bool(response["invalid"]), response["proj"]

    def probe(self, player_id: str, move: str, args: Dict[str, Any]) -> bool:
        """Whether the engine would accept this move, run against a throwaway clone."""
        response = self._rpc(
            {
                "cmd": "probe",
                "playerID": player_id,
                "move": move,
                "args": to_oracle_args(args),
            }
        )
        return bool(response["legal"])

    def probe_batch(self, probes: Sequence[tuple[str, str, Dict[str, Any]]]) -> List[bool]:
        """Probe many moves in one round trip. Same answers, one line instead of hundreds."""
        if not probes:
            return []
        response = self._rpc(
            {
                "cmd": "probeBatch",
                "probes": [
                    {"playerID": player_id, "move": move, "args": to_oracle_args(args)}
                    for player_id, move, args in probes
                ],
            }
        )
        return [bool(entry) for entry in response["legal"]]

    def projection(self) -> Dict[str, Any]:
        return self._rpc({"cmd": "proj"})["proj"]

    def close(self) -> None:
        if self.process.poll() is not None:
            return
        try:
            self._rpc({"cmd": "quit"})
        except (OracleError, ValueError, BrokenPipeError):
            pass
        finally:
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()

    def stderr_tail(self, limit: int = 20) -> str:
        """Whatever Node complained about, for a failure report."""
        return "\n".join(list(self._stderr_lines)[-limit:])

    def __enter__(self) -> "OracleClient":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

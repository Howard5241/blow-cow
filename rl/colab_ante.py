"""Drive the Ante replication runs on a Colab VM: launch them, watch them, mirror them back.

Colab reclaims a session out from under you — the free tier after ten or fifteen minutes, a Pro A100
at roughly an hour — and **the VM's disk dies with the VM**. So nothing here assumes the runs will
still be there next time. Four verbs to drive it with, plus `push`, each safe to run repeatedly:

    python rl/colab_ante.py status           # is each arm alive, and how far along
    python rl/colab_ante.py mirror --weights # pull log.jsonl and latest.pt back to rl/runs/
    python rl/colab_ante.py launch           # start anything not running, resuming where it left off
    python rl/colab_ante.py bootstrap        # after a reclaim: new VM, code up, checkpoints up, go

**Mirror on a timer, because you cannot mirror a VM that is already gone.** That is the one part of
this with a deadline: everything else is recoverable, and an un-mirrored hour is not. A pull every
*N* minutes bounds the loss at *N* minutes — **the mirror interval is the bound, not the snapshot
interval**, since a snapshot the mirror never collected dies with the disk.

Pick *N* off the observed rate, not off a habit. A 15-minute interval was fine for the 2M arms at
~25k steps/min; the 4M arms drew a VM doing **~62k steps/min**, where the same 15 minutes is over
900k steps and the first reclaim cost about a quarter of a run. At that pace a 250k snapshot lands
every four minutes, so five minutes is the interval that collects roughly all of them.

`launch` is what makes a reclaim cheap rather than fatal — it resumes from `latest.pt` when there is
one and only falls back to `--init` for an arm that has never started. But it looks for that file
**on the VM**, so on a fresh VM it would restart every arm from zero. `bootstrap` is the ordering
that avoids it: upload, `push` the mirrored checkpoints, then `launch`.

The snapshot interval is 250k steps because that is the recipe the published arms used — the opponent
pool holds eight snapshots, so the interval sets how far back the population reaches. Shortening it
to lose less on a reclaim would quietly change the experiment, which for a replication is the one
thing that must not happen. At ~25k decisions a minute that caps the loss at about ten minutes.

Windows: the CLI does not import at all without the shim, because `colab_cli/console.py` imports
`termios` at module load. Point ``COLAB_CLI`` elsewhere if yours lives somewhere else.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import List, Optional, Sequence, Tuple

REPO = Path(__file__).resolve().parent.parent
RUNS = REPO / "rl" / "runs"

DEFAULT_SESSION = "blowcow-ante"
DEFAULT_CLI = Path.home() / ".config" / "colab-cli" / "colab_win.py"

#: Remote layout. The tarball unpacks to ``/content/work/rl``, so remote paths are the repo's own.
WORK = "/content/work"

#: The checkpoint every arm warm-starts from, repo-relative. **This is the experiment.**
#:
#: `m2-5p` is generation two and ships today. Generation three widened the *pool* instead — five
#: seeded strategies rather than three, including both exploiters — and lost to `m2-5p` at all three
#: seeds in both head-to-head directions and by an order of magnitude on the mixed table; see
#: "Generation three" in `rl/ANTE.md`. So this cohort keeps generation two's own pool and recurses on
#: the *policy* instead, which is the axis that has actually delivered every time it has been tried
#: (`m2-2p` beats `m-2p` in 95% of matches).
#:
#: Warm-starting from a match checkpoint rather than a one-round one carries the value head over,
#: since it already predicts this exact quantity at this exact `value_scale` — the trainer decides
#: that and says which it did. At step zero the network therefore *is* `m2-5p`, critic included, so
#: anything gained is the further training rather than a re-fitted critic.
INIT = "rl/runs/m2-5p/final.pt"

#: The permanently seated opponents — `--pool-init`, never evicted. Generation two's, unchanged.
POOL_INIT = (
    "round:rl/runs/ante-s2-long/final.pt",
    "ckpt:rl/runs/m-5p/final.pt",
    "ckpt:rl/runs/xg1-5p/final.pt",
)

#: Everything staged on a fresh VM before `launch`, repo-relative. `INIT` and every `POOL_INIT`
#: member has to be here: an arm cannot start without its warm start, and a pool member missing on
#: the VM is a *silent* change of experiment rather than a crash.
#: `INIT` is normally a `POOL_INIT` member too, so this is deduplicated while keeping the order.
UPLOADS: Tuple[str, ...] = tuple(
    dict.fromkeys((INIT,) + tuple(spec.split(":", 1)[1] for spec in POOL_INIT))
)

#: Done, and kept only so the record of what this script has run is not lost. They are **out** of
#: `ARMS` on purpose: every verb walks that tuple, so leaving them in would upload finished
#: checkpoints on every bootstrap to accomplish nothing. Their artifacts are in `rl/runs/`.
FINISHED: Tuple[str, ...] = (
    "m-warm-s2", "m-warm-lie-s2", "m-warm-norecord-s2", "m-warm-lie-long",
    "m-warm-lie-long-s2", "m-warm-lie-long-s3", "m-warm-long-s2",
    "m3-5p-s1", "m3-5p-s2", "m3-5p-s3",   # the wider pool; it lost, see `rl/ANTE.md`
)

#: name, seed, --steps, extra flags, extra environment.
#:
#: **Generation three by recursion, the five-seat cohort.** Three seeds because the seed spread at
#: fixed recipe is 2.1 gold — larger than any component effect this package has ever measured — so a
#: single arm is not readable, and `rl/ANTE.md` records two published claims that had to be withdrawn
#: for exactly that reason. Every flag below is `m2-5p`'s byte for byte, `--pool-init` and
#: `--pool-size` included; `INIT` is the only difference. So the comparison against the shipped arm
#: is clean and what it measures is the further training.
ARMS: Tuple[Tuple[str, str, int, Tuple[str, ...], dict], ...] = (
    ("m3r-5p-s1", "1", 2_000_000, (), {}),
    ("m3r-5p-s2", "2", 2_000_000, (), {}),
    ("m3r-5p-s3", "3", 2_000_000, (), {}),
)

#: Byte for byte `m2-5p`'s flags. See the module docstring on the snapshot interval.
COMMON = [
    "--players", "5", "--rounds", "20", "--gold", "5",
    "--placement-weight", "3", "--lie-coef", "0.0",
    "--self-play-prob", "0.3", "--baseline-prob", "0.25",
    "--pool-size", "11", "--pool-init", *POOL_INIT,
    "--snapshot-every", "250000", "--eval-every", "999999999",
    "--device", "cpu",
]

LAUNCHER = '''
import os, pathlib, subprocess

WORK = pathlib.Path({work!r})
RUNS = WORK / "rl" / "runs"
INIT = {init!r}
COMMON = {common!r}
ARMS = {arms!r}
NEEDED = {uploads!r}

missing = [p for p in NEEDED if not (WORK / p).exists()]
if missing:
    # The trainer does refuse a missing pool member — but it refuses inside a detached process
    # whose only trace is a `.out` file, so `status` reports STOPPED at zero steps and that is
    # indistinguishable from a reclaim. Fail here instead, where the message is the answer.
    raise SystemExit("missing on the VM, run `bootstrap`: " + ", ".join(missing))

def alive(pid_file):
    if not pid_file.exists():
        return False
    try:
        return pathlib.Path("/proc/%d" % int(pid_file.read_text().strip())).exists()
    except Exception:
        return False

RUNS.mkdir(parents=True, exist_ok=True)
for name, seed, steps, extra, extra_env in ARMS:
    run = RUNS / name
    pid_file = RUNS / (name + ".pid")
    if (run / "final.pt").exists():
        print(name + ": finished"); continue
    if alive(pid_file):
        print(name + ": already running (pid " + pid_file.read_text().strip() + ")"); continue
    latest = run / "latest.pt"
    cmd = ["python", "rl/ante_match_train.py", "--run", "rl/runs/" + name,
           "--steps", str(steps), "--seed", seed] + COMMON + list(extra)
    cmd += ["--resume", "rl/runs/" + name + "/latest.pt"] if latest.exists() else ["--init", INIT]
    env = dict(os.environ, OMP_NUM_THREADS="3", MKL_NUM_THREADS="3", PYTHONUNBUFFERED="1")
    env.update(extra_env)
    handle = open(RUNS / (name + ".out"), "a")
    process = subprocess.Popen(cmd, cwd=str(WORK), stdout=handle,
                               stderr=subprocess.STDOUT, env=env, start_new_session=True)
    pid_file.write_text(str(process.pid))
    note = (" " + " ".join(sorted(extra_env))) if extra_env else ""
    print(name + ": " + ("resumed" if latest.exists() else "started") +
          " pid " + str(process.pid) + note)
'''

STATUS = '''
import json, pathlib

RUNS = pathlib.Path({work!r}) / "rl" / "runs"
ARMS = {arms!r}
rows = []
for name, seed, steps, extra, extra_env in ARMS:
    run = RUNS / name
    pid_file = RUNS / (name + ".pid")
    alive = False
    if pid_file.exists():
        try:
            alive = pathlib.Path("/proc/%d" % int(pid_file.read_text().strip())).exists()
        except Exception:
            alive = False
    last = None
    log = run / "log.jsonl"
    if log.exists():
        for line in log.read_text(encoding="utf-8").splitlines():
            if line.strip():
                last = line
    row = {{"arm": name, "alive": alive, "target": steps, "done": (run / "final.pt").exists()}}
    if last:
        record = json.loads(last)
        for key in ("steps", "minutes", "gold_edge", "entropy", "call_split", "lie_auc"):
            if key in record:
                row[key] = record[key]
    else:
        # A run that has just resumed is loading a checkpoint — with a full pool that is a dozen
        # megabytes — and has written no log line yet. Reporting 0 there reads as "restarted from
        # zero", which is the one thing this whole arrangement exists to avoid; the console output
        # already knows better, so ask it rather than showing a number that invites a wrong action.
        out = RUNS / (name + ".out")
        if out.exists():
            for line in out.read_text(errors="replace").splitlines():
                if "resumed" in line and " at " in line and " steps" in line:
                    try:
                        row["steps"] = int(line.split(" at ")[1].split(" steps")[0])
                        row["starting"] = True
                    except (ValueError, IndexError):
                        pass
    rows.append(row)
print("BEGIN_STATUS")
print(json.dumps(rows))
'''


_INTERPRETER: Optional[str] = None

#: Stripped before spawning the CLI. The project venv is built on the Microsoft Store's Python 3.11,
#: which exports ``PYTHONUSERBASE`` pointing into its own `LocalCache\\local-packages`. That variable
#: is inherited by *any* child python, so the system 3.14 interpreter resolves its user site to the
#: Store's directory instead of `AppData\\Roaming\\Python\\Python314\\site-packages` — which is where
#: `pip install --user` actually put `colab_cli`. The symptom is a `ModuleNotFoundError` from an
#: interpreter that imports the module perfectly well when you run it by hand.
_LEAKY_VARS = ("PYTHONUSERBASE", "PYTHONHOME", "PYTHONPATH", "VIRTUAL_ENV", "__PYVENV_LAUNCHER__")


def child_env() -> dict:
    return {key: value for key, value in os.environ.items() if key not in _LEAKY_VARS}


def colab_python() -> str:
    """The interpreter that can import ``colab_cli`` — found by asking, not by assuming.

    Deliberately **not** `sys.executable`: the CLI needs Python >= 3.12 and lives on the system
    interpreter, while this repo's `rl/` work runs on the 3.11 project venv, so running this script
    with the venv fails with `No module named 'colab_cli'`. Nor is a bare ``python`` enough — on
    Windows that can resolve to the Store stub or to whatever the venv put in front of it, both of
    which fail the same confusing way. So every python on PATH is probed and the first that can
    import the module wins. ``COLAB_PYTHON`` skips the search.
    """
    global _INTERPRETER
    if _INTERPRETER is not None:
        return _INTERPRETER

    override = os.environ.get("COLAB_PYTHON")
    candidates: List[str] = [override] if override else []
    seen = set(candidates)
    for entry in os.environ.get("PATH", "").split(os.pathsep):
        for name in ("python.exe", "python3.exe", "python", "python3"):
            path = Path(entry) / name
            if path.is_file() and str(path) not in seen:
                seen.add(str(path))
                candidates.append(str(path))
    candidates.append(sys.executable)

    for candidate in candidates:
        try:
            probe = subprocess.run(
                [candidate, "-c", "import colab_cli"],
                capture_output=True,
                timeout=60,
                env=child_env(),
            )
        except (OSError, subprocess.SubprocessError):
            continue
        if probe.returncode == 0:
            _INTERPRETER = candidate
            return candidate

    raise SystemExit(
        "No interpreter on PATH can import colab_cli. Install it with `pip install --user "
        "google-colab-cli jupyter-kernel-client==0.15.0` on a Python >= 3.12, or set COLAB_PYTHON."
    )


#: Subcommands that are about the account rather than one session, and reject `--session`.
_SESSIONLESS = frozenset({"sessions", "version", "update", "readme", "skill", "pay"})


def cli_command(session: str, args: Sequence[str]) -> List[str]:
    cli = Path(os.environ.get("COLAB_CLI", str(DEFAULT_CLI)))
    command = [colab_python(), str(cli), *args]
    if args and args[0] not in _SESSIONLESS:
        command += ["--session", session]
    return command


def run_cli(session: str, args: Sequence[str], timeout: int = 900) -> str:
    # Called straight from Python rather than through Git Bash on purpose: MSYS rewrites a remote
    # `/content/...` into `C:/Program Files/Git/content/...`, and not going through a shell is the
    # one way to sidestep that rather than paper over it with MSYS_NO_PATHCONV.
    result = subprocess.run(
        cli_command(session, args),
        capture_output=True,
        text=True,
        timeout=timeout,
        env=child_env(),
    )
    if result.returncode != 0:
        raise SystemExit(
            f"colab {' '.join(args)} failed ({result.returncode}):\n{result.stdout}\n{result.stderr}"
        )
    return result.stdout


def exec_source(session: str, source: str, timeout: int = 900) -> str:
    """Run a snippet on the VM. It goes via a temp file because `exec` takes ``-f``, not stdin."""
    handle = tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8")
    try:
        handle.write(source)
        handle.close()
        return run_cli(session, ["exec", "-f", handle.name], timeout=timeout)
    finally:
        os.unlink(handle.name)


# --------------------------------------------------------------------------- verbs


def do_launch(session: str) -> int:
    source = LAUNCHER.format(work=WORK, common=COMMON, arms=ARMS, init=INIT, uploads=UPLOADS)
    print(exec_source(session, source).strip())
    return 0


def do_status(session: str) -> int:
    output = exec_source(session, STATUS.format(work=WORK, arms=ARMS), timeout=300)
    if "BEGIN_STATUS" not in output:
        print(output.strip())
        return 1
    rows = json.loads(output.split("BEGIN_STATUS", 1)[1].strip().splitlines()[0])
    print(f"{'arm':<20} {'state':<9} {'steps':>10} {'target':>9} {'min':>6} "
          f"{'gold_edge':>10} {'entropy':>8} {'split':>7} {'lie_auc':>8}")
    for row in rows:
        state = "done" if row["done"] else ("running" if row["alive"] else "STOPPED")
        if state == "running" and row.get("starting"):
            state = "starting"
        print(
            f"{row['arm']:<20} {state:<9} {row.get('steps', 0):>10,} {row['target']:>9,} "
            f"{row.get('minutes', 0):>6.0f} {row.get('gold_edge', float('nan')):>10.3f} "
            f"{row.get('entropy', float('nan')):>8.3f} {row.get('call_split', float('nan')):>7.2f} "
            f"{row.get('lie_auc', float('nan')):>8.3f}"
        )
    return 0


def splice_log(local_path: Path, incoming: Path) -> Tuple[int, int]:
    """Join a mirrored log onto the local one at the step the mirrored one starts.

    A plain copy loses history after a reclaim. `push` sends `latest.pt` and nothing else, so a fresh
    VM starts an empty `log.jsonl` and the run appends to it from the resume point — meaning the
    downloaded log covers only what happened *since* the bootstrap, and overwriting with it would
    throw away every line before the reclaim.

    So local lines are kept up to the first step the incoming log covers, and the incoming lines
    follow. That drops the rewound segment — the few tens of thousands of steps that ran after the
    last mirrored snapshot and died with the VM — which is right: those updates are not in the
    checkpoint that was resumed, so they are not part of this run's history any more. The result is
    monotonic in `steps` across any number of reclaims.

    In the ordinary case the incoming log starts at the run's first line, nothing local is kept, and
    this is a copy. Returns (kept, appended) for reporting.
    """
    incoming_rows = [line for line in incoming.read_text(encoding="utf-8").splitlines() if line.strip()]
    if not incoming_rows:
        return (0, 0)
    try:
        start = int(json.loads(incoming_rows[0])["steps"])
    except (ValueError, KeyError, json.JSONDecodeError):
        local_path.write_text("\n".join(incoming_rows) + "\n", encoding="utf-8")
        return (0, len(incoming_rows))

    kept: List[str] = []
    if local_path.exists():
        for line in local_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                if int(json.loads(line)["steps"]) < start:
                    kept.append(line)
            except (ValueError, KeyError, json.JSONDecodeError):
                continue
    local_path.write_text("\n".join(kept + incoming_rows) + "\n", encoding="utf-8")
    return (len(kept), len(incoming_rows))


def do_mirror(session: str, weights: bool) -> int:
    """Copy each arm's log, console output and resume point back into `rl/runs/`.

    The log first and the checkpoint second, deliberately: the log is small and is what a run is read
    from, so a mirror interrupted halfway still leaves the record intact.
    """
    for name, *_ in ARMS:
        local = RUNS / name
        local.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory() as directory:
            staged = Path(directory) / "log.jsonl"
            try:
                run_cli(session, ["download", f"{WORK}/rl/runs/{name}/log.jsonl", str(staged)])
            except SystemExit:
                print(f"  {name}/log.jsonl: not there yet")
            else:
                kept, added = splice_log(local / "log.jsonl", staged)
                note = f" (kept {kept} local, +{added})" if kept else f" (+{added})"
                print(f"  {name}/log.jsonl{note}")
        try:
            run_cli(session, ["download", f"{WORK}/rl/runs/{name}.out", str(RUNS / f"{name}.out")])
        except SystemExit:
            pass
        # `args.json` is written by the trainer and was never mirrored, which is why `rl/ANTE.md`
        # has to record that none of the Colab-trained arms reproduces from its own manifest — the
        # seed in particular is recoverable from nothing else. It is a few hundred bytes.
        try:
            run_cli(session, ["download", f"{WORK}/rl/runs/{name}/args.json", str(local / "args.json")])
        except SystemExit:
            pass
        if weights:
            for artifact in ("latest.pt", "final.pt"):
                try:
                    run_cli(
                        session,
                        ["download", f"{WORK}/rl/runs/{name}/{artifact}", str(local / artifact)],
                        timeout=1800,
                    )
                    print(f"  {name}/{artifact}")
                except SystemExit:
                    pass
    return 0


def do_push(session: str) -> int:
    """Put mirrored resume points back on a **fresh** VM, so `launch` continues instead of restarting.

    This is the half that is easy to forget. `launch` decides between `--resume` and `--init` by
    looking for `latest.pt` *on the VM*, and a new VM has none — so without this an arm silently
    starts again from zero and the mirrored progress is wasted.
    """
    pushed = 0
    for name, *_ in ARMS:
        local = RUNS / name
        # A finished arm is pushed as `final.pt`, not `latest.pt`, and that is not a nicety. `launch`
        # skips an arm whose `final.pt` is on the VM and otherwise resumes from `latest.pt` — so
        # pushing the resume point of a *finished* run would set it going again from its last
        # snapshot, and the next mirror would bring that re-run's `final.pt` down on top of the
        # finished one already sitting here. Restarting a completed 2M arm to overwrite its own
        # result is the worst thing this script could do, so the finished flag goes up first.
        artifact = "final.pt" if (local / "final.pt").exists() else "latest.pt"
        source = local / artifact
        if not source.exists():
            continue
        exec_source(
            session,
            f"import pathlib; pathlib.Path({WORK!r} + '/rl/runs/{name}').mkdir(parents=True, exist_ok=True)",
            timeout=300,
        )
        run_cli(
            session,
            ["upload", str(source), f"{WORK}/rl/runs/{name}/{artifact}"],
            timeout=1800,
        )
        print(f"  {name}/{artifact}" + ("  (finished; will be skipped)" if artifact == "final.pt" else ""))
        pushed += 1
    if not pushed:
        print("  nothing mirrored yet; there is no resume point to push")
    return 0


def do_bootstrap(session: str) -> int:
    """Stand a VM up from nothing and continue where the mirror left off. Recovery, in one command.

    Order matters and is the whole trick: the source and the warm-start checkpoint go up, then any
    mirrored ``latest.pt`` (`push`), and only then `launch` — which decides between `--resume` and
    `--init` by looking for `latest.pt` **on the VM**. Launch before pushing and every arm silently
    starts again from zero.
    """
    existing = run_cli(session, ["sessions"], timeout=300)
    if session not in existing:
        print(f"creating session {session!r}...")
        run_cli(session, ["new", "--gpu", "A100"], timeout=900)
    else:
        print(f"session {session!r} is already up")

    # tarfile rather than shelling out to tar: on Windows `tar -f C:/...` reads `C:` as a remote host.
    with tempfile.TemporaryDirectory() as directory:
        bundle = Path(directory) / "rl.tgz"
        skip = {"__pycache__", "runs", "oracle"}
        with __import__("tarfile").open(bundle, "w:gz") as archive:
            for path in sorted((REPO / "rl").rglob("*")):
                if any(part in skip for part in path.relative_to(REPO).parts):
                    continue
                if path.is_file():
                    archive.add(path, arcname=str(path.relative_to(REPO)).replace("\\", "/"))
        run_cli(session, ["upload", str(bundle), "/content/rl.tgz"], timeout=1800)
        print(f"  uploaded rl/ ({bundle.stat().st_size // 1024} KB)")

    # The warm start *and* every permanently seated pool member. They are a megabyte each, so this
    # is cheap; leaving one out is not, because it is the experiment that changes.
    staged = []
    for relative in UPLOADS:
        source = REPO / relative
        if not source.exists():
            raise SystemExit(f"{source} is missing; it is the warm start or a --pool-init member")
        # Flat, and under `/content` rather than a subdirectory: `upload` is not documented to
        # create parent directories, and the copy into place happens on the VM a few lines below.
        remote = "/content/stage__" + relative.replace("/", "__")
        run_cli(session, ["upload", str(source), remote], timeout=1800)
        staged.append((remote, relative))
    print(f"  uploaded {len(staged)} checkpoint(s): the warm start and the pool")

    exec_source(
        session,
        f"""
import pathlib, shutil, subprocess
work = pathlib.Path({WORK!r}); work.mkdir(parents=True, exist_ok=True)
subprocess.run(["tar","xzf","/content/rl.tgz","-C",str(work)], check=True)
for remote, relative in {staged!r}:
    target = work / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(remote, target)
print("extracted")
""",
        timeout=600,
    )
    print("  extracted on the VM")
    do_push(session)
    return do_launch(session)


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("verb", choices=("status", "mirror", "launch", "push", "bootstrap"))
    parser.add_argument("--session", default=DEFAULT_SESSION)
    parser.add_argument("--weights", action="store_true",
                        help="mirror: also pull latest.pt and final.pt, which are megabytes rather than kilobytes")
    args = parser.parse_args(argv)

    if args.verb == "bootstrap":
        return do_bootstrap(args.session)
    if args.verb == "launch":
        return do_launch(args.session)
    if args.verb == "status":
        return do_status(args.session)
    if args.verb == "push":
        return do_push(args.session)
    return do_mirror(args.session, args.weights)


if __name__ == "__main__":
    raise SystemExit(main())

"""A stage challenge's troupe, as the workshop plays it, and the ducks "+ duck" offers.

Besides "self" (the checkpoint on the training's page, the star) and Hub references pinned to a
commit, a workshop's timeline may name a checkpoint of this machine that is not published yet:
`local:<folder>/<run>@<n>`, checkpoint n of logs/rsl_rl/<folder>/<run>/, from any challenge in the
checkout. The Arena never reads that form: Publish & compete replaces it with the commit the
checkpoint was published at.

A local duck plays its checkpoint exported exactly as its own evaluation exports it (the same kept
ONNX), on the rig of its challenge's event. A reference plays what the Arena fetches for it, on the
rig its manifest names.
"""

import hashlib
import json
from pathlib import Path

from ..hub_fetch import fetch_references
from ..manifest import load_event
from ..policy import load_policy
from ..runner import Performer
from ..timeline import LOCAL, SELF, TimelineError, load_troupe, split_local
from .challenges import Challenge, is_stage, open_challenges, timeline_file
from .publishing import export, published
from .runs import LOGS, Run, find_runs


def local_policy(run, n: int) -> str:
    """How a timeline names checkpoint n of `run`: its folder under logs/rsl_rl/, its directory, n."""
    return f"{LOCAL}{run.path.parent.name}/{run.id}@{n}"


def resolve_local(root, policy: str) -> tuple[Run, int, Challenge]:
    """The run, the checkpoint and the challenge a `local:` duck names; a TimelineError when this
    checkout holds no such checkpoint (a run deleted, a name mistyped). Looked up by name among the
    checkout's own runs, never joined into a path: a folder or a run called ".." finds nothing."""
    folder, run_id, n = split_local(policy)
    for challenge in open_challenges(root):
        for run in find_runs(root, challenge.task):
            if (run.path.parent.name, run.id) == (folder, run_id) and n in run.checkpoints:
                return run, n, challenge
    raise TimelineError(f"{policy!r}: this checkout has no such checkpoint")


def candidates(root) -> list[dict]:
    """What "+ duck" offers, each with the rig it performs on: every checkpoint of every run of every
    challenge in the checkout, then every policy published from those runs (their published.json)."""
    checkpoints, policies = [], []
    for challenge in open_challenges(root):
        rig = load_event(challenge.event).rig
        for run in find_runs(root, challenge.task):
            checkpoints += [{"policy": local_policy(run, n), "label": f"{challenge.folder} · {run.id} · {n}", "rig": rig}
                            for n in run.checkpoints]
            policies += [{"policy": f"{e['repo']}@{e['revision']}", "label": f"{e['repo']}@{e['revision'][:7]}", "rig": rig}
                         for e in published(run)]
    return checkpoints + policies


def performers_for(root, troupe, star_onnx, star_rig, event) -> tuple[Performer, ...]:
    """The runner's cast for `troupe` on `event`: "self" plays the star's ONNX on its rig, a local duck
    its checkpoint exported, a reference what the Arena fetches. One ONNX session per distinct
    policy: two copies of the star share one."""
    played = {SELF: (load_policy(star_onnx), star_rig)}
    for policy in troupe.references():
        if policy.startswith(LOCAL):
            run, n, challenge = resolve_local(root, policy)
            played[policy] = (load_policy(export(root, run, n)), load_event(challenge.event).rig)
    # fetch_references leaves the local forms alone, and names a refusal by the troupe's own numbers.
    for policy, fetched in fetch_references(troupe, event).items():
        played[policy] = (load_policy(fetched.path), fetched.rig or event.rig)
    return tuple(Performer(*played[duck.policy], duck.start, duck.timeline) for duck in troupe.ducks)


def timeline_key(root, challenge) -> str | None:
    """Which performance a challenge's checkpoints play: on a stage, the sha256 of its timeline.json
    and of the size and time of each checkpoint file a local duck names; None on a race, or on a
    stage without one, which plays the event's own command.

    The text names a local checkpoint, not its bytes, and a run pulled again from its Hugging Face
    job rewrites the file under the same name. A stat, not a hash: the pages ask for this every few
    seconds. A timeline without a local duck keys on its text alone, as before troupes."""
    if not is_stage(challenge):
        return None
    path = timeline_file(challenge)
    try:
        digest = hashlib.sha256(path.read_bytes())
    except FileNotFoundError:
        return None
    try:
        troupe = load_troupe(path, load_event(challenge.event), allow_local=True)
    except TimelineError:
        return digest.hexdigest()  # it cannot play: its evaluation stores why, under its text
    for policy in troupe.references():
        if policy.startswith(LOCAL):
            try:
                stat = _checkpoint_file(root, policy).stat()
                digest.update(f"{policy} {stat.st_size} {stat.st_mtime_ns}".encode())
            except FileNotFoundError:
                digest.update(f"{policy} missing".encode())  # a key that changes once it appears
    return digest.hexdigest()


def _checkpoint_file(root, policy: str) -> Path:
    """The file a `local:` duck names, found by name among the runs on disk as `resolve_local` finds its
    run (never joined into a path), but without reading a challenge: the pages' key must answer while
    a challenge.toml is broken by hand. FileNotFoundError when there is none."""
    folder, run_id, n = split_local(policy)
    for path in (root / LOGS).glob(f"*/*/model_{n}.pt"):
        if (path.parent.parent.name, path.parent.name) == (folder, run_id):
            return path
    raise FileNotFoundError(policy)


def local_ducks(root, troupe) -> list[tuple[str, int, Run, int, Challenge]]:
    """Each checkpoint of this machine the troupe names, once, in the order its ducks name them: the
    `local:` policy, the first duck that names it, and its run, checkpoint and challenge."""
    found = []
    for policy in troupe.references():
        if policy.startswith(LOCAL):
            first = next(k for k, duck in enumerate(troupe.ducks) if duck.policy == policy)
            found.append((policy, first, *resolve_local(root, policy)))
    return found


def resolved(text: str, on_hub: dict[str, str]) -> str:
    """A timeline's text as the Arena reads it: each `local:` duck named instead by the
    "owner/repo@revision" its checkpoint was published at."""
    raw = json.loads(text)
    for duck in raw["ducks"]:
        duck["policy"] = on_hub.get(duck["policy"], duck["policy"])
    return json.dumps(raw, indent=2) + "\n"

"""What the commentators may know about a run: public, allowlisted facts.

A Fact is a sentence with a reference. The writer must cite references, and
the checks read the cited texts back to verify every number and every name it
speaks. Nothing here fetches, infers or scores; the worker passes records it
already holds. Editorial fiction lives in lore.py, never in a fact about a
player.
"""

import re
import unicodedata
from dataclasses import dataclass

from ..index import by_user, leaderboard, sort_key, standing
from ..manifest import Manifest
from ..points import Receipt
from ..store import RunRecord


@dataclass(frozen=True)
class Fact:
    ref: str
    text: str
    kind: str  # result | notable | lore | recent
    tags: tuple[str, ...] = ()
    # Participant names this fact establishes; a name spoken without citing
    # such a fact is a name the model made up.
    identities: tuple[str, ...] = ()
    # "fell" when the fact records a fall, "dnf" for a DNF without one. Fall
    # vocabulary in the dialogue must cite a fact whose outcome is "fell".
    outcome: str | None = None
    # Notability. Result facts are always worth citing; detectors score theirs.
    score: float = 1.0


def technical_text(text: str) -> bool:
    """Recognisable machine labels: never broadcast prose."""
    text = unicodedata.normalize("NFKC", text)
    return bool(re.search(
        r"https?://|[/\\]|\b\w+_\w+\b|"
        r"\b[\w.-]+\.(?:mp4|webm|mov|mkv|avi|wav|mp3|ogg|jsonl?|csv|onnx|wasm|npy|npz)\b|"
        r"\b[0-9a-f]{16,}\b|\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b",
        text, re.IGNORECASE,
    ))


def label(value, limit: int = 80) -> bool:
    """Submitter-supplied text a fact may quote: short, printable, no markup,
    nothing machine-shaped — a fact quoting it would have the turn refused."""
    return (isinstance(value, str) and 0 < len(value.strip()) <= limit
            and value.isprintable() and not any(c in value for c in "<>")
            and not technical_text(value))


def nature(manifest: Manifest) -> tuple[str, tuple[str, ...]]:
    """What kind of contest this is, in words and in tags the bible matches on."""
    if manifest.course.kind == "stage":
        return "a performance on a stage decided by the public's votes", ("vote",)
    length = f"{manifest.course.length_m:g} m"
    if manifest.course.slope_deg > 0:
        return f"a {length} climb up an {manifest.course.slope_deg:g} degree slope", ("hill",)
    if manifest.rig == "rollers":
        return f"a {length} race on roller skates", ("rollers",)
    return f"a {length} sprint on foot", ("sprint",)


ACTS = {
    "first_event": "a first run on this event",
    "own_best": "a new personal best",
    "podium": "a podium place held",
    "run": "a run of the day",
}
ACT_TAGS = {"first_event": "first-run", "own_best": "pb", "podium": "podium"}


def _result(record: RunRecord, manifest: Manifest) -> Fact:
    if manifest.course.kind == "stage":
        # A performance is not a race: its length is the only time it has, and
        # it ends early only when the simulation breaks down, which is no fall.
        text = (f"The performance lasts {record.score:.2f} s." if record.seeds_finished
                else "The performance was cut short.")
        return Fact("run#/result", text, "result", ("performance",))
    who = f"@{record.user}"
    total = len(record.per_seed)
    falls = sum(1 for s in record.per_seed if s.status == "fall")
    if record.seeds_finished == 0:
        text = f"{who} did not finish: none of the {total} seeds reached the line"
        text += f", the duck fell on {falls} of them." if falls else "."
        return Fact("run#/result", text, "result", ("dnf", "fall") if falls else ("dnf",),
                    outcome="fell" if falls else "dnf")
    text = f"The mean finish time is {record.score:.2f} s"
    if record.seeds_finished == total:
        return Fact("run#/result", text + f", every one of the {total} seeds finished.", "result",
                    ("clean",))
    text += (f", with {record.seeds_finished} of {total} seeds finished; an unfinished seed "
             f"counts as the {manifest.time_limit_s:g} s limit")
    text += f", and the duck fell on {falls} of them." if falls else "."
    return Fact("run#/result", text, "result", ("fall",) if falls else ("partial",),
                outcome="fell" if falls else None)


def _board(record: RunRecord, manifest: Manifest, event_runs) -> Fact:
    rows = leaderboard(event_runs, entrant=by_user)
    others = [row.record for row in rows if row.record.user != record.user]
    if not others:
        return Fact("run#/board", f"This run opens the {manifest.title} board: nobody else has "
                    "published on it.", "result", ("open-board", "first-run"))
    rank = standing(event_runs, record.run_id).rank
    size = len(others) + 1
    if rank == 1:
        return Fact("run#/board", f"This run takes the lead of the {manifest.title} board, "
                    f"with {size} entrants ranked.", "result", ("lead", "podium"))
    leader = min(others, key=sort_key)
    text = f"On the {manifest.title} board this run ranks {rank} of {size}"
    tags = ["podium"] if rank <= 3 else []
    if record.seeds_finished:
        gap = record.score - leader.score
        text += f", {gap:.2f} s behind the leader, @{leader.user}."
        if gap < 0.5:
            tags.append("close")
        return Fact("run#/board", text, "result", tuple(tags), identities=(leader.user,))
    return Fact("run#/board", text + ".", "result", tuple(tags))


def _points(record: RunRecord, receipts: list[Receipt]) -> Fact | None:
    mine = [r for r in receipts if r.source_id == record.run_id]
    if not mine:
        return None
    total = sum(r.points for r in mine)
    parts = ", ".join(f"{ACTS[r.act]} ({r.points})" for r in mine)
    tags = tuple(dict.fromkeys(ACT_TAGS[r.act] for r in mine if r.act in ACT_TAGS))
    return Fact("run#/points", f"This run earned {total} points: {parts}.", "result", tags)


NOTE_MAX = 280
# What an author may write in a note and not in a name: a unit (m/s, km/h, rad/s: a short word,
# one slash, a shorter one, not a path's a/b/c) and a snake_case word.
NOTE_ALLOWS = re.compile(r"(?<![\w/])[^\W_]{1,5}/[^\W_]{1,3}(?![\w/])|\b[^\W_]+(?:_[^\W_]+)+\b")
# What a note may not hold although a name may: a link without its :// (that slash is refused
# anyway) and a file name, a word with an extension.
NOTE_REFUSES = re.compile(r"\bwww\.|\b[^\W_][\w-]+\.[a-z][a-z0-9]{0,4}\b", re.IGNORECASE)


def _quotable(text: str) -> bool:
    """A note a fact may quote: `label`'s checks, with NOTE_ALLOWS let through (masked at the same
    length) and NOTE_REFUSES refused. A turn that repeats such a unit or name as written is still
    refused by the dialogue's own check: the writer has to say it in words."""
    text = unicodedata.normalize("NFKC", text)
    return (not NOTE_REFUSES.search(text)
            and label(NOTE_ALLOWS.sub(lambda m: "x" * len(m[0]), text), limit=NOTE_MAX))


def _note(record: RunRecord) -> Fact | None:
    """The author's own words about the policy, quoted as theirs: never a result, and only when they
    read as prose (`_quotable`). Its line breaks and runs of spaces are a textarea's layout: quoted
    as single spaces."""
    text = " ".join((record.description or "").split())
    if not _quotable(text):
        return None
    return Fact("run#/note", f'@{record.user} says about the policy: "{text}"', "notable",
                identities=(record.user,))


def result_facts(record: RunRecord, manifest: Manifest, event_runs, receipts) -> tuple[Fact, ...]:
    """The run itself: the event, who ran, what the clock says (on a stage, how
    long the performance lasts), where it stands and what it earned. `event_runs`
    are the counting runs of the event as they stood when this one was published,
    this one included; a voted event's board is not a clock, so it gets no board
    fact."""
    what, tags = nature(manifest)
    who = f"@{record.user}"
    policy = record.policy_name if label(record.policy_name) else None
    note = _note(record)
    doing = "performing" if manifest.course.kind == "stage" else "racing"
    facts = [
        Fact("run#/event", f"The event is the {manifest.title}, {what}.", "result", tags),
        Fact("run#/participant",
             f"The participant is {who}, {doing} a policy named {policy}." if policy
             else f"The participant is {who}.",
             "result", ("participant",), identities=(record.user,)),
        _result(record, manifest),
    ]
    if note:
        facts.append(note)
    if manifest.metric != "votes":
        facts.append(_board(record, manifest, event_runs))
    points = _points(record, receipts)
    if points:
        facts.append(points)
    return tuple(facts)

"""Runs are an append-only log, and the log is a git repo.

One immutable write per run, never a read-modify-write: two simultaneous
submissions cannot contend, so there is nothing to lock. Durability is "it is a
git repo", and the data is public — which for an open benchmark is a feature.

The leaderboard is never stored, only derived (see index.py).
"""

import json
import os
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Protocol

from .evaluate import SeedResult

_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"  # Crockford, ULID-style
_TAIL_BITS = 60  # 12 base32 chars

# The files a ready clip holds beside its clip.json (arena/clips.py writes them,
# routes_read.py serves them by these exact names).
CLIP_MEDIA = ("landscape.mp4", "vertical.mp4", "poster.png")


def clip_version(manifest: dict) -> str:
    """The render a clip's media belong to, fit for a URL: its `rendered_at`
    stripped to digits. The media are served cached for a year as immutable,
    so a clip rendered again — the same race on a new stage — must be a new
    URL, or everyone who watched it once keeps watching the old one."""
    return "".join(ch for ch in manifest.get("rendered_at", "") if ch.isalnum())

_id_lock = threading.Lock()
_id_state = {"stamp": -1, "rand": 0}


def new_id() -> str:
    """A time-ordered unique id, so records sort chronologically.

    Globally unique across events, which is why GET /api/runs/{run_id} needs no
    event in its path.

    Ids are millisecond timestamp + a random tail. When two ids are generated
    in the same process within the same millisecond — routine under test, or
    under any real burst of submissions — the tail is incremented rather than
    re-rolled, so ids still sort in call order instead of depending on luck.
    """
    with _id_lock:
        stamp = int(time.time() * 1000)
        if stamp <= _id_state["stamp"]:
            stamp = _id_state["stamp"]
            _id_state["rand"] = (_id_state["rand"] + 1) & ((1 << _TAIL_BITS) - 1)
        else:
            _id_state["rand"] = uuid.uuid4().int & ((1 << _TAIL_BITS) - 1)
        _id_state["stamp"] = stamp
        rand = _id_state["rand"]

    head = "".join(_BASE32[(stamp >> shift) & 31] for shift in range(45, -5, -5))
    tail = "".join(_BASE32[(rand >> shift) & 31] for shift in range(_TAIL_BITS - 5, -5, -5))
    return f"{head}{tail}"


@dataclass(frozen=True)
class RunRecord:
    run_id: str
    event_id: str
    submitted_at: str
    user: str
    policy_name: str
    source: dict
    model_sha256: str
    score: float
    seeds_finished: int
    per_seed: tuple[SeedResult, ...]
    trace_seed: int
    runner_version: int
    # Whether this run's .onnx is in the store and can be downloaded.
    #
    # A flag rather than a filesystem probe per row: the leaderboard renders one
    # link per entry, and asking the store "does this exist" for each of them
    # would be one round trip per row against a Hub snapshot. Defaults False, so
    # runs recorded before policies were kept show no download link instead of a
    # broken one — the log is append-only, those files are never coming back.
    model_stored: bool = False
    # Where this policy's training environment lives, if its author shared one.
    # Validated on the way in by arena/envlink.py — only a few known hosts, and
    # never rendered without rel="noopener noreferrer".
    env_url: str | None = None
    # The commanded forward speed the score was set at. The sweep picks it per
    # policy (see evaluate.py), so it differs from row to row and is worth
    # keeping: two entries with the same time did not necessarily do the same
    # thing. Defaulted because pre-sweep runs have no such key.
    command_vx: float = 0.0
    # Which of the robot's colourways this entry raced in. An opaque string on
    # purpose: the four names live in the frontend's liveries.js, and the viewer
    # already falls back to `classic` for one it does not know, so duplicating
    # that list here would buy a second source of truth for nothing.
    livery: str = "classic"
    # What the author wrote about the policy for the commentators, from the manifest at the pinned
    # revision; None when it wrote nothing of its own. Submitter text: only the commentary quotes it,
    # as the author's words, after its own checks.
    description: str | None = None
    # The sha256 of the timeline.json a stage entry played, from its repo at the pinned revision;
    # None for a race, or for a performance of the event's own command. The same weights with
    # another timeline are another performance.
    timeline_sha256: str | None = None

    @property
    def offers_download(self) -> bool:
        """Whether the board should show a download link for this run.

        `model_stored` says whether the SPACE holds the bytes, which stopped
        being the same question when publishing moved to the author's own Hub
        repo: those runs offer a download and store nothing here. Keeping the
        rule in one place stops the API and the frontend disagreeing about it.
        """
        return bool(self.model_stored or (self.source or {}).get("kind") == "hub")

    def to_dict(self) -> dict:
        return {
            "run_id": self.run_id,
            "event_id": self.event_id,
            "submitted_at": self.submitted_at,
            "user": self.user,
            "policy_name": self.policy_name,
            "source": self.source,
            "model_sha256": self.model_sha256,
            "score": self.score,
            "seeds_finished": self.seeds_finished,
            "per_seed": [
                {"seed": r.seed, "status": r.status, "time_s": r.time_s} for r in self.per_seed
            ],
            "trace_seed": self.trace_seed,
            "runner_version": self.runner_version,
            "command_vx": self.command_vx,
            "model_stored": self.model_stored,
            "env_url": self.env_url,
            "livery": self.livery,
            "description": self.description,
            "timeline_sha256": self.timeline_sha256,
        }

    @classmethod
    def from_dict(cls, raw: dict) -> "RunRecord":
        return cls(
            run_id=raw["run_id"],
            event_id=raw["event_id"],
            submitted_at=raw["submitted_at"],
            user=raw["user"],
            policy_name=raw["policy_name"],
            source=raw["source"],
            model_sha256=raw["model_sha256"],
            score=raw["score"],
            seeds_finished=raw["seeds_finished"],
            per_seed=tuple(
                SeedResult(seed=r["seed"], status=r["status"], time_s=r["time_s"])
                for r in raw["per_seed"]
            ),
            trace_seed=raw["trace_seed"],
            runner_version=raw["runner_version"],
            command_vx=raw.get("command_vx", 0.0),
            model_stored=raw.get("model_stored", False),
            env_url=raw.get("env_url"),
            # .get, not [..]: runs recorded before liveries existed have no such
            # key, and an append-only log means those files are never rewritten.
            livery=raw.get("livery", "classic"),
            # .get, not [..]: runs recorded before descriptions existed have no such
            # key, and an append-only log means those files are never rewritten.
            description=raw.get("description"),
            # .get, not [..]: runs recorded before timelines existed have no such
            # key, and an append-only log means those files are never rewritten.
            timeline_sha256=raw.get("timeline_sha256"),
        )


@dataclass(frozen=True)
class Withdrawal:
    """An author taking one of their entries off the board.

    An ADDED record, not a deleted one. The log is append-only — that is what
    makes two simultaneous submissions unable to contend, and what makes
    durability mean "it is a git repo" — so a withdrawal is one more immutable
    write, never a rewrite of history. The row leaves the board; the run that
    produced it stays on disk, still readable, still explicable.

    `repo_id` and `revision` are carried when the run came from the Hub, because
    recovery reasons in those terms: without them a withdrawn entry would be
    re-raced and put straight back at the next restart.
    """

    run_id: str
    event_id: str
    user: str
    withdrawn_at: str
    repo_id: str | None = None
    revision: str | None = None

    def to_dict(self) -> dict:
        return {
            "run_id": self.run_id,
            "event_id": self.event_id,
            "user": self.user,
            "withdrawn_at": self.withdrawn_at,
            "repo_id": self.repo_id,
            "revision": self.revision,
        }

    @classmethod
    def from_dict(cls, raw: dict) -> "Withdrawal":
        return cls(
            run_id=raw["run_id"],
            event_id=raw["event_id"],
            user=raw["user"],
            withdrawn_at=raw["withdrawn_at"],
            repo_id=raw.get("repo_id"),
            revision=raw.get("revision"),
        )


@dataclass(frozen=True)
class Ballot:
    """One person's verdict on one drawn field of ducks.

    `candidates` is IN LANE ORDER, which is why there is no colour field: lane i
    wears the frontend's `LANE_CSS[i]`, and the draw shuffles the order. The
    order IS the colour assignment, so there is nothing to keep in step.

    Recording every candidate and not only the winner is what makes a raw vote
    count honest: exposure — how often a duck was SHOWN — derives from the same
    record, so the draw can equalise it without a second log.
    """

    ballot_id: str
    event_id: str
    voter: str
    cast_at: str
    candidates: tuple[str, ...]
    choice: str

    @property
    def day(self) -> str:
        """The UTC date it was cast on: its shard, and the unit of the quota."""
        return self.cast_at[:10]

    def to_dict(self) -> dict:
        return {
            "ballot_id": self.ballot_id,
            "event_id": self.event_id,
            "voter": self.voter,
            "cast_at": self.cast_at,
            "candidates": list(self.candidates),
            "choice": self.choice,
        }

    @classmethod
    def from_dict(cls, raw: dict) -> "Ballot":
        return cls(
            ballot_id=raw["ballot_id"],
            event_id=raw["event_id"],
            voter=raw["voter"],
            cast_at=raw["cast_at"],
            candidates=tuple(raw["candidates"]),
            choice=raw["choice"],
        )


class Ballots(Protocol):
    def cast(self, ballot: Ballot) -> None: ...
    def since(self, first_day: str) -> list[Ballot]: ...


def days_from(first_day: str, today: str) -> list[str]:
    """Every YYYY-MM-DD from `first_day` to `today`, inclusive.

    The Hub reader needs them explicitly: `allow_patterns` takes paths, not a
    range, and that restriction is what keeps a read the same size in a year as
    it is today.
    """
    start, end = date.fromisoformat(first_day), date.fromisoformat(today)
    out, day = [], start
    while day <= end:
        out.append(day.isoformat())
        day += timedelta(days=1)
    return out


class LocalBallots:
    """The ballot log on a local filesystem. One immutable file per ballot."""

    def __init__(self, root: Path):
        self.root = Path(root)

    def _path(self, ballot: Ballot) -> Path:
        return self.root / "votes" / ballot.day / f"{ballot.ballot_id}.json"

    def cast(self, ballot: Ballot) -> None:
        path = self._path(ballot)
        # Refused rather than overwritten, exactly as a run is. The double-vote
        # guard is the ballot table's single-use entry (routes_vote.py); this
        # refusal is a second line of defence, kept for whatever reaches disk
        # by some other path.
        if path.exists():
            raise FileExistsError(f"ballot {ballot.ballot_id} already cast at {path}")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(ballot.to_dict(), indent=2))

    def since(self, first_day: str) -> list[Ballot]:
        root = self.root / "votes"
        if not root.is_dir():
            return []
        out: list[Ballot] = []
        for shard in sorted(root.iterdir()):
            if not shard.is_dir() or shard.name < first_day:
                continue
            out.extend(
                Ballot.from_dict(json.loads(p.read_text())) for p in sorted(shard.glob("*.json"))
            )
        return sorted(out, key=lambda b: (b.cast_at, b.ballot_id))


class Store(Protocol):
    def append(
        self, record: RunRecord, trace_blob: bytes, model_blob: bytes | None = None
    ) -> None: ...
    def runs(self, event_id: str) -> list[RunRecord]: ...
    def trace(self, run_id: str) -> bytes: ...
    def model(self, sha256: str) -> bytes: ...
    def withdraw(self, withdrawal: Withdrawal) -> None: ...
    def withdrawals(self) -> list[Withdrawal]: ...
    def mark_seen(self, run_id: str, user: str, seen_at: str) -> None: ...
    def seen(self) -> frozenset[str]: ...
    def mark_clip_pending(self, run_id: str, user: str, event_id: str, queued_at: str) -> None: ...
    def put_clip(self, run_id: str, files: dict[str, bytes]) -> None: ...
    def fail_clip(self, run_id: str, failed_at: str, reason: str) -> None: ...
    def clip_state(self, run_id: str) -> tuple[str, dict | None]: ...
    def clip_file(self, run_id: str, name: str) -> Path: ...
    def pending_clips(self) -> list[str]: ...
    def failed_clips(self) -> list[str]: ...
    def refresh(self) -> None: ...


class LocalStore:
    """The store on a local filesystem: tests, development, and the read cache."""

    def __init__(self, root: Path):
        self.root = Path(root)

    def _run_path(self, event_id: str, run_id: str) -> Path:
        return self.root / "runs" / event_id / f"{run_id}.json"

    def _trace_path(self, run_id: str) -> Path:
        return self.root / "traces" / f"{run_id}.npz"

    def _model_path(self, sha256: str) -> Path:
        # Content-addressed. Two people publishing the same weights, or one
        # person publishing them twice under different names, store one file —
        # and the name is a checksum of the contents, so a download can be
        # verified against the record without trusting the store.
        return self.root / "models" / f"{sha256}.onnx"

    def append(
        self, record: RunRecord, trace_blob: bytes, model_blob: bytes | None = None
    ) -> None:
        run_path = self._run_path(record.event_id, record.run_id)
        trace_path = self._trace_path(record.run_id)
        # Both paths are checked, not just the JSON. An append that died between
        # its two writes leaves an orphan trace behind, and silently overwriting
        # that on a retry would be the one mutation this store exists to prevent.
        # A retry simply takes a new run_id, which costs nothing.
        for path in (run_path, trace_path):
            if path.exists():
                raise FileExistsError(f"run {record.run_id} already recorded at {path}")
        run_path.parent.mkdir(parents=True, exist_ok=True)
        trace_path.parent.mkdir(parents=True, exist_ok=True)
        # Trace and model first, JSON last: runs() globs only *.json, so a
        # failure part-way leaves a run that no reader can see, rather than a
        # visible run whose replay or download 404s.
        trace_path.write_bytes(trace_blob)
        if model_blob is not None:
            model_path = self._model_path(record.model_sha256)
            # NOT guarded like the other two, and that is the point of hashing
            # the name: an existing file here has identical contents by
            # definition, so writing it again is a no-op and refusing would
            # break the second person to publish a shared policy.
            if not model_path.exists():
                model_path.parent.mkdir(parents=True, exist_ok=True)
                model_path.write_bytes(model_blob)
        run_path.write_text(json.dumps(record.to_dict(), indent=2))

    def runs(self, event_id: str) -> list[RunRecord]:
        directory = self.root / "runs" / event_id
        if not directory.is_dir():
            return []
        return [
            RunRecord.from_dict(json.loads(p.read_text())) for p in sorted(directory.glob("*.json"))
        ]

    def trace(self, run_id: str) -> bytes:
        return self._trace_path(run_id).read_bytes()

    def model(self, sha256: str) -> bytes:
        return self._model_path(sha256).read_bytes()

    def _withdrawal_path(self, run_id: str) -> Path:
        return self.root / "withdrawn" / f"{run_id}.json"

    def withdraw(self, withdrawal: Withdrawal) -> None:
        path = self._withdrawal_path(withdrawal.run_id)
        # Idempotent on purpose: withdrawing twice is a double-click, not an
        # error worth showing someone.
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(withdrawal.to_dict(), indent=2))

    def withdrawals(self) -> list[Withdrawal]:
        directory = self.root / "withdrawn"
        if not directory.is_dir():
            return []
        return [
            Withdrawal.from_dict(json.loads(p.read_text()))
            for p in sorted(directory.glob("*.json"))
        ]

    def _seen_path(self, run_id: str) -> Path:
        return self.root / "seen" / f"{run_id}.json"

    def mark_seen(self, run_id: str, user: str, seen_at: str) -> None:
        """The author has opened this run's page: the result has been revealed.

        The first visit is the one that matters, so an existing file is left
        alone rather than re-dated. Same shape as a withdrawal — one small file
        in its own folder, never a change to the run's own record.
        """
        path = self._seen_path(run_id)
        if path.exists():
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({"run_id": run_id, "user": user, "seen_at": seen_at}, indent=2)
        )

    def seen(self) -> frozenset[str]:
        directory = self.root / "seen"
        if not directory.is_dir():
            return frozenset()
        return frozenset(p.stem for p in directory.glob("*.json"))

    # ── clips: pending.json, then clip.json + media, or failed.json ──────────
    #
    # Three files rather than one state file that changes: this store never
    # rewrites, and a state read by presence needs no lock. `clip_state` is the
    # one place the precedence lives: ready beats failed beats pending.

    def _clip_dir(self, run_id: str) -> Path:
        return self.root / "clips" / run_id

    def mark_clip_pending(self, run_id: str, user: str, event_id: str, queued_at: str) -> None:
        # Written once, like a seen file: a re-queue after a crash must not
        # re-date the clip it already owed.
        path = self._clip_dir(run_id) / "pending.json"
        if path.exists():
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(
            {"run_id": run_id, "user": user, "event_id": event_id, "queued_at": queued_at}, indent=2
        ))

    def put_clip(self, run_id: str, files: dict[str, bytes]) -> None:
        folder = self._clip_dir(run_id)
        if (folder / "clip.json").exists():
            raise FileExistsError(f"clip {run_id} already rendered at {folder}")
        folder.mkdir(parents=True, exist_ok=True)
        # Media first, clip.json last: state is read off clip.json, so a write
        # that dies part-way leaves a pending clip, never a ready one with a
        # missing file.
        for name, blob in files.items():
            if name != "clip.json":
                (folder / name).write_bytes(blob)
        (folder / "clip.json").write_bytes(files["clip.json"])

    def fail_clip(self, run_id: str, failed_at: str, reason: str) -> None:
        # Written once, like a seen file: a second failure must not erase the
        # reason the first one recorded.
        path = self._clip_dir(run_id) / "failed.json"
        if path.exists():
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(
            {"run_id": run_id, "failed_at": failed_at, "reason": reason}, indent=2
        ))

    def clip_state(self, run_id: str) -> tuple[str, dict | None]:
        folder = self._clip_dir(run_id)
        if (folder / "clip.json").is_file():
            return "ready", json.loads((folder / "clip.json").read_text())
        # The reason travels with the state: a page showing a failed clip has
        # to say why, and this is the only place that file is read.
        if (folder / "failed.json").is_file():
            return "failed", json.loads((folder / "failed.json").read_text())
        if (folder / "pending.json").is_file():
            return "pending", None
        return "none", None

    def clip_file(self, run_id: str, name: str) -> Path:
        return self._clip_dir(run_id) / name

    def pending_clips(self) -> list[str]:
        directory = self.root / "clips"
        if not directory.is_dir():
            return []
        return sorted(
            folder.name for folder in directory.iterdir()
            if folder.is_dir() and self.clip_state(folder.name)[0] == "pending"
        )

    def failed_clips(self) -> list[str]:
        directory = self.root / "clips"
        if not directory.is_dir():
            return []
        return sorted(
            folder.name for folder in directory.iterdir()
            if folder.is_dir() and self.clip_state(folder.name)[0] == "failed"
        )

    def refresh(self) -> None:
        """Nothing to do: a directory is read fresh every time."""


class HubStore:
    """The same log, on a Hugging Face dataset repo.

    Every write is a new file, so commits never conflict on content. Reads go
    through a local snapshot, which is also what the index scans at boot.
    """

    def __init__(self, repo_id: str, token: str | None = None, snapshot_ttl_s: float = 20.0):
        from huggingface_hub import HfApi

        self.repo_id = repo_id
        self.api = HfApi(token=token or os.environ.get("HF_TOKEN"))
        # Reads go through a snapshot, and rendering one leaderboard asks the
        # store for every run. Without this, that is a network round trip per
        # request — the board would feel broken even with ten entries in it.
        # A short TTL rather than a permanent cache, because another process (or
        # a person editing the dataset) can append; a write here invalidates
        # immediately, so your own submission is never stale.
        self._snapshot_ttl_s = snapshot_ttl_s
        self._snapshot: LocalStore | None = None
        self._snapshot_at = 0.0

    def append(
        self, record: RunRecord, trace_blob: bytes, model_blob: bytes | None = None
    ) -> None:
        from huggingface_hub import CommitOperationAdd

        run_path = f"runs/{record.event_id}/{record.run_id}.json"
        # Match LocalStore's refusal to overwrite. CommitOperationAdd would
        # otherwise apply a re-append of the same record — a retry loop in the
        # web layer, say — as a silent overwrite, which is exactly the history
        # rewrite this store is built to prevent.
        #
        # This deliberately does NOT claim to stop a concurrent race: two
        # processes could both see nothing and both commit. That safety comes
        # from run_id uniqueness instead, which is why ids are generated rather
        # than derived from the entry. Paying one round trip for the realistic
        # bug is worth it; pretending it closes the race would not be.
        if self.api.file_exists(self.repo_id, run_path, repo_type="dataset"):
            raise FileExistsError(f"run {record.run_id} already recorded in {self.repo_id}")

        self.api.create_commit(
            repo_id=self.repo_id,
            repo_type="dataset",
            commit_message=f"{record.event_id}: {record.user} {record.score:.3f}s",
            operations=[
                CommitOperationAdd(
                    path_in_repo=run_path,
                    path_or_fileobj=json.dumps(record.to_dict(), indent=2).encode(),
                ),
                CommitOperationAdd(
                    path_in_repo=f"traces/{record.run_id}.npz",
                    path_or_fileobj=trace_blob,
                ),
                *(
                    [
                        CommitOperationAdd(
                            path_in_repo=f"models/{record.model_sha256}.onnx",
                            path_or_fileobj=model_blob,
                        )
                    ]
                    if model_blob is not None
                    else []
                ),
            ],
        )
        # The board must show your own entry the instant you publish it, so a
        # write drops the cache rather than waiting out the TTL.
        self._snapshot = None

    def snapshot(self, fresh: bool = False) -> LocalStore:
        from huggingface_hub import snapshot_download

        if (
            not fresh
            and self._snapshot is not None
            and time.monotonic() - self._snapshot_at < self._snapshot_ttl_s
        ):
            return self._snapshot
        # The clips' media stay out of the snapshot — a boot would otherwise
        # download every video ever rendered. clip_file fetches one on demand.
        self._snapshot = LocalStore(Path(snapshot_download(
            self.repo_id, repo_type="dataset", ignore_patterns=["*.mp4", "*.png"]
        )))
        self._snapshot_at = time.monotonic()
        return self._snapshot

    def runs(self, event_id: str) -> list[RunRecord]:
        return self.snapshot().runs(event_id)

    def trace(self, run_id: str) -> bytes:
        return self.snapshot().trace(run_id)

    def model(self, sha256: str) -> bytes:
        return self.snapshot().model(sha256)

    def withdraw(self, withdrawal: Withdrawal) -> None:
        from huggingface_hub import CommitOperationAdd

        self.api.create_commit(
            repo_id=self.repo_id,
            repo_type="dataset",
            commit_message=f"withdraw {withdrawal.run_id} ({withdrawal.user})",
            operations=[
                CommitOperationAdd(
                    path_in_repo=f"withdrawn/{withdrawal.run_id}.json",
                    path_or_fileobj=json.dumps(withdrawal.to_dict(), indent=2).encode(),
                )
            ],
        )
        # The board must show the withdrawal immediately, not after the TTL.
        self._snapshot = None

    def withdrawals(self) -> list[Withdrawal]:
        return self.snapshot().withdrawals()

    def mark_seen(self, run_id: str, user: str, seen_at: str) -> None:
        from huggingface_hub import CommitOperationAdd

        path = f"seen/{run_id}.json"
        # The first visit stays, as on LocalStore; one round trip to know.
        if self.api.file_exists(self.repo_id, path, repo_type="dataset"):
            return
        self.api.create_commit(
            repo_id=self.repo_id,
            repo_type="dataset",
            commit_message=f"seen {run_id} ({user})",
            operations=[
                CommitOperationAdd(
                    path_in_repo=path,
                    path_or_fileobj=json.dumps(
                        {"run_id": run_id, "user": user, "seen_at": seen_at}, indent=2
                    ).encode(),
                )
            ],
        )
        # The dot must go out the moment the page is seen, not after the TTL.
        self._snapshot = None

    def seen(self) -> frozenset[str]:
        return self.snapshot().seen()

    def _commit_clip_files(self, run_id: str, files: dict[str, bytes], message: str) -> None:
        from huggingface_hub import CommitOperationAdd

        self.api.create_commit(
            repo_id=self.repo_id,
            repo_type="dataset",
            commit_message=message,
            operations=[
                CommitOperationAdd(path_in_repo=f"clips/{run_id}/{name}", path_or_fileobj=blob)
                for name, blob in files.items()
            ],
        )
        self._snapshot = None

    def mark_clip_pending(self, run_id: str, user: str, event_id: str, queued_at: str) -> None:
        # Written once, like a seen file: a re-queue after a crash must not
        # re-date the clip it already owed. One round trip to know.
        path = f"clips/{run_id}/pending.json"
        if self.api.file_exists(self.repo_id, path, repo_type="dataset"):
            return
        body = {"run_id": run_id, "user": user, "event_id": event_id, "queued_at": queued_at}
        self._commit_clip_files(
            run_id, {"pending.json": json.dumps(body, indent=2).encode()}, f"clip pending {run_id}"
        )

    def put_clip(self, run_id: str, files: dict[str, bytes]) -> None:
        if self.api.file_exists(self.repo_id, f"clips/{run_id}/clip.json", repo_type="dataset"):
            raise FileExistsError(f"clip {run_id} already rendered in {self.repo_id}")
        self._commit_clip_files(run_id, files, f"clip {run_id}")

    def fail_clip(self, run_id: str, failed_at: str, reason: str) -> None:
        # Written once, like a seen file: a second failure must not erase the
        # reason the first one recorded.
        path = f"clips/{run_id}/failed.json"
        if self.api.file_exists(self.repo_id, path, repo_type="dataset"):
            return
        body = {"run_id": run_id, "failed_at": failed_at, "reason": reason}
        self._commit_clip_files(
            run_id, {"failed.json": json.dumps(body, indent=2).encode()}, f"clip failed {run_id}"
        )

    def clip_state(self, run_id: str) -> tuple[str, dict | None]:
        return self.snapshot().clip_state(run_id)

    def clip_file(self, run_id: str, name: str) -> Path:
        from huggingface_hub import hf_hub_download

        # One file, cached by the Hub cache: the second read costs nothing.
        return Path(hf_hub_download(
            self.repo_id, f"clips/{run_id}/{name}", repo_type="dataset", token=self.api.token
        ))

    def pending_clips(self) -> list[str]:
        return self.snapshot().pending_clips()

    def failed_clips(self) -> list[str]:
        return self.snapshot().failed_clips()

    def refresh(self) -> None:
        """The next read downloads again: what another process wrote — a clip
        job, say — is seen now rather than after the TTL."""
        self._snapshot = None


class HubBallots:
    """The ballot log on the same dataset repo, read through its OWN snapshot.

    Two things matter here and neither is an optimisation detail. The snapshot
    is separate from the run store's, so casting a vote never invalidates the
    board's cache — voting must not make the leaderboard slow. And it is
    downloaded with `allow_patterns` over the window only, so a read costs the
    same in a year as it does today. That is what lets the log stay append-only
    with nothing ever pruned: the repo grows, reads do not.
    """

    def __init__(self, repo_id: str, token: str | None = None, snapshot_ttl_s: float = 10.0):
        from huggingface_hub import HfApi

        self.repo_id = repo_id
        self.api = HfApi(token=token or os.environ.get("HF_TOKEN"))
        self._snapshot_ttl_s = snapshot_ttl_s
        self._snapshot: LocalBallots | None = None
        self._snapshot_at = 0.0
        self._patterns: tuple[str, ...] = ()

    def cast(self, ballot: Ballot) -> None:
        from huggingface_hub import CommitOperationAdd

        path = f"votes/{ballot.day}/{ballot.ballot_id}.json"
        if self.api.file_exists(self.repo_id, path, repo_type="dataset"):
            raise FileExistsError(f"ballot {ballot.ballot_id} already cast in {self.repo_id}")
        self.api.create_commit(
            repo_id=self.repo_id,
            repo_type="dataset",
            commit_message=f"{ballot.event_id}: {ballot.voter} voted",
            operations=[
                CommitOperationAdd(
                    path_in_repo=path,
                    path_or_fileobj=json.dumps(ballot.to_dict(), indent=2).encode(),
                )
            ],
        )
        # Your own vote must be in the count the page shows you next.
        self._snapshot = None

    def since(self, first_day: str) -> list[Ballot]:
        from huggingface_hub import snapshot_download

        today = datetime.now(UTC).date().isoformat()
        patterns = tuple(f"votes/{day}/*" for day in days_from(first_day, today))
        stale = (
            self._snapshot is None
            or patterns != self._patterns
            or time.monotonic() - self._snapshot_at >= self._snapshot_ttl_s
        )
        if stale:
            self._snapshot = LocalBallots(
                Path(
                    snapshot_download(
                        self.repo_id, repo_type="dataset", allow_patterns=list(patterns)
                    )
                )
            )
            self._snapshot_at = time.monotonic()
            self._patterns = patterns
        return self._snapshot.since(first_day)

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
from pathlib import Path
from typing import Protocol

from .evaluate import SeedResult

_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"  # Crockford, ULID-style
_TAIL_BITS = 60  # 12 base32 chars

_id_lock = threading.Lock()
_id_state = {"stamp": -1, "rand": 0}


def new_run_id() -> str:
    """A time-ordered unique id, so run ids sort chronologically.

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
            "livery": self.livery,
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
            # .get, not [..]: runs recorded before liveries existed have no such
            # key, and an append-only log means those files are never rewritten.
            livery=raw.get("livery", "classic"),
        )


class Store(Protocol):
    def append(
        self, record: RunRecord, trace_blob: bytes, model_blob: bytes | None = None
    ) -> None: ...
    def runs(self, event_id: str) -> list[RunRecord]: ...
    def trace(self, run_id: str) -> bytes: ...
    def model(self, sha256: str) -> bytes: ...


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
        self._snapshot = LocalStore(Path(snapshot_download(self.repo_id, repo_type="dataset")))
        self._snapshot_at = time.monotonic()
        return self._snapshot

    def runs(self, event_id: str) -> list[RunRecord]:
        return self.snapshot().runs(event_id)

    def trace(self, run_id: str) -> bytes:
        return self.snapshot().trace(run_id)

    def model(self, sha256: str) -> bytes:
        return self.snapshot().model(sha256)

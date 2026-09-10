"""Where the app keeps things, and who it thinks you are.

Everything defaults to working with no configuration at all: a store under the
working directory and a user called "local". That is the point — trying the
Arena must not require an account, a token or a network.
"""

import os
from dataclasses import dataclass
from pathlib import Path

from ..index import ENTRANTS
from ..store import HubStore, LocalStore

DEFAULT_STORE = Path("arena-board")
DEFAULT_USER = "local"
# Local default: rank one row per policy. With a single signed-in user, ranking
# per person collapses the board to one line however many policies you try,
# which makes the head-to-head replay — the whole point of running it locally —
# impossible to use. A deployed, multi-user Space sets this to "user".
DEFAULT_RANK_BY = "policy"


@dataclass(frozen=True)
class ArenaConfig:
    store_dir: Path
    dev_user: str
    frontend_dir: Path | None
    rank_by: str
    # The dataset repo that holds the run log, or None for the local filesystem.
    #
    # A Space's container filesystem is ephemeral: without this, every published
    # run and every uploaded policy is lost the next time the Space restarts or
    # wakes from sleep. Set ARENA_DATASET to a dataset repo id and HF_TOKEN to a
    # token that can write to it.
    dataset_repo: str | None = None
    hf_token: str | None = None

    @classmethod
    def from_env(
        cls,
        store_dir: Path | None = None,
        dev_user: str | None = None,
        frontend_dir: Path | None = None,
        rank_by: str | None = None,
    ) -> "ArenaConfig":
        store = Path(store_dir or os.environ.get("ARENA_STORE") or DEFAULT_STORE)
        user = dev_user or os.environ.get("ARENA_DEV_USER") or DEFAULT_USER

        candidate = frontend_dir or os.environ.get("ARENA_FRONTEND")
        if candidate is None:
            candidate = Path(__file__).resolve().parents[2] / "app" / "dist"
        candidate = Path(candidate)
        # A missing bundle is reported by the app, not raised here: the API is
        # useful on its own and `arena serve` should say "run npm run build"
        # rather than traceback.
        resolved = candidate if (candidate / "index.html").is_file() else None

        ranking = rank_by or os.environ.get("ARENA_RANK_BY") or DEFAULT_RANK_BY
        if ranking not in ENTRANTS:
            raise ValueError(
                f"ARENA_RANK_BY must be one of {sorted(ENTRANTS)}, got {ranking!r}"
            )

        return cls(
            store_dir=store,
            dev_user=user,
            frontend_dir=resolved,
            rank_by=ranking,
            dataset_repo=(os.environ.get("ARENA_DATASET") or "").strip() or None,
            hf_token=(os.environ.get("HF_TOKEN") or "").strip() or None,
        )

    @property
    def entrant(self):
        """The dedup key this deployment ranks by."""
        return ENTRANTS[self.rank_by]

    def ensure_store(self) -> Path:
        self.store_dir.mkdir(parents=True, exist_ok=True)
        return self.store_dir

    def store_description(self) -> str:
        """One line for the startup banner, so a misconfigured Space is obvious."""
        if self.dataset_repo and self.hf_token:
            return f"dataset {self.dataset_repo} (durable)"
        if self.dataset_repo:
            return (
                f"{self.store_dir} — EPHEMERAL: ARENA_DATASET is set to "
                f"{self.dataset_repo!r} but HF_TOKEN is not, so nothing can be written "
                "to it. Published runs will be lost on restart."
            )
        return f"{self.store_dir} (local filesystem)"

    def build_store(self):
        """The store this deployment writes to.

        Falls back to the local filesystem rather than refusing to start when a
        dataset is named but no token is available. A Space that boots with a
        loud warning and a working leaderboard is more useful than one that
        crash-loops on a missing secret — and `store_description` puts that
        warning where it cannot be missed.
        """
        if self.dataset_repo and self.hf_token:
            return HubStore(self.dataset_repo, token=self.hf_token)
        return LocalStore(self.ensure_store())

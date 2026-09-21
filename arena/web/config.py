"""Where the app keeps things, and who it thinks you are.

Everything defaults to working with no configuration at all: a store under the
working directory and a user called "local". That is the point — trying the
Arena must not require an account, a token or a network.
"""

import os
import secrets
from dataclasses import dataclass
from pathlib import Path

from ..index import ENTRANTS
from ..store import HubBallots, HubStore, LocalBallots, LocalStore
from .oauth import OAuthSettings

DEFAULT_STORE = Path("arena-board")
DEFAULT_BROADCAST_DIR = Path("/tmp/arena-broadcasts")
DEFAULT_USER = "local"
# Local default: rank one row per policy. With a single signed-in user, ranking
# per person collapses the board to one line however many policies you try,
# which makes the head-to-head replay — the whole point of running it locally —
# impossible to use. A deployed, multi-user Space sets this to "user".
DEFAULT_RANK_BY = "policy"
# HF's own default is 8 hours. Matching it means the cookie and the token expire
# together, so there is no window where the session outlives its own token.
DEFAULT_SESSION_TTL_S = 8 * 60 * 60
# The router model that writes the commentary: the served model nearest the
# one the prompt was tuned on. No provider suffix, so the router picks one
# that serves it. A model that thinks before answering spends the writer's
# token budget on thoughts and is rejected as incomplete; pick an instruct one.
DEFAULT_COMMENTARY_MODEL = "deepseek-ai/DeepSeek-V3.1"


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
    # Reconcile the board against the Hub at startup: race whatever has been
    # published there and is missing here.
    #
    # OFF by default, and that is a spec requirement, not caution: the engine and
    # the web layer must both work on a developer machine with no Hugging Face
    # account and NO NETWORK. A deployment opts in with ARENA_RECOVER=1.
    recover_on_boot: bool = False
    oauth: OAuthSettings | None = None
    # Signs the session cookie. Defaults to the OAuth client secret, which every
    # Space already has and never changes across its workers; falls back to a
    # per-process random value locally, so cookies from a previous process are
    # worthless rather than replayable.
    session_secret: str = ""
    session_ttl_s: float = DEFAULT_SESSION_TTL_S
    # Where the clip recorder's own Chrome loads clip.html: this server, on
    # loopback. `arena serve` passes its port; ARENA_ORIGIN overrides.
    origin: str = "http://127.0.0.1:8000"
    # The address a shared link carries. A Space knows its host; locally there
    # is none, and the unfurl route falls back to the request's.
    public_origin: str | None = None
    # Layouts rendered at once. Half the cores: SwiftShader takes every core a
    # frame can get, so a 2-vCPU Space renders one layout at a time.
    clip_parallel: int = 1
    # Whether this process runs the clip worker. `arena clip` turns it off so
    # its one render is not raced by a drain of everything else owed.
    clip_worker: bool = True
    # The documented way to stop rendering on a running Space: set ARENA_CLIPS=0
    # and nothing new is queued. Existing clips and the routes serving them are
    # unaffected — this only stops making more.
    clips_enabled: bool = True
    # Render a clip for every run that has none — the log as it stood before
    # clips existed. Set ARENA_CLIP_BACKFILL=1 on the deploy that brings clips
    # to a Space with history; the drain at each boot then owes the rest,
    # newest first, behind fresh publishes, and finds nothing to do once caught up.
    clip_backfill: bool = False
    # Whether publishes get Peter and Ray's lines. ARENA_COMMENTARY=0 is the
    # off switch for a running Space; no token turns it off with a boot line.
    commentary_enabled: bool = True
    # The router model that writes them. ARENA_COMMENTARY_MODEL overrides.
    commentary_model: str = DEFAULT_COMMENTARY_MODEL
    # Where broadcasts (BroadcastBook) are written and read. ARENA_BROADCASTS
    # overrides. Not the store: a broadcast is consumed once and forgotten
    # twenty airings later, and on a Space every store write is a dataset
    # commit — far too many of those, far too briefly needed.
    broadcast_dir: Path = DEFAULT_BROADCAST_DIR

    @classmethod
    def from_env(
        cls,
        store_dir: Path | None = None,
        dev_user: str | None = None,
        frontend_dir: Path | None = None,
        rank_by: str | None = None,
        origin: str | None = None,
        clip_worker: bool = True,
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

        oauth = OAuthSettings.from_env(dict(os.environ), os.environ.get("SPACE_HOST"))
        secret = (os.environ.get("OAUTH_CLIENT_SECRET") or "").strip() or secrets.token_urlsafe(32)

        parallel_env = os.environ.get("ARENA_CLIP_PARALLEL")
        if parallel_env:
            try:
                clip_parallel = int(parallel_env)
            except ValueError:
                clip_parallel = 0
            if clip_parallel < 1:
                raise ValueError(
                    f"ARENA_CLIP_PARALLEL must be a positive integer, got {parallel_env!r}"
                )
        else:
            clip_parallel = max(1, (os.cpu_count() or 2) // 2)

        return cls(
            store_dir=store,
            dev_user=user,
            frontend_dir=resolved,
            rank_by=ranking,
            dataset_repo=(os.environ.get("ARENA_DATASET") or "").strip() or None,
            hf_token=(os.environ.get("HF_TOKEN") or "").strip() or None,
            recover_on_boot=(os.environ.get("ARENA_RECOVER") or "").strip() in {"1", "true", "yes"},
            oauth=oauth,
            session_secret=secret,
            origin=os.environ.get("ARENA_ORIGIN") or origin or "http://127.0.0.1:8000",
            public_origin=(f"https://{host}" if (host := os.environ.get("SPACE_HOST")) else None),
            clip_parallel=clip_parallel,
            clip_worker=clip_worker,
            clips_enabled=(os.environ.get("ARENA_CLIPS") or "1").strip() not in {"0", "false", "no"},
            clip_backfill=(os.environ.get("ARENA_CLIP_BACKFILL") or "").strip() in {"1", "true", "yes"},
            commentary_enabled=(os.environ.get("ARENA_COMMENTARY") or "1").strip()
            not in {"0", "false", "no"},
            commentary_model=(os.environ.get("ARENA_COMMENTARY_MODEL") or "").strip()
            or DEFAULT_COMMENTARY_MODEL,
            broadcast_dir=Path(os.environ.get("ARENA_BROADCASTS") or DEFAULT_BROADCAST_DIR),
        )

    @property
    def entrant(self):
        """The dedup key this deployment ranks by."""
        return ENTRANTS[self.rank_by]

    @property
    def oauth_enabled(self) -> bool:
        return self.oauth is not None

    def ensure_store(self) -> Path:
        self.store_dir.mkdir(parents=True, exist_ok=True)
        return self.store_dir

    def store_description(self) -> str:
        """One line for the startup banner, so a misconfigured Space is obvious."""
        if self.dataset_repo and self.hf_token:
            return f"dataset {self.dataset_repo} (durable)"
        if self.dataset_repo:
            # Name what else is set, because the realistic failure is a token
            # that EXISTS under another name. Saying only "HF_TOKEN is not set"
            # is true and useless when the owner has just added `microduck_token`
            # and is looking at it. Names only — never values.
            others = sorted(
                key
                for key in os.environ
                if key != "HF_TOKEN" and ("TOKEN" in key.upper() or "SECRET" in key.upper())
            )
            hint = (
                f" This deployment does have {', '.join(others)} — if one of those holds "
                "the token, rename it to HF_TOKEN."
                if others
                else ""
            )
            return (
                f"{self.store_dir} — EPHEMERAL: ARENA_DATASET is set to "
                f"{self.dataset_repo!r} but HF_TOKEN is not, so nothing can be written "
                f"to it. Published runs will be lost on restart.{hint}"
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

    def build_ballots(self):
        """The ballot log this deployment writes to. Same repo, own snapshot."""
        if self.dataset_repo and self.hf_token:
            return HubBallots(self.dataset_repo, token=self.hf_token)
        return LocalBallots(self.ensure_store())

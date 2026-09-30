"""Racing a policy: as a trial, or for the record.

Both paths run the SAME evaluation. `try` returns the result and keeps nothing;
`submit` returns the result and appends it to the log. That split exists so you
can measure a policy against the standing board without publishing every
experiment you run.

`submit` re-evaluates rather than accepting numbers from the browser, even
straight after a trial produced them. Runs are deterministic — the golden test
pins that — so re-running costs about a second and yields the identical time,
which means the rule "the server does the timing" survives having a trial
button at all.

Uploads are validated by the same `load_policy` the CLI uses, so a rejection
carries the engine's own wording, and nothing is recorded unless the evaluation
completes.
"""

import base64
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool

from .. import trace as trace_codec
from ..envlink import EnvLinkError, normalise_env_url
from ..evaluate import evaluate, evaluate_at
from ..hub_fetch import FetchedPolicy, FetchError, fetch_policy
from ..hub_publish import HubPublishError, publish_policy
from ..manifest import ManifestError, load_event
from ..policy import MAX_MODEL_BYTES, PolicyError, load_policy
from ..store import RunRecord, Withdrawal, new_id
from .routes_auth import current_user
from .session import Session

router = APIRouter(prefix="/api")


def _publish_to_hub(token: str, username: str, name: str, blob: bytes, rig: str, event_id=None):
    """Wrapped so tests replace one function rather than the Hub client."""
    from huggingface_hub import HfApi

    return publish_policy(HfApi(token=token), username, name, blob, rig, event_id)


def _fetch_from_hub(repo_id: str) -> FetchedPolicy:
    """Wrapped so tests replace one function rather than the Hub client."""
    return fetch_policy(repo_id)


def _require_session(request: Request) -> Session:
    """Racing costs CPU and publishing writes to a namespace. Both need a name.

    Watching does not: the board, the replays and the downloads are open to
    anyone who can open the page.
    """
    session = current_user(request)
    if session is None:
        raise HTTPException(status_code=401, detail="Please sign in to race a policy.")
    return session


def _load_and_evaluate(path: Path, manifest, command_vx: float | None = None):
    """The blocking half of a run, in one call so it takes one thread hop."""
    policy = load_policy(path)
    if command_vx is None:
        return policy, evaluate(manifest, policy)
    return policy, evaluate_at(manifest, policy, command_vx)


def _event_or_404(event_id: str):
    try:
        return load_event(event_id)
    except ManifestError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _speed(manifest, value: str | None) -> float | None:
    """A trial's chosen speed, or None for the full sweep.

    Clamped to the event's own declared range rather than rejected: the picker
    is built from that range, so a value outside it is a stale page or a hand-
    made request, and neither is worth a 400. Anything unparseable falls back to
    the sweep, which is the honest answer to "I don't know what you asked for".
    """
    if value is None or str(value).strip() == "":
        return None
    try:
        vx = float(value)
    except (TypeError, ValueError):
        return None
    return min(manifest.sweep.hi, max(manifest.sweep.lo, vx))


async def _race(
    event_id: str,
    file: UploadFile | None,
    repo_id: str | None = None,
    command_vx: str | None = None,
):
    """Validate a policy and evaluate it. Shared by both paths, and both sources.

    Exactly one of `file` (an upload) and `repo_id` (already on the Hub) is
    given — the routes enforce that before calling in. Returns `(manifest,
    policy, evaluation, payload, fetched)`, or raises the HTTP error a
    submitter should see.

    `payload` comes back because `submit` stores an upload's weights so others
    can download and race them, and re-reading the upload after it has been
    consumed is not possible. `fetched` comes back instead, for the Hub path:
    the policy already lives with its author, so there is nothing here to
    store — `submit` records a link built from it rather than a blob.
    """
    manifest = _event_or_404(event_id)

    if repo_id:
        try:
            # Offloaded to a worker thread: this is a network call.
            fetched = await run_in_threadpool(_fetch_from_hub, repo_id)
        except FetchError as exc:
            # 400, not 500: the reference is the problem, and the message is
            # written to be read by the person who typed it.
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        try:
            # Offloaded to a worker thread. Both steps are CPU-bound — an ONNX
            # session load plus five simulated runs, about a second in total —
            # and these are `async def` handlers, so doing them inline would
            # block the whole event loop. This is also where the 64 MiB cap is
            # enforced for a fetched policy: `load_policy` checks every path
            # alike, whichever source it came from.
            policy, result = await run_in_threadpool(
                _load_and_evaluate, fetched.path, manifest, _speed(manifest, command_vx)
            )
        except PolicyError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return manifest, policy, result, None, fetched

    payload = await file.read()
    if len(payload) > MAX_MODEL_BYTES:
        # Checked before writing anything: an oversize upload should cost nothing.
        raise HTTPException(
            status_code=413,
            detail=f"model is {len(payload)} bytes, larger than the "
            f"{MAX_MODEL_BYTES} byte limit",
        )

    with tempfile.TemporaryDirectory() as work:
        path = Path(work) / "submitted.onnx"
        path.write_bytes(payload)
        try:
            # Offloaded to a worker thread. Both steps are CPU-bound — an ONNX
            # session load plus five simulated runs, about a second in total —
            # and these are `async def` handlers, so doing them inline would
            # block the whole event loop.
            policy, result = await run_in_threadpool(
                _load_and_evaluate, path, manifest, _speed(manifest, command_vx)
            )
        except PolicyError as exc:
            # 400, not 500: the file is the problem, and the message is written
            # to be read by the person who uploaded it.
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    return manifest, policy, result, payload, None


def _seed_rows(result):
    return [{"seed": s.seed, "status": s.status, "time_s": s.time_s} for s in result.per_seed]


def _env_url(value: str | None) -> str | None:
    """The submitter's training-environment link, or a 400 saying why not.

    400 rather than silently dropping it: someone who typed a link and got a row
    with no button would have no idea which of the two happened.
    """
    try:
        return normalise_env_url(value)
    except EnvLinkError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _livery(value: str | None) -> str:
    """Capped, not validated against a list.

    The four names live in the frontend; the viewer falls back to `classic` for
    anything it does not recognise, and that fallback is tested. Keeping a copy
    of the list here would give the two sides a chance to disagree.
    """
    return (value or "classic").strip()[:32] or "classic"


def _label(name: str | None, filename: str | None) -> str:
    # Capped: this is submitter-supplied text that ends up on a shared board, and
    # nothing downstream bounds it. 80 characters is generous for a policy name.
    return ((name or "").strip() or Path(filename or "policy.onnx").stem)[:80]


def _require_exactly_one(file: UploadFile | None, repo_id: str | None) -> None:
    """A policy comes from an upload or a Hub repo id, never both, never neither."""
    if (file is None) == (not repo_id):
        raise HTTPException(
            status_code=400,
            detail="Send either a .onnx file or a repo id, not both and not neither.",
        )


@router.post("/events/{event_id}/try")
async def try_policy(
    event_id: str,
    request: Request,
    file: UploadFile | None = File(default=None),
    repo_id: str | None = Form(default=None),
    name: str | None = Form(default=None),
    livery: str | None = Form(default=None),
    command_vx: str | None = Form(default=None),
) -> dict:
    """Race a policy and keep nothing.

    The trace comes back inline rather than being parked server-side: a trial
    that was never recorded should not create state with a lifetime to manage.

    `command_vx` pins the commanded speed for this trial. Omit it for the full
    sweep — the same measurement the board uses. Pinning is five runs instead of
    thirty-odd, so it is also the quick way to look at one behaviour.

    `repo_id` races a policy already on the Hub, by reference — nothing is
    uploaded, and exactly one of `file` and `repo_id` must be given.
    """
    _require_session(request)
    _require_exactly_one(file, repo_id)
    _, _, result, _payload, fetched = await _race(event_id, file, repo_id, command_vx)
    return {
        "policy_name": _label(name, file.filename if file else fetched.filename),
        "livery": _livery(livery),
        "score": result.score,
        "command_vx": result.command_vx,
        "seeds_finished": result.seeds_finished,
        "seeds_total": len(result.per_seed),
        "per_seed": _seed_rows(result),
        "trace_seed": result.trace_seed,
        "trace_b64": base64.b64encode(
            result.trace.astype("<f4").tobytes()
        ).decode("ascii"),
    }


@router.post("/events/{event_id}/submit")
async def submit(
    event_id: str,
    request: Request,
    file: UploadFile | None = File(default=None),
    repo_id: str | None = Form(default=None),
    name: str | None = Form(default=None),
    livery: str | None = Form(default=None),
    command_vx: str | None = Form(default=None),
    env_url: str | None = Form(default=None),
) -> dict:
    # Gated before any of the expensive work: validating and racing a policy for
    # someone who is not signed in would burn CPU on a shared Space for a
    # request that cannot be recorded.
    session = _require_session(request)
    _require_exactly_one(file, repo_id)
    # Checked before racing: a link this server will refuse should cost nobody
    # thirty seconds of simulation first.
    link = _env_url(env_url)

    # `command_vx` pins the commanded speed for this entry; omit it for the full
    # sweep, which stays the default.
    #
    # An earlier version refused it here, on the reasoning that a board where
    # entrants choose their own speed ranks whoever guessed best. That objection
    # does not survive the arithmetic: the sweep already keeps the BEST time
    # across every speed in the range, including whichever one you would have
    # pinned. Pinning can therefore only match or lose to sweeping — it is
    # self-penalising, not exploitable.
    #
    # One honest caveat. The sweep's shortlist is chosen from a ONE-SEED scan, so
    # it can miss a speed that would have won over five. A pinned entry can
    # occasionally beat the sweep's answer for the same policy by a hair. The
    # board shows each row's commanded speed, so this is visible rather than
    # hidden.
    manifest, policy, result, payload, fetched = await _race(
        event_id, file, repo_id, command_vx
    )

    store = request.app.state.store
    label = _label(name, file.filename if file else fetched.filename)

    # Race first, publish second, record third. Nothing is written into
    # someone's Hub namespace until the harness above has confirmed the file
    # is a working policy — a validation failure never reaches the Hub.
    #
    # A `repo_id` entry never goes through this: the policy already lives with
    # its author, in that repo, so there is nothing here to publish.
    published = None
    if fetched is None and session.token:
        try:
            published = _publish_to_hub(
                session.token, session.username, label, payload, manifest.rig, manifest.id
            )
        except HubPublishError as exc:
            # 502, not 500: the Hub refused, and the message is the Hub's. And
            # nothing is recorded — a row pointing at a repo that does not
            # exist is worse than an error.
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    if fetched is not None:
        source = {
            "kind": "hub",
            "repo_id": fetched.repo_id,
            "filename": fetched.filename,
            "revision": fetched.revision,
            "url": fetched.url,
        }
    elif published is not None:
        source = {
            "kind": "hub",
            "repo_id": published.repo_id,
            "filename": published.filename,
            "revision": published.revision,
            "url": published.url,
        }
    else:
        source = {"kind": "upload", "filename": file.filename}

    record = RunRecord(
        run_id=new_id(),
        event_id=manifest.id,
        # Zero-padded ISO-8601 ending in Z. arena/index.py breaks a full tie by
        # comparing this as a STRING, so an isoformat() offset would misorder it.
        submitted_at=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        user=session.username,
        policy_name=label,
        source=source,
        model_sha256=policy.sha256,
        score=result.score,
        command_vx=result.command_vx,
        seeds_finished=result.seeds_finished,
        per_seed=result.per_seed,
        trace_seed=result.trace_seed,
        runner_version=result.runner_version,
        # Publishing shares the weights, either kept here, in the author's own
        # Hub repo, or — for a `repo_id` entry — nowhere, because they were
        # already there. This is stated on the page next to the button,
        # because it changes what "Publish" means: a time nobody can
        # reproduce is a claim, and the whole value of the board is that
        # anyone can download an entry and race it themselves.
        model_stored=published is None and fetched is None,
        env_url=link,
        livery=_livery(livery),
    )
    store.append(record, trace_codec.encode(result.trace, result.settle), payload if published is None else None)

    clips = request.app.state.clips
    if clips.available:
        # Owed now, rendered later: the response does not wait for a video.
        # The run is already on the board at this point, so a marker that
        # fails to write must not turn a successful publish into a 500.
        try:
            store.mark_clip_pending(
                record.run_id, record.user, record.event_id, record.submitted_at
            )
            clips.enqueue(record.run_id)
        except Exception as exc:  # noqa: BLE001 — see above
            print(f"clip: {record.run_id} not queued ({type(exc).__name__}: {exc})")

    return {
        "run_id": record.run_id,
        "user": record.user,
        "policy_name": record.policy_name,
        "livery": record.livery,
        "score": record.score,
        "command_vx": record.command_vx,
        "model_stored": record.model_stored,
        "offers_download": record.offers_download,
        "policy_url": (record.source or {}).get("url"),
        "seeds_finished": record.seeds_finished,
        "seeds_total": len(record.per_seed),
        "per_seed": _seed_rows(result),
        "trace_seed": record.trace_seed,
    }


@router.post("/runs/{run_id}/withdraw")
def withdraw(run_id: str, request: Request) -> dict:
    """Take one of YOUR OWN entries off the board.

    Not a delete. The log is append-only, so this appends a withdrawal: the row
    leaves the board, the run stays on disk, and the history is never rewritten.

    It also stops recovery resurrecting the entry. Without that the button would
    appear to work and the row would be back at the next restart, because the
    policy is still published on the Hub and the boot reconciliation would
    re-race it.

    The policy repo itself is untouched. It belongs to its author, who can
    delete it on the Hub if they want to — this Space asks only for
    `contribute-repos`, and widening that to `manage-repos` for every visitor
    would be a large permission to charge for a delete button.
    """
    from datetime import UTC, datetime

    from .routes_read import _find_run

    session = _require_session(request)
    store = request.app.state.store
    record = _find_run(store, run_id)

    # Ownership is decided from the SESSION, never from anything the browser
    # sent. A withdrawal is destructive to someone's standing, and the only
    # thing that may authorise it is who the server believes you are.
    if record.user != session.username:
        raise HTTPException(
            status_code=403,
            detail=f"{run_id} was published by {record.user}, not you.",
        )

    source = record.source or {}
    store.withdraw(
        Withdrawal(
            run_id=record.run_id,
            event_id=record.event_id,
            user=record.user,
            withdrawn_at=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            repo_id=source.get("repo_id"),
            revision=source.get("revision"),
        )
    )
    # The channel must not play a run its author just took off the board.
    request.app.state.programme.invalidate()
    return {"withdrawn": record.run_id, "event_id": record.event_id}


@router.post("/runs/{run_id}/seen")
def mark_seen(run_id: str, request: Request) -> dict:
    """The author has opened this run's page: the reveal has played, the dot goes out.

    Owner-only, decided from the session exactly as a withdrawal is. Idempotent:
    the store keeps the first visit and ignores the rest.
    """
    from .routes_read import _find_run

    session = _require_session(request)
    store = request.app.state.store
    record = _find_run(store, run_id)
    if record.user != session.username:
        raise HTTPException(
            status_code=403,
            detail=f"{run_id} was published by {record.user}, not you.",
        )
    store.mark_seen(
        record.run_id, record.user, datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    )
    return {"seen": True}

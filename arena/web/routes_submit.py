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
from ..evaluate import evaluate, evaluate_at
from ..manifest import ManifestError, load_event
from ..policy import MAX_MODEL_BYTES, PolicyError, load_policy
from ..store import RunRecord, new_run_id

router = APIRouter(prefix="/api")


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


async def _race(event_id: str, file: UploadFile, command_vx: str | None = None):
    """Validate an upload and evaluate it. Shared by both paths.

    Returns `(manifest, policy, evaluation, payload)`, or raises the HTTP error
    a submitter should see. The payload comes back because `submit` stores the
    weights so others can download and race them, and re-reading the upload
    after it has been consumed is not possible.
    """
    manifest = _event_or_404(event_id)

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

    return manifest, policy, result, payload


def _seed_rows(result):
    return [{"seed": s.seed, "status": s.status, "time_s": s.time_s} for s in result.per_seed]


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


@router.post("/events/{event_id}/try")
async def try_policy(
    event_id: str,
    file: UploadFile = File(...),
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
    """
    _, _, result, _payload = await _race(event_id, file, command_vx)
    return {
        "policy_name": _label(name, file.filename),
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
    file: UploadFile = File(...),
    name: str | None = Form(default=None),
    livery: str | None = Form(default=None),
) -> dict:
    # NO command_vx here, deliberately, even though `try` accepts one. A board
    # where entrants pick their own commanded speed ranks whoever guessed best,
    # which is the exact failure the sweep was built to remove. A published time
    # is always the full sweep.
    manifest, policy, result, payload = await _race(event_id, file)

    config = request.app.state.config
    store = request.app.state.store

    record = RunRecord(
        run_id=new_run_id(),
        event_id=manifest.id,
        # Zero-padded ISO-8601 ending in Z. arena/index.py breaks a full tie by
        # comparing this as a STRING, so an isoformat() offset would misorder it.
        submitted_at=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        user=config.dev_user,
        policy_name=_label(name, file.filename),
        source={"kind": "upload", "filename": file.filename},
        model_sha256=policy.sha256,
        score=result.score,
        command_vx=result.command_vx,
        seeds_finished=result.seeds_finished,
        per_seed=result.per_seed,
        trace_seed=result.trace_seed,
        runner_version=result.runner_version,
        # Publishing shares the weights. This is stated on the page next to the
        # button, because it changes what "Publish" means: a time nobody can
        # reproduce is a claim, and the whole value of the board is that anyone
        # can download an entry and race it themselves.
        model_stored=True,
        livery=_livery(livery),
    )
    store.append(record, trace_codec.encode(result.trace), payload)

    return {
        "run_id": record.run_id,
        "user": record.user,
        "policy_name": record.policy_name,
        "livery": record.livery,
        "score": record.score,
        "command_vx": record.command_vx,
        "model_stored": record.model_stored,
        "seeds_finished": record.seeds_finished,
        "seeds_total": len(record.per_seed),
        "per_seed": _seed_rows(result),
        "trace_seed": record.trace_seed,
    }

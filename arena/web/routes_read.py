"""Read-only endpoints: what events exist, and who is winning them.

These shape engine objects into the JSON the page renders. No ranking, scoring
or selection logic lives here — `arena.index.leaderboard` owns all of it, so the
web layer and the CLI can never disagree about who is first.
"""

import re

import numpy as np
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse, Response

from ..index import leaderboard
from ..manifest import Manifest, ManifestError, all_events, load_event
from ..store import RunRecord
from ..trace import decode

router = APIRouter(prefix="/api")


def event_summary(manifest: Manifest) -> dict:
    return {
        "id": manifest.id,
        "title": manifest.title,
        "rig": manifest.rig,
        "status": manifest.status,
        "length_m": manifest.course.length_m,
        "width_m": manifest.course.width_m,
        "slope_deg": manifest.course.slope_deg,
        "time_limit_s": manifest.time_limit_s,
        "seeds": len(manifest.seeds),
        # The sweep, not a single command: the event no longer pins a speed,
        # it declares the range every entry is tried over.
        "sweep_lo": manifest.sweep.lo,
        "sweep_hi": manifest.sweep.hi,
        "sweep_step": manifest.sweep.step,
        "sweep_count": len(manifest.sweep.speeds()),
    }


def _event_or_404(event_id: str) -> Manifest:
    try:
        return load_event(event_id)
    except ManifestError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/events")
def list_events() -> dict:
    return {"events": [event_summary(m) for m in all_events()]}


@router.get("/events/{event_id}/leaderboard")
def event_leaderboard(event_id: str, request: Request) -> dict:
    manifest = _event_or_404(event_id)
    config = request.app.state.config
    store = request.app.state.store
    rows = leaderboard(
        store.runs(manifest.id),
        entrant=config.entrant,
        withdrawn=frozenset(w.run_id for w in store.withdrawals()),
    )
    return {
        "event": event_summary(manifest),
        "rows": [
            {
                "rank": row.rank,
                "user": row.record.user,
                "policy_name": row.record.policy_name,
                "livery": row.record.livery,
                "score": row.record.score,
                "command_vx": row.record.command_vx,
                # Whether this row offers a download. False for runs recorded
                # before policies were kept, so the page shows nothing rather
                # than a link that 404s.
                "model_stored": row.record.model_stored,
                # The single rule the board renders from: `model_stored` or a
                # Hub-backed source. See RunRecord.offers_download.
                "offers_download": row.record.offers_download,
                "policy_url": (row.record.source or {}).get("url"),
                "seeds_finished": row.record.seeds_finished,
                "seeds_total": len(row.record.per_seed),
                "run_id": row.record.run_id,
                "submitted_at": row.record.submitted_at,
            }
            for row in rows
        ],
    }


def _find_run(store, run_id: str) -> RunRecord:
    """Scan every event for a run id.

    Run ids are globally unique, so the id alone addresses a run and the URL
    needs no event. With one small local store, scanning is cheaper than
    maintaining an index; the deployed version gets the in-memory index instead.
    """
    for manifest in all_events():
        for record in store.runs(manifest.id):
            if record.run_id == run_id:
                return record
    raise HTTPException(status_code=404, detail=f"no such run: {run_id!r}")


@router.get("/runs/{run_id}")
def run_detail(run_id: str, request: Request) -> dict:
    store = request.app.state.store
    record = _find_run(store, run_id)
    frames = decode(store.trace(run_id)).shape[0]
    return {
        "run_id": record.run_id,
        "event_id": record.event_id,
        "user": record.user,
        "policy_name": record.policy_name,
        "score": record.score,
        "seeds_finished": record.seeds_finished,
        "per_seed": [
            {"seed": s.seed, "status": s.status, "time_s": s.time_s} for s in record.per_seed
        ],
        "trace_seed": record.trace_seed,
        "submitted_at": record.submitted_at,
        "runner_version": record.runner_version,
        "frames": frames,
        "offers_download": record.offers_download,
        "policy_url": (record.source or {}).get("url"),
    }


# Same cap the intake enforces, so a download cannot be larger than an upload
# was allowed to be.
_SAFE_NAME = re.compile(r"[^A-Za-z0-9_-]+")


def policy_filename(policy_name: str, user: str) -> str:
    """A filename a person can find again in their downloads folder.

    Derived from submitter-supplied text, so it is sanitised rather than
    trusted: a policy called `../../etc/passwd` or one with a quote in it must
    not be able to shape a Content-Disposition header or a path.

    Dots are dropped from the stem rather than kept, which costs `v1.2` its dot
    and removes the whole family of `..` and `policy.onnx.exe` confusions in
    exchange. The extension is appended here, so it is the only one.
    """
    # Collapsed, not just substituted: "../../etc" would otherwise become
    # "--etc" and read as a mangled filename rather than a clean one.
    stem = _SAFE_NAME.sub("-", f"{user}-{policy_name}")
    stem = re.sub(r"-{2,}", "-", stem).strip("-")[:60].strip("-")
    return f"{stem or 'policy'}.onnx"


@router.get("/runs/{run_id}/policy")
def run_policy(run_id: str, request: Request) -> Response:
    """The published .onnx itself, so anyone can race someone else's policy.

    This is what makes the board more than a scoreboard: a time you cannot
    reproduce is a claim, and a time whose weights you can download and run
    yourself is a result. Only published runs are here — a trial is evaluated
    and kept nowhere, which is the whole point of having a trial button.
    """
    store = request.app.state.store
    record = _find_run(store, run_id)
    source = record.source or {}
    if source.get("kind") == "hub" and source.get("url"):
        # The weights live with their author. Redirect rather than proxy: the
        # Hub serves them faster than this Space can, and a proxied download
        # would put every byte through a 2-vCPU container.
        return RedirectResponse(source["url"])
    if not record.model_stored:
        raise HTTPException(
            status_code=404,
            detail=f"run {run_id} was recorded before policies were kept, "
            "so its weights are not in the store",
        )
    return Response(
        content=store.model(record.model_sha256),
        media_type="application/octet-stream",
        headers={
            "Content-Disposition":
                f'attachment; filename="{policy_filename(record.policy_name, record.user)}"',
            # The name is a hash of the contents, so the bytes behind this run
            # can never change. Worth caching hard.
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Model-SHA256": record.model_sha256,
        },
    )


@router.get("/runs/{run_id}/trace")
def run_trace(run_id: str, request: Request) -> Response:
    """Raw little-endian float32, TRACE_WIDTH values per frame.

    The stored form is compressed float16 npz, which a browser cannot read. This
    decodes it server-side so the frontend is one `new Float32Array(buffer)` away
    from a replay — no numpy-in-JavaScript, no base64 bloat.
    """
    store = request.app.state.store
    _find_run(store, run_id)  # 404 before touching the trace file
    trace = decode(store.trace(run_id))
    payload = np.ascontiguousarray(trace, dtype="<f4").tobytes()
    return Response(
        content=payload,
        media_type="application/octet-stream",
        headers={"X-Frame-Count": str(trace.shape[0]), "Cache-Control": "no-store"},
    )

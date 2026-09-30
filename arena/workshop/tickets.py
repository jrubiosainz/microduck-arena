"""A challenge's trainings as the page shows them: one ticket each.

A ticket gathers what is known of one training from three places: the training this workshop
follows now (its log, its exact state), the record each launch writes (jobs.py, which outlives the
workshop), and the run directory mjlab writes (checkpoints, provenance, curve). A run trained from a
shell has no record: its ticket is its directory alone, under the directory's name. Nothing here
asks the network — what the Hub says of a job is in its record, written by the watcher.
"""

from ..manifest import load_event
from .code import code_url
from .evaluations import summary
from .jobs import recorded_jobs
from .publishing import published
from .runs import curve, find_runs

# What the Hub says of a job, as a ticket says it.
HF_STAGES = {"SCHEDULING": "starting", "RUNNING": "running", "COMPLETED": "done",
             "CANCELED": "stopped", "ERROR": "failed", "DELETED": "failed"}
# What a followed training's process says, as a ticket says it.
LIVE_STATES = {"running": "running", "finished": "done", "failed": "failed", "stopped": "stopped"}


def _iterations(record, run) -> int | None:
    """How many iterations the training was launched for: its record's recipe, else its provenance."""
    if record and record.get("recipe"):
        return int(record["recipe"]["max_iterations"])
    command = list(run.provenance.get("command") or []) if run else []
    for i, arg in enumerate(command):
        if arg == "--agent.max-iterations" and i + 1 < len(command):
            return int(command[i + 1])
        if arg.startswith("--agent.max-iterations="):
            return int(arg.split("=", 1)[1])
    return None


def _state(live, record, run, total) -> str:
    if live is not None:
        return LIVE_STATES[live.state]
    if record and record.get("where") == "hf-jobs":
        return HF_STAGES.get(record.get("stage"), "running")
    if record and record.get("ended"):
        return LIVE_STATES[record["ended"]]
    # A local training whose workshop was closed, or a run from a shell: its checkpoints say.
    last = run.checkpoints[-1] if run and run.checkpoints else None
    return "done" if total and last is not None and last + 1 >= total else "stopped"


def _progress(live, run, total, state) -> dict | None:
    if live is not None and live.progress:
        done, total = live.progress
        return {"done": done, "total": total}
    if not total:
        return None
    if state == "done":
        return {"done": total, "total": total}
    return {"done": run.checkpoints[-1] if run and run.checkpoints else 0, "total": total}


def _checkpoints(run, voted: bool) -> tuple[list[dict], int | None]:
    done = summary(run) if run else {}
    rows = [{"n": n, **done.get(n, {"status": "queued"})} for n in (run.checkpoints if run else ())]
    finishers = [r for r in rows if r["status"] == "evaluated" and r["seeds_finished"] > 0]
    # A voted event is not a clock: its best is the public's to say.
    best = None if voted or not finishers else min(finishers, key=lambda r: (r["score"], r["n"]))["n"]
    return rows, best


def _started(record, run) -> str:
    return (record or {}).get("started") or (run.provenance.get("started") if run else None) or ""


def _job_url(live, record) -> str | None:
    """An HF job's page on the Hub, where its whole log is, once its id is known."""
    job_id = (live.job_id if live is not None else None) or (record or {}).get("job_id")
    if not record or record.get("where") != "hf-jobs" or not job_id:
        return None
    return f"https://huggingface.co/jobs/{record['namespace']}/{job_id}"


def _sources(ws, challenge) -> list[tuple]:
    """(id, live, record, run) for each training of `challenge`, newest first."""
    runs = find_runs(ws.root, challenge.task)  # newest first: the first of a name is its newest
    newest = {}
    for run in runs:
        newest.setdefault(run.name, run)
    found, claimed = [], set()
    for record in recorded_jobs(ws.root, challenge.task):
        run = newest.get(record["name"])
        if run is not None:
            claimed.add(run.id)
        found.append((record["name"], ws.trainings.get((challenge.task, record["name"])), record, run))
    found += [(run.id, None, None, run) for run in runs if run.id not in claimed]
    return sorted(found, key=lambda s: _started(s[2], s[3]), reverse=True)


def _ticket(source_, voted: bool) -> dict:
    ticket_id, live, record, run = source_
    total = _iterations(record, run)
    state = _state(live, record, run, total)
    rows, best = _checkpoints(run, voted)
    return {
        "id": ticket_id,
        "name": record["name"] if record else run.name,
        "where": record["where"] if record else None,
        "state": state,
        "progress": _progress(live, run, total, state),
        "started": _started(record, run),
        "run_id": run.id if run else None,
        "dirty": bool(run and run.provenance.get("dirty")),
        "checkpoints": rows,
        "best": best,
        "job_url": _job_url(live, record),
        "published": (published(run) or [None])[-1] if run else None,
    }


def _voted(challenge) -> bool:
    return load_event(challenge.event).metric == "votes"


def source(ws, challenge, ticket_id: str) -> tuple | None:
    """(id, live, record, run) of one ticket, or None."""
    return next((s for s in _sources(ws, challenge) if s[0] == ticket_id), None)


def tickets(ws, challenge) -> list[dict]:
    voted = _voted(challenge)
    return [_ticket(s, voted) for s in _sources(ws, challenge)]


def ticket(ws, challenge, ticket_id: str) -> dict | None:
    found = source(ws, challenge, ticket_id)
    return _ticket(found, _voted(challenge)) if found else None


def ticket_detail(ws, challenge, ticket_id: str, since: int = 0) -> dict | None:
    """The ticket with what its page adds: the log from `since`, the curve, what it was launched with."""
    found = source(ws, challenge, ticket_id)
    if found is None:
        return None
    _, live, record, run = found
    lines, following = live.log(since) if live is not None else ([], since)
    return {
        **_ticket(found, _voted(challenge)),
        "log": lines, "next": following, "following": live is not None,
        "curve": curve(run) if run else [],
        "commit": run.provenance.get("commit") if run else None,
        "code_url": code_url(ws.root, run.provenance.get("commit")) if run else None,
        "recipe": (record or {}).get("recipe"),
        "params": (record or {}).get("params"),
    }

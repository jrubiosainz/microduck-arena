"""Peter and Ray's lines, written at publish time.

context projects a run's own facts, notable digs the log for more, lore
offers a memory or two, the five most recent broadcasts give continuity, and
generator writes and checks. This module puts them together for one run and
shapes the file the store keeps beside the clip.
"""

import json

from huggingface_hub import get_token

from ..manifest import Manifest, all_events
from ..points import counting, receipts
from ..store import RunRecord
from .context import Fact, result_facts
from .generator import complete, write
from .lore import Lore, select_memories
from .notable import notable_facts, pick, situation

COMMENTARY_VERSION = 1
RECENT = 5
COOLDOWN = 10


def router_provider(model: str, token: str):
    """The Hugging Face router as the writer's provider."""
    return lambda messages, max_tokens: complete(messages, max_tokens, model=model, token=token)


def hub_token(config) -> str | None:
    """The Space's HF_TOKEN, or the developer's own Hub session locally."""
    return config.hf_token or get_token()


def open_events() -> dict[str, Manifest]:
    return {m.id: m for m in all_events() if m.status == "open"}


def find_run(store, run_id: str) -> RunRecord:
    for manifest in all_events():
        for record in store.runs(manifest.id):
            if record.run_id == run_id:
                return record
    raise LookupError(f"no such run: {run_id!r}")


def recent_commentaries(store, exclude: str | None, limit: int = RECENT) -> list[dict]:
    """The newest commentaries first, the run being written left out."""
    found = []
    for run_id in store.clips_ready():
        if run_id == exclude:
            continue
        body = store.commentary(run_id)
        if body:
            found.append(body)
    found.sort(key=lambda body: body["written_at"], reverse=True)
    return found[:limit]


def used_memories(store, exclude: str | None, cooldown: int = COOLDOWN) -> set[str]:
    return {ref for body in recent_commentaries(store, exclude, cooldown)
            for ref in body["dialogue"]["lore_refs"]}


def _recent_fact(body: dict) -> Fact:
    about = " ".join(f["text"] for f in body["facts"] if f["kind"] == "result")
    # The names that commentary established are the ones a callback may speak.
    names = tuple(word.lstrip("@").rstrip(".,;:!?")
                  for word in about.split() if word.startswith("@"))
    return Fact(f"recent:{body['run_id']}", f"Earlier this season: {about}", "recent",
                identities=tuple(dict.fromkeys(names)))


def gather(store, record: RunRecord, lore: Lore) -> tuple[list[Fact], list[dict]]:
    """Everything the writer may cite for this run, and the recent wording."""
    events = open_events()
    withdrawn = frozenset(w.run_id for w in store.withdrawals())
    all_runs = [r for m in all_events() for r in store.runs(m.id)]
    s = situation(record, all_runs, withdrawn, events)
    voted = {m.id: m.vote for m in events.values() if m.vote is not None}
    earned = receipts(counting(list(s.runs), frozenset()), frozenset(), voted=voted)
    facts = list(result_facts(record, s.manifest, s.on_event(), earned))
    facts += pick(notable_facts(s))
    used = used_memories(store, record.run_id)
    facts += [Fact(f"lore:{m.id}", m.memory, "lore", m.tags)
              for m in select_memories(lore, facts, used)]
    recent = recent_commentaries(store, record.run_id)
    facts += [_recent_fact(body) for body in recent]
    wording = [{"ref": f"recent:{body['run_id']}",
                "turns": [t["text"] for t in body["dialogue"]["turns"]]} for body in recent]
    return facts, wording


def compose(store, run_id: str, *, lore: Lore, provider, model: str) -> dict:
    """A checked dialogue for one run, or Rejected from the writer."""
    record = find_run(store, run_id)
    facts, recent = gather(store, record, lore)
    written = write(run_id, facts, recent, lore=lore, provider=provider, model=model)
    cited = {ref for turn in written["turns"] for ref in turn["fact_refs"]}
    return {
        "run_id": run_id, **written,
        "facts": [{"ref": f.ref, "kind": f.kind, "text": f.text} for f in facts
                  if f.kind == "result" or f.ref in cited],
    }


def commentary_json(written: dict, plan: dict, written_at: str) -> bytes:
    """The file beside the clip: the dialogue, the plan that plays it, the
    facts it was written from, and who wrote it."""
    if plan["duration_ms"] % 40:
        raise ValueError("a plan's duration must be a whole number of 40 ms frames")
    body = {
        "version": COMMENTARY_VERSION, "run_id": written["run_id"], "written_at": written_at,
        "model": written["model"], "usage": written["usage"], "facts": written["facts"],
        "dialogue": {"turns": written["turns"], "lore_refs": written["lore_refs"]},
        "plan": plan,
    }
    return json.dumps(body, indent=2, ensure_ascii=False).encode()

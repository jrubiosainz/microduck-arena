"""Peter and Ray's lines, written for one airing.

context projects a run's own facts, notable digs the log for more, lore offers a
memory or two, what went out lately keeps the memories from repeating and lends
a callback its one fact, and generator writes and checks. This module puts them
together for one run, at the moment the reserve needs it.
"""

from huggingface_hub import get_token

from ..manifest import Manifest, all_events
from ..points import counting, receipts
from ..store import RunRecord
from .context import Fact, result_facts
from .generator import AT_NAME, CALLBACK, NO_CALLBACK, complete, direction, write
from .lore import Lore, select_memories
from .notable import notable_facts, pick, profiles, situation

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


def recent_broadcasts(book, limit: int = RECENT) -> list:
    """The last dialogues that went out, newest last — the order they were heard."""
    return book.recent_aired(limit)


def used_memories(book, cooldown: int = COOLDOWN) -> set[str]:
    """Memories spent on the air lately, so the bible does not repeat itself."""
    return {ref for one in book.recent_aired(cooldown)
            for ref in one.dialogue["lore_refs"]}


# The board and the points sentences speak in the present tense of "this run"
# ("This run takes the lead of…", "This run earned…"): borrowed by a callback
# they would describe the wrong run, and no judge stands behind the claim any
# more. Only the event, the participant and the plain result travel.
CALLBACK_REFS = ("run#/event", "run#/participant", "run#/result")


def callback_fact(book, run_id: str) -> list[Fact]:
    """The one earlier run a callback may cite: the last one other than this
    run to air, and of it only the event, the participant and the result."""
    for one in reversed(recent_broadcasts(book)):
        if one.run_id != run_id:
            about = " ".join(fact["text"] for fact in one.dialogue["brief"]["facts"]
                             if fact["ref"] in CALLBACK_REFS)
            # The handles that text prints are the ones a callback may speak, read
            # with the writer's own pattern so "@alice's" yields the same identity.
            names = AT_NAME.findall(about)
            return [Fact(f"recent:{one.id}", f"Earlier this season: {about}", "recent",
                         identities=tuple(dict.fromkeys(names)))]
    return []


def gather(store, record: RunRecord, lore: Lore, book, callback: bool) -> list[Fact]:
    """Everything the writer may cite for this run.

    Read at the moment of writing, not at publish: the standings, the records
    and the memories are the ones true when Peter and Ray open their mouths.
    """
    events = open_events()
    withdrawn = frozenset(w.run_id for w in store.withdrawals())
    all_runs = [r for m in all_events() for r in store.runs(m.id)]
    s = situation(record, all_runs, withdrawn, events)
    voted = {m.id: m.vote for m in events.values() if m.vote is not None}
    earned = receipts(counting(list(s.runs), frozenset()), frozenset(), voted=voted)
    facts = list(result_facts(record, s.manifest, s.on_event(), earned))
    facts += pick(notable_facts(s)) + profiles(s, earned)
    used = used_memories(book)
    facts += [Fact(f"lore:{m.id}", m.memory, "lore", m.tags)
              for m in select_memories(lore, facts, used)]
    return facts + (callback_fact(book, record.run_id) if callback else [])


def briefing(store, run_id: str, *, lore: Lore, book) -> tuple[list[Fact], dict]:
    """What one dialogue is written from: the facts it may cite, the direction it drew."""
    record = find_run(store, run_id)
    drawn = direction(run_id)
    facts = gather(store, record, lore, book, callback=drawn["callback"] == CALLBACK)
    if facts[-1].kind != "recent":
        # A callback the book cannot serve is no callback, and the brief says so.
        drawn = {**drawn, "callback": NO_CALLBACK}
    return facts, drawn


def compose(store, run_id: str, *, lore: Lore, provider, model: str, book) -> dict:
    """A checked dialogue for one run with the brief it was written from, or Rejected."""
    facts, drawn = briefing(store, run_id, lore=lore, book=book)
    written = write(facts, drawn, lore=lore, provider=provider, model=model)
    return {
        "run_id": run_id, **written,
        "brief": {"facts": [{"ref": f.ref, "kind": f.kind, "text": f.text} for f in facts],
                  "direction": drawn, "model": written["model"]},
    }

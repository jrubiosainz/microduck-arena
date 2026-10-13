"""Who performs on a stage: every duck of a troupe, the policy it plays and the rig it stands on.

A troupe (arena/timeline.py) names each duck's policy: "self", the entered repo's own, or another
repo's, pinned to a commit and read by arena/hub_fetch.py. A cast is that troupe made playable and
recordable: one Performer per duck for the runner, and one entry per duck for `RunRecord.cast` —
whose policy it plays (a borrowed one credited to its author), its rig, where it starts on the stage
and how it is heard (arena.timeline.sound_of).

Each distinct policy is one Policy, shared by every duck that plays it: three copies of "self" run
one ONNX session, which keeps nothing from one call to the next.
"""

from collections.abc import Mapping
from dataclasses import dataclass

from .hub_fetch import FetchedPolicy, first_duck, hub_name
from .manifest import Manifest
from .policy import Policy, PolicyError, load_policy
from .runner import Performer
from .timeline import SELF, Duck, Troupe, constant_timeline, solo, sound_of


@dataclass(frozen=True)
class Cast:
    performers: tuple[Performer, ...]
    # RunRecord.cast, in duck order.
    record: tuple[dict, ...]


def borrowed_source(fetched: FetchedPolicy, policy: Policy) -> dict:
    """How a run credits a borrowed duck: the repo at its commit, the weights' sha256, the author (the
    repo's owner) and the policy's name. Credit only: votes and points are the entrant's."""
    return {
        "repo_id": fetched.repo_id,
        "filename": fetched.filename,
        "revision": fetched.revision,
        "url": fetched.url,
        "model_sha256": policy.sha256,
        "user": fetched.repo_id.split("/", 1)[0],
        # Capped as an entry's own name is: another author's text, on a shared board.
        "policy_name": hub_name(fetched)[:80],
    }


def load_borrowed(troupe: Troupe | None, references: Mapping[str, FetchedPolicy]) -> dict[str, tuple[FetchedPolicy, Policy]]:
    """Every borrowed policy loaded, once however many ducks play it, beside the repo it came from. A
    file that does not load is refused as a fetch is, naming the first duck that plays it. A stage
    entry without a timeline borrows nothing."""
    borrowed = {}
    for reference, fetched in references.items():
        try:
            borrowed[reference] = (fetched, load_policy(fetched.path))
        except PolicyError as exc:
            raise PolicyError(f"{first_duck(troupe, reference)}: {exc}") from exc
    return borrowed


def duck_record(policy, rig: str, duck: Duck) -> dict:
    """How a run keeps one duck: whose policy it plays (`policy`, as the caller credits it), its rig,
    where it starts and how it is heard."""
    return {"policy": policy, "rig": rig, "start": duck.start.to_dict(), "sound": sound_of(duck.timeline)}


def cast_of(event: Manifest, troupe: Troupe | None, star: Policy, rig: str | None,
            borrowed: Mapping[str, tuple[FetchedPolicy, Policy]]) -> Cast:
    """A stage entry's cast. `star` plays every "self" duck, on `rig` (its manifest's, or None for the
    event's); each borrowed duck plays its own loaded policy, on its manifest's rig or the event's.
    Without a troupe the entry plays alone at the centre: the event's own command, for its whole
    time limit."""
    troupe = troupe or solo(constant_timeline(event.command, event.time_limit_s))
    performers, record = [], []
    for duck in troupe.ducks:
        if duck.policy == SELF:
            policy, duck_rig, credit = star, rig or event.rig, SELF
        else:
            fetched, policy = borrowed[duck.policy]
            duck_rig, credit = fetched.rig or event.rig, borrowed_source(fetched, policy)
        performers.append(Performer(policy, duck_rig, duck.start, duck.timeline))
        record.append(duck_record(credit, duck_rig, duck))
    return Cast(tuple(performers), tuple(record))

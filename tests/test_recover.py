
from arena.constants import RUNNER_VERSION
from arena.recover import (
    Candidate,
    already_recorded,
    candidates,
    events_for,
    plan,
)
from tests.test_store import make_record


class Event:
    def __init__(self, id, rig):
        self.id, self.rig = id, rig


SPRINT = Event("sprint-2m", "legs")
HILL = Event("hill-climb-1m5", "legs")
ROLLER = Event("roller-sprint-2m", "rollers")
EVENTS = [SPRINT, HILL, ROLLER]


def arena_manifest(**over):
    base = {
        "name": "walk",
        "robot": {"model": "microduck", "control_hz": 50},
        "published_by": "microduck-arena",
    }
    base.update(over)
    return base


def listing(*pairs):
    return lambda: list(pairs)


def manifests(mapping):
    return lambda repo_id: mapping.get(repo_id)


def test_a_policy_this_arena_published_is_a_candidate():
    found = candidates(
        listing(("cdeplanne/microduck-walk", "rev1")),
        manifests({"cdeplanne/microduck-walk": arena_manifest()}),
    )
    assert found == [
        Candidate(
            repo_id="cdeplanne/microduck-walk",
            revision="rev1",
            user="cdeplanne",
            policy_name="walk",
            rig="legs",
            event_id=None,
        )
    ]


def test_someone_elses_tagged_policy_is_skipped_by_default():
    """Recovery restores what went through this Arena. Racing every tagged repo
    would enrol people who never asked to be on this board."""
    found = candidates(
        listing(("stranger/microduck-hop", "rev1")),
        manifests({"stranger/microduck-hop": arena_manifest(published_by=None)}),
    )
    assert found == []


def test_all_tagged_widens_it_to_the_whole_ecosystem():
    found = candidates(
        listing(("stranger/microduck-hop", "rev1")),
        manifests({"stranger/microduck-hop": arena_manifest(published_by=None)}),
        all_tagged=True,
    )
    assert [c.repo_id for c in found] == ["stranger/microduck-hop"]


def test_a_repo_with_no_manifest_is_skipped_not_guessed_at():
    found = candidates(listing(("a/b", "rev1")), manifests({}))
    assert found == []


def test_a_policy_for_a_machine_we_have_no_event_for_is_skipped():
    found = candidates(
        listing(("a/b", "rev1")),
        manifests({"a/b": arena_manifest(robot={"model": "some other robot"})}),
        all_tagged=True,
    )
    assert found == []


def test_the_rollers_model_string_maps_back_to_the_rollers_rig():
    """Community publishers write 'microduck passive rollers'; recovery must read it back."""
    found = candidates(
        listing(("a/microduck-skate", "rev1")),
        manifests({"a/microduck-skate": arena_manifest(robot={"model": "microduck passive rollers"})}),
    )
    assert found[0].rig == "rollers"


def test_a_nameless_manifest_falls_back_to_the_repo_slug():
    found = candidates(
        listing(("a/microduck-walk-rough", "rev1")),
        manifests({"a/microduck-walk-rough": arena_manifest(name="")}),
    )
    assert found[0].policy_name == "walk-rough"


def test_an_event_recorded_in_the_manifest_is_the_only_one_used():
    candidate = Candidate("a/b", "r", "a", "b", "legs", event_id="hill-climb-1m5")
    assert [e.id for e in events_for(candidate, EVENTS)] == ["hill-climb-1m5"]


def test_without_a_recorded_event_every_rig_matching_event_is_used():
    """The honest fallback for manifests written before the field existed: the
    alternative is discarding the entry, and a policy that can enter an event is
    a fairer guess than no entry at all."""
    candidate = Candidate("a/b", "r", "a", "b", "legs", event_id=None)
    assert [e.id for e in events_for(candidate, EVENTS)] == ["sprint-2m", "hill-climb-1m5"]

    roller = Candidate("a/c", "r", "a", "c", "rollers", event_id=None)
    assert [e.id for e in events_for(roller, EVENTS)] == ["roller-sprint-2m"]


def test_an_unknown_event_name_in_a_manifest_yields_nothing_rather_than_everything():
    candidate = Candidate("a/b", "r", "a", "b", "legs", event_id="no-such-event")
    assert events_for(candidate, EVENTS) == []


def hub_run(repo_id, revision, **over):
    fields = {
        "source": {"kind": "hub", "repo_id": repo_id, "revision": revision, "url": "u"},
        "runner_version": RUNNER_VERSION,
    }
    fields.update(over)
    return make_record(**fields)


def test_an_identical_repo_revision_is_already_recorded():
    assert already_recorded([hub_run("a/b", "rev1")], "a/b", "rev1") is True


def test_a_newer_revision_of_the_same_repo_is_not():
    """Republishing a policy is a new commit, and it deserves a fresh measurement."""
    assert already_recorded([hub_run("a/b", "rev1")], "a/b", "rev2") is False


def test_a_run_from_another_runner_version_does_not_count():
    """It was measured by different physics. Restoring on the strength of it
    would put an incomparable time back on the board."""
    stale = hub_run("a/b", "rev1", runner_version=RUNNER_VERSION - 1)
    assert already_recorded([stale], "a/b", "rev1") is False


def test_a_locally_uploaded_run_never_satisfies_a_hub_candidate():
    upload = make_record(source={"kind": "upload", "filename": "w.onnx"})
    assert already_recorded([upload], "a/b", "rev1") is False


def test_a_full_store_plans_no_work_at_all():
    """The property that makes running this at every boot cheap."""
    found = [Candidate("a/b", "rev1", "a", "b", "legs", event_id="sprint-2m")]
    stored = {"sprint-2m": [hub_run("a/b", "rev1")]}
    assert plan(found, EVENTS, lambda e: stored.get(e, [])) == []


def test_an_empty_store_plans_every_rig_matching_event():
    found = [Candidate("a/b", "rev1", "a", "b", "legs", event_id=None)]
    work = plan(found, EVENTS, lambda e: [])
    assert [(c.repo_id, ev.id) for c, ev in work] == [
        ("a/b", "sprint-2m"),
        ("a/b", "hill-climb-1m5"),
    ]


def test_a_partly_lost_store_plans_only_what_is_missing():
    found = [Candidate("a/b", "rev1", "a", "b", "legs", event_id=None)]
    stored = {"sprint-2m": [hub_run("a/b", "rev1")], "hill-climb-1m5": []}
    work = plan(found, EVENTS, lambda e: stored.get(e, []))
    assert [ev.id for _, ev in work] == ["hill-climb-1m5"]


def test_a_manifest_written_by_publish_maps_its_accessories_to_the_rig():
    """`uv run publish` says rollers as an accessory of the one "microduck" robot."""
    manifest = {"name": "skater", "robot": {"model": "microduck", "accessories": ["rollers"]}}
    found = candidates(lambda: [("alice/microduck-skater", "rev1")], lambda repo_id: manifest, all_tagged=True)
    assert [c.rig for c in found] == ["rollers"]


def test_recover_plays_a_stage_entry_with_its_timeline_at_the_listed_revision(tmp_path, monkeypatch):
    import pytest

    from arena.assets import ASSET_ROOT
    from arena.hub_fetch import FetchedPolicy
    from arena.manifest import load_event
    from arena.recover import recover
    from arena.store import LocalStore
    from arena.timeline import Timeline

    asked = []

    def fetch_policy(repo_id, revision=None, event=None):
        asked.append((repo_id, revision, event.id))
        return FetchedPolicy(
            repo_id=repo_id, filename="policy.onnx", revision=revision,
            path=ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx",
            url=f"https://huggingface.co/{repo_id}/resolve/{revision}/policy.onnx",
            timeline=Timeline(2.0, (0.0, 1.0), ((0.0,) * 13,) * 2, ((0.0, 1.0), (0.0, 0.0))),
            timeline_sha256="t" * 64,
        )

    monkeypatch.setattr("arena.hub_fetch.fetch_policy", fetch_policy)
    reader = (listing(("alice/talent", "rev7")),
              manifests({"alice/talent": arena_manifest(arena={"event": "got-a-talent"})}))
    [record] = recover(LocalStore(tmp_path), [load_event("got-a-talent")], reader=reader)
    assert asked == [("alice/talent", "rev7", "got-a-talent")]
    assert record.score == pytest.approx(2.0)
    assert record.sound == {"triggers": [[0.0, 0.0, 1.0], [1.0, 0.0, 0.0]]}
    assert (record.timeline_sha256, record.source["revision"]) == ("t" * 64, "rev7")

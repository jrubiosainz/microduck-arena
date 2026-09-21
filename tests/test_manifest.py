import dataclasses
import inspect

import pytest

from arena.manifest import EVENTS_DIR, ManifestError, all_events, load_event, load_manifest

# A well-formed manifest, as TOML sections. Tests override one entry to build a
# specific malformation, so each test names only what it is breaking.
GOOD = {
    "root": 'id="probe"\ntitle="Probe"\nrig="legs"\ncategory="race"\n'
            'time_limit_s=10.0\nmetric="mean_finish_time"\nseeds=[1]\n',
    "course": '[course]\nkind="lane"\nlength_m=1.0\nwidth_m=0.8\n'
              'wall_height_m=0.15\nslope_deg=0.0\n',
    "command": '[command]\nvel=[0.25,0,0]\nhead=[0,0,0,0]\nbody=[0,0,0,0,0,0]\n',
    "start": '[start]\nkeyframe="STAND"\nsettle_s=0.5\n'
             '[start.perturbation]\njoint_rad=0.01\nyaw_deg=2.0\n',
    "termination": '[termination]\nfall_gravity_z=-0.5\nfall_hold_s=0.3\n',
    "sweep": '[sweep]\nlo=0.2\nhi=0.4\nstep=0.1\nfinalists=1\n',
    "clip": "",
}


def write_manifest(tmp_path, **overrides):
    """Write a manifest that is well-formed except for the sections overridden."""
    sections = GOOD | overrides
    path = tmp_path / "probe.toml"
    path.write_text("".join(sections[key] for key in GOOD))
    return path


def test_sprint_loads():
    m = load_event("sprint-2m")
    assert m.id == "sprint-2m"
    assert m.rig == "legs"
    assert m.seeds == (1, 2, 3, 4, 5)
    assert m.course.length_m == 2.0
    assert m.time_limit_s == 50.0


def test_command_is_13_wide_with_velocity_first():
    m = load_event("sprint-2m")
    assert len(m.command) == 13
    assert m.command[:3] == (0.25, 0.0, 0.0)
    # head(4) and body(6) slots are zero-padded, as the runtime pads them.
    assert m.command[3:] == (0.0,) * 10


def test_a_manifest_is_hashable_and_compares_by_value():
    """frozen=True has to mean what it says.

    An ndarray command field would make this dataclass unhashable, make `==`
    return an elementwise array instead of a bool, and — worst — leave a loaded
    event mutable in place, so one stray write could corrupt the event for every
    later run in the same process.
    """
    a, b = load_event("sprint-2m"), load_event("sprint-2m")
    assert a == b
    assert len({a, b}) == 1


def test_every_shipped_event_loads():
    events = all_events()
    assert len(events) >= 1
    assert len({m.id for m in events}) == len(events), "duplicate event ids"


def test_shipped_events_span_more_than_one_rig():
    """The whole platform claim is that a new rig or course is data, not code.

    If every shipped event happened to share one rig, that claim would be
    untested by the fixture set itself — this guards against that regression.
    """
    rigs = {m.rig for m in all_events()}
    assert len(rigs) > 1


def test_unknown_event_is_an_error():
    with pytest.raises(ManifestError, match="no such event"):
        load_event("nope")


def test_the_probe_fixture_is_itself_valid(tmp_path):
    """Guards the helper: if the baseline were malformed, every test below would
    pass for the wrong reason."""
    assert load_manifest(write_manifest(tmp_path)).id == "probe"


def test_unknown_metric_is_rejected(tmp_path):
    path = write_manifest(
        tmp_path,
        root='id="probe"\ntitle="Probe"\nrig="legs"\ncategory="race"\ntime_limit_s=10.0\n'
             'metric="vibes"\nseeds=[1]\n',
    )
    with pytest.raises(ManifestError, match="unknown metric"):
        load_manifest(path)


def test_unknown_rig_is_rejected(tmp_path):
    path = write_manifest(
        tmp_path,
        root='id="probe"\ntitle="Probe"\nrig="hovercraft"\ncategory="race"\ntime_limit_s=10.0\n'
             'metric="mean_finish_time"\nseeds=[1]\n',
    )
    with pytest.raises(ManifestError, match="unknown rig"):
        load_manifest(path)


def test_command_width_is_validated(tmp_path):
    path = write_manifest(
        tmp_path,
        command='[command]\nvel=[0.25,0]\nhead=[0,0,0,0]\nbody=[0,0,0,0,0,0]\n',
    )
    with pytest.raises(ManifestError, match="vel must have 3"):
        load_manifest(path)


def test_empty_seeds_is_rejected(tmp_path):
    """An event with no seeds would score every entry as a mean of nothing."""
    path = write_manifest(
        tmp_path,
        root='id="probe"\ntitle="Probe"\nrig="legs"\ncategory="race"\ntime_limit_s=10.0\n'
             'metric="mean_finish_time"\nseeds=[]\n',
    )
    with pytest.raises(ManifestError, match="seeds must not be empty"):
        load_manifest(path)


def test_duplicate_seeds_are_rejected(tmp_path):
    """A repeated seed would run the same episode twice and weight it double."""
    path = write_manifest(
        tmp_path,
        root='id="probe"\ntitle="Probe"\nrig="legs"\ncategory="race"\ntime_limit_s=10.0\n'
             'metric="mean_finish_time"\nseeds=[1,1,2]\n',
    )
    with pytest.raises(ManifestError, match="duplicate seeds"):
        load_manifest(path)


def test_sweep_speeds_span_the_declared_range_inclusive():
    m = load_event("sprint-2m")
    speeds = m.sweep.speeds()
    assert speeds[0] == pytest.approx(m.sweep.lo)
    # The top of the range must be INCLUDED. Accumulating 0.05 twenty times from
    # 0.20 lands on 1.2000000000000002, so a bare `v <= hi` would silently drop
    # the fastest speed the event asked for.
    assert speeds[-1] == pytest.approx(m.sweep.hi)
    assert len(speeds) == 21
    assert speeds == tuple(sorted(set(speeds))), "speeds must be distinct and ascending"


def test_the_sweep_is_wide_enough_to_be_worth_running():
    """A one-point sweep would quietly restore the pinned-command behaviour.

    Except for an event ranked on votes: there, the sweep is deliberately one
    point, so every entrant is judged on the same commanded speed instead of
    the fastest one it can reach.
    """
    for m in all_events():
        if m.metric == "votes":
            continue
        speeds = m.sweep.speeds()
        assert len(speeds) >= 10, f"{m.id}: {len(speeds)} speeds is not a sweep"
        assert m.sweep.hi >= 2 * m.command[0], f"{m.id}: sweep tops out near the old pin"
        assert 1 <= m.sweep.finalists <= len(speeds)


def test_command_at_replaces_only_the_forward_speed():
    m = load_event("sprint-2m")
    swapped = m.command_at(0.85)
    assert swapped[0] == 0.85
    assert swapped[1:] == m.command[1:]
    assert len(swapped) == len(m.command)
    # The event itself is untouched: frozen has to survive a sweep of 21 calls.
    assert m.command[0] == 0.25


@pytest.mark.parametrize(
    "sweep,complaint",
    [
        ('[sweep]\nlo=0.2\nhi=0.4\nstep=0.0\nfinalists=1\n', "step"),
        ('[sweep]\nlo=0.2\nhi=0.4\nstep=-0.1\nfinalists=1\n', "step"),
        ('[sweep]\nlo=0.9\nhi=0.4\nstep=0.1\nfinalists=1\n', "hi"),
        ('[sweep]\nlo=0.2\nhi=0.4\nstep=0.1\nfinalists=0\n', "finalists"),
        ('[sweep]\nlo=0.2\nhi=0.4\nstep=0.1\n', "finalists"),
    ],
)
def test_a_malformed_sweep_is_rejected(tmp_path, sweep, complaint):
    """A sweep with no step would loop forever rather than fail, so this is
    validation with teeth and not a courtesy message."""
    with pytest.raises(ManifestError, match=complaint):
        load_manifest(write_manifest(tmp_path, sweep=sweep))


def test_a_missing_sweep_section_is_rejected(tmp_path):
    path = tmp_path / "probe.toml"
    path.write_text("".join(
        GOOD[key] for key in GOOD if key != "sweep"
    ))
    with pytest.raises(ManifestError, match="sweep"):
        load_manifest(path)


def test_every_event_declares_a_status_and_the_shipped_ones_are_valid():
    from arena.manifest import STATUSES

    for m in all_events():
        assert m.status in STATUSES, f"{m.id}: {m.status!r}"


def test_the_open_events_are_the_three_originals_and_the_swag_contest():
    assert {m.id for m in all_events() if m.status == "open"} == {
        "sprint-2m",
        "roller-sprint-2m",
        "hill-climb-1m5",
        "swag-contest",
    }


def test_the_four_new_ones_are_planned_rather_than_racing_a_borrowed_course():
    """They copy the sprint's physics so they can exist on the programme. Open
    would mean a time recorded under one of their names is a sprint time."""
    assert {m.id for m in all_events() if m.status == "planned"} == {
        "highest-jump",
        "roller-slide",
        "rough-ground",
        "hold-your-ground",
    }


# The programme as designed on 2026-09-16. Written out rather than derived, so
# that adding an event fails this test until someone chooses its category on
# purpose — which is the whole reason the field is required.
EXPECTED_CATEGORIES = {
    "sprint-2m": "race",
    "roller-sprint-2m": "race",
    "hill-climb-1m5": "race",
    "roller-slide": "race",
    "highest-jump": "challenge",
    "hold-your-ground": "challenge",
    "rough-ground": "challenge",
    "swag-contest": "showcase",
}


def test_the_programme_is_categorised_as_designed():
    assert {m.id: m.category for m in all_events()} == EXPECTED_CATEGORIES


def test_an_unknown_category_is_refused(tmp_path):
    path = write_manifest(tmp_path, root=GOOD["root"].replace('category="race"', 'category="sprint"'))
    with pytest.raises(ManifestError, match="unknown category"):
        load_manifest(path)


def test_a_missing_category_is_refused(tmp_path):
    """No default: `status` and `order` have a safe one, `category` does not.
    Defaulting to "race" is exactly the bug this field exists to fix."""
    path = write_manifest(tmp_path, root=GOOD["root"].replace('category="race"\n', ""))
    with pytest.raises(ManifestError, match="missing 'category'"):
        load_manifest(path)


def test_a_missing_status_defaults_to_open(tmp_path):
    """Every manifest written before this field existed is a real event."""
    assert load_manifest(write_manifest(tmp_path)).status == "open"


def test_an_unknown_status_is_rejected(tmp_path):
    with pytest.raises(ManifestError, match="status"):
        load_manifest(write_manifest(tmp_path, root=GOOD["root"] + 'status="someday"\n'))


def test_the_programme_has_a_declared_order_with_the_sprint_first():
    """Declared, not derived: neither alphabetical nor filesystem order is the
    order a person wants to read a race card in."""
    programme = sorted(all_events(), key=lambda m: (m.order, m.title))
    assert [m.id for m in programme[:4]] == [
        "sprint-2m",
        "swag-contest",
        "roller-sprint-2m",
        "hill-climb-1m5",
    ]
    # Everything raceable comes before everything that is not.
    statuses = [m.status for m in programme]
    assert statuses == sorted(statuses, key=lambda s: s != "open")


def test_an_event_without_an_order_sorts_last_rather_than_first():
    """A new manifest that forgets the field must not jump the queue."""
    m = load_manifest(write_manifest(tmp_path_for_order()))
    assert m.order == 100


def tmp_path_for_order():
    import tempfile
    from pathlib import Path

    return Path(tempfile.mkdtemp())


def test_an_event_without_a_vote_section_has_no_vote_rules():
    assert load_event("sprint-2m").vote is None


def test_the_swag_contest_declares_its_ballot_and_its_window():
    vote = load_event("swag-contest").vote
    assert (vote.ballot_min, vote.ballot_max) == (2, 4)
    assert (vote.window_days, vote.per_day) == (7, 20)


def test_the_swag_contest_races_the_sprints_environment_at_one_pinned_speed():
    swag, sprint = load_event("swag-contest"), load_event("sprint-2m")
    assert swag.course == sprint.course
    assert swag.command == sprint.command
    assert swag.start == sprint.start
    assert swag.termination == sprint.termination
    assert swag.seeds == sprint.seeds
    # lo == hi: everyone walks at the same commanded speed, so the judgement
    # lands on style and not on who was asked to go faster.
    assert swag.sweep.speeds() == (0.25,)
    assert swag.metric == "votes"


def test_a_vote_section_is_validated_loudly(tmp_path):
    base = (EVENTS_DIR / "swag-contest.toml").read_text()
    for bad, message in [
        ("ballot_min  = 1", "ballot_min"),
        ("ballot_max  = 1", "ballot_max"),
        ("window_days = 0", "window_days"),
        ("per_day     = 0", "per_day"),
    ]:
        key = bad.split()[0]
        broken = "\n".join(
            bad if line.startswith(key) else line for line in base.splitlines()
        )
        path = tmp_path / "broken.toml"
        path.write_text(broken)
        with pytest.raises(ManifestError, match=message):
            load_manifest(path)


def test_ballot_max_cannot_outgrow_the_voting_page_s_colour_palette(tmp_path):
    """The voting page has exactly 5 lane colours (LANE_CSS in course.js). A
    ballot_max above that would put two lanes in the same colour, which is
    unvotable in a feature whose whole premise is "pick a colour"."""
    base = (EVENTS_DIR / "swag-contest.toml").read_text()
    broken = "\n".join(
        "ballot_max  = 6" if line.startswith("ballot_max") else line
        for line in base.splitlines()
    )
    path = tmp_path / "broken.toml"
    path.write_text(broken)
    with pytest.raises(ManifestError, match="ballot_max"):
        load_manifest(path)


def test_ranking_on_votes_without_a_vote_section_is_refused(tmp_path):
    base = (EVENTS_DIR / "sprint-2m.toml").read_text()
    path = tmp_path / "no-rules.toml"
    path.write_text(base.replace('metric       = "mean_finish_time"', 'metric       = "votes"'))
    with pytest.raises(ManifestError, match="votes"):
        load_manifest(path)


def test_a_vote_section_without_metric_votes_is_refused(tmp_path):
    """`[vote]` and `metric = "votes"` imply each other, in both directions.

    Without this direction, adding `[vote]` to a timed event's manifest alone
    would leave `routes_read._voted()` (keyed on `[vote]`) treating it as
    voted while `event_leaderboard` (keyed on `metric`) kept ranking it on
    time — the two readings would diverge silently.
    """
    base = (EVENTS_DIR / "swag-contest.toml").read_text()
    path = tmp_path / "vote-without-metric.toml"
    path.write_text(base.replace('metric       = "votes"', 'metric       = "mean_finish_time"'))
    with pytest.raises(ManifestError, match="vote"):
        load_manifest(path)


def test_every_shipped_events_metric_has_a_scoring_function():
    """`manifest.py` validates which metric NAMES an event may declare;
    `evaluate.py` holds a second registry mapping that name to the function
    that computes a run's score. A manifest naming a metric with no entry
    there is unreachable — `evaluate()` and `evaluate_at()` both raise
    `KeyError` the instant anyone enters it — and nothing else catches this,
    because every other test fabricates RunRecords directly rather than
    running `evaluate()` against a real manifest.
    """
    from arena.evaluate import METRICS as SCORERS

    for m in all_events():
        assert m.metric in SCORERS, f"{m.id}: no evaluate.METRICS entry for {m.metric!r}"


def test_category_never_reaches_scoring_storage_or_the_run_record():
    """`category` is display-only: which wall a flyer hangs on, nothing more.

    It must never influence how a run is scored, how it is stored, how points
    are folded, or what a RunRecord carries — a scoring rule that read it
    would let event authors game the board by relabelling an event, and a
    stored field would be a second place category could drift from the
    manifest. This was checked by hand with grep during review; nothing kept
    it checked, so it is cheap for a category to sneak back in unnoticed.
    """
    from arena import evaluate, points, store

    for module in (evaluate, points, store):
        src = inspect.getsource(module)
        assert "category" not in src.lower(), f"'category' appears in {module.__name__}"

    field_names = {f.name for f in dataclasses.fields(store.RunRecord)}
    assert "category" not in field_names, "RunRecord carries a 'category' field"


def test_an_event_without_a_clip_section_gets_the_defaults():
    clip = load_event("sprint-2m").clip
    assert clip.tape_max_s == 12.0
    assert clip.sounds == ("crowd", "horn", "verdict")
    assert clip.camera.kind == "chase"
    assert clip.camera.side is None
    assert clip.to_dict() == {
        "tape_max_s": 12.0,
        "sounds": ["crowd", "horn", "verdict"],
        "camera": {"kind": "chase", "back": 0.35, "height": 0.34, "side": None,
                   "target_height": 0.12, "fov": 42.0},
    }


def test_a_clip_section_pins_the_tape_a_fixed_camera_and_the_sounds(tmp_path):
    path = write_manifest(
        tmp_path,
        clip='[clip]\ntape_max_s=6.0\nsounds=["crowd"]\n'
             '[clip.camera]\nkind="fixed"\nposition=[1.0,0.6,2.2]\ntarget=[1.0,0.1,0.0]\nfov=40\n',
    )
    clip = load_manifest(path).clip
    assert clip.tape_max_s == 6.0
    assert clip.sounds == ("crowd",)
    assert clip.camera.to_dict() == {
        "kind": "fixed", "position": [1.0, 0.6, 2.2], "target": [1.0, 0.1, 0.0], "fov": 40.0
    }


@pytest.mark.parametrize(
    "section, said",
    [
        ('[clip]\nsounds=["crowd","organ"]\n', "unknown sound source"),
        ('[clip]\ntape_max_s=0\n', "tape_max_s must be positive"),
        ('[clip]\nfoo=1\n', "unknown keys"),
        ('[clip]\n[clip.camera]\nkind="drone"\n', "unknown camera kind"),
        ('[clip]\n[clip.camera]\nkind="fixed"\nfov=40\n', "needs position and target"),
        ('[clip]\n[clip.camera]\nkind="chase"\nposition=[0,0,0]\n', "unknown keys"),
    ],
)
def test_a_malformed_clip_section_is_refused(tmp_path, section, said):
    with pytest.raises(ManifestError, match=said):
        load_manifest(write_manifest(tmp_path, clip=section))

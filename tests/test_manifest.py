import pytest

from arena.manifest import ManifestError, all_events, load_event, load_manifest

# A well-formed manifest, as TOML sections. Tests override one entry to build a
# specific malformation, so each test names only what it is breaking.
GOOD = {
    "root": 'id="probe"\ntitle="Probe"\nrig="legs"\ntime_limit_s=10.0\n'
            'metric="mean_finish_time"\nseeds=[1]\n',
    "course": '[course]\nkind="lane"\nlength_m=1.0\nwidth_m=0.8\n'
              'wall_height_m=0.15\nslope_deg=0.0\n',
    "command": '[command]\nvel=[0.25,0,0]\nhead=[0,0,0,0]\nbody=[0,0,0,0,0,0]\n',
    "start": '[start]\nkeyframe="STAND"\nsettle_s=0.5\n'
             '[start.perturbation]\njoint_rad=0.01\nyaw_deg=2.0\n',
    "termination": '[termination]\nfall_gravity_z=-0.5\nfall_hold_s=0.3\n',
    "sweep": '[sweep]\nlo=0.2\nhi=0.4\nstep=0.1\nfinalists=1\n',
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
        root='id="probe"\ntitle="Probe"\nrig="legs"\ntime_limit_s=10.0\n'
             'metric="vibes"\nseeds=[1]\n',
    )
    with pytest.raises(ManifestError, match="unknown metric"):
        load_manifest(path)


def test_unknown_rig_is_rejected(tmp_path):
    path = write_manifest(
        tmp_path,
        root='id="probe"\ntitle="Probe"\nrig="hovercraft"\ntime_limit_s=10.0\n'
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
        root='id="probe"\ntitle="Probe"\nrig="legs"\ntime_limit_s=10.0\n'
             'metric="mean_finish_time"\nseeds=[]\n',
    )
    with pytest.raises(ManifestError, match="seeds must not be empty"):
        load_manifest(path)


def test_duplicate_seeds_are_rejected(tmp_path):
    """A repeated seed would run the same episode twice and weight it double."""
    path = write_manifest(
        tmp_path,
        root='id="probe"\ntitle="Probe"\nrig="legs"\ntime_limit_s=10.0\n'
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
    """A one-point sweep would quietly restore the pinned-command behaviour."""
    for m in all_events():
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

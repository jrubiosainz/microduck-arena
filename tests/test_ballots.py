import pytest

from arena.store import Ballot, LocalBallots, new_id


def make_ballot(**overrides) -> Ballot:
    fields = {
        "ballot_id": new_id(),
        "event_id": "swag-contest",
        "voter": "coralie",
        "cast_at": "2026-09-15T10:00:00Z",
        "candidates": ("run-a", "run-b", "run-c"),
        "choice": "run-b",
    }
    fields.update(overrides)
    return Ballot(**fields)


def test_a_ballot_round_trips_through_its_dict():
    ballot = make_ballot()
    assert Ballot.from_dict(ballot.to_dict()) == ballot


def test_a_ballot_is_filed_under_the_day_it_was_cast():
    assert make_ballot(cast_at="2026-09-15T23:59:59Z").day == "2026-09-15"


def test_casting_writes_one_file_that_reads_back(tmp_path):
    ballots = LocalBallots(tmp_path)
    one = make_ballot(cast_at="2026-09-15T10:00:00Z")
    two = make_ballot(cast_at="2026-09-16T10:00:00Z")
    ballots.cast(one)
    ballots.cast(two)
    assert ballots.since("2026-09-01") == [one, two]


def test_since_ignores_days_before_the_window(tmp_path):
    ballots = LocalBallots(tmp_path)
    old = make_ballot(cast_at="2026-09-01T10:00:00Z")
    recent = make_ballot(cast_at="2026-09-15T10:00:00Z")
    ballots.cast(old)
    ballots.cast(recent)
    assert ballots.since("2026-09-10") == [recent]


def test_an_empty_store_has_no_ballots(tmp_path):
    assert LocalBallots(tmp_path).since("2026-09-01") == []


def test_casting_the_same_ballot_twice_is_refused(tmp_path):
    """The id is the seal's own MAC, so a double-click addresses the same file.
    The route turns this refusal into an idempotent success."""
    ballots = LocalBallots(tmp_path)
    ballot = make_ballot()
    ballots.cast(ballot)
    with pytest.raises(FileExistsError):
        ballots.cast(ballot)

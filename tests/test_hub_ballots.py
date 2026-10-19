import json
import shutil
from datetime import UTC, datetime, timedelta
from fnmatch import fnmatch

import pytest

from arena.store import BallotLogStuck, HubBallots, days_from
from tests.test_ballots import make_ballot


def day(back: int) -> str:
    return (datetime.now(UTC).date() - timedelta(days=back)).isoformat()


class FakeHub:
    """The dataset as a folder: downloads copy from it, commits are recorded, and a commit can be
    made to fail a number of times first."""

    def __init__(self, remote, local, failures=0):
        self.remote, self.local, self.failures = remote, local, failures
        self.downloads: list[list[str]] = []
        self.commits: list[tuple[str, str, dict]] = []

    def snapshot_download(self, repo_id, repo_type, allow_patterns):
        self.downloads.append(list(allow_patterns))
        out = self.local / f"download-{len(self.downloads)}"
        out.mkdir()
        for path in self.remote.rglob("*.json"):
            name = path.relative_to(self.remote).as_posix()
            if any(fnmatch(name, pattern) for pattern in allow_patterns):
                (out / name).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy(path, out / name)
        return str(out)

    def create_commit(self, repo_id, repo_type, commit_message, operations):
        if self.failures:
            self.failures -= 1
            raise ConnectionError("the Hub is away")
        for op in operations:
            self.commits.append((op.path_in_repo, commit_message, json.loads(op.path_or_fileobj)))


@pytest.fixture
def remote(tmp_path):
    root = tmp_path / "remote"
    root.mkdir()
    return root


def on_hub(remote, ballot):
    path = remote / "votes" / ballot.day / f"{ballot.ballot_id}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(ballot.to_dict()))


def hub_ballots(tmp_path, remote, **options):
    hub = FakeHub(remote, tmp_path, failures=options.pop("failures", 0))
    return HubBallots("org/runs", api=hub, retry_s=options.pop("retry_s", 0), **options), hub


def test_since_reads_the_hub_once_then_answers_from_memory(tmp_path, remote):
    old = make_ballot(cast_at=f"{day(6)}T10:00:00Z")
    recent = make_ballot(cast_at=f"{day(1)}T10:00:00Z")
    on_hub(remote, old)
    on_hub(remote, recent)
    ballots, hub = hub_ballots(tmp_path, remote)
    assert ballots.since(day(6)) == [old, recent]
    assert ballots.since(day(6)) == [old, recent]
    assert hub.downloads == [[f"votes/{d}/*" for d in days_from(day(6), day(0))]]


def test_an_earlier_first_day_loads_only_the_days_missing(tmp_path, remote):
    oldest = make_ballot(cast_at=f"{day(6)}T10:00:00Z")
    on_hub(remote, oldest)
    ballots, hub = hub_ballots(tmp_path, remote)
    assert ballots.since(day(4)) == []
    assert ballots.since(day(6)) == [oldest]
    assert hub.downloads[1] == [f"votes/{day(6)}/*", f"votes/{day(5)}/*"]


def test_a_cast_is_counted_at_once_and_committed_by_the_writer(tmp_path, remote):
    ballots, hub = hub_ballots(tmp_path, remote)
    ballot = make_ballot(cast_at=f"{day(0)}T10:00:00Z")
    ballots.since(day(6))
    ballots.cast(ballot)
    assert ballots.since(day(6)) == [ballot]
    ballots.flush(5)
    assert hub.commits == [(
        f"votes/{ballot.day}/{ballot.ballot_id}.json",
        f"{ballot.event_id}: {ballot.voter} voted",
        ballot.to_dict(),
    )]


def test_a_failed_commit_is_retried_until_it_lands_in_order(tmp_path, remote):
    ballots, hub = hub_ballots(tmp_path, remote, failures=2)
    first = make_ballot(cast_at=f"{day(0)}T10:00:00Z")
    second = make_ballot(cast_at=f"{day(0)}T10:01:00Z")
    ballots.cast(first)
    ballots.cast(second)
    ballots.flush(5)
    assert [path for path, _, _ in hub.commits] == [
        f"votes/{first.day}/{first.ballot_id}.json", f"votes/{second.day}/{second.ballot_id}.json",
    ]


def test_casting_a_ballot_twice_is_refused(tmp_path, remote):
    ballots, _ = hub_ballots(tmp_path, remote)
    ballot = make_ballot(cast_at=f"{day(0)}T10:00:00Z")
    ballots.cast(ballot)
    with pytest.raises(FileExistsError):
        ballots.cast(ballot)


def test_a_writer_stuck_on_the_hub_refuses_the_next_vote(tmp_path, remote):
    # A minute between tries, so the writer fails once and then sleeps through the test.
    ballots, _ = hub_ballots(tmp_path, remote, failures=10**6, retry_s=60, stuck_after_s=0)
    first = make_ballot(cast_at=f"{day(0)}T10:00:00Z")
    second = make_ballot(cast_at=f"{day(0)}T10:01:00Z")
    ballots.cast(first)
    with pytest.raises(BallotLogStuck):
        ballots.cast(second)
    assert second not in ballots.since(day(6))

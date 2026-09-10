from arena.constants import RUNNER_VERSION
from arena.index import by_policy, by_user, leaderboard
from tests.test_store import make_record


def test_ranks_ascend_by_score():
    rows = leaderboard([
        make_record(user="slow", score=30.0),
        make_record(user="fast", score=20.0),
        make_record(user="mid", score=25.0),
    ])
    assert [r.record.user for r in rows] == ["fast", "mid", "slow"]
    assert [r.rank for r in rows] == [1, 2, 3]


def test_only_the_best_run_per_user_appears():
    rows = leaderboard([
        make_record(user="alice", score=30.0),
        make_record(user="alice", score=22.0),
        make_record(user="alice", score=27.0),
        make_record(user="bob", score=25.0),
    ])
    assert [(r.record.user, r.record.score) for r in rows] == [("alice", 22.0), ("bob", 25.0)]


def test_a_tie_breaks_on_seeds_finished():
    rows = leaderboard([
        make_record(user="flaky", score=20.0, seeds_finished=3),
        make_record(user="steady", score=20.0, seeds_finished=5),
    ])
    assert [r.record.user for r in rows] == ["steady", "flaky"]


def test_a_full_tie_breaks_on_earliest_submission():
    rows = leaderboard([
        make_record(user="later", score=20.0, seeds_finished=5,
                    submitted_at="2026-09-03T12:00:00Z"),
        make_record(user="earlier", score=20.0, seeds_finished=5,
                    submitted_at="2026-09-03T09:00:00Z"),
    ])
    assert [r.record.user for r in rows] == ["earlier", "later"]


def test_runs_from_another_runner_version_are_excluded():
    rows = leaderboard(
        [
            make_record(user="current", score=30.0, runner_version=RUNNER_VERSION),
            # Offset from the real version rather than a literal, so this can
            # never accidentally BE the current version after a bump — which
            # would leave the test asserting nothing.
            make_record(user="stale", score=10.0, runner_version=RUNNER_VERSION - 1),
        ],
        runner_version=RUNNER_VERSION,
    )
    assert [r.record.user for r in rows] == ["current"]


def test_an_empty_log_is_an_empty_board():
    assert leaderboard([]) == []


def test_a_dnf_entry_still_ranks_last_rather_than_vanishing():
    rows = leaderboard([
        make_record(user="finisher", score=20.0, seeds_finished=5),
        make_record(user="faller", score=45.0, seeds_finished=0),
    ])
    assert [r.record.user for r in rows] == ["finisher", "faller"]
    assert rows[-1].record.seeds_finished == 0


def test_by_user_collapses_a_persons_policies_into_one_row():
    """The public rule: one determined competitor cannot own the top ten."""
    rows = leaderboard(
        [
            make_record(user="alice", policy_name="v1", score=22.0),
            make_record(user="alice", policy_name="v2", score=19.0),
        ],
        entrant=by_user,
    )
    assert [r.record.policy_name for r in rows] == ["v2"]


def test_by_policy_lets_one_persons_policies_race_each_other():
    """The local rule.

    With a single signed-in user, ranking per person leaves one row no matter
    how many policies are tried — which makes the head-to-head replay, the whole
    point of running locally, impossible to use.
    """
    rows = leaderboard(
        [
            make_record(user="alice", policy_name="v1", score=22.0),
            make_record(user="alice", policy_name="v2", score=19.0),
        ],
        entrant=by_policy,
    )
    assert [r.record.policy_name for r in rows] == ["v2", "v1"]
    assert [r.rank for r in rows] == [1, 2]


def test_by_policy_still_keeps_only_the_best_run_of_each_policy():
    """Retrying a policy should improve its row, not add another."""
    rows = leaderboard(
        [
            make_record(user="alice", policy_name="v1", score=25.0),
            make_record(user="alice", policy_name="v1", score=20.0),
            make_record(user="alice", policy_name="v2", score=30.0),
        ],
        entrant=by_policy,
    )
    assert [(r.record.policy_name, r.record.score) for r in rows] == [("v1", 20.0), ("v2", 30.0)]


def test_by_policy_keeps_two_people_apart_even_with_the_same_policy_name():
    """The key is (person, policy) — two people entering "walker" are distinct."""
    rows = leaderboard(
        [
            make_record(user="alice", policy_name="walker", score=19.0),
            make_record(user="bob", policy_name="walker", score=21.0),
        ],
        entrant=by_policy,
    )
    assert [r.record.user for r in rows] == ["alice", "bob"]


def test_the_default_entrant_is_the_public_rule():
    """Unless a caller asks otherwise, the safe multi-user semantics apply."""
    rows = leaderboard(
        [
            make_record(user="alice", policy_name="v1", score=22.0),
            make_record(user="alice", policy_name="v2", score=19.0),
        ]
    )
    assert len(rows) == 1

"""Facts are sentences with references; nothing invented, nothing technical."""

from arena.commentary.context import label, nature, result_facts, technical_text
from arena.evaluate import SeedResult
from arena.manifest import load_event
from arena.points import Receipt
from tests.test_store import make_record


def seeds(finished, total=5, status="fall"):
    return tuple(
        SeedResult(seed=i + 1, status="finish" if i < finished else status,
                   time_s=12.0 if i < finished else None)
        for i in range(total)
    )


def run(user, score, at, finished=5, event="sprint-2m", run_id=None, **more):
    fields = {"user": user, "score": score, "submitted_at": at, "seeds_finished": finished,
              "per_seed": seeds(finished), "event_id": event, "policy_name": f"{user}-v1"}
    if run_id:
        fields["run_id"] = run_id
    fields.update(more)
    return make_record(**fields)


def test_technical_text_catches_paths_ids_and_filenames_but_not_prose():
    assert technical_text("see clips/01M2/landscape.mp4")
    assert technical_text("run 01a2b3c4d5e6f7a8b9")
    assert technical_text("the sprint_2m event")
    assert not technical_text("a 12.40 s sprint, every seed finished")
    assert label("walker-v3") and not label("<b>walker</b>") and not label("x" * 81)
    # Machine-shaped: a fact quoting it would have every turn that spoke it refused.
    assert not label("walker_v3")


def test_nature_reads_the_manifest():
    assert nature(load_event("sprint-2m")) == ("a 2 m sprint on foot", ("sprint",))
    assert nature(load_event("hill-climb-1m5")) == ("a 1.5 m climb up an 8 degree slope", ("hill",))
    assert nature(load_event("roller-sprint-2m")) == ("a 2 m race on roller skates", ("rollers",))
    assert nature(load_event("swag-contest")) == ("a contest decided by the public's votes", ("vote",))


def test_a_clean_run_states_event_participant_time_rank_gap_and_points():
    manifest = load_event("sprint-2m")
    leader = run("carol", 11.20, "2026-09-10T10:00:00Z", run_id="R0")
    mine = run("alice", 12.40, "2026-09-11T10:00:00Z", run_id="R1")
    receipts = [Receipt("alice", "first_event", 100, "sprint-2m", "R1", mine.submitted_at),
                Receipt("alice", "run", 10, "sprint-2m", "R1", mine.submitted_at),
                Receipt("carol", "podium", 250, "sprint-2m", "R0", leader.submitted_at)]
    facts = result_facts(mine, manifest, [leader, mine], receipts)
    by_ref = {f.ref: f for f in facts}
    assert by_ref["run#/event"].text == "The event is the 2 m Sprint, a 2 m sprint on foot."
    assert by_ref["run#/event"].tags == ("sprint",)
    participant = by_ref["run#/participant"]
    assert participant.text == "The participant is @alice, racing a policy named alice-v1."
    assert participant.identities == ("alice",)
    assert by_ref["run#/result"].text == "The mean finish time is 12.40 s, every one of the 5 seeds finished."
    assert by_ref["run#/result"].tags == ("clean",) and by_ref["run#/result"].outcome is None
    board = by_ref["run#/board"]
    assert board.text == "On the 2 m Sprint board this run ranks 2 of 2, 1.20 s behind the leader, @carol."
    assert board.identities == ("carol",) and "podium" in board.tags
    points = by_ref["run#/points"]
    assert points.text == "This run earned 110 points: a first run on this event (100), a run of the day (10)."
    assert points.tags == ("first-run",)
    assert all(f.kind == "result" for f in facts)


def test_a_fall_is_an_outcome_and_a_lead_is_said_as_such():
    manifest = load_event("hill-climb-1m5")
    fell = run("bob", 32.0, "2026-09-11T10:00:00Z", finished=3, event="hill-climb-1m5", run_id="R2")
    facts = {f.ref: f for f in result_facts(fell, manifest, [fell], [])}
    assert facts["run#/result"].text == (
        "The mean finish time is 32.00 s, with 3 of 5 seeds finished; an unfinished seed "
        "counts as the 60 s limit, and the duck fell on 2 of them."
    )
    assert facts["run#/result"].outcome == "fell" and facts["run#/result"].tags == ("fall",)
    assert facts["run#/board"].text == "This run opens the 1.5 m Hill Climb board: nobody else has published on it."
    assert "open-board" in facts["run#/board"].tags
    assert "run#/points" not in facts


def test_a_dnf_by_timeout_is_not_a_fall_and_a_voted_event_has_no_board():
    sprint = load_event("sprint-2m")
    timed_out = make_record(user="dan", score=50.0, seeds_finished=0, per_seed=seeds(0, status="timeout"),
                            submitted_at="2026-09-11T10:00:00Z", policy_name="<script>")
    facts = {f.ref: f for f in result_facts(timed_out, sprint, [timed_out], [])}
    assert facts["run#/result"].text == "@dan did not finish: none of the 5 seeds reached the line."
    assert facts["run#/result"].outcome == "dnf"
    # A policy name that is not a label is left out, never quoted.
    assert facts["run#/participant"].text == "The participant is @dan."
    swag = load_event("swag-contest")
    voted = run("eve", 20.0, "2026-09-11T10:00:00Z", event="swag-contest")
    refs = [f.ref for f in result_facts(voted, swag, [voted], [])]
    assert "run#/board" not in refs

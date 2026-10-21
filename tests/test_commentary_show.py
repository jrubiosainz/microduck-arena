"""A cup's show written ahead; only the router and the plan page are faked."""

import json
import random
import re
from dataclasses import replace

import httpx
import numpy as np
import pytest

from arena.commentary.context import Fact
from arena.commentary.cup import cup_facts, screen_view
from arena.commentary.generator import Rejected, directed
from arena.commentary.lore import load
from arena.commentary.show import (
    DESK_ANGLES,
    DESK_HANDLES,
    DESK_NUMBERS,
    DESK_PLAYERS,
    TRIES,
    compose_show,
    match_footage,
    show_outline,
    thin,
    write_show,
)
from arena.course import string_offset
from arena.match import BoutResult
from arena.moments import Moment, moments
from arena.store import LocalStore
from arena.trace import decode, encode
from tests.show_cups import MANIFEST, played_cup
from tests.test_commentary_generator import reply
from tests.test_moments import dragged

CUP = played_cup()
IDS = [match.match_id for match in CUP.matches]
LORE = load()
PROFILES = {e.user: Fact(f"profile#/{e.user}", f"@{e.user} has a season.", "notable", ("profile",))
            for e in CUP.entrants}
STEPS = (Moment(0.0, "start", None), Moment(4.0, "lead", "west"), Moment(8.0, "pit", "east"))
DESK = [{"speaker": speaker, "text": f"Desk line {i}.", "fact_refs": [0]}
        for i, speaker in enumerate(("peter", "ray", "peter"))]


def footage(cup):
    return {m.match_id: {"duration_ms": 30000, "bouts": [
        {"k": bout.k, "tape_start_s": 2.0 + 9 * bout.k, "tape_end_s": 10.0 + 9 * bout.k,
         "seconds": 8.0, "moments": list(STEPS)} for bout in m.bouts]} for m in cup.matches}


FOOTAGE = footage(CUP)


class Router:
    """A desk prompt gets three turns citing fact 0; a call, one line per moment from the speaker
    the prompt names first, in turn. The asks numbered in `refused` get an answer that is no JSON."""

    def __init__(self, down_at=None, refused=()):
        self.down_at = down_at
        self.refused = refused
        self.asked = []

    def __call__(self, messages, max_tokens):
        self.asked.append(messages)
        if len(self.asked) == self.down_at:
            raise httpx.ConnectError("router down")
        if len(self.asked) in self.refused:
            return reply(None, content="not json")
        user = json.loads(messages[1]["content"])
        if "moments" not in user:
            return reply(DESK)
        first = re.search(r"The first line is (\w+)'s\.", messages[0]["content"])[1]
        speakers = (first, "ray" if first == "peter" else "peter")
        return reply([{"speaker": speakers[i % 2], "text": f"Call line {i}."}
                      for i in range(len(user["moments"]))])

    def calls(self):
        """The moments of every call prompt, in the order asked."""
        users = [json.loads(messages[1]["content"]) for messages in self.asked]
        return [user["moments"] for user in users if "moments" in user]


class FakeTab:
    def __init__(self):
        self.asked = []

    def prepare(self, dialogue):
        self.asked.append(("prepare", dialogue))
        return {"duration_ms": 12000, "captions": [], "notes": [], "gestures": []}

    def prepare_call(self, call):
        self.asked.append(("prepare_call", call))
        return {"duration_ms": call["duration_ms"], "captions": [], "notes": [], "gestures": []}


def show(provider, done=None, *, cup=CUP, tape=FOOTAGE, tab=None, log=print):
    return write_show(cup, manifest=MANIFEST, history=(), lore=LORE, provider=provider,
                      model="fake/model", tab=tab or FakeTab(), rng=random.Random(7),
                      profiles=PROFILES, footage=tape, done=done, log=log)


def whats(moments):
    return [moment["what"] for moment in moments]


def test_the_outline_opens_introduces_every_match_recaps_each_group_round_and_crowns():
    outline = show_outline(CUP)
    intro = [f"intro-{match_id}" for match_id in IDS]
    assert [s["id"] for s in outline] == [
        "opening", intro[0], intro[1], "recap-1", intro[2], intro[3], "recap-2", intro[4], intro[5],
        "recap-3", intro[6], intro[7], intro[8], "ceremony", "close"]
    assert [s["after"] for s in outline] == [-1, -1, 0, 1, 1, 2, 3, 3, 4, 5, 5, 6, 7, 8, 8]
    assert [s["kind"] for s in outline] == [s["id"].split("-")[0] for s in outline]
    assert [s["match_id"] for s in outline if s["kind"] == "intro"] == IDS
    assert outline[0] == {"id": "opening", "kind": "opening", "after": -1}


def test_thin_keeps_the_start_and_the_end_and_spaces_the_rest():
    start = Moment(0.0, "start", None)
    lead, slip, time = (Moment(4.0, "lead", "west"), Moment(7.9, "slip", "east"),
                        Moment(45.0, "time", "west"))
    assert thin([start, lead, slip, time]) == [start, lead, time]
    # The rehearsal's pit finishes (match 002's second bout, match 000's first): a slip or an edge
    # just before the pit held the deciding line back until the clip ran out.
    lead, edge, slip, pit = (Moment(2.44, "lead", "east"), Moment(17.04, "edge", "west"),
                             Moment(23.02, "slip", "west"), Moment(23.46, "pit", "west"))
    assert thin([start, lead, edge, slip, pit]) == [start, edge, pit]
    ground, edge, slip, pit = (Moment(1.26, "ground", "west"), Moment(12.18, "edge", "east"),
                               Moment(12.56, "slip", "east"), Moment(13.02, "pit", "east"))
    assert thin([start, ground, edge, slip, pit]) == [start, pit]


def test_every_desk_segment_and_every_call_is_written_and_timed():
    router, tab = Router(), FakeTab()
    written = show(router, tab=tab)
    outline = show_outline(CUP)
    assert len(router.asked) == 37  # 15 desk segments and 22 bouts
    assert list(written["desk"]) == [s["id"] for s in outline]
    for segment in outline:
        desk = written["desk"][segment["id"]]
        assert (desk["kind"], desk["after"]) == (segment["kind"], segment["after"])
        assert desk["screen"] == screen_view(CUP, segment["after"] + 1, MANIFEST)
        assert desk["plan"]["duration_ms"] == 12000
        assert desk["dialogue"]["turns"] == [{**turn, "fact_refs": ["cup#/cup"]} for turn in DESK]
        assert desk["dialogue"]["brief"]["model"] == "fake/model"
    assert [asked["run_id"] for kind, asked in tab.asked if kind == "prepare"] == [
        f"tug-of-war-0001-{s['id']}" for s in outline]
    assert list(written["calls"]) == IDS
    first = written["calls"][IDS[0]]
    assert [line["at_ms"] for line in first["lines"]] == [2000, 6000, 10000, 11000, 15000, 19000]
    assert [line["speaker"] for line in first["lines"]] == ["peter", "ray"] * 3
    assert ("prepare_call", {"id": IDS[0], "lines": first["lines"], "duration_ms": 30000}) in tab.asked
    assert first["plan"]["duration_ms"] == 30000


def test_a_bout_s_last_line_is_heard_before_the_clip_moves_on():
    """The rehearsal's match 002: a bout ends on its tape's last frame, 0.52 s before the next
    bout's tape and 2.54 s before the clip's end, so its last line must be heard by then."""
    first = CUP.matches[0]
    tape = footage(CUP)
    tape[first.match_id] = {"duration_ms": 75040, "bouts": [
        {"k": 0, "tape_start_s": 3.52, "tape_end_s": 48.52, "seconds": 45.0,
         "moments": [Moment(0.0, "start", None), Moment(3.62, "lead", "west"),
                     Moment(45.0, "time", "west")]},
        {"k": 1, "tape_start_s": 49.04, "tape_end_s": 72.5, "seconds": 23.46,
         "moments": [Moment(0.0, "start", None), Moment(17.04, "edge", "west"),
                     Moment(23.02, "slip", "west"), Moment(23.46, "pit", "west")]}]}
    lines = show(Router(), tape=tape)["calls"][first.match_id]["lines"]
    assert [(line["at_ms"], line.get("by_ms")) for line in lines] == [
        (3520, None), (48520, 49040), (49040, None), (66080, None), (72500, 75040)]


def test_a_bout_s_lines_are_written_from_that_bout_alone():
    router = Router()
    show(router)
    calls = router.calls()
    assert [len(m.bouts) for m in CUP.matches[:2]] == [2, 3]
    one, two, three = (whats(moments) for moments in calls[2:5])
    assert one == [("Bout 1 starts, puller 3 on the west side and puller 5 on the east; "
                    "the score is puller 3 0, puller 5 0."),
                   "puller 3 pulls the marker over to their side of the pit.",
                   ("puller 5 drops into the pit. puller 3 wins the bout; "
                    "the score is puller 3 1, puller 5 0.")]
    assert [(m["index"], m["second"]) for m in calls[2]] == [(0, 0.0), (1, 4.0), (2, 8.0)]
    assert any("Bout 1 starts" in what for what in one) and not any("Bout 2" in what for what in one)
    assert not any("wins the match" in what for what in one + two)
    winner = CUP.entrants[CUP.matches[1].winner].name
    assert three[-1].endswith(f"{winner} wins the match 2–1.")
    assert not any("@" in what for moments in calls for what in whats(moments))


def test_a_bout_stopped_by_a_reset_is_called_a_draw_at_its_end_and_never_time_up():
    reset = BoutResult(0, 0, "west", None, "draw", 12.0)
    limit = BoutResult(1, 1, "east", "a", "marker", 45.0)
    first = replace(CUP.matches[0], bouts=(reset, limit, BoutResult(2, 2, "west", "a", "pit", 6.5)))
    cup = replace(CUP, matches=(first, *CUP.matches[1:]))
    tape = footage(cup)
    bouts = tape[first.match_id]["bouts"]
    bouts[0].update(seconds=12.0, moments=[STEPS[0], STEPS[1], Moment(12.0, "time", "west")])
    bouts[1].update(seconds=45.0,
                    moments=[STEPS[0], Moment(4.0, "lead", "east"), Moment(45.0, "time", "east")])
    router = Router()
    written = show(router, cup=cup, tape=tape)
    cut, full = (whats(moments) for moments in router.calls()[:2])
    assert cut[-1] == "The bout is stopped and called a draw."
    assert not any("Nobody wins" in what or "Time is up" in what for what in cut)
    assert cut[1] == "puller 2 pulls the marker over to their side of the pit."
    # the draw is said at the bout's end: its 12 s are taped from 2 s to 10 s
    assert [line["at_ms"] for line in written["calls"][first.match_id]["lines"]][:3] == [2000, 4667, 10000]
    assert full[-1] == ("Time is up with the marker on puller 2's side. puller 2 wins the bout; "
                        "the score is puller 2 1, puller 4 0.")


def test_a_match_level_after_its_bouts_goes_to_the_rating_on_air():
    final = CUP.matches[-1]
    bouts = (BoutResult(0, 0, "west", "a", "pit", 6.5), BoutResult(1, 1, "east", "b", "pit", 6.5),
             BoutResult(2, 2, "west", None, "draw", 45.0), BoutResult(3, 3, "east", None, "draw", 45.0),
             BoutResult(4, 4, "west", None, "draw", 20.0))  # the last one stopped by a reset
    level = replace(final, bouts=bouts, wins=(1, 1), decided_by="rating")
    cup = replace(CUP, matches=(*CUP.matches[:-1], level))
    tape = footage(cup)
    tape[level.match_id]["duration_ms"] = 50000
    for bout, taped in zip(bouts[2:], tape[level.match_id]["bouts"][2:]):
        taped.update(seconds=bout.time_s, moments=[STEPS[0], Moment(bout.time_s, "time", None)])
    router = Router()
    show(router, cup=cup, tape=tape)
    told = [whats(moments) for moments in router.calls()[-5:]]
    winner = cup.entrants[level.winner].name
    assert told[-2][-1] == "Time is up with the marker dead centre. Nobody wins the bout."
    assert told[-1][-1] == ("The bout is stopped and called a draw. "
                            f"After 5 bouts without 2 wins, the match goes to {winner} on the rating.")
    assert not any("1–1" in what or "wins the match" in what for bout in told for what in bout)


def test_the_desk_is_told_what_the_segment_is_for():
    router = Router()
    written = show(router)

    def facts(segment_id):
        return written["desk"][segment_id]["dialogue"]["brief"]["facts"]

    def refs(segment_id, prefix):
        return [fact["ref"] for fact in facts(segment_id) if fact["ref"].startswith(prefix)]

    system = router.asked[0][0]["content"]
    assert DESK_ANGLES["opening"] in system and DESK_PLAYERS["opening"] in system
    assert f"{DESK_ANGLES['opening']} {DESK_NUMBERS}" in system
    assert "never rounded or turned into metres" in system and "nothing added up, subtracted or counted" in system
    assert f"{DESK_PLAYERS['opening']} {DESK_HANDLES}" in system
    assert "never as a player's duck: to name both, the duck's name, then 'steered by' and the handle" in system
    assert json.loads(router.asked[0][1]["content"])["facts"] == [
        {"index": i, "text": fact["text"]} for i, fact in enumerate(facts("opening"))]
    opening = facts("opening")
    assert "cup#/group/A" in refs("opening", "cup#/group/")
    assert not any(fact["text"].startswith("In the last match") for fact in opening)
    assert refs("opening", "profile#/") == ["profile#/p0", "profile#/p1"]
    intro = facts(f"intro-{IDS[1]}")
    assert len([fact for fact in intro if fact["text"].startswith("In the last match")]) == 1
    upcoming = next(fact.text for fact in cup_facts(CUP, 1, (), MANIFEST) if fact.ref == "cup#/next")
    assert upcoming in [fact["text"] for fact in intro]
    assert refs(f"intro-{IDS[1]}", ("cup#/group/", "profile#/")) == [
        "cup#/group/B", "profile#/p3", "profile#/p5"]
    assert refs("recap-1", "profile#/") == []
    assert refs("ceremony", "profile#/") == ["profile#/p0"]


def test_a_show_cut_off_by_the_router_resumes_where_it_stopped():
    done = {"desk": {}, "calls": {}}
    with pytest.raises(httpx.ConnectError):
        show(Router(down_at=5), done)
    written = dict(done["desk"])
    assert list(written) == ["opening", f"intro-{IDS[0]}", f"intro-{IDS[1]}", "recap-1"]
    router = Router()
    assert show(router, done) is done
    assert len(router.asked) == 33
    assert all(done["desk"][segment_id] is entry for segment_id, entry in written.items())
    assert (len(done["desk"]), len(done["calls"])) == (15, 9)


def test_a_show_cut_off_during_the_calls_keeps_the_matches_it_called():
    done = {"desk": {}, "calls": {}}
    with pytest.raises(httpx.ConnectError):
        show(Router(down_at=15 + 2 + 2), done)  # the desk, match 0's two bouts, match 1's first
    called = dict(done["calls"])
    assert (len(done["desk"]), list(called)) == (15, [IDS[0]])
    router = Router()
    show(router, done)
    assert len(router.asked) == 22 - 2
    assert done["calls"][IDS[0]] is called[IDS[0]]
    assert [len(router.calls()[0]), len(done["calls"][IDS[1]]["lines"])] == [3, 9]
    assert list(done["calls"]) == IDS


def test_a_refused_answer_is_asked_again_with_a_fresh_direction():
    router, logged = Router(refused={1}), []
    written = show(router, log=logged.append)
    assert len(router.asked) == 38
    drawn = written["desk"]["opening"]["dialogue"]["brief"]["direction"]
    assert directed(drawn) in router.asked[1][0]["content"]
    assert router.asked[0][0]["content"] != router.asked[1][0]["content"]
    assert logged == ["show: opening refused (model answer is not JSON)"]


def test_a_segment_refused_three_times_holds_the_show():
    asked, logged = [], []

    def refusing(messages, max_tokens):
        asked.append(messages)
        return reply(None, content="not json")

    done = {"desk": {}, "calls": {}}
    with pytest.raises(Rejected):
        show(refusing, done, log=logged.append)
    assert len(asked) == TRIES
    assert done["desk"] == {}
    assert logged == ["show: opening refused (model answer is not JSON)"] * TRIES


def taped_clip(ks, seconds=30.0):
    """A match clip's clip.json as Plan C's clip_manifest writes it: where each bout's tape starts and ends."""
    return json.dumps({"layouts": {"landscape": {"seconds": seconds, "timing": {"bouts": [
        {"k": k, "tape_start_s": 2.0 + 9 * k, "tape_end_s": 10.02 + 9 * k} for k in ks]}}}}).encode()


def test_match_footage_reads_each_bout_and_where_its_clip_tapes_it(tmp_path):
    store, first = LocalStore(tmp_path), CUP.matches[0]
    blob = encode(dragged(), np.zeros((2, 3, 21), np.float32))  # its settle is no part of the bout
    store.put_cup_files("tug-of-war", 1, {f"bouts/{first.match_id}-0.npz": blob})
    store.put_clip(first.match_id, {"clip.json": taped_clip([0])})
    assert match_footage(store, replace(CUP, matches=CUP.matches[:2]), MANIFEST, {}) == {first.match_id: {
        "duration_ms": 30000, "bouts": [{"k": 0, "tape_start_s": 2.0, "tape_end_s": 10.02, "seconds": 8.02,
                                         "moments": moments(decode(blob), MANIFEST.course, string_offset("legs"))}]}}
    # the second match's clip is not ready: it is called on a later tick, as the first already is here
    assert match_footage(store, replace(CUP, matches=CUP.matches[:2]), MANIFEST, {first.match_id: {}}) == {}


def test_a_cup_s_show_is_composed_from_its_store_and_the_cups_before_it(tmp_path):
    store, second = LocalStore(tmp_path), played_cup(number=2)
    store.put_cup_files("tug-of-war", 1, {"draw.json": CUP.draw_json(), "matches.json": CUP.matches_json()})
    files = {"draw.json": second.draw_json(), "matches.json": second.matches_json()}
    for match in second.matches:
        files.update({f"bouts/{match.match_id}-{bout.k}.npz": encode(dragged()) for bout in match.bouts})
        store.put_clip(match.match_id, {"clip.json": taped_clip([bout.k for bout in match.bouts])})
    store.put_cup_files("tug-of-war", 2, files)
    done = {"desk": {}, "calls": {}}
    written = compose_show(store, second, lore=LORE, provider=Router(), model="fake/model", tab=FakeTab(),
                           rng=random.Random(7), done=done)
    assert written is done and list(written["calls"]) == [match.match_id for match in second.matches]
    assert json.loads(json.dumps(written)) == written  # as the worker stores it
    opening = [fact["text"] for fact in written["desk"]["opening"]["dialogue"]["brief"]["facts"]]
    assert "@p0 won Cup #1 and defends the title." in opening
    assert written["calls"][second.matches[0].match_id]["lines"][0]["at_ms"] == 2000

import json

from tests.loading import load_script

bench = load_script("commentary_bench")


def aired(*texts, facts=()):
    return {"dialogue": {
        "turns": [{"speaker": "peter", "text": text, "fact_refs": []} for text in texts],
        "brief": {"facts": [{"ref": f"f{i}", "kind": kind, "text": text}
                            for i, (kind, text) in enumerate(facts)],
                  "direction": {}, "model": "m"}}}


def test_a_session_is_read_in_air_order(tmp_path):
    for at_ms in (3000, 1000, 2000):
        (tmp_path / f"{at_ms}-B.json").write_text(json.dumps({"at_ms": at_ms}))
    assert [one["at_ms"] for one in bench.load(tmp_path)] == [1000, 2000, 3000]


def test_a_sentence_heard_before_is_a_repeat():
    session = [aired("Rank 1 of 1 is a short ladder. What a day."),
               aired("The bell rang twice for the brave duck today."),
               aired("Well, rank 1 of 1 is a short ladder, Peter.")]
    # Three sentences of four words or more; only the last was heard before.
    assert bench.repeats(session) == (1, 3)


def test_words_lifted_from_the_facts_are_not_the_writers_repetition():
    fact = ("result", "The mean finish time is 12.40 s, every one of the 5 seeds finished.")
    session = [aired("Every one of the 5 seeds finished.", facts=[fact]),
               aired("Every one of the 5 seeds finished.", facts=[fact])]
    assert bench.repeats(session) == (0, 2)
    assert bench.tics(session) == []


def test_tics_are_the_four_grams_most_dialogues_share():
    session = [aired("A coffee tin and a bell."), aired("Still a coffee tin and nothing else."),
               aired("Nothing to see here at all.")]
    assert bench.tics(session) == [("a coffee tin and", 2)]


def test_props_are_the_writers_own_words_by_share_of_dialogues():
    run_fact = ("result", "The mean finish time is 12.40 s.")
    memory = ("lore", "The megaphone that never worked.")
    session = [aired("12.40 s! The megaphone again, and the bell.", facts=[run_fact, memory]),
               aired("The bell, Peter.", facts=[run_fact])]
    found = dict(bench.props(session))
    # A memory does not excuse a prop; a function word and a fact's word are not one.
    assert found["bell"] == 1.0 and found["megaphone"] == 0.5
    assert "the" not in found and "12" not in found and "s" not in found


def test_the_reserves_log_is_tallied_by_reason():
    lines = ["booth  on",
             "commentary: R1 written",
             "commentary: R2 refused (a number not in the cited facts)",
             "commentary: R3 refused (a number not in the cited facts)",
             "commentary: R4 not written (ReadTimeout: timed out)",
             "commentary: R5 written, but the programme was not told (OSError: full)"]
    assert bench.landing(lines) == {
        "written": 2, "refused: a number not in the cited facts": 2,
        "not written: ReadTimeout": 1}


def test_the_report_names_each_measure():
    text = bench.report([aired("Rank 1 of 1 is a short ladder.")] * 2,
                        ["commentary: R1 written"])
    assert "2 dialogues" in text
    assert "repeated sentences: 1 of 2" in text
    assert "rank 1 of 1" in text and "ladder" in text and "written" in text

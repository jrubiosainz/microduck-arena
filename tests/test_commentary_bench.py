import json

import pytest

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
                        ["commentary: R1 written"], [])
    assert "2 dialogues" in text
    assert "repeated sentences: 1 of 2" in text
    assert "rank 1 of 1" in text and "ladder" in text and "written" in text


VERDICT = {"grounded": {"ok": True, "turn": None, "why": ""},
           "english": {"ok": True, "turn": None, "why": ""},
           "personalities": {"ok": False, "turn": 1, "why": "Ray recites the board."},
           "scene": "feeling-then-fact",
           "followed": {"opening": True, "angle": False}}


def test_the_judge_is_shown_the_brief_and_the_dialogue_and_answers_in_json():
    asked = []

    def provider(messages, max_tokens):
        asked.append((messages, max_tokens))
        return {"content": "```json\n" + json.dumps(VERDICT) + "\n```"}

    one = aired("Well.", facts=[("result", "The mean finish time is 12.40 s.")])
    one["dialogue"]["brief"]["direction"] = {"turns": 3, "opening": "Peter opens mid-thought."}
    sheets = {"peter": {"name": "Peter", "sheet": "Warm."}}
    assert bench.judge(provider, one, sheets) == VERDICT
    [(messages, max_tokens)] = asked
    assert max_tokens == bench.JUDGE_LIMIT
    assert all(label in messages[0]["content"] for label in bench.SCENES)
    assert "Warm." in messages[0]["content"]
    shown = json.loads(messages[1]["content"])
    assert shown == {"facts": one["dialogue"]["brief"]["facts"],
                     "direction": {"turns": 3, "opening": "Peter opens mid-thought."},
                     "dialogue": one["dialogue"]["turns"]}


@pytest.mark.parametrize("broken", [
    {k: v for k, v in VERDICT.items() if k != "scene"},
    {**VERDICT, "extra": "unasked"},
    {**VERDICT, "personalities": {"ok": False, "why": "Ray recites the board."}},
    {**VERDICT, "grounded": {"ok": "true", "turn": None, "why": ""}},
    {**VERDICT, "scene": "no-such-scene"},
    {**VERDICT, "followed": {"opening": "yes"}},
    ["not", "an", "object"],
])
def test_a_verdict_that_is_not_the_shape_asked_for_costs_itself(broken):
    def provider(messages, max_tokens):
        return {"content": json.dumps(broken)}

    with pytest.raises(ValueError):
        bench.judge(provider, aired("Well."), {})


def test_the_mechanic_gives_rates_reasons_scenes_and_adherence():
    fine = {**VERDICT, "personalities": {"ok": True, "turn": None, "why": ""},
            "scene": "teasing", "followed": {"opening": True, "angle": True}}
    lines = "\n".join(bench.mechanic([VERDICT, fine]))
    assert "grounded  2 of 2" in lines
    assert "personalities  1 of 2" in lines and "turn 1: Ray recites the board." in lines
    assert "feeling-then-fact" in lines and "teasing" in lines
    assert "angle  1 of 2" in lines and "opening  2 of 2" in lines

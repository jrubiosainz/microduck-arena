"""Facts in, checked dialogue out; only the router is faked."""

import json

import httpx
import pytest

from arena.commentary.context import Fact
from arena.commentary.generator import (
    CHECK_LIMIT,
    ROUTER,
    WRITE_LIMIT,
    Rejected,
    complete,
    write,
)
from arena.commentary.lore import load

LORE = load()
FACTS = [
    Fact("run#/event", "The event is the 2 m Sprint, a 2 m sprint on foot.", "result", ("sprint",)),
    Fact("run#/participant", "The participant is @alice, racing a policy named alice-v1.", "result",
         ("participant",), identities=("alice",)),
    Fact("run#/result", "The mean finish time is 12.40 s, every one of the 5 seeds finished.",
         "result", ("clean",)),
    Fact("run#/board",
         "On the 2 m Sprint board this run ranks 2 of 4, 1.20 s behind the leader, @carol.",
         "result", ("podium",), identities=("carol",)),
    Fact("lore:tin-trophy", "The trophy they built from a coffee tin and a bicycle bell.", "lore",
         ("podium",)),
    Fact("recent:R9",
         "Earlier this season: @bob's run on the 2 m Sprint, 13.10 s, every seed finished.",
         "recent", ("clean",), identities=("bob",)),
]
RECENT = [{"ref": "recent:R9", "turns": ["Thirteen ten, Ray!", "Thirteen point one zero, Peter."]}]
TURNS = [
    {"speaker": "peter", "text": "12.40! Alice flies down the 2 m Sprint, Ray!",
     "fact_refs": [0, 1, 2]},
    {"speaker": "ray",
     "text": "12.40 s, every seed finished. Rank 2 on the board, 1.20 s behind carol.",
     "fact_refs": [2, 3]},
    {"speaker": "peter", "text": "Do we bring out the coffee tin, my friend?", "fact_refs": [4]},
]
# Quantities are never spelled out: "twelve" or "second" would fail the
# number-word check, which is the point of the check.
CHECK = {"grounded": True, "english": True, "personalities": True, "fresh": True}


def reply(payload, **changes):
    answer = {"content": json.dumps(payload), "finish_reason": "stop", "model": "fake/model",
              "prompt_tokens": 900, "completion_tokens": 120}
    answer.update(changes)
    return answer


def provider_for(*answers):
    queue = list(answers)
    calls = []

    def provider(messages, max_tokens):
        calls.append((messages, max_tokens))
        return queue.pop(0)

    provider.calls = calls
    return provider


def run_case(turns=TURNS, verdict=CHECK, facts=FACTS, recent=RECENT):
    # The audit answers a small JSON object of booleans: its completion_tokens
    # must fit CHECK_LIMIT, unlike the write call's much larger budget.
    provider = provider_for(reply(turns), reply(verdict, completion_tokens=80))
    return write(facts, recent, lore=LORE, provider=provider, model="fake/model"), provider


def test_a_checked_dialogue_keeps_the_prose_and_maps_indices_to_references():
    written, provider = run_case()
    assert [t["text"] for t in written["turns"]] == [t["text"] for t in TURNS]
    assert written["turns"][0]["fact_refs"] == ["run#/event", "run#/participant", "run#/result"]
    assert written["turns"][2]["fact_refs"] == ["lore:tin-trophy"]
    assert written["lore_refs"] == ["tin-trophy"]
    assert written["model"] == "fake/model"
    assert written["usage"] == {"prompt_tokens": 1800, "completion_tokens": 200}
    (write_messages, write_max), (check_messages, check_max) = provider.calls
    assert write_max == WRITE_LIMIT and check_max == CHECK_LIMIT
    system = write_messages[0]["content"]
    assert LORE.characters["peter"]["sheet"][:60] in system
    assert "earlier this season" in system
    assert LORE.characters["peter"]["sheet"][:60] in check_messages[0]["content"]
    user = json.loads(write_messages[1]["content"])
    assert [f["index"] for f in user["facts"]] == list(range(6))
    assert user["facts"][4]["memory"] is True
    assert user["recent_broadcasts"] == [{"index": 5, "turns": RECENT[0]["turns"]}]
    audit = json.loads(check_messages[1]["content"])
    assert audit["dialogue"] == TURNS


def test_the_writing_prompt_shape_example_shows_three_turns():
    # The example must match TURNS (3 to 6, alternating peter then ray) or a
    # model that copies its shape produces a dialogue the length check rejects.
    _, provider = run_case()
    (write_messages, _), _ = provider.calls
    system = write_messages[0]["content"]
    start = system.index("Shape: ") + len("Shape: ")
    end = system.index("]. ", start) + 1
    shape = json.loads(system[start:end])
    assert [turn["speaker"] for turn in shape] == ["peter", "ray", "peter"]


@pytest.mark.parametrize("turns, why", [
    (TURNS[:2], "3 to 6 turns"),
    (TURNS * 3, "3 to 6 turns"),
    ([TURNS[1], TURNS[0], TURNS[2]], "alternate"),
    ([{**TURNS[0], "text": "Peter: what a run!"}, TURNS[1], TURNS[2]], "speaker prefix"),
    ([{**TURNS[0], "text": "I'm Peter Duckry and what a run!"}, TURNS[1], TURNS[2]],
     "self-introduction"),
    ([{**TURNS[0], "text": "See clips/R1/landscape.mp4, Ray!"}, TURNS[1], TURNS[2]], "technical"),
    ([{**TURNS[0], "text": "He flies down the sprint!"}, TURNS[1], TURNS[2]], "gendered"),
    ([{**TURNS[0], "text": "Carol will be worried, Ray!", "fact_refs": [0]}, TURNS[1], TURNS[2]],
     "name"),
    ([{**TURNS[0], "text": "Alice fell at the line!"}, TURNS[1], TURNS[2]], "fall"),
    ([TURNS[0], {**TURNS[1], "text": "12.41 s on the clock."}, TURNS[2]], "number"),
    ([TURNS[0], {**TURNS[1], "text": "Three seconds behind carol.", "fact_refs": [3]}, TURNS[2]],
     "number"),
    ([{**TURNS[0], "fact_refs": []}, TURNS[1], TURNS[2]], "fact_refs"),
    ([{**TURNS[0], "fact_refs": [9]}, TURNS[1], TURNS[2]], "fact_refs"),
    ([{**TURNS[0], "fact_refs": [0, 0]}, TURNS[1], TURNS[2]], "fact_refs"),
    ([{**TURNS[0], "text": "<b>Go</b>"}, TURNS[1], TURNS[2]], "printable"),
    ([{**TURNS[0], "text": "x" * 241}, TURNS[1], TURNS[2]], "240"),
    ([{**TURNS[0], "extra": 1}, TURNS[1], TURNS[2]], "speaker, text, fact_refs"),
    ([{"speaker": "peter", "text": "What a day, Ray!", "fact_refs": [4]},
      {"speaker": "ray", "text": "A day, Peter.", "fact_refs": [4]},
      {"speaker": "peter", "text": "The coffee tin, my friend?", "fact_refs": [4]}], "result"),
    ([{**TURNS[0], "text": "Alice is here in the booth with us!"}, TURNS[1], TURNS[2]], "booth"),
])
def test_local_checks_reject_with_a_reason(turns, why):
    with pytest.raises(Rejected, match=why):
        run_case(turns=turns)


def test_a_player_at_the_line_or_in_the_lead_is_not_placed_in_the_booth():
    # Only naming the booth is a placement; ordinary grounded scene-setting
    # ("at the line", "in the lead") must not trip the same check.
    turns = [{**TURNS[0], "text": "Alice is at the line, Ray!"}, TURNS[1], TURNS[2]]
    written, _ = run_case(turns=turns)
    assert written["turns"][0]["text"] == "Alice is at the line, Ray!"


@pytest.mark.parametrize("verdict", [
    {**CHECK, "grounded": False}, {**CHECK, "fresh": False}, {**CHECK, "personalities": "true"},
    {"grounded": True, "english": True}, True,
])
def test_the_audit_must_say_true_four_times(verdict):
    with pytest.raises(Rejected, match="audit"):
        run_case(verdict=verdict)


@pytest.mark.parametrize("changes", [
    {"content": "not JSON"}, {"finish_reason": "length"}, {"completion_tokens": WRITE_LIMIT + 1},
    {"prompt_tokens": 0}, {"content": None},
])
def test_an_invalid_provider_answer_is_rejected(changes):
    provider = provider_for(reply(TURNS, **changes), reply(CHECK, completion_tokens=80))
    with pytest.raises(Rejected):
        write(FACTS, RECENT, lore=LORE, provider=provider, model="m")


def test_a_name_spoken_in_a_facts_own_text_is_grounded_by_that_fact_alone():
    # A notable fact can name the participant in its own text without declaring
    # an identity itself (context.py's own detectors do exactly this); citing
    # that fact alone, not the participant fact, still grounds the name.
    facts = FACTS + [Fact("notable#/personal-best",
                          "@alice beats their previous best on the 2 m Sprint, 13.00 s, by 0.60 s.",
                          "notable", ("pb",))]
    turns = [{**TURNS[0], "text": "Alice smashes a personal best, Ray!", "fact_refs": [6]},
             TURNS[1], TURNS[2]]
    written, _ = run_case(turns=turns, facts=facts)
    assert written["turns"][0]["fact_refs"] == ["notable#/personal-best"]


def test_two_facts_establishing_the_same_name_need_only_one_cited():
    # The sprint-like shape this fix exists for: the participant fact and a
    # second fact both establish @alice. Citing either one alone is enough;
    # the bug was demanding both.
    facts = FACTS + [Fact("notable#/personal-best",
                          "@alice beats their previous best on the 2 m Sprint, 13.00 s, by 0.60 s.",
                          "notable", ("pb",))]
    turns = [{**TURNS[0], "text": "Alice makes it look easy, Ray!", "fact_refs": [1]},
             TURNS[1], TURNS[2]]
    written, _ = run_case(turns=turns, facts=facts)
    assert written["turns"][0]["fact_refs"] == ["run#/participant"]


def test_a_recent_run_may_be_called_back_only_by_its_fact():
    turns = [
        {**TURNS[0]},
        {"speaker": "ray", "text": "Bob ran 13.10 s here earlier this season, Peter.",
         "fact_refs": [5]},
        TURNS[2],
    ]
    written, _ = run_case(turns=turns)
    assert written["turns"][1]["fact_refs"] == ["recent:R9"]
    with pytest.raises(Rejected, match="name"):
        run_case(turns=[TURNS[0], {**turns[1], "fact_refs": [2]}, TURNS[2]])


class Answered:
    """What the router sends back when it is happy."""

    def raise_for_status(self):
        pass

    def json(self):
        return {"model": "served/model", "usage": {"prompt_tokens": 7, "completion_tokens": 9},
                "choices": [{"message": {"content": "[]"}, "finish_reason": "stop"}]}


def test_complete_posts_the_routers_contract_and_retries_a_transport_error_once(monkeypatch):
    posts = []

    def post(url, *, headers, json, timeout):
        posts.append({"url": url, "headers": headers, "body": json, "timeout": timeout})
        if len(posts) == 1:
            raise httpx.TransportError("connection reset")
        return Answered()

    monkeypatch.setattr(httpx, "post", post)
    messages = [{"role": "user", "content": "hi"}]
    answer = complete(messages, WRITE_LIMIT, model="a/model", token="t")
    assert answer == {"content": "[]", "finish_reason": "stop", "model": "served/model",
                      "prompt_tokens": 7, "completion_tokens": 9}
    assert posts[0] == {
        "url": ROUTER, "headers": {"Authorization": "Bearer t"}, "timeout": 15.0,
        "body": {"model": "a/model", "messages": messages, "max_tokens": WRITE_LIMIT,
                 "temperature": 0.3, "reasoning_effort": "none"},
    }
    # The retry is the same request to the same provider: there is no failover.
    assert posts == [posts[0], posts[0]]


def test_a_second_transport_error_is_not_retried_again(monkeypatch):
    posts = []

    def post(url, **sent):
        posts.append(url)
        raise httpx.TransportError("connection reset")

    monkeypatch.setattr(httpx, "post", post)
    with pytest.raises(httpx.TransportError):
        complete([], CHECK_LIMIT, model="a/model", token="t")
    assert posts == [ROUTER, ROUTER]

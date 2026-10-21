"""Facts in, playable dialogue out; only the router is faked."""

import json
import random
import re

import httpx
import pytest

from arena.commentary.context import Fact
from arena.commentary.generator import (
    BOOTH_CONTEXT,
    CALL_CONTEXT,
    CALL_LIMIT,
    CALL_STYLE,
    CALLBACK,
    DIMENSIONS,
    GROUNDING,
    LOOKBACK,
    OPENINGS,
    ROUTER,
    STYLE,
    WRITE_LIMIT,
    Rejected,
    complete,
    directed,
    direction,
    write,
    write_call,
)
from arena.commentary.lore import load

LORE = load()
FACTS = [
    Fact("run#/event", "The event is the 2 m Sprint, a 2 m sprint on foot.", "result", ("sprint",)),
    Fact("run#/participant", "The participant is @alice, racing a policy named alice-v1.", "result",
         ("participant",)),
    Fact("run#/result", "The mean finish time is 12.40 s, every one of the 5 seeds finished.",
         "result", ("clean",)),
    Fact("run#/board",
         "On the 2 m Sprint board this run ranks 2 of 4, 1.20 s behind the leader, @carol.",
         "result", ("podium",)),
    Fact("lore:throne", "A board with a single name on it: Peter calls it a throne, Ray calls it "
         "a queue with nobody behind.", "lore", ("open-board",)),
    Fact("recent:R9",
         "Earlier this season: @bob's run on the 2 m Sprint, 13.10 s, every seed finished.",
         "recent", ("clean",)),
]
TURNS = [
    {"speaker": "peter", "text": "12.40! Alice flies down the 2 m Sprint, Ray!",
     "fact_refs": [0, 1, 2]},
    {"speaker": "ray",
     "text": "12.40 s, every seed finished. Rank 2 on the board, 1.20 s behind carol.",
     "fact_refs": [2, 3]},
    {"speaker": "peter", "text": "A throne with nobody behind it, my friend?", "fact_refs": [4]},
]


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


def run_case(turns=TURNS, facts=FACTS):
    provider = provider_for(reply(turns))
    return (write(facts, direction(random.Random(1), [], LORE.scenes), lore=LORE, provider=provider,
                  model="fake/model"),
            provider)


def test_a_dialogue_keeps_the_prose_and_maps_indices_to_references():
    written, provider = run_case()
    assert [t["text"] for t in written["turns"]] == [t["text"] for t in TURNS]
    assert written["turns"][0]["fact_refs"] == ["run#/event", "run#/participant", "run#/result"]
    assert written["turns"][2]["fact_refs"] == ["lore:throne"]
    assert written["lore_refs"] == ["throne"]
    assert written["model"] == "fake/model"
    assert written["usage"] == {"prompt_tokens": 900, "completion_tokens": 120}
    # One call: nothing judges a dialogue between the writer and the air.
    [(write_messages, write_max)] = provider.calls
    assert write_max == WRITE_LIMIT
    system = write_messages[0]["content"]
    assert LORE.characters["peter"]["sheet"][:60] in system
    assert "earlier this season" in system
    user = json.loads(write_messages[1]["content"])
    assert [f["index"] for f in user["facts"]] == list(range(6))
    assert user["facts"][4]["memory"] is True
    assert set(user) == {"facts"}


def test_the_writing_prompt_shape_example_shows_three_turns():
    # The example must match TURNS (3 to 6, alternating peter then ray) or a
    # model that copies its shape produces a dialogue the length check rejects.
    _, provider = run_case()
    [(write_messages, _)] = provider.calls
    system = write_messages[0]["content"]
    start = system.index("Shape: ") + len("Shape: ")
    end = system.index("]. ", start) + 1
    shape = json.loads(system[start:end])
    assert [turn["speaker"] for turn in shape] == ["peter", "ray", "peter"]


def test_a_direction_is_drawn_per_dialogue_and_is_data():
    drawn = direction(random.Random(7), [], LORE.scenes)
    assert drawn == direction(random.Random(7), [], LORE.scenes)
    assert set(drawn) == {"turns", "scene", *DIMENSIONS}
    assert drawn["scene"] in LORE.scenes
    assert all(drawn[name] in options for name, options in DIMENSIONS.items())
    dialogues = (directed(direction(random.Random(seed), [], LORE.scenes)) for seed in range(50))
    assert len(set(dialogues)) > 25
    # The writer is told the direction it drew, in the prompt's own sentence.
    assert directed(drawn).startswith(
        f"This dialogue: {drawn['turns']} turns. The scene: {drawn['scene']} ")
    _, provider = run_case()
    directed_prompt = directed(direction(random.Random(1), [], LORE.scenes))
    assert directed_prompt in provider.calls[0][0][0]["content"]


def test_a_direction_stays_away_from_what_the_last_dialogues_drew():
    # Half the distinct openings: fewer and one comes straight back, more and
    # the draw becomes a rotation.
    recent = [{**direction(random.Random(0), [], LORE.scenes), "opening": opening}
              for opening in OPENINGS[:LOOKBACK]]
    drawn = {direction(random.Random(seed), recent, LORE.scenes)["opening"] for seed in range(200)}
    assert drawn == set(OPENINGS[LOOKBACK:])


def test_a_scene_stays_away_from_what_the_last_dialogues_drew():
    # Half the distinct scenes, exactly like a dimension of DIMENSIONS.
    lookback = len(LORE.scenes) // 2
    recent = [{**direction(random.Random(0), [], LORE.scenes), "scene": scene}
              for scene in LORE.scenes[:lookback]]
    drawn = {direction(random.Random(seed), recent, LORE.scenes)["scene"] for seed in range(200)}
    assert drawn == set(LORE.scenes[lookback:])


def test_the_prompt_no_longer_hands_out_the_word_debut():
    assert "debut" not in STYLE + GROUNDING + BOOTH_CONTEXT
    assert "then adds a fact" not in STYLE
    assert "a grin and a well-chosen number" not in STYLE
    assert "then puts a fact on the table" not in LORE.characters["ray"]["sheet"]


def test_the_booth_speaks_of_nothing_a_new_viewer_has_not_seen():
    """The hall's bell, echo and bench, the booth's trophies and the commentators' past were
    private jokes: a viewer who had never watched the channel heard of props never shown."""
    told = " ".join((STYLE, GROUNDING, BOOTH_CONTEXT, json.dumps(LORE.characters), *LORE.scenes,
                     *(m.memory for m in LORE.memories),
                     *(option for options in DIMENSIONS.values() for option in options))).lower()
    for prop in ("bell", "hall", "echo", "gym", "megaphone", "trophy", "coffee", "curtain",
                 "notebook", "pencil", "badge", "lap of honour", "fog", "towel", "bench"):
        assert not re.search(rf"\b{prop}\b", told), prop


def test_the_booth_knows_a_performance_is_not_a_race():
    """Seeds, a finish and a mean time belong to races; a performance's length is its only
    time. "Show" stays the broadcast's word ("do not describe the show"), so the stage's
    turn is a performance."""
    assert "A race is a handful of attempts, called seeds" in BOOTH_CONTEXT
    assert "A run is a handful of attempts" not in BOOTH_CONTEXT
    assert "or performing on a stage" in BOOTH_CONTEXT
    assert "A performance on the stage is a single turn the public votes on: never timed" in BOOTH_CONTEXT


def test_the_callback_is_a_coin_that_avoids_nothing():
    recent = [{**direction(random.Random(0), [], LORE.scenes), "callback": CALLBACK}] * LOOKBACK
    called = sum(direction(random.Random(seed), recent, LORE.scenes)["callback"] == CALLBACK
                 for seed in range(400))
    assert 60 < called < 140  # one in four, whatever was drawn lately


def test_a_code_fence_around_the_answer_is_dressing():
    fenced = "```json\n" + json.dumps(TURNS) + "\n```"
    provider = provider_for(reply(TURNS, content=fenced))
    written = write(FACTS, direction(random.Random(1), [], LORE.scenes), lore=LORE,
                     provider=provider, model="m")
    assert [t["text"] for t in written["turns"]] == [t["text"] for t in TURNS]


@pytest.mark.parametrize("turns, why", [
    (TURNS[:2], "3 to 6 turns"),
    (TURNS * 3, "3 to 6 turns"),
    ([TURNS[1], TURNS[0], TURNS[2]], "alternate"),
    ([{**TURNS[0], "fact_refs": []}, TURNS[1], TURNS[2]], "fact_refs"),
    ([{**TURNS[0], "fact_refs": [9]}, TURNS[1], TURNS[2]], "fact_refs"),
    ([{**TURNS[0], "fact_refs": [0, 0]}, TURNS[1], TURNS[2]], "fact_refs"),
    ([{**TURNS[0], "text": "  "}, TURNS[1], TURNS[2]], "non-empty"),
    ([{**TURNS[0], "text": "x" * 241}, TURNS[1], TURNS[2]], "240"),
    ([{**TURNS[0], "extra": 1}, TURNS[1], TURNS[2]], "speaker, text, fact_refs"),
])
def test_an_answer_the_booth_cannot_play_is_rejected_with_a_reason(turns, why):
    with pytest.raises(Rejected, match=why):
        run_case(turns=turns)


def test_the_prose_itself_is_never_judged():
    # What a line says is the prompt's business: an invented number, a fall, a
    # pronoun or a name nobody cited all go on air as written.
    turns = [{**TURNS[0], "text": "He fell twice and still ran 99 s, Ray!", "fact_refs": [0]},
             {**TURNS[1], "text": "Carol will be worried, Peter.", "fact_refs": [4]},
             TURNS[2]]
    written, _ = run_case(turns=turns)
    assert [t["text"] for t in written["turns"]] == [t["text"] for t in turns]


@pytest.mark.parametrize("changes", [
    {"content": "not JSON"}, {"finish_reason": "length"}, {"completion_tokens": WRITE_LIMIT + 1},
    {"prompt_tokens": 0}, {"content": None},
])
def test_an_invalid_provider_answer_is_rejected(changes):
    provider = provider_for(reply(TURNS, **changes))
    with pytest.raises(Rejected):
        write(FACTS, direction(random.Random(1), [], LORE.scenes), lore=LORE, provider=provider,
              model="m")


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
        "url": ROUTER, "headers": {"Authorization": "Bearer t"}, "timeout": 60.0,
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
        complete([], WRITE_LIMIT, model="a/model", token="t")
    assert posts == [ROUTER, ROUTER]


def test_the_booth_is_taught_what_the_tug_is():
    assert "a duck's rating is the ground it wins from the Arena's reference duck" in BOOTH_CONTEXT
    assert "winch" not in BOOTH_CONTEXT and "fell or went" not in BOOTH_CONTEXT


MOMENTS = [{"index": 0, "second": 0.0, "what": "The bout starts."},
           {"index": 1, "second": 6.5, "what": "The marker moves 10 cm west."},
           {"index": 2, "second": 12.0, "what": "Alice drops into the pit."}]
CALL = [{"speaker": "ray", "text": "Off they go."},
        {"speaker": "peter", "text": "The marker slides west!"},
        {"speaker": "ray", "text": "And in."}]


def call_with(lines, first="ray"):
    provider = provider_for(reply(lines))
    return write_call(FACTS, MOMENTS, first, lore=LORE, provider=provider, model="fake/model"), provider


def test_a_call_is_one_line_per_moment_from_the_first_speaker_given():
    written, provider = call_with(CALL)
    assert written["lines"] == CALL
    assert written["model"] == "fake/model"
    assert written["usage"] == {"prompt_tokens": 900, "completion_tokens": 120}
    [(messages, max_tokens)] = provider.calls
    assert max_tokens == CALL_LIMIT
    system = messages[0]["content"]
    assert CALL_CONTEXT in system and CALL_STYLE in system
    assert "The first line is ray's." in system
    assert "This bout has 3 moments: answer exactly 3 lines, one per moment" in system
    assert LORE.characters["peter"]["sheet"][:60] in system
    assert json.loads(messages[1]["content"]) == {
        "facts": [{"index": i, "text": fact.text} for i, fact in enumerate(FACTS)],
        "moments": MOMENTS}


@pytest.mark.parametrize("lines, why", [
    (CALL[:2], "the call must have one line per moment"),
    ([CALL[1], CALL[0], CALL[1]], "lines must alternate, starting with ray"),
    ([{**CALL[0], "fact_refs": [0]}, CALL[1], CALL[2]], "a line has other keys than speaker, text"),
    ([{**CALL[0], "text": "x" * 81}, CALL[1], CALL[2]], "a line's text is over 80 characters"),
    ([{**CALL[0], "text": "  "}, CALL[1], CALL[2]], "a line's text must be a non-empty string"),
])
def test_a_call_the_booth_cannot_play_is_rejected(lines, why):
    with pytest.raises(Rejected, match=why):
        call_with(lines)


def test_the_call_prompt_carries_no_private_prop():
    for prop in ("fog machine", "bell", "lap of honour", "trophy"):
        assert prop not in CALL_CONTEXT + CALL_STYLE


def test_the_call_prompt_says_only_the_pit_puts_a_duck_out():
    assert "knocked over stays in it and can still be dragged" in CALL_CONTEXT and "45 seconds" in CALL_CONTEXT


def test_a_call_names_a_duck_never_its_player():
    # The profile facts print handles; a call once said "Bout to Nico."
    assert "Name a duck exactly as the moments print its name, never by its player's handle or name" in CALL_STYLE


def test_a_call_starts_with_peter_or_ray():
    with pytest.raises(ValueError, match="peter or ray"):
        write_call(FACTS, [], "bob", lore=LORE, provider=None, model="m")

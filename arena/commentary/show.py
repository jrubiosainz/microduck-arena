"""A cup's show, written ahead: Peter and Ray at the desk around the matches, and on every bout.

A desk segment is told the cup as it stood before the match it airs ahead of (cup.py), never
anything later; a bout is called from its own moments alone, its result told only in its last
one, a bout a MuJoCo reset stopped included. Nothing here reads the prose back: an answer the
booth cannot play is logged and asked for again, TRIES times in all, and then the show waits.
"""

import random
from collections.abc import Mapping, Sequence

from ..constants import CTRL_DT
from ..course import string_offset
from ..cup import Cup, Entrant, MatchRecord
from ..cupworker import load_cup
from ..manifest import Manifest, load_event
from ..match import BoutResult
from ..moments import GROUND_M, Moment, moments
from ..trace import decode
from .context import Fact
from .cup import cup_facts, group_round, player_profiles, score_text, screen_view
from .generator import NO_CALLBACK, Rejected, direction, write, write_call
from .lore import Lore

CALL_GAP_S = 4.0  # between a bout's start and its end, a moment is called this long after the last
TRIES = 3  # answers asked for one desk segment or one bout before the show waits

DESK_TURNS = {"opening": (5, 6), "intro": (3, 4), "recap": (4, 5), "ceremony": (5, 6), "close": (3,)}
DESK_ANGLES = {
    "opening": "This is the opening of the cup's show, before any match: present the cup, the "
               "field and the draw, and name the favourites by their ratings against the reference "
               "duck. Nothing has been played yet.",
    "intro": "The next match is about to start: who meets whom and at what stage of the cup. If a "
             "match was played just before, react to its result in one line first.",
    "recap": "A group round has just ended: go over its results and how the groups stand now, "
             "then hand over to the next match.",
    "ceremony": "The final has just been played: crown the champion, say how they won the final, "
                "and look back on their cup in one line.",
    "close": "The show is ending: name the champion once more and say when the next cup premieres.",
}
# Left to itself the desk turns "favourite by 41.1 cm" into "over forty centimetres" or "nearly half a metre",
# and a path of four 2–0 wins into "eight bouts".
DESK_NUMBERS = ("Every number said is one a fact prints, said as it prints it: a rating or a gap with its decimal "
                "and cm, never rounded or turned into metres, never 'nearly' or 'over' one; nothing added up, "
                "subtracted or counted.")
DESK_PLAYERS = {
    "opening": "Name ducks by their names as the facts print them, the favourites first; a player by handle at most once.",
    "intro": "Name both ducks of the next match by their names as printed, and each one's player by handle once.",
    "recap": "Name only the ducks the facts put at the top of a group, by their names as printed.",
    "ceremony": "Name the champion duck and its player's handle, and the beaten finalist once.",
    "close": "Name the champion duck and its player's handle.",
}
# A rematch or a streak fact names players alone, and the desk then says "Nico won" or "Ann's duck".
DESK_HANDLES = ("A player is named only by the handle a fact prints, at sign included, never by a bare name; a "
                "duck only by its name, never as someone's duck.")
DESK_FACTS = {
    "opening": ("cup#/cup", "cup#/next", "cup#/group/", "cup#/ratings", "cup#/defending"),
    "intro": ("cup#/cup", "cup#/next", "cup#/favourite", "cup#/last", "cup#/rematch", "cup#/streak/", "cup#/defending"),
    "recap": ("cup#/cup", "cup#/round", "cup#/group/", "cup#/through", "cup#/next"),
    "ceremony": ("cup#/cup", "cup#/champion", "cup#/path", "cup#/defending", "cup#/last"),
    "close": ("cup#/cup", "cup#/champion", "cup#/next-cup"),
}
CALL_FACTS = ("cup#/cup", "cup#/next", "cup#/favourite")
WHATS = {
    "lead": "{} pulls the marker over to their side of the pit.",
    "ground": f"{{}} has pulled the marker {round(GROUND_M * 100)} cm their way.",
    "edge": "{} is at the edge of the pit.",
    "slip": "{} slips and leans hard.",
    "pit": "{} drops into the pit.",
}


def show_outline(cup: Cup) -> list[dict]:
    """The desk segments in airing order: the opening, an intro before every match, a recap after
    the last match of each group round, then the ceremony and the close."""
    rounds = [group_round(cup, match) if match.group else None for match in cup.matches] + [None]
    outline = [{"id": "opening", "kind": "opening", "after": -1}]
    for i, match in enumerate(cup.matches):
        outline.append({"id": f"intro-{match.match_id}", "kind": "intro",
                        "match_id": match.match_id, "after": i - 1})
        if rounds[i] and rounds[i] != rounds[i + 1]:
            outline.append({"id": f"recap-{rounds[i]}", "kind": "recap", "after": i})
    last = len(cup.matches) - 1
    return outline + [{"id": "ceremony", "kind": "ceremony", "after": last},
                      {"id": "close", "kind": "close", "after": last}]


def thin(moments: Sequence[Moment]) -> list[Moment]:
    """The moments a call has time to say: the start and the end of the bout, and between them
    only a moment CALL_GAP_S or more after the last one kept."""
    kept = []
    for moment in moments:
        if moment.kind in ("start", "pit", "time") or moment.at_s - kept[-1].at_s >= CALL_GAP_S:
            kept.append(moment)
    return kept


def _profiles(profiles: Mapping[str, Fact], ducks: Sequence[Entrant]) -> list[Fact]:
    return [profiles[duck.user] for duck in ducks if duck.user in profiles]


def _desk_facts(cup: Cup, segment: dict, history: Sequence[Cup], manifest: Manifest,
                profiles: Mapping[str, Fact]) -> list[Fact]:
    """What a desk segment may cite: the cup's facts it is about, and the profiles of the
    favourites (opening), the next pair (intro) or the champion (ceremony, close)."""
    kind, before = segment["kind"], segment["after"] + 1
    wanted = DESK_FACTS[kind]
    if kind == "opening":
        ducks = sorted(cup.entrants, key=lambda e: (-e.rating, e.user))[:2]
    elif kind == "intro":
        upcoming = cup.matches[before]
        wanted += (f"cup#/group/{upcoming.group}",) if upcoming.group else ()
        ducks = [cup.entrants[upcoming.a], cup.entrants[upcoming.b]]
    elif kind == "recap":
        ducks = []
    else:
        ducks = [cup.entrants[cup.matches[-1].winner]]
    facts = [fact for fact in cup_facts(cup, before, history, manifest)
             if fact.ref.startswith(wanted)]
    return facts + _profiles(profiles, ducks)


def _desk_dialogue(facts: list[Fact], kind: str, recent: list[dict], *, lore: Lore, provider,
                   model: str, rng: random.Random) -> tuple[dict, dict]:
    """A direction drawn for one desk segment, and the dialogue written to it."""
    drawn = {**direction(rng, recent, lore.scenes), "turns": rng.choice(DESK_TURNS[kind]),
             "angle": f"{DESK_ANGLES[kind]} {DESK_NUMBERS}", "player": f"{DESK_PLAYERS[kind]} {DESK_HANDLES}",
             "callback": NO_CALLBACK}
    return drawn, write(facts, drawn, lore=lore, provider=provider, model=model)


def _told(cup: Cup, manifest: Manifest, match: MatchRecord, bout: BoutResult,
          aired: Sequence[Moment]) -> list[dict]:
    """A bout's moments as its call is told them, every duck by its on-air name: the last one
    adds the bout's result, and the deciding bout's the match's."""
    # A draw before the time limit is a step MuJoCo had to reset: its last moment, the trace's
    # last frame, is no time up.
    reset = bout.how == "draw" and bout.time_s < manifest.bout.time_limit_s - CTRL_DT / 2
    a, b = cup.entrants[match.a].name, cup.entrants[match.b].name
    west, east = (a, b) if bout.a_side == "west" else (b, a)
    ducks = {"west": west, "east": east}

    def score(bouts: int) -> str:
        wa, wb = (sum(one.winner == side for one in match.bouts[:bouts]) for side in "ab")
        return f"the score is {a} {wa}, {b} {wb}."

    whats = []
    for moment in aired:
        duck = ducks.get(moment.side)
        if moment.kind == "start":
            whats.append(f"Bout {bout.k + 1} starts, {west} on the west side and {east} on the "
                         f"east; {score(bout.k)}")
        elif moment.kind == "time" and reset:
            whats.append("The bout is stopped and called a draw.")
        elif moment.kind == "time":
            whats.append(f"Time is up with the marker on {duck}'s side." if duck
                         else "Time is up with the marker dead centre.")
        else:
            whats.append(WHATS[moment.kind].format(duck))
    if bout.winner:
        whats[-1] += f" {a if bout.winner == 'a' else b} wins the bout; {score(bout.k + 1)}"
    elif not reset:
        whats[-1] += " Nobody wins the bout."
    if bout is match.bouts[-1]:
        winner = cup.entrants[match.winner].name
        whats[-1] += (f" After {len(match.bouts)} bouts without {manifest.bout.bouts_to_win} wins, "
                      f"the match goes to {winner} on the rating." if match.decided_by == "rating"
                      else f" {winner} wins the match {score_text(match)}.")
    return [{"index": i, "second": moment.at_s, "what": what}
            for i, (moment, what) in enumerate(zip(aired, whats))]


def _tried(log, what: str, writer, *args, **kwargs):
    """The writer's answer, asked again on a refusal: TRIES in all, each refusal logged, the last
    one raised."""
    for attempt in range(1, TRIES + 1):
        try:
            return writer(*args, **kwargs)
        except Rejected as why:
            log(f"show: {what} refused ({why})")
            if attempt == TRIES:
                raise


def write_show(cup: Cup, *, manifest: Manifest, history: Sequence[Cup], lore: Lore, provider,
               model: str, tab, rng: random.Random, profiles: Mapping[str, Fact],
               footage: Mapping[str, dict], done: dict | None = None, log=print) -> dict:
    """Every desk segment, then every match's call, each put into `done` the moment it is timed, so
    a show cut off by the router resumes where it stopped. `footage[match_id]` is where the
    match's clip tapes each bout and the bout's moments."""
    show = {"desk": {}, "calls": {}} if done is None else done
    for segment in show_outline(cup):
        if segment["id"] in show["desk"]:
            continue
        facts = _desk_facts(cup, segment, history, manifest, profiles)
        recent = [one["dialogue"]["brief"]["direction"] for one in reversed(show["desk"].values())]
        drawn, written = _tried(log, segment["id"], _desk_dialogue, facts, segment["kind"], recent,
                                lore=lore, provider=provider, model=model, rng=rng)
        plan = tab.prepare({"run_id": f"{cup.event_id}-{cup.number:04d}-{segment['id']}",
                            "turns": written["turns"]})
        show["desk"][segment["id"]] = {
            "kind": segment["kind"], "after": segment["after"],
            "dialogue": {"turns": written["turns"], "brief": {
                "facts": [{"ref": f.ref, "kind": f.kind, "text": f.text} for f in facts],
                "direction": drawn, "model": written["model"]}},
            "plan": plan, "screen": screen_view(cup, segment["after"] + 1, manifest)}
    for match in cup.matches:
        if match.match_id in show["calls"]:
            continue
        facts = [fact for fact in cup_facts(cup, match.index, history, manifest)
                 if fact.ref in CALL_FACTS]
        facts += _profiles(profiles, [cup.entrants[match.a], cup.entrants[match.b]])
        taped, lines, first = footage[match.match_id], [], "peter"
        for bout, tape in zip(match.bouts, taped["bouts"], strict=True):
            aired = thin(tape["moments"])
            written = _tried(log, f"{match.match_id} bout {bout.k + 1}", write_call, facts,
                             _told(cup, manifest, match, bout, aired), first, lore=lore,
                             provider=provider, model=model)
            start, end, seconds = tape["tape_start_s"], tape["tape_end_s"], tape["seconds"]
            lines += [{"at_ms": round(1000 * (start + (end - start) * moment.at_s / seconds)), **line}
                      for moment, line in zip(aired, written["lines"])]
            first = "ray" if lines[-1]["speaker"] == "peter" else "peter"
        plan = tab.prepare_call({"id": match.match_id, "lines": lines,
                                 "duration_ms": taped["duration_ms"]})
        show["calls"][match.match_id] = {"lines": lines, "plan": plan}
    return show


def match_footage(store, cup: Cup, manifest: Manifest) -> dict:
    """Per match, its clip's length and, per bout, where the clip tapes it and its moments, read
    from its trace; LookupError for a match whose clip is not ready."""
    offset, footage = string_offset(manifest.rig), {}
    for match in cup.matches:
        state, clip = store.clip_state(match.match_id)
        if state != "ready":
            raise LookupError(f"the clip of {match.match_id} is {state}")
        landscape, bouts = clip["layouts"]["landscape"], []
        for tape in landscape["timing"]["bouts"]:
            trace = decode(store.cup_file(cup.event_id, cup.number,
                                          f"bouts/{match.match_id}-{tape['k']}.npz"))
            bouts.append({**tape, "seconds": trace.shape[1] * CTRL_DT,
                          "moments": moments(trace, manifest.course, offset)})
        footage[match.match_id] = {"duration_ms": round(landscape["seconds"] * 1000), "bouts": bouts}
    return footage


def earlier_cups(store, cup: Cup) -> list[Cup]:
    """The event's cups before this one that were played: what its show may recall."""
    earlier = (load_cup(store, cup.event_id, number) for number in store.cup_numbers(cup.event_id)
               if number < cup.number)
    return [one for one in earlier if one.matches]


def compose_show(store, cup: Cup, *, lore: Lore, provider, model: str, tab, rng: random.Random,
                 done: dict, log=print) -> dict:
    """The cup's show from the store: its event, the cups before it, its players' seasons and
    its match clips, `done` filled as it is written."""
    manifest = load_event(cup.event_id)
    history = earlier_cups(store, cup)
    return write_show(cup, manifest=manifest, history=history, lore=lore, provider=provider,
                      model=model, tab=tab, rng=rng, profiles=player_profiles(store, cup, history),
                      footage=match_footage(store, cup, manifest), done=done, log=log)

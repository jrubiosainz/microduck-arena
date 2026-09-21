"""Measure a collected session: what repeats on the air, and what the reserve's log says.

The owner hears three kinds of sameness — the same phrases, the same props and
gags, the same mechanic of the exchange — and each has a measure here. None of
them gates anything: the channel has already said what this reads.

    uv run --frozen python scripts/commentary_bench.py ~/arena-sessions/2026-09-21-baseline \
        --log space.log

At least thirty dialogues, and two sessions before any conclusion: at twenty
samples a rate moves by three on its own.
"""

import argparse
import json
import re
from collections import Counter
from pathlib import Path

WINDOW = 20  # the dialogues aired before one, against which its sentences are compared
GRAM = 4
_FUNCTION_WORDS_TEXT = (
    "a about after again all also am an and any are as at be because been before being but by "
    "can could did do does doing down for from had has have having here how i if in into is it "
    "its just like me more most much my no nor not now of off on once only or other our out "
    "over own same so some such than that the their them then there these they this those "
    "through to too under until up very was we were what when where which while who whom why "
    "will with would yet you your")
FUNCTION_WORDS = frozenset(_FUNCTION_WORDS_TEXT.split())
LOG_LINE = re.compile(r"commentary: \S+ (written|refused|not written)(?: \((.*))?")


def load(directory: Path) -> list[dict]:
    """A session in air order: a file's name begins with its slot's millisecond."""
    return [json.loads(path.read_text()) for path in sorted(directory.glob("*.json"))]


def tokens(text: str) -> list[str]:
    return re.findall(r"[^\W_]+", text.casefold())


def grams(text: str) -> set[tuple[str, ...]]:
    found = tokens(text)
    return {tuple(found[i:i + GRAM]) for i in range(len(found) - GRAM + 1)}


def own_sentences(one: dict) -> list[set]:
    """Each spoken sentence of four words or more as its 4-grams, the facts' own left out:
    a line lifted from a fact is the fact's repetition, not the writer's."""
    given = set().union(*(grams(fact["text"]) for fact in one["dialogue"]["brief"]["facts"]))
    spoken = [sentence for turn in one["dialogue"]["turns"]
              for sentence in re.split(r"(?<=[.!?])\s+", turn["text"])]
    return [grams(sentence) - given for sentence in spoken if grams(sentence)]


def repeats(session: list[dict]) -> tuple[int, int]:
    """How many sentences were heard before, of how many: a sentence is a repeat when at
    least half of its 4-grams occur in the WINDOW dialogues aired before it."""
    heard: list[set] = []
    repeated = total = 0
    for one in session:
        before = set().union(*heard[-WINDOW:])
        sentences = own_sentences(one)
        total += len(sentences)
        repeated += sum(1 for own in sentences if own and 2 * len(own & before) >= len(own))
        heard.append(set().union(*sentences))
    return repeated, total


def tics(session: list[dict], top: int = 15) -> list[tuple[str, int]]:
    """The 4-grams the most dialogues share, with how many dialogues."""
    shared = Counter(gram for one in session for gram in set().union(*own_sentences(one)))
    return [(" ".join(gram), count) for gram, count in shared.most_common(top) if count > 1]


def props(session: list[dict], top: int = 20) -> list[tuple[str, float]]:
    """The writer's own vocabulary by share of dialogues: the words no fact about the run
    contains. A memory is not such a fact — a prop out of the bible is still a prop."""
    used = Counter()
    for one in session:
        given = {word for fact in one["dialogue"]["brief"]["facts"] if fact["kind"] != "lore"
                 for word in tokens(fact["text"])}
        said = {word for turn in one["dialogue"]["turns"] for word in tokens(turn["text"])}
        used.update(said - given - FUNCTION_WORDS)
    return [(word, count / len(session)) for word, count in used.most_common(top)]


def landing(lines) -> Counter:
    """The reserve's attempts by outcome and reason. An exception's message changes with
    every call, so a dialogue that was not written is counted by the exception's type."""
    tally = Counter()
    for line in lines:
        found = LOG_LINE.search(line)
        if found:
            outcome, why = found.groups()
            if outcome == "written":
                tally["written"] += 1
            elif outcome == "refused":
                tally[f"refused: {why.rstrip().removesuffix(')')}"] += 1
            else:
                tally[f"not written: {why.partition(':')[0]}"] += 1
    return tally


def report(session: list[dict], log_lines: list[str]) -> str:
    repeated, total = repeats(session)
    out = [f"{len(session)} dialogues", "",
           f"PHRASES  repeated sentences: {repeated} of {total} ({repeated / total:.0%})"]
    out += [f"  {count:3d}  {gram}" for gram, count in tics(session)]
    out += ["", "PROPS  the writer's own words, by share of dialogues"]
    out += [f"  {share:4.0%}  {word}" for word, share in props(session)]
    if log_lines:
        tally = landing(log_lines)
        out += ["", f"LANDING  {sum(tally.values())} attempts"]
        out += [f"  {count:3d}  {why}" for why, count in tally.most_common()]
    return "\n".join(out)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("session", type=Path, help="a directory collect_broadcasts.py filled")
    parser.add_argument("--log", type=Path, help="the reserve's log: the Space's or a server's")
    args = parser.parse_args()
    session = load(args.session)
    if not session:
        parser.error(f"no dialogue in {args.session}")
    log_lines = args.log.read_text().splitlines() if args.log else []
    print(report(session, log_lines))


if __name__ == "__main__":
    main()

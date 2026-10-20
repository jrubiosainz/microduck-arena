"""A weekly cup's records and calendar. Pure: no I/O, no clock."""

import json
import re
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from arena.manifest import CupRules
from arena.match import BoutResult

GROUP_NAMES = "ABCDEFGHIJKLMNOP"
_STAMP = "%Y-%m-%dT%H:%M:%SZ"
_MATCH_ID = re.compile(r"^([a-z0-9-]+)-(\d{4})-(\d{3})$")


def iso(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime(_STAMP)


def parse_iso(stamp: str) -> datetime:
    return datetime.strptime(stamp, _STAMP).replace(tzinfo=UTC)


@dataclass(frozen=True)
class Entrant:
    user: str
    run_id: str
    policy_name: str
    livery: str
    rating: float
    model_sha256: str
    source: dict  # RunRecord.source: where the policy is fetched from
    name: str  # the duck's on-air name in this cup: policy_name, or "policy_name (@user)" on a clash

    def view(self) -> dict:
        return {"user": self.user, "policy_name": self.policy_name, "name": self.name,
                "livery": self.livery, "rating": self.rating, "run_id": self.run_id}

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, raw: dict) -> "Entrant":
        return cls(**raw)


@dataclass(frozen=True)
class MatchRecord:
    match_id: str
    index: int  # position in playing order
    round: str  # "group" | "round of 16" | "quarter-final" | "semi-final" | "final" | "round of 2n"
    group: str | None  # "A", "B", … on a group match
    a: int
    b: int  # entrant indices
    bouts: tuple[BoutResult, ...]
    wins: tuple[int, int]
    winner: int  # entrant index
    decided_by: str

    def to_dict(self) -> dict:
        return {"match_id": self.match_id, "index": self.index, "round": self.round, "group": self.group,
                "a": self.a, "b": self.b, "bouts": [bout.to_dict() for bout in self.bouts],
                "wins": list(self.wins), "winner": self.winner, "decided_by": self.decided_by}

    @classmethod
    def from_dict(cls, raw: dict) -> "MatchRecord":
        return cls(raw["match_id"], raw["index"], raw["round"], raw["group"], raw["a"], raw["b"],
                   tuple(BoutResult.from_dict(bout) for bout in raw["bouts"]), tuple(raw["wins"]),
                   raw["winner"], raw["decided_by"])


@dataclass(frozen=True)
class Cup:
    event_id: str
    number: int
    close_at: str  # ISO "…Z"
    premiere_at: str  # the scheduled premiere, ISO "…Z"
    secret: str  # 32 hex chars, drawn at close
    entrants: tuple[Entrant, ...]
    groups: tuple[tuple[int, ...], ...]  # () when skipped
    skipped: bool = False  # fewer than min_entrants
    matches: tuple[MatchRecord, ...] = ()  # group rounds, then the knockout, in playing order
    order: dict | None = None  # {"starts_at": ISO, "segments": [...]}, once fixed

    def draw_json(self) -> bytes:
        return json.dumps({
            "event_id": self.event_id, "number": self.number, "close_at": self.close_at,
            "premiere_at": self.premiere_at, "secret": self.secret,
            "entrants": [entrant.to_dict() for entrant in self.entrants],
            "groups": [list(group) for group in self.groups], "skipped": self.skipped,
        }).encode()

    def matches_json(self) -> bytes:
        return json.dumps({"matches": [match.to_dict() for match in self.matches]}).encode()

    @classmethod
    def from_json(cls, draw: bytes, matches: bytes | None = None, order: bytes | None = None) -> "Cup":
        raw = json.loads(draw)
        played = () if matches is None else tuple(MatchRecord.from_dict(m) for m in json.loads(matches)["matches"])
        return cls(raw["event_id"], raw["number"], raw["close_at"], raw["premiere_at"], raw["secret"],
                   tuple(Entrant.from_dict(e) for e in raw["entrants"]),
                   tuple(tuple(group) for group in raw["groups"]), raw["skipped"], played,
                   None if order is None else json.loads(order))


def match_id(event_id: str, number: int, index: int) -> str:
    return f"{event_id}-{number:04d}-{index:03d}"


def parse_match_id(text: str) -> tuple[str, int, int] | None:
    found = _MATCH_ID.match(text)
    return None if found is None else (found[1], int(found[2]), int(found[3]))


def is_match_id(clip_id: str) -> bool:
    return parse_match_id(clip_id) is not None


def cup_times(rules: CupRules, number: int) -> tuple[datetime, datetime]:
    """(close_at, premiere_at) of cup `number`: the local wall clock steps by weeks, the close is absolute."""
    day = rules.first + timedelta(weeks=number - 1)
    premiere = datetime.combine(day, rules.premiere, ZoneInfo(rules.timezone)).astimezone(UTC)
    return premiere - timedelta(hours=rules.close_before_h), premiere


def closed_cups(rules: CupRules, now: datetime) -> int:
    number = 0
    while cup_times(rules, number + 1)[0] <= now:
        number += 1
    return number

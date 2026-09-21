"""The reserve: dialogues written before the grid needs them.

A booth can only be laid once its dialogue exists, because the slot's length is
the dialogue's length. So the writing runs ahead of the playhead: the reserve
walks the order the next cycle will play and keeps the first few runs stocked.
A run with nothing waiting simply gets no booth, which is a state the channel
already knows how to be in.
"""

import threading
import time

from ..broadcasts import utcnow
from ..live import cycle
from .generator import Rejected

DEPTH = 8  # runs kept stocked: about ten minutes of programme
PER_HOUR = 120  # generation attempts, refusals included; steady state is about 80
IDLE_S = 5.0  # how long to wait when every run in reach is stocked
RETRY_S = 300.0  # how long a refused run waits: the grid's horizon


class CommentaryStock:
    def __init__(self, book, tab, compose, pool, *, depth: int = DEPTH,
                 per_hour: int = PER_HOUR, log=print, landed=lambda: None,
                 now=time.monotonic, clock=utcnow):
        self.book = book
        self.tab = tab
        self.compose = compose
        self.pool = pool
        self.depth = depth
        self.per_hour = per_hour
        self.log = log
        self.landed = landed
        self.now = now
        self.clock = clock
        self._attempts: list[float] = []
        # When each run was last refused. A refusal is the run's own — its facts,
        # its direction — so trying it again at once mostly buys the same refusal:
        # one run took more than half of a measured session's refusals that way,
        # every five seconds, out of the hourly cap every other run shares.
        self._refused: dict[str, float] = {}
        # Where the walk resumes after a failure that is not the run's own: a
        # broken tab must not pin it on the same run forever, so the very next
        # turn tries the one after it. A landed dialogue resets it — the front of
        # the order is what matters.
        self._cursor = 0
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    @property
    def available(self) -> bool:
        return self.tab is not None

    def attempts_left(self) -> int:
        edge = self.now() - 3600
        self._attempts = [at for at in self._attempts if at > edge]
        return max(0, self.per_hour - len(self._attempts))

    def wanted(self) -> list[str]:
        """The next runs to reach the screen that have no dialogue waiting and
        were not refused in the last RETRY_S."""
        edge = self.now() - RETRY_S
        self._refused = {run_id: at for run_id, at in self._refused.items() if at > edge}
        stocked = self.book.runs_stocked()
        order = cycle(self.pool(), 0)
        return [entry.run_id for entry in order
                if entry.run_id not in stocked and entry.run_id not in self._refused][:self.depth]

    def turn(self) -> str | None:
        """One unit of work: at most one dialogue written. The run it wrote for,
        or None when nothing was wanted, the cap is reached, or it was refused."""
        self.book.sweep(self.clock())
        if not self.attempts_left():
            return None
        wanted = self.wanted()
        if not wanted:
            return None
        index = self._cursor % len(wanted)
        run_id = wanted[index]
        self._attempts.append(self.now())
        put = False
        try:
            written = self.compose(run_id)
            plan = self.tab.prepare({"run_id": run_id, "turns": written["turns"]})
            self.book.put(run_id, {"turns": written["turns"], "lore_refs": written["lore_refs"],
                                   "brief": written["brief"]}, plan, self.clock())
            put = True
            self.log(f"commentary: {run_id} written")
            self.landed()
        except Rejected as why:
            # About four in ten are refused on the real log. It is the local
            # checks doing their job, not a fault: the run waits, and the walk
            # goes on with the others.
            self.log(f"commentary: {run_id} refused ({why})")
            self._refused[run_id] = self.now()
            return None
        except Exception as exc:  # noqa: BLE001 — a dead browser, a plan the
            # book refuses (not a whole number of 40 ms frames) or the
            # caller's own landed() can all raise here, none of them only an
            # OSError, a RuntimeError or a ValueError (ConnectionClosed is
            # none of the three). Nothing in this whole unit of work may end
            # the reserve's thread for the life of the process, so it is
            # logged — truthfully, since the dialogue may already be written
            # by the time landed() is what failed — and the walk moves on.
            if put:
                self.log(f"commentary: {run_id} written, but the programme was not "
                         f"told ({type(exc).__name__}: {exc})")
            else:
                self.log(f"commentary: {run_id} not written ({type(exc).__name__}: {exc})")
            self._cursor = index + 1
            return None
        self._cursor = 0
        return run_id

    def _work(self) -> None:
        # The reserve outlives every failure, the way the clip worker does, or
        # the writing ends for the life of the process while the boot line still
        # says the booth is on. A turn is not only the generation: it sweeps the
        # book and reads the pool, which on the Space is the Hub — one 429, one
        # expired token, one network blip, and this thread would be gone.
        while not self._stop.is_set():
            try:
                wrote = self.turn()
            except Exception as exc:  # noqa: BLE001 — see above
                self.log(f"commentary: the reserve lost a turn ({type(exc).__name__}: {exc})")
                wrote = None
            if wrote is None:
                self._stop.wait(IDLE_S)

    def start(self) -> None:
        if self._thread is None:
            self._thread = threading.Thread(target=self._work, name="arena-commentary",
                                            daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self.tab is not None:
            self.tab.close()

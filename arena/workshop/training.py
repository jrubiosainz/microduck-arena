"""A training this workshop launched and follows, as `uv run --no-sync train …` in the checkout.

On this machine the process IS the training. On Hugging Face Jobs it is `train … --hf-jobs`, which
submits the job and streams its log until the job ends. The job's uploader pushes the run to a Hub
repo that mirrors logs/rsl_rl/; this pulls that repo back into logs/rsl_rl/ every two minutes and
once more at the end, so the evaluator and Publish find an HF run exactly where they find a local
one. Every launch is written down (jobs.py): it outlives this process.
"""

import os
import re
import shlex
import signal
import subprocess
import threading
from datetime import UTC, datetime

from .jobs import remember_job
from .runs import LOGS
from .shell import child_env, uv

PULL_EVERY_S = 120.0
_JOB_ID = re.compile(r"^\[job\] id:\s+(\S+)")
_ITERATION = re.compile(r"Learning iteration (\d+)/(\d+)")
# Every download into logs/rsl_rl/ in turn: a followed job's pulls, and the watcher's (watch.py).
_PULLING = threading.Lock()


def ckpt_repo(user: str, challenge, name: str) -> str:
    return f"{user}/{challenge.task.lower()}-{name}"


def fetch(root, repo: str) -> subprocess.CompletedProcess:
    """Bring an HF job's checkpoint repo, a mirror of logs/rsl_rl/, back into logs/rsl_rl/."""
    with _PULLING:
        return subprocess.run(
            uv("hf", "download", repo, "--local-dir", str(LOGS), "--quiet"),
            cwd=root, capture_output=True, text=True, env=child_env(), check=False,
        )


def train_command(challenge, name: str, recipe: dict[str, int], hf_user: str | None) -> list[str]:
    """`hf_user` is the Hugging Face account the job runs (and is billed) under; None trains here."""
    command = uv(
        "train", challenge.task,
        "--env.scene.num-envs", str(recipe["num_envs"]),
        "--agent.max-iterations", str(recipe["max_iterations"]),
        "--agent.seed", str(recipe["seed"]),
        "--agent.logger", "tensorboard",
        "--agent.run-name", name,
    )
    if hf_user:
        command += ["--hf-jobs", "--no-wandb", "--namespace", hf_user,
                    "--ckpt-repo", ckpt_repo(hf_user, challenge, name)]
    return command


class Training:
    def __init__(self, root, challenge, name: str, where: str, recipe: dict[str, int],
                 params: dict[str, float], hf_user: str | None = None):
        """`where` is "local" or "hf-jobs"; `hf_user` the account an HF job runs (and is billed) under."""
        self.root, self.task, self.name, self.where = root, challenge.task, name, where
        self.namespace = hf_user if where == "hf-jobs" else None
        self.ckpt_repo = ckpt_repo(hf_user, challenge, name) if self.namespace else None
        command = train_command(challenge, name, recipe, self.namespace)
        self.returncode: int | None = None
        self._lines = [f"$ {shlex.join(command)}"]
        self._job_id: str | None = None
        self._progress: tuple[int, int] | None = None
        # The log, the job id and the progress: written by the follower, read by the pages.
        self._lock = threading.Lock()
        self._ended = threading.Event()
        self._stopped = False
        self.proc = subprocess.Popen(
            command, cwd=root, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, errors="replace", bufsize=1, env=child_env(), start_new_session=True,
        )
        # Before the log is read: its job ids update this record.
        hf = {"ckpt_repo": self.ckpt_repo, "namespace": self.namespace, "job_id": None} if self.ckpt_repo else {}
        remember_job(root, self.task, name, where=where, recipe=recipe, params=params,
                     started=datetime.now(UTC).isoformat(timespec="seconds"), **hf)
        threading.Thread(target=self._follow, daemon=True).start()
        if self.ckpt_repo:
            threading.Thread(target=self._pull_while_running, daemon=True).start()

    def _say(self, line: str) -> None:
        # A resubmitted job (mjlab retries on a volume-mount failure) prints a fresh id; the last one
        # seen is the one actually running and billed.
        job = _JOB_ID.match(line) if self.ckpt_repo else None
        iteration = _ITERATION.search(line)
        with self._lock:
            self._lines.append(line)
            if job:
                self._job_id = job.group(1)
            if iteration:
                self._progress = (int(iteration.group(1)), int(iteration.group(2)))
        if job:
            remember_job(self.root, self.task, self.name, job_id=job.group(1))

    def _follow(self) -> None:
        for line in self.proc.stdout:
            self._say(line.rstrip("\n"))
        code = self.proc.wait()
        self._ended.set()
        if self.ckpt_repo:
            self.pull()  # whatever the job saved last
        with self._lock:
            self.returncode = code  # read by `state`; set with the log so a snapshot is never torn
        if not self.ckpt_repo or not self.job_id:
            # How it ended, for its ticket after a restart. An HF job with an id ends by the Hub's word.
            remember_job(self.root, self.task, self.name, ended=self.state)

    def _pull_while_running(self) -> None:
        while not self._ended.wait(PULL_EVERY_S):
            self.pull()

    def pull(self) -> None:
        done = fetch(self.root, self.ckpt_repo)
        if done.returncode == 0:
            self._say(f"[workshop] fetched the checkpoints from {self.ckpt_repo}")
        else:
            self._say(f"[workshop] could not fetch {self.ckpt_repo}:")
            for line in (done.stdout + done.stderr).splitlines():
                self._say(line)

    @property
    def job_id(self) -> str | None:
        with self._lock:
            return self._job_id

    @property
    def progress(self) -> tuple[int, int] | None:
        """(iteration, iterations) as the log last said it."""
        with self._lock:
            return self._progress

    @property
    def state(self) -> str:
        if self.returncode is None:
            return "running"
        if self._stopped:
            return "stopped"
        return "finished" if self.returncode == 0 else "failed"

    def stop(self, hub) -> None:
        """Cancel the HF job first — killing `train --hf-jobs` would only detach from it — then end
        the local process. A no-op once the process has already ended: the state can still read
        "running" while the final pull is in flight, and by then there is no job left to cancel and
        the pid may already have been recycled (`_follow` reaps it right away).
        """
        if self._ended.is_set():
            return
        if self.ckpt_repo and (job := self.job_id):
            hub.cancel_job(job, self.namespace)  # the only call in this method the caller need worry about
            remember_job(self.root, self.task, self.name, stage="CANCELED")  # nothing left to ask the Hub
            self._say(f"[workshop] cancelled job {job}")
        self._stopped = True
        try:
            os.killpg(self.proc.pid, signal.SIGTERM)
        except OSError:
            pass

    def log(self, since: int = 0) -> tuple[list[str], int]:
        """The lines from `since`, and where the next read starts."""
        with self._lock:
            return self._lines[max(since, 0):], len(self._lines)

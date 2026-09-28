"""One training at a time, as `uv run --no-sync train …` in the checkout.

With an NVIDIA GPU the process IS the training. Without one it is `train …
--hf-jobs`, which submits the job and streams its log until the job ends. The
job's uploader pushes the run to a Hub repo that mirrors logs/rsl_rl/; this
pulls that repo back into logs/rsl_rl/ every few minutes and once more at the
end, so Test and Publish find an HF run exactly where they find a local one.
"""

import os
import re
import shlex
import signal
import subprocess
import threading

from .runs import LOGS
from .shell import child_env, uv

PULL_EVERY_S = 120.0
_JOB_ID = re.compile(r"^\[job\] id:\s+(\S+)")


def ckpt_repo(user: str, challenge, name: str) -> str:
    return f"{user}/{challenge.task.lower()}-{name}"


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
    def __init__(self, root, name: str, command: list[str], ckpt_repo: str | None = None, namespace: str | None = None):
        self.root, self.name, self.ckpt_repo, self.namespace = root, name, ckpt_repo, namespace
        self.returncode: int | None = None
        self._lines = [f"$ {shlex.join(command)}"]
        self._lock = threading.Lock()
        self._pulling = threading.Lock()
        self._ended = threading.Event()
        self._stopped = False
        self.proc = subprocess.Popen(
            command, cwd=root, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1, env=child_env(), start_new_session=True,
        )
        threading.Thread(target=self._follow, daemon=True).start()
        if ckpt_repo:
            threading.Thread(target=self._pull_while_running, daemon=True).start()

    def _say(self, line: str) -> None:
        with self._lock:
            self._lines.append(line)

    def _follow(self) -> None:
        for line in self.proc.stdout:
            self._say(line.rstrip("\n"))
        code = self.proc.wait()
        self._ended.set()
        if self.ckpt_repo:
            self.pull()  # whatever the job saved last
        self.returncode = code  # read by `state`: set last, after the final pull

    def _pull_while_running(self) -> None:
        while not self._ended.wait(PULL_EVERY_S):
            self.pull()

    def pull(self) -> bool:
        with self._pulling:  # the periodic pull and a button press never overlap
            done = subprocess.run(
                uv("hf", "download", self.ckpt_repo, "--local-dir", str(LOGS), "--quiet"),
                cwd=self.root, capture_output=True, text=True, env=child_env(),
            )
        if done.returncode == 0:
            self._say(f"[workshop] fetched the checkpoints from {self.ckpt_repo}")
        else:
            self._say(f"[workshop] could not fetch {self.ckpt_repo}:")
            for line in (done.stdout + done.stderr).splitlines():
                self._say(line)
        return done.returncode == 0

    @property
    def job_id(self) -> str | None:
        with self._lock:
            return next((m.group(1) for line in self._lines if (m := _JOB_ID.match(line))), None)

    @property
    def state(self) -> str:
        if self.returncode is None:
            return "running"
        if self._stopped:
            return "stopped"
        return "finished" if self.returncode == 0 else "failed"

    def stop(self, hub) -> None:
        """Killing `train --hf-jobs` would only detach from the job, so an HF job is cancelled first."""
        if self.ckpt_repo and (job := self.job_id):
            hub.cancel_job(job, self.namespace)
            self._say(f"[workshop] cancelled job {job}")
        self._stopped = True
        try:
            os.killpg(self.proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass

    def snapshot(self, since: int = 0) -> dict:
        with self._lock:
            lines, total = self._lines[max(since, 0):], len(self._lines)
        return {
            "name": self.name, "mode": "hf-jobs" if self.ckpt_repo else "local", "state": self.state,
            "returncode": self.returncode, "ckpt_repo": self.ckpt_repo, "job_id": self.job_id,
            "log": lines, "next": total,
        }

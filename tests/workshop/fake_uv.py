"""`uv`, as the workshop calls it — `uv run --no-sync <command> …` — played without training anything.

Each call is appended to $FAKE_UV_LOG as JSON. `train` writes a run the way
mjlab does (provenance.json, model_0.pt and model_1.pt, the fixture TensorBoard
file); with --hf-jobs it prints what hf_jobs prints and writes the run into
$FAKE_HUB/<ckpt repo>/ instead, which `hf download` copies back. `publish
--dry-run` writes ./publish-<name>/ with $FAKE_UV_ONNX as policy.onnx; a real
`publish` prints the commit URL the real one prints and, with `--enter`, the
line an entry prints (FAKE_UV_ENTER_REFUSED=1: the refusal, exit 3). FAKE_UV_FAIL_<COMMAND>=1
makes that command fail; FAKE_UV_TRAIN_S keeps `train` alive that long;
FAKE_UV_RESUBMIT=1 prints a second `[job] id:` line, as `train --hf-jobs`
does when a volume mount fails and it resubmits. `hf auth login` prints what
huggingface_hub's browser flow prints without a terminal, waits FAKE_HF_LOGIN_S, then succeeds
(FAKE_HF_LOGIN_DENIED=1: fails; FAKE_HF_LOGIN_SILENT=1: prints no URL).
"""

import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path


def flag(argv, name, default=None):
    """`name value` or `name=value`, as an argparse-style parser reads either."""
    for i, arg in enumerate(argv):
        if arg == name:
            return argv[i + 1]
        if arg.startswith(f"{name}="):
            return arg.removeprefix(f"{name}=")
    return default


def train(argv):
    name = flag(argv, "--agent.run-name")
    commit = subprocess.run(["git", "rev-parse", "--short=9", "HEAD"], capture_output=True, text=True, check=False).stdout.strip()
    record = {"command": ["train", *argv], "task": argv[0], "seed": int(flag(argv, "--agent.seed", 42)),
              "commit": commit, "branch": "main", "dirty": False, "started": "2026-09-28T10:00:00Z"}
    if "--hf-jobs" in argv:
        repo = flag(argv, "--ckpt-repo")
        print(f"[ckpt] checkpoints -> https://huggingface.co/{repo}", flush=True)
        print("[job] id:  fakejob42", flush=True)
        if os.environ.get("FAKE_UV_RESUBMIT"):
            print("[job] volume mount failed; resubmitting", flush=True)
            print("[job] id:  fakejob43", flush=True)
        base = Path(os.environ["FAKE_HUB"]) / repo
    else:
        base = Path("logs") / "rsl_rl"
    run = base / "sprint_2m" / f"{datetime.now().astimezone():%Y-%m-%d_%H-%M-%S}_{name}"
    run.mkdir(parents=True)
    (run / "provenance.json").write_text(json.dumps(record))
    shutil.copy(os.environ["FAKE_UV_TFEVENTS"], run / "events.out.tfevents.1.fake")
    for n in (0, 1):
        (run / f"model_{n}.pt").write_bytes(b"pt")
    print("Learning iteration 1/2", flush=True)
    time.sleep(float(os.environ.get("FAKE_UV_TRAIN_S", "0")))
    return int(os.environ.get("FAKE_UV_TRAIN_RC", "0"))


def hf(argv):
    if argv[:2] == ["auth", "login"]:
        return login(argv)
    repo, dest = argv[1], Path(flag(argv, "--local-dir"))
    source = Path(os.environ["FAKE_HUB"]) / repo
    if source.is_dir():
        shutil.copytree(source, dest, dirs_exist_ok=True)
    print(dest)
    return 0


def login(argv):
    assert "--force" in argv, argv
    if os.environ.get("FAKE_HF_LOGIN_SILENT"):
        print("hf: unknown command 'auth'", file=sys.stderr)
        return 2
    print("\n    Open this URL in your browser:\n        https://huggingface.co/oauth/device?user_code=WDJB-MJHT\n", flush=True)
    print("    And enter the code: WDJB-MJHT\n", flush=True)
    print("    Waiting for authorization", end="", flush=True)
    time.sleep(float(os.environ.get("FAKE_HF_LOGIN_S", "0")))
    print()
    if os.environ.get("FAKE_HF_LOGIN_DENIED"):
        print("Authorization denied.", file=sys.stderr)
        return 1
    print("Login successful.")
    return 0


def publish(argv):
    name = flag(argv, "--name")
    if "--dry-run" in argv:
        out = Path(f"publish-{name}")
        out.mkdir(exist_ok=True)
        shutil.copy(os.environ["FAKE_UV_ONNX"], out / "policy.onnx")
        (out / "manifest.json").write_text(json.dumps({"name": name, "kind": "perpetual"}))
        (out / "README.md").write_text(f"# {name}\n")
        print(f"[publish] dry run: wrote {out.resolve()}/ (policy.onnx, manifest.json, README.md, checkpoint.pt)")
        return 0
    repo = flag(argv, "--repo")
    print(f"[publish] uploaded: https://huggingface.co/{repo}/commit/{'a' * 40}")
    if "--enter" in argv:
        if os.environ.get("FAKE_UV_ENTER_REFUSED"):
            print(f"[publish] uploaded https://huggingface.co/{repo}/commit/{'a' * 40}, "
                  "but the Arena did not enter it: 403: not yours", file=sys.stderr)
            return 3
        print(f"[publish] entered on sprint-2m: 4.892 s (5/5 seeds) at 0.55 m/s → {flag(argv, '--arena')}/#/r/fakerun1")
    return 0


def main():
    argv = sys.argv[1:]
    with open(os.environ["FAKE_UV_LOG"], "a") as log:
        log.write(json.dumps({"argv": argv, "cwd": os.getcwd()}) + "\n")
    assert argv[:2] == ["run", "--no-sync"], argv
    command, rest = argv[2], argv[3:]
    if os.environ.get(f"FAKE_UV_FAIL_{command.upper()}"):
        print(f"{command}: boom", file=sys.stderr)
        return 2
    return {"train": train, "hf": hf, "publish": publish}[command](rest)


if __name__ == "__main__":
    sys.exit(main())

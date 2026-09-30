"""Runs are found on disk, wherever they were trained; their curve is read from TensorBoard."""

import json
import shutil
import struct
from pathlib import Path

import pytest

from arena.workshop import eventfile
from arena.workshop.runs import curve, find_runs

PROBE = Path(__file__).resolve().parents[1] / "fixtures" / "workshop" / "events.out.tfevents.probe"
TASK = "Mjlab-Sprint2m-MicroDuck"


def _run(root, name, task=TASK, checkpoints=(0, 1, 2), stamp="2026-09-28_10-00-00", experiment="sprint_2m"):
    run = root / "logs" / "rsl_rl" / experiment / f"{stamp}_{name}"
    run.mkdir(parents=True)
    (run / "provenance.json").write_text(json.dumps({"task": task, "dirty": False}))
    for n in checkpoints:
        (run / f"model_{n}.pt").write_bytes(b"pt")
    shutil.copy(PROBE, run / "events.out.tfevents.1790586250.host.3263.0")
    return run


def test_runs_of_this_task_are_found_newest_first(tmp_path):
    _run(tmp_path, "first", stamp="2026-09-28_10-00-00")
    _run(tmp_path, "second", stamp="2026-09-28_11-00-00")
    _run(tmp_path, "rolling", task="Mjlab-RollerSprint2m-MicroDuck", experiment="roller_sprint_2m")
    (tmp_path / "logs" / "rsl_rl" / "sprint_2m" / "no-provenance").mkdir()
    runs = find_runs(tmp_path, TASK)
    assert [r.name for r in runs] == ["second", "first"]
    assert runs[0].id == "2026-09-28_11-00-00_second"


def test_checkpoints_are_listed_by_iteration_not_by_name(tmp_path):
    _run(tmp_path, "first", checkpoints=(0, 250, 1000, 2999))
    (run,) = find_runs(tmp_path, TASK)
    assert run.checkpoints == (0, 250, 1000, 2999)


def test_a_provenance_still_being_written_is_skipped_not_fatal(tmp_path):
    _run(tmp_path, "first")
    torn = _run(tmp_path, "pulling", stamp="2026-09-28_12-00-00")
    (torn / "provenance.json").write_text('{"task": "Mjlab-Spr')
    assert [r.name for r in find_runs(tmp_path, TASK)] == ["first"]


def test_the_curve_is_the_mean_reward_tensorboard_recorded(tmp_path):
    _run(tmp_path, "first")
    (run,) = find_runs(tmp_path, TASK)
    # pytest.approx() falls back to strict equality for non-numeric elements
    # (each (step, value) tuple is "non-numeric" from its point of view), so
    # each float is wrapped individually rather than the whole list at once.
    assert curve(run) == [(1, pytest.approx(-0.6283139)), (2, pytest.approx(-0.5193406))]


def test_a_run_without_tensorboard_files_has_no_curve_yet(tmp_path):
    run_dir = _run(tmp_path, "first")
    for events in run_dir.glob("events.out.tfevents.*"):
        events.unlink()
    (run,) = find_runs(tmp_path, TASK)
    assert curve(run) == []


def test_a_record_cut_off_mid_write_is_left_for_next_time(tmp_path):
    whole = PROBE.read_bytes()
    torn = tmp_path / "events.out.tfevents.torn"
    # A next record whose length has arrived but whose bytes have not all: what a
    # pull catches while the job's writer is mid-flush.
    torn.write_bytes(whole + whole[:20])
    assert eventfile.scalars(torn, "Train/mean_reward") == eventfile.scalars(PROBE, "Train/mean_reward")


def test_a_record_whose_payload_ends_mid_field_is_left_for_next_time(tmp_path):
    whole = PROBE.read_bytes()
    # A step field (protobuf field 2, varint wire type) whose length arrived in
    # full but whose continuation byte (0x85's high bit) never did: the length
    # check alone would accept this record, so the field walk itself must catch it.
    payload = bytes([16, 0x85])
    broken = tmp_path / "events.out.tfevents.broken"
    broken.write_bytes(
        whole + struct.pack("<Q", len(payload)) + b"\x00\x00\x00\x00" + payload + b"\x00\x00\x00\x00"
    )
    assert eventfile.scalars(broken, "Train/mean_reward") == eventfile.scalars(PROBE, "Train/mean_reward")
